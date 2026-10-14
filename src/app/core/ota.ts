import { useCallback, useEffect, useRef, useState } from 'react';
import { preferences } from './preferences.ts';
import { invoke, isTauri } from './tauri.ts';

/**
 * The page's half of over-the-air updates.
 *
 * Three jobs, in the order a launch needs them:
 *
 * 1. `settleBoot` - tell Rust this frontend really mounted, so the build the
 *    loader staked is not counted against it next launch. It runs in App's
 *    first effect, which is after a real commit, and BEFORE anything checks
 *    for updates: AttackFM installed and reloaded before its wager was
 *    settled, and so quarantined the very bundle it had just run.
 * 2. `useUpdates` - look for a newer build soon after launch and whenever the
 *    app comes back to the screen (at most every ten minutes), install it in
 *    the background, and say so. A downloaded build runs on the next page
 *    load; the list offers a reload, and a cold start picks it up regardless.
 * 3. The APK - when the published APK is newer than this binary, download it
 *    (in Rust, verified) and hand it to Android's installer through the
 *    activity. The installer's own confirmation screen is the one step no app
 *    can skip, and the first time also asks to allow installs from Glyph.
 *
 * Everything is a no-op in a browser, where reloading the page is the update.
 */

export interface OtaStatus {
  nativeVersion: string;
  nativeGeneration: number;
  embeddedBuild: string | null;
  embeddedVersion: string | null;
  activeBuild: string | null;
  activeVersion: string | null;
  runningBuild: string | null;
  quarantined: string[];
  /*
   * Optional because a web bundle runs on older binaries too: native
   * generation 1 (0.2.0) predates signing and answers without these, and a
   * page that assumed them would crash in Settings on exactly the phones that
   * most need to see "Install 0.3.0".
   */
  /** Update sources in the order they are tried: remembered from a signed manifest, then compiled in. */
  sources?: string[];
  /** Endpoints a signed manifest has moved; each consumer falls back to its own default. */
  services?: { format: string | null; modelMirrors: string[] };
}

/** "attack.fm" for "https://attack.fm/glyph": where updates come from, as a person reads it. */
export function sourceHost(source: string | undefined): string | null {
  if (!source) return null;
  try {
    return new URL(source).host;
  } catch {
    return null;
  }
}

export interface ApkInfo {
  version: string;
  versionCode: number;
  native: number;
  sha256: string;
  bytes: number;
  url: string;
}

interface CheckResult {
  web: 'current' | 'installed' | 'needs-native' | 'quarantined' | 'offline';
  webBuild: string | null;
  webVersion: string | null;
  apk: ApkInfo | null;
  error: string | null;
}

export type ApkPhase =
  | { kind: 'none' }
  | { kind: 'available'; info: ApkInfo }
  | { kind: 'downloading'; info: ApkInfo; received: number; total: number }
  | { kind: 'installing'; info: ApkInfo }
  | { kind: 'needs-permission'; info: ApkInfo }
  | { kind: 'failed'; info: ApkInfo; message: string };

export interface Updates {
  /** A newer frontend is downloaded and runs on reload. */
  ready: { build: string; version: string } | null;
  apk: ApkPhase;
  checking: boolean;
  lastError: string | null;
  lastChecked: number | null;
  status: OtaStatus | null;
  /** What this page is: the build it was compiled as. */
  build: string;
  version: string;
  check: () => void;
  reload: () => void;
  installApk: () => void;
}

/**
 * How long a returning app waits before looking again. A minute: coming back to
 * Glyph is the moment a wait for an update is felt, and a check is one small
 * signed manifest.
 */
const RECHECK_MS = 60_000;
/** The first look, after launch has settled and the list has painted. */
const FIRST_CHECK_MS = 4_000;
/**
 * And again, on this beat, for as long as the app is open and on screen.
 *
 * Matt: "the OTA update is taking really long to show up in the app". It was:
 * an app left open looked once, four seconds after launch, and then never
 * again until it had been away and come back. Published anything after that
 * first look and the app would not see it for as long as it stayed in front of
 * you - which is exactly what someone testing a release does. Nothing runs
 * while the app is hidden or in the background; the native notifier
 * (UpdateCheckWorker.kt) is what covers that, and it keeps its own six hours.
 */
const POLL_MS = 2 * 60_000;

let settled = false;

/** Report a real mount. Idempotent; see the header. */
export function settleBoot(): void {
  if (settled) return;
  settled = true;
  const boot = window.__glyphBoot;
  if (boot) boot.mounted = true;
  if (!isTauri()) return;
  const build = boot?.build ?? null;
  console.info(`[glyph] frontend ${__GLYPH_VERSION__} (${__GLYPH_BUILD__}) mounted ${build ? 'over the air' : 'from the app'}`);
  invoke('ota_boot_ok', { build }).catch((error: unknown) => console.warn('[glyph] boot report failed:', error));
}

