import { invoke, isTauri } from '../core/tauri.ts';
import { preferences } from '../core/preferences.ts';
import type { Segment } from './markdown.ts';

/**
 * The transcriber, behind one interface, whichever one is running.
 *
 * Three engines answer it. On the phone it is Whisper in the Rust core: the page
 * streams microphone samples in and gets partial and committed text back as
 * events, and the recording is kept as the note's tape. In a desktop browser,
 * where there is no Rust, it is the browser's own speech recognition when it
 * has one - good enough to develop the capture screen against with a real
 * voice. And with `?simulate` in the URL it is a script that speaks a fixed
 * note on a timer, which is what makes the screen testable with no microphone.
 *
 * The page never learns which one it got beyond `kind`, which is shown so a
 * person can tell a real on-device transcription from a browser fallback.
 */

export type EngineKind = 'whisper' | 'browser' | 'simulated';

export interface CaptureHandlers {
  /** Best guess for speech not yet committed; replaces the previous one. */
  onPartial: (text: string) => void;
  /** Committed text, appended. */
  onSegment: (segment: Segment) => void;
  onError: (message: string) => void;
  /** Model download progress, only ever reported by the Whisper engine. */
  onModelProgress?: (receivedBytes: number, totalBytes: number) => void;
}

export interface StopOptions {
  /** Keep the audio as this note's tape. */
  recordAs?: string;
  /** Add to the note's existing tape rather than start it over. */
  append?: boolean;
}

export interface Stopped {
  /** The kept tape's whole length, or null when nothing was kept. */
  recordedMs: number | null;
  /**
   * The final decoder result, when the engine has one. Whisper produces this
   * from `capture_stop` after it has drained the last audio; phrase events can
   * still be in flight when the page removes its listeners. Browser, simulated,
   * and older native hosts do not have an authoritative final result.
   */
  transcript: string | null;
}

export interface CaptureSession {
  kind: EngineKind;
  /** Whether this engine wants the page's microphone samples. */
  wantsSamples: boolean;
  /** Whether `stop` can keep the recording (Whisper on a generation-6 binary). */
  keepsAudio: boolean;
  push: (samples: Float32Array) => void;
  /** How much has been recorded, in ms, on the timeline segment times use. */
  positionMs: () => number;
  /** Commit what remains and return the authoritative final transcript where the engine has one. */
  stop: (options?: StopOptions) => Promise<Stopped>;
  /** Drop it; resolves once the engine has let go (the Whisper session is gone), where that takes a trip to Rust. */
  cancel: () => void | Promise<void>;
}

/** Transfer a stopped temporary recording only after final confirmation. */
export async function reassignRecording(fromId: string, toId: string, append: boolean): Promise<number | null> {
  if (!isTauri()) return null;
  return await invoke<number | null>('capture_reassign_recording', { fromId, toId, append });
}

/** A cancelled/rejected command has no note to own its temporary recording. */
export async function discardRecording(id: string): Promise<void> {
  if (isTauri()) await invoke('capture_discard_recording', { id });
}

// ---- the model ----------------------------------------------------------------

export interface ModelStatus {
  present: boolean;
  name: string;
  path: string;
  bytes: number;
}

export async function modelStatus(): Promise<ModelStatus | null> {
  if (!isTauri()) return null;
  return invoke<ModelStatus>('capture_model_status');
}

/**
 * Make sure the model is on the phone, downloading it if not.
 *
 * Called when the app opens as well as when a capture starts, so the download -
 * about 60 MB - happens the first time Glyph is opened rather than the first
 * time the side key is held. A note started on a whim that has to wait for a
 * download is a note that does not get started.
 */
