/**
 * The page's two-way line to the Android activity.
 *
 * Inbound, the activity calls into `window.__glyph` - `refresh` when the app is
 * resumed, `capture` when the side key is held while Glyph is already open.
 * Outbound, the page calls `window.GlyphHost`, the JavascriptInterface
 * MainActivity registers.
 *
 * `window.__glyph` is ONE object shared by every module that answers the host,
 * and that is the reason this file exists. The notes store used to assign the
 * whole object for its refresh hook; the moment a second answer (capture) was
 * needed, each assignment would have wiped the other's, and the failure is a
 * side-key press that silently does nothing when the app is open - the one case
 * a desktop test never exercises. Registration merges; removal deletes one key.
 */

type Handler = () => void;

interface GlyphInbound {
  refresh?: Handler;
  capture?: Handler;
  /** Android answered the notification-permission prompt: update alerts' state may have changed. */
  alerts?: Handler;
  /** A picked picture, as JSON: `{ path }`, `{ cancelled: true }` or `{ error }` (core/images.ts). */
  image?: (json: string) => void;
  /** The back gesture: true if the page used it, false at the root (core/back.ts). */
  back?: () => boolean;
  /** The hinge angle in degrees, 0 closed to 180 flat, as it changes on a folding phone (core/unfold.ts). */
  hinge?: (angle: number) => void;
  /** The screen went off during a recording: the side key was pressed to stop (native generation 12). */
  screenOff?: Handler;
}

interface GlyphHostBridge {
  takeLaunch(): string;
  isLocked(): boolean;
  endCapture(leave: boolean): void;
  /**
   * Hand a downloaded, verified APK to Android's installer: "started", or
   * "permission" when Glyph first has to be allowed to install apps (the
   * activity opens that settings page), or a short reason it could not.
   * Optional: builds from before OTA do not have it.
   */
  installApk?(path: string): string;
  // The assistant helpers, for the side-key guide. Optional: an over-the-air
  // page can be running on an APK from before they existed.
  /** Whether Glyph holds the digital assistant role, which the side key's press-and-hold opens. */
  isAssistant?(): boolean;
  /** Open the settings screen where the assistant app is chosen; true if one opened. */
  openAssistantSettings?(): boolean;
  /** `Build.MANUFACTURER`, e.g. "samsung". */
  deviceMaker?(): string;
  // Update alerts (0.3.2). Optional for the same reason.
  /** "off", "on", or "blocked" (on, but Android is not allowing Glyph's notifications). */
  updateAlerts?(): string;
  /** Turn update alerts on or off; answers the new state. May raise Android's permission prompt. */
  setUpdateAlerts?(on: boolean): string;
  // Pictures (native generation 8). Optional for the same reason.
  /** Open the phone's picture picker; "started", or why not. The picture arrives as an `image` event. */
  pickImage?(): string;
  // The side key to stop (native generation 12). Optional for the same reason.
  /** A recording started or ended: keeps the screen on, and reports it going off as `screenOff`. */
  setCapturing?(on: boolean): void;
  /** The clipboard as JSON: `{ text }`, `{ path }` for a picture, `{ error }`, or `{}` (generation 12). */
  readClipboard?(): string;
  // The system bars (native generation 15). Optional for the same reason.
  /** Dark status and navigation bar icons on a light page, light ones on a dark page. */
  setLightChrome?(light: boolean): void;
}

declare global {
  interface Window {
    __glyph?: GlyphInbound;
    GlyphHost?: GlyphHostBridge;
    /** This page load's launch reason, read from the host once; see takeCaptureLaunch. */
    __glyphLaunch?: string;
  }
}

/** Answer a call from the activity. Returns the unregister function. */
export function answerHost<K extends keyof GlyphInbound>(name: K, handler: NonNullable<GlyphInbound[K]>): () => void {
  window.__glyph = { ...window.__glyph, [name]: handler };
  return () => {
    if (window.__glyph?.[name] === handler) {
      const next = { ...window.__glyph };
      delete next[name];
      window.__glyph = next;
    }
  };
}

/**
 * Whether this launch was a request to record, consumed on read.
 *
 * The browser has no host, and a dev URL with `?capture` stands in for the side
 * key so the capture screen can be opened and iterated on without a phone.
 */
export function takeCaptureLaunch(): boolean {
  // The host's answer is consumed on read, so it is kept on the page: when an
  // over-the-air frontend starts rendering and the loader falls back to the
  // embedded one (index.html), the second App asks again in the same page, and
  // a side-key cold start must still open the capture screen rather than the list.
  if (window.GlyphHost) {
    window.__glyphLaunch ??= window.GlyphHost.takeLaunch();
    return window.__glyphLaunch === 'capture';
  }
  return new URLSearchParams(window.location.search).has('capture');
}

/** Whether the phone is locked. False wherever there is no host to ask. */
export function isLocked(): boolean {
  try {
    return window.GlyphHost?.isLocked() ?? false;
  } catch {
    return false;
  }
}

/** Tell the activity a capture is over; `leave` returns a locked phone to its lock screen. */
export function endCapture(leave: boolean): void {
  try {
    window.GlyphHost?.endCapture(leave);
  } catch {
    // No host, or a host from an older build: nothing to withdraw.
  }
}

/**
 * A recording started or ended. On a phone that can tell (generation 12) the
 * screen stays on while it runs, and pressing the side key, which turns the
 * screen off, stops it through `screenOff`. Answers whether this phone does
 * that, so the recorder can say "Press the side key to stop" only where it is
 * true.
 */
export function setCapturing(on: boolean): boolean {
  try {
    if (typeof window.GlyphHost?.setCapturing !== 'function') return false;
    window.GlyphHost.setCapturing(on);
    return true;
  } catch {
    return false;
  }
}