/** "0912 22:15" - a build id as a person scans it, in their own time zone. */
export function describeBuild(build: string | null | undefined): string {
  if (!build || !/^\d{14}$/.test(build)) return 'unknown build';
  const at = new Date(
    Date.UTC(+build.slice(0, 4), +build.slice(4, 6) - 1, +build.slice(6, 8), +build.slice(8, 10), +build.slice(10, 12), +build.slice(12, 14)),
  );
  return at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Dotted versions compared numerically; anything unparsable compares as older. */
export function isNewerVersion(offered: string, installed: string): boolean {
  const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(offered);
  const b = parse(installed);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Whether this page was built as the staging app (vite.config.ts): its own id, its own data, no updates. */
export const STAGING: boolean = typeof __GLYPH_STAGING__ !== 'undefined' && __GLYPH_STAGING__;

export function useUpdates(): Updates {
  const [ready, setReady] = useState<Updates['ready']>(null);
  const [apk, setApk] = useState<ApkPhase>({ kind: 'none' });
  const [checking, setChecking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [status, setStatus] = useState<OtaStatus | null>(null);
  const running = useRef(false);
  const lastAt = useRef(0);

  const check = useCallback(async () => {
    // Local only: nothing is asked of the box, not even whether there is an update.
    // A staging build never updates: what was installed is what runs.
    // Nor does Glyph Dev (`tauri android dev`): its page comes live from the Mac's Vite server, so a downloaded bundle
    // is never what it runs, and offering one left "A new version of Glyph is ready" that Reload could never take
    // (Matt: "the OTA update isn't taking").
    if (!isTauri() || running.current || preferences().localOnly || STAGING || import.meta.env.DEV) return;
    running.current = true;
    setChecking(true);
    try {
      const result = await invoke<CheckResult>('ota_check');
      const now = await invoke<OtaStatus>('ota_status');
      setStatus(now);
      lastAt.current = Date.now();
      setLastChecked(lastAt.current);
      setLastError(result.web === 'offline' ? result.error : null);

      if (result.web === 'installed' && result.webBuild) {
        console.info(`[glyph] OTA build ${result.webBuild} installed; runs on reload`);
        setReady({ build: result.webBuild, version: result.webVersion ?? '' });
      } else if (now.activeBuild && now.activeBuild !== now.runningBuild && now.activeBuild !== window.__glyphBoot?.build) {
        // Installed by an earlier check in this run, or before a reload that
        // fell back: still waiting to be loaded.
        setReady({ build: now.activeBuild, version: now.activeVersion ?? '' });
      }

      const offered = result.apk;
      const apkNewer =
        offered && (isNewerVersion(offered.version, now.nativeVersion) || offered.native > now.nativeGeneration);
      setApk((prev) => {
        if (!offered || !apkNewer) return { kind: 'none' };
        // A download or install in progress is not interrupted by a check.
        if (prev.kind === 'downloading' || prev.kind === 'installing') return prev;
        return { kind: 'available', info: offered };
      });
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      running.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return undefined;
    void invoke<OtaStatus>('ota_status').then(setStatus).catch(() => undefined);
    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAt.current > RECHECK_MS) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    // On the beat, while the app is in front: a hidden app is asleep and the phone's own notifier covers that.
    const beat = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  const installApk = useCallback(async () => {
    // 'installing' may be retried: the person can dismiss Android's dialog, and
    // the verified file is still in the cache, so a second tap costs nothing.
    if (apk.kind === 'none' || apk.kind === 'downloading') return;
    const info = apk.info;
    const host = window.GlyphHost;
    if (!host?.installApk) {
      setApk({ kind: 'failed', info, message: 'This build can’t install updates itself. Download it from attack.fm/glyph.' });
      return;
    }
    setApk({ kind: 'downloading', info, received: 0, total: info.bytes });
    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<{ received: number; total: number }>('ota://apk-progress', (event) => {
        setApk({ kind: 'downloading', info, received: event.payload.received, total: event.payload.total });
      });
      const path = await invoke<string>('ota_fetch_apk');
      const answer = host.installApk(path);
      if (answer === 'permission') setApk({ kind: 'needs-permission', info });
      else if (answer === 'started') setApk({ kind: 'installing', info });
      else setApk({ kind: 'failed', info, message: `The installer did not start (${answer}).` });
    } catch (error) {
      setApk({ kind: 'failed', info, message: error instanceof Error ? error.message : String(error) });
    } finally {
      unlisten?.();
    }
  }, [apk]);

  return {
    ready,
    apk,
    checking,
    lastError,
    lastChecked,
    status,
    build: __GLYPH_BUILD__,
    version: __GLYPH_VERSION__,
    check: () => void check(),
    reload: () => window.location.reload(),
    installApk: () => void installApk(),
  };
}