export async function ensureModel(onProgress?: (received: number, total: number) => void): Promise<ModelStatus | null> {
  if (!isTauri()) return null;
  const status = await modelStatus();
  if (status?.present) return status;
  // Local only: nothing is downloaded, and the recorder says why.
  if (preferences().localOnly) throw new Error('Local only is on, so the voice model was not downloaded. Turn it off in Settings to get it.');

  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<{ receivedBytes: number; totalBytes: number }>('capture://model-progress', (event) =>
    onProgress?.(event.payload.receivedBytes, event.payload.totalBytes),
  );
  try {
    return await invoke<ModelStatus>('capture_fetch_model');
  } finally {
    unlisten();
  }
}

// ---- engines ----------------------------------------------------------------------

export async function startCapture(handlers: CaptureHandlers): Promise<CaptureSession> {
  if (new URLSearchParams(window.location.search).has('simulate')) return simulated(handlers);
  if (isTauri()) return whisper(handlers);
  return browser(handlers);
}

/** The binary generation whose `capture_stop` keeps the recording. */
const RECORDING_GENERATION = 6;

/**
 * The Whisper session that owns the native capture, which there is only one of: every session's pushes land in the same
 * recording. A session that has been replaced (the "Glyph" listener's, once the recorder starts its own; a start that
 * was called off) must not keep pushing, or its audio is interleaved chunk by chunk with the live session's, and the
 * tape plays back as a stutter of two copies a few milliseconds apart that Whisper can't make sense of.
 */
let owner: symbol | null = null;

async function whisper(handlers: CaptureHandlers): Promise<CaptureSession> {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisteners = await Promise.all([
    listen<{ text: string }>('capture://partial', (event) => handlers.onPartial(event.payload.text)),
    listen<Segment>('capture://segment', (event) => handlers.onSegment(event.payload)),
    listen<{ message: string }>('capture://error', (event) => handlers.onError(event.payload.message)),
  ]);
  const unlistenAll = () => unlisteners.forEach((off) => off());

  await ensureModel(handlers.onModelProgress);

  /*
   * Samples that arrive before `capture_start` resolves are held, not dropped.
   * Starting loads the model on the first press after launch, which takes long
   * enough to swallow the first words - and the first words of a note are
   * usually its subject.
   */
  let started = false;
  /** Samples handed over, which is exactly the recording Rust holds once the chain drains. */
  let recorded = 0;
  const held: Float32Array[] = [];
  // Pushes are chained so they reach Rust in order; two in-flight invokes are
  // not guaranteed to land in the order they were sent.
  let chain: Promise<unknown> = Promise.resolve();
  const me = Symbol('capture');
  const send = (samples: Float32Array) => {
    if (owner !== me) return;
    recorded += samples.length;
    const pcm = toBase64(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    chain = chain.then(() => invoke('capture_push', { pcm })).catch((error: unknown) => handlers.onError(String(error)));
  };

  // Asked rather than assumed: a bundle carrying this page can run on a binary
  // from before recordings were kept, whose capture_stop takes no arguments.
  const generation = await invoke<{ nativeGeneration?: number }>('ota_status').then(
    (status) => status.nativeGeneration ?? 0,
    () => 0,
  );
  const keepsAudio = generation >= RECORDING_GENERATION;

  try {
    await invoke('capture_start');
  } catch (error) {
    unlistenAll();
    throw error;
  }
  // The native capture is this session's from here; any earlier session's pushes stop landing in it.
  owner = me;
  started = true;
  for (const samples of held.splice(0)) send(samples);

  return {
    kind: 'whisper',
    wantsSamples: true,
    keepsAudio,
    push: (samples) => {
      if (started) send(samples);
      else held.push(samples);
    },
    positionMs: () => (recorded * 1000) / 16_000,
    stop: async (options = {}) => {
      await chain;
      if (owner === me) owner = null;
      try {
        if (!keepsAudio) {
          await invoke<unknown>('capture_stop');
          return { recordedMs: null, transcript: null };
        }
        const finished = await invoke<{ transcript: string; recordedMs: number | null }>('capture_stop', {
          recordAs: options.recordAs ?? null,
          append: options.append ?? false,
        });
        return { recordedMs: finished.recordedMs, transcript: finished.transcript?.trim() || null };
      } finally {
        unlistenAll();
      }
    },
    cancel: () => {
      unlistenAll();
      // A session that no longer owns the native capture leaves it alone: cancelling would end the newer session's.
      if (owner !== me) return Promise.resolve();
      owner = null;
      return invoke('capture_cancel').then(
        () => undefined,
        () => undefined,
      );
    },
  };
}

/**
 * Bytes as base64, for the trip across the IPC bridge.
 *
 * NOT a raw `Uint8Array` handed straight to `invoke`, although that is the
 * natural shape and works on the desktop. Android's WebView cannot give native
 * code a request's body, so Tauri carries every payload there as JSON, and raw
 * bytes arrive in Rust as a JSON value that `capture_push` rejected - on the
 * Fold, every chunk of every capture, which is a capture screen that never
 * transcribes a word. Base64 is the same bytes in a string both bridges carry,
 * at a cost of about 17 KB per 200 ms chunk.
 *
 * Built in slices because `String.fromCharCode(...bytes)` on a large array
 * overruns the engine's argument limit; 0x8000 is comfortably under it.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The browser's own recogniser, for developing on a laptop. Chrome only. */
function browser(handlers: CaptureHandlers): CaptureSession {
  type Recognition = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
  };
  const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  if (!Ctor) throw new Error('Voice notes need the Ghost.md app; this browser has no speech recognition.');

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  const startedAt = performance.now();
  let lastEnd = 0;
  let running = true;
  let settle: (() => void) | null = null;
  const now = () => performance.now() - startedAt;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (result?.isFinal) {
        const at = now();
        handlers.onSegment({ text: text.trim(), startMs: lastEnd, endMs: at });
        lastEnd = at;
      } else {
        interim += text;
      }
    }
    handlers.onPartial(interim.trim());
  };
  recognition.onerror = (event) => handlers.onError(event.error);
  // Chrome ends a "continuous" session on its own after a silence; restart it
  // until the person actually stops.
  recognition.onend = () => {
    if (running) recognition.start();
    else settle?.();
  };
  recognition.start();

  return {
    kind: 'browser',
    wantsSamples: false,
    keepsAudio: false,
    push: () => undefined,
    positionMs: now,
    stop: () =>
      new Promise<Stopped>((resolve) => {
        running = false;
        settle = () => resolve({ recordedMs: null, transcript: null });
        recognition.stop();
      }),
    cancel: () => {
      running = false;
      recognition.stop();
    },
  };
}

