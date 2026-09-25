import { describeBuild } from './ota.ts';
import { isTauri } from './tauri.ts';

/**
 * What every update changed, as a list a person can read (Matt: "show a changelog with all updates including OTA").
 *
 * Each release published to attack.fm adds an entry to `/glyph/changelog.json` (scripts/deploy-ota.mjs), which is
 * written from the one that is live, so the history belongs to the site rather than to any one machine. An entry is
 * what the update said about itself: its version, the build it is, when it went out, the line of notes the deploy
 * carried, and the APK version when one went with it.
 *
 * The list is read for the What's new page in Settings. It is words, not code - the bundles themselves are signed
 * and checked (src-tauri/src/ota.rs) - so it is fetched plainly and kept for reading offline.
 */

export interface Release {
  /** "1.4.1-4": the version, with the release's number on the version it is for. */
  version: string;
  /** The build id, which is what the app runs and how a release is recognised. */
  build: string;
  /** When it was published, ISO. */
  at: string;
  /** The line the deploy carried, if any. */
  notes?: string;
  /** The APK version published with it, when one was. */
  apk?: string;
}

const KEY = 'glyph-changelog';
const FILE = 'changelog.json';
/** Where updates come from when the app has not been told otherwise. */
const HOME = 'https://attack.fm/glyph';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The releases in `value`, newest first: anything without a version and a build is not a release. */
export function readReleases(value: unknown): Release[] {
  if (!Array.isArray(value)) return [];
  const releases: Release[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const version = text(raw.version);
    const build = text(raw.build);
    if (!version || !/^\d{14}$/.test(build)) continue;
    const notes = text(raw.notes);
    const apk = text(raw.apk);
    releases.push({ version, build, at: text(raw.at), ...(notes ? { notes } : {}), ...(apk ? { apk } : {}) });
  }
  return releases.sort((a, b) => b.build.localeCompare(a.build)).filter((release, i, all) => all.findIndex((other) => other.build === release.build) === i);
}

/**
 * Where the changelog is read from: the source a signed manifest moved the app to, else attack.fm. The web version is
 * served beside its own changelog, so there it is simply the file next door.
 */
export function changelogUrl(sources: readonly string[] | undefined, onPhone = isTauri()): string {
  if (!onPhone) return `./${FILE}`;
  const first = sources?.find((source) => /^https?:\/\//.test(source));
  return `${(first ?? HOME).replace(/\/+$/, '')}/${FILE}`;
}

/** What was read last time, for a page opened with no signal. */
export function keptReleases(): Release[] {
  try {
    return readReleases(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function keep(releases: readonly Release[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(releases.slice(0, 60)));
  } catch {
    // The page shows what it fetched; next time it reads it again.
  }
}

/** Reads the changelog from the update source. Answers what was kept when it cannot be reached. */
export async function fetchReleases(sources: readonly string[] | undefined, signal?: AbortSignal): Promise<Release[]> {
  try {
    const answer = await fetch(changelogUrl(sources), { cache: 'no-store', signal });
    if (!answer.ok) throw new Error(String(answer.status));
    const releases = readReleases(await answer.json());
    if (releases.length) keep(releases);
    return releases;
  } catch {
    return keptReleases();
  }
}

/** "Sep 15, 11:09 PM", or the build id's own reading when there is no date. */
export function releaseWhen(release: Release): string {
  const at = release.at ? new Date(release.at) : null;
  if (at && !Number.isNaN(at.getTime())) return at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return describeBuild(release.build);
}

/** The releases a device moving from build `seen` to build `now` has not been told about, newest first. */
export function releasesSince(releases: readonly Release[], seen: string, now: string): Release[] {
  return releases.filter((release) => release.build > seen && release.build <= now);
}
