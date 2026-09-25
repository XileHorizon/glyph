import { convertFileSrc } from '@tauri-apps/api/core';
import { answerHost } from './host.ts';
import { invoke, isTauri } from './tauri.ts';

/**
 * Pictures in notes.
 *
 * A note refers to a picture as `![caption](image/<name>)`: a relative path,
 * so a folder of notes and an `image/` folder beside it would still make sense
 * anywhere markdown is read. On the phone the picture is a JPEG the app keeps
 * under its own data (native generation 8): the activity picks it and shrinks
 * it (`GlyphHost.pickImage`, MainActivity.kt), Rust files it (`save_image`),
 * and the `img` scheme serves it to the editor. In a browser the picture is
 * kept in IndexedDB and handed to the editor as a blob URL, so the screen can
 * be built and judged without a phone.
 */

export const IMAGE_REF = /!\[([^\]]*)\]\(image\/([A-Za-z0-9_.-]+)\)/g;

/** The markdown for a picture, on a line of its own. */
export function imageMarkdown(name: string, caption = ''): string {
  return `![${caption}](image/${name})`;
}

/** Every picture a note refers to. */
export function imageNames(body: string): string[] {
  return [...body.matchAll(IMAGE_REF)].map((m) => m[2] ?? '').filter(Boolean);
}

// ---- the phone ----------------------------------------------------------------------

type PickAnswer = { path: string } | { cancelled: true } | { error: string };

let pending: ((answer: PickAnswer) => void) | null = null;
let listening = false;

function listenOnce(): void {
  if (listening) return;
  listening = true;
  answerHost('image', (json) => {
    let answer: PickAnswer;
    try {
      answer = JSON.parse(json) as PickAnswer;
    } catch {
      answer = { error: 'The picture could not be read.' };
    }
    pending?.(answer);
    pending = null;
  });
}

async function pickNative(): Promise<string | null> {
  const bridge = window.GlyphHost;
  if (typeof bridge?.pickImage !== 'function') throw new Error('This build cannot add pictures yet. Install the newest Ghost.md.');
  listenOnce();
  const answer = await new Promise<PickAnswer>((resolve) => {
    pending = resolve;
    const started = bridge.pickImage?.();
    if (started !== 'started') {
      pending = null;
      resolve({ error: started || 'The picker did not open.' });
    }
  });
  if ('cancelled' in answer) return null;
  if ('error' in answer) throw new Error(answer.error);
  const { name } = await invoke<{ name: string }>('save_image', { path: answer.path });
  return name;
}

/**
 * Adopts a picture the activity has already put in its cache - one it copied
 * out of the clipboard for the press-and-hold menu's Paste - and answers its
 * name, the way `pickNative` does for a picked one.
 */
export async function adoptImagePath(path: string): Promise<string> {
  const { name } = await invoke<{ name: string }>('save_image', { path });
  return name;
}

// ---- a picture from anywhere else: the clipboard ----------------------------------------

/** The binary generation that has `save_image_data`. */
const PASTE_GENERATION = 9;
let generation: number | null = null;

/** A picture shrunk so its long side is at most 1600 px, as a JPEG, turned the right way up. */
async function shrink(file: Blob): Promise<Blob> {
  // An empty file is a clipboard pointing at a picture that has since been
  // cleaned up: Chrome on Android copies a picture as a link to a file it
  // deletes after a while, and the paste still says "image" with no bytes.
  if (!file.size) throw new Error('That picture isn’t on the clipboard anymore. Copy it again and paste.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('That picture couldn’t be opened.');
  });
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The picture could not be read.');
  // Paper under a transparent PNG, so a screenshot with no background does not turn black as a JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('The picture could not be read.');
  return blob;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Keeps a picture that arrived as a file rather than from the picker - pasted
 * from the clipboard - and answers its name. On the phone the shrunk bytes go
 * to Rust (`save_image_data`, native generation 9); in a browser, to storage.
 */
export async function saveImageFile(file: Blob): Promise<string> {
  const shrunk = await shrink(file);
  if (isTauri()) {
    generation ??= await invoke<{ nativeGeneration?: number }>('ota_status').then(
      (status) => status.nativeGeneration ?? 0,
      () => 0,
    );
    if (generation < PASTE_GENERATION) throw new Error('Pasting pictures needs the newest Ghost.md. Install it from attack.fm/glyph.');
    const base64 = toBase64(new Uint8Array(await shrunk.arrayBuffer()));
    const { name } = await invoke<{ name: string }>('save_image_data', { base64 });
    return name;
  }
  const name = `${crypto.randomUUID()}.jpg`;
  await webPut(name, shrunk);
  urls.set(name, URL.createObjectURL(shrunk));
  return name;
}

// ---- the browser ---------------------------------------------------------------------

const DB = 'glyph-images';
const STORE = 'images';
const urls = new Map<string, string>();

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('No picture storage in this browser.'));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No picture storage in this browser.'));
  });
}

async function webPut(name: string, blob: Blob): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('The picture was not saved.'));
  });
}

async function webGet(name: string): Promise<Blob | null> {
  const d = await db().catch(() => null);
  if (!d) return null;
  return new Promise((resolve) => {
    const request = d.transaction(STORE).objectStore(STORE).get(name);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

/** A browser picture's bytes, for sync; null when this browser has none by that name. */
export async function webImageBytes(name: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const blob = await webGet(name);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Keeps a picture that arrived by sync, under its own name. */
export async function keepWebImage(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const blob = new Blob([bytes], { type: name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg' });
  await webPut(name, blob);
  urls.set(name, URL.createObjectURL(blob));
  window.dispatchEvent(new Event(IMAGE_READY));
}

/** A photo from the file picker, shrunk to at most 1600 px on its long side, as a JPEG. */
async function pickWeb(): Promise<string | null> {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (!file) return null;
  return saveImageFile(file);
}

// ---- both ---------------------------------------------------------------------------------

/** Let the person choose a picture; answers its name, or null if they chose none. */
export function pickImage(): Promise<string | null> {
  return isTauri() ? pickNative() : pickWeb();
}

/** Fires when a browser picture has been loaded from storage and `imageUrl` will now answer for it. */
export const IMAGE_READY = 'glyph:image-ready';

/**
 * Where the editor loads a picture from. On the phone, always at once. In a
 * browser, at once for a picture seen this session; otherwise empty, with the
 * picture fetched from storage and `IMAGE_READY` fired when it is there.
 */
export function imageUrl(name: string): string {
  if (isTauri()) return convertFileSrc(name, 'img');
  const known = urls.get(name);
  if (known !== undefined) return known;
  urls.set(name, '');
  void webGet(name).then((blob) => {
    if (!blob) return;
    urls.set(name, URL.createObjectURL(blob));
    window.dispatchEvent(new Event(IMAGE_READY));
  });
  return '';
}