/**
 * A fixed note, spoken on a clock, for exercising the screen without a
 * microphone. Each phrase arrives first as growing partials and then as a
 * committed segment, which is the rhythm the Whisper engine produces. It
 * "keeps" audio in the sense that stop answers with a length, so a note's tape
 * can be built against it.
 */
/**
 * `?simulate` speaks a note; `?simulate=route` speaks one that sends itself to
 * another note partway ("Glyph, move this to shopping list", yes) and then
 * pauses, so routing and the tips in a pause can be watched without a
 * microphone; `?simulate=leave` leaves a note in AttackFM, said in one phrase
 * and then in two; `?simulate=item` speaks "Glyph, new item for attack FM" and
 * items for its list; `?simulate=command` is Matt's case, "add a list item to"
 * with the item after a pause, answered yes, then one answered no, then the
 * keyword with no command after it; `?simulate=ask` stops at the question;
 * `?simulate=table` builds a table in AttackFM by answering its questions, and
 * `?simulate=tableask` stops at the table's yes; `?simulate=say&say=a|b` speaks
 * the phrases given, bar-separated. `?simulate=review&review`
 * says a note with a misheard word and, on Done, runs the review with its
 * models simulated (review/useReview.ts).
 */
const SCRIPTS: Record<string, string[]> = {
  note: [
    'Weekend trip.',
    'We need to book the cabin by Friday and the deposit is 200 dollars.',
    'For the drive we want snacks, water, a charger and the good playlist.',
    'Remember to ask Sam about the dog.',
    'Separately the car needs an oil change before we leave.',
  ],
  route: ['Oat milk, eggs and the good coffee.', 'Hey Ghost, move this to shopping list.', 'Yes.', 'And bin bags.'],
  leave: ['Quick thought before I forget.', 'Hey Ghost, leave a note on the page for attack FM that says the seek bar drifts on two devices.', 'Yes.', 'Hey Ghost, leave a note for attack FM.', 'Ship the APK on Friday.', 'Yes.'],
  item: ['Quick thought before I forget.', 'Hey Ghost, new item for attack FM.', 'Fix the login bug on Android.', 'Yes.', 'Hey Ghost, new tasks for attack FM.', 'Update the readme, ship the APK and tell Sam.', 'Yes.'],
  table: ['Bug bash on Friday.', 'Hey Ghost, add a table to attack FM.', 'Bug, owner and status.', 'Seek bar drift, Matt, open.', 'Downloads stuck, Sam, fixed.', "That's it.", 'Yes.'],
  giveback: ['Pick up the parcel.', 'Hey Ghost, that was a long day.'],
  review: ['Bug bash on Friday.', 'Fix the seat bar on two devices.', 'Downloads get stuck on the discover list.'],
  tableask: ['Bug bash on Friday.', 'Hey Ghost, add a table to attack FM.', 'Bug, owner and status.', 'Seek bar drift, Matt, open.', 'Downloads stuck, Sam, fixed.', "That's it."],
  ask: ['Quick thought before I forget.', 'Hey Ghost, add a list item to the attack FM.', 'Fix the seek bar.'],
  command: ['Quick thought before I forget.', 'Hey Ghost, add a list item to the attack FM.', 'Fix the seek bar.', 'Yes.', 'Hey Ghost add ship the APK to attack FM.', 'No.', 'Ghost is going to need a plugin store.'],
};

