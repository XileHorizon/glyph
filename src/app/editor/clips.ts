import { Facet, RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { clipLength, clipsIn, playsOn, type Clip } from '../core/clips.ts';

/**
 * Voice memos in a note, playable where they sit.
 *
 * A clip is markdown (core/clips.ts): `![voice 0:12](tape:12000-19500)`, a stretch of the note's own tape. A small
 * player stands in its place: on its own line after a "- " it reads as a bullet with a player, mid-sentence as a
 * segment in the words (Matt: "allow for voice memos to be left as a bullet point or inline audio segment"). The mark
 * itself comes back on the line the caret is on, so it can still be read, moved or deleted.
 *
 * The player is the note's recording, played between the clip's two times: one `<audio>` per clip, made on the first
 * tap, since a WebView asks the recordings scheme for byte ranges and seeks within the file it already has
 * (src-tauri/src/capture_commands.rs). Only one plays at a time. Without a tape to play - a note read in a browser,
 * or a recording since removed - there is no player at all: the clip is a quiet mark saying a memo was left here, and
 * nothing to press.
 */

/** The note's recording: where it is played from, and which tape it is (core/clips.ts `tapeId`). */
export interface Tape {
  src: string | null;
  id: string | null;
}

export const tapeSource = Facet.define<Tape, Tape>({ combine: (values) => values.find((value) => value.src) ?? { src: null, id: null } });

/** The clip playing now, so a second tap elsewhere stops it. */
let playing: HTMLAudioElement | null = null;

function stopPlaying(): void {
  playing?.pause();
  playing = null;
}

class ClipWidget extends WidgetType {
  private audio: HTMLAudioElement | null = null;

  constructor(
    readonly clip: Clip,
    readonly src: string | null,
  ) {
    super();
  }

  eq(other: ClipWidget): boolean {
    return other.clip.startMs === this.clip.startMs && other.clip.endMs === this.clip.endMs && other.src === this.src;
  }

  toDOM(): HTMLElement {
    const length = clipLength(this.clip);
    // A note whose recording was removed still says a memo was left here, quietly, with nothing to press: a play
    // button that cannot play is worse than a mark that says what it is.
    if (!this.src) {
      const quiet = document.createElement('span');
      quiet.className = 'cm-clip cm-clipQuiet';
      quiet.title = 'The recording this was a piece of is not on this note any more.';
      quiet.textContent = `voice ${length}`;
      return quiet;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-clip';
    button.dataset.state = 'still';
    button.setAttribute('aria-label', `Play this voice memo, ${length}`);
    const mark = document.createElement('span');
    mark.className = 'cm-clipMark';
    mark.setAttribute('aria-hidden', 'true');
    const words = document.createElement('span');
    words.className = 'cm-clipLength';
    words.textContent = length;
    button.append(mark, words);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle(button);
    });
    return button;
  }

  /** Plays the clip's stretch, or stops it. The end is watched as it plays, since a media element cannot be told one. */
  private toggle(button: HTMLElement): void {
    if (this.audio && playing === this.audio) {
      stopPlaying();
      button.dataset.state = 'still';
      return;
    }
    stopPlaying();
    if (!this.audio) {
      const audio = new Audio(this.src ?? '');
      audio.preload = 'metadata';
      audio.addEventListener('timeupdate', () => {
        if (audio.currentTime * 1000 >= this.clip.endMs) {
          audio.pause();
          audio.currentTime = this.clip.startMs / 1000;
        }
      });
      audio.addEventListener('pause', () => {
        button.dataset.state = 'still';
        if (playing === audio) playing = null;
      });
      audio.addEventListener('play', () => {
        button.dataset.state = 'playing';
      });
      audio.addEventListener('error', () => {
        button.dataset.state = 'still';
        button.title = 'This voice memo couldn’t be played.';
      });
      this.audio = audio;
    }
    this.audio.currentTime = this.clip.startMs / 1000;
    playing = this.audio;
    void this.audio.play().catch(() => {
      button.dataset.state = 'still';
      button.title = 'This voice memo couldn’t be played.';
    });
  }

  destroy(): void {
    if (playing === this.audio) stopPlaying();
    this.audio = null;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * The player in place of the mark, since the sound is the content and `![voice 0:12](tape:12000-19500)` in the middle
 * of a sentence is noise. The mark comes back on the line the caret is on, so it can be read, moved or deleted like
 * any other text - the same bargain the formatted view makes with every mark (editor/viewMode.ts).
 */
function decorate(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const src = state.facet(tapeSource);
  const carets = state.selection.ranges;
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    if (!line.text.includes('](tape:')) continue;
    const showing = carets.some((range) => range.from <= line.to && range.to >= line.from);
    for (const clip of clipsIn(line.text)) {
      const from = line.from + clip.from;
      const to = line.from + clip.to;
      // A memo of a tape the note no longer has is drawn, not played: its times mean nothing on another recording.
      const play = playsOn(clip, src.id) ? src.src : null;
      const widget = Decoration.widget({ widget: new ClipWidget(clip, play), side: 1 });
      if (showing) builder.add(to, to, widget);
      else builder.add(from, to, Decoration.replace({ widget: new ClipWidget(clip, play) }));
    }
  }
  return builder.finish();
}

const clipField = StateField.define<DecorationSet>({
  create: decorate,
  update(value, tr) {
    const caretMoved = tr.selection !== undefined || tr.docChanged;
    return caretMoved || tr.startState.facet(tapeSource) !== tr.state.facet(tapeSource) ? decorate(tr.state) : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // A hidden mark is one thing to the caret and to a delete, not twenty characters of markdown.
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

const clipTheme = EditorView.baseTheme({
  '.cm-clip': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4em',
    verticalAlign: '-0.15em',
    margin: '0 0.15em',
    padding: '0.1em 0.7em 0.1em 0.5em',
    border: '1.5px solid var(--app-ink, currentColor)',
    borderRadius: '999px',
    background: 'none',
    color: 'var(--app-ink, var(--glacier-text))',
    font: 'inherit',
    fontSize: '0.78em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  '.cm-clipQuiet': {
    borderStyle: 'dashed',
    borderColor: 'var(--app-ink-3, currentColor)',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    cursor: 'default',
    paddingInline: '0.7em',
  },
  // A triangle for still, two bars while it plays: the only two states it has.
  '.cm-clipMark': {
    display: 'inline-block',
    inlineSize: '0.7em',
    blockSize: '0.8em',
    background: 'currentColor',
    clipPath: 'polygon(0 0, 100% 50%, 0 100%)',
  },
  '.cm-clip[data-state="playing"] .cm-clipMark': {
    clipPath: 'polygon(0 0, 35% 0, 35% 100%, 0 100%, 0 0, 65% 0, 100% 0, 100% 100%, 65% 100%, 65% 0)',
  },
  '.cm-clipLength': { fontVariantNumeric: 'tabular-nums' },
});

/** Voice memos drawn and played in the editor; `src` is the note's recording. */
export function clips(): Extension {
  return [clipField, clipTheme];
}