function simulated(handlers: CaptureHandlers): CaptureSession {
  const params = new URLSearchParams(window.location.search);
  // `?simulate=say&say=First phrase.|Second phrase.` speaks whatever is given, a phrase per bar: any command can be tried without a microphone.
  const said = params.get('say');
  const script = said ? said.split('|').map((phrase) => phrase.trim()).filter(Boolean) : (SCRIPTS[params.get('simulate') ?? ''] ?? SCRIPTS.note!);
  type Cue = { at: number; run: () => void };
  const cues: Cue[] = [];
  let at = 0;
  script.forEach((phrase, index) => {
    const words = phrase.split(' ');
    const startMs = at;
    words.forEach((_, w) => cues.push({ at: (at += 180), run: () => handlers.onPartial(words.slice(0, w + 1).join(' ')) }));
    const endMs = (at += 350);
    cues.push({
      at: endMs,
      run: () => {
        handlers.onPartial('');
        handlers.onSegment({ text: phrase, startMs, endMs });
      },
    });
    at += index === 3 ? 2600 : 300; // one long pause, to show a paragraph break
  });

  let clock = 0;
  let next = 0;
  let last = performance.now();
  let finished: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const timer = window.setInterval(() => {
    const now = performance.now();
    clock += now - last;
    last = now;
    while (next < cues.length && (cues[next]?.at ?? Infinity) <= clock) cues[next++]?.run();
    if (next >= cues.length) finished();
  }, 40);

  return {
    kind: 'simulated',
    wantsSamples: false,
    keepsAudio: true,
    push: () => undefined,
    positionMs: () => clock,
    stop: async () => {
      await Promise.race([done, new Promise((resolve) => window.setTimeout(resolve, 50))]);
      window.clearInterval(timer);
      return { recordedMs: Math.round(clock), transcript: null };
    },
    cancel: () => window.clearInterval(timer),
  };
}
