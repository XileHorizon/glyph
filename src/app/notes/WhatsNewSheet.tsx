import { useEffect, useRef, useState } from 'react';
import { useBack } from '../core/back.ts';
import { fetchReleases, releasesSince, releaseWhen, type Release } from '../core/changelog.ts';
import { SheetGroup, SheetNote, SheetRow, SheetTitle } from '../plugins/kit.tsx';
import sheet from '../editor/NoteSettings.module.css';
import { useSheetDrag } from '../editor/sheetDrag.ts';

/**
 * What's new, once, after an update (Matt: "show changelog after installing update in modal drawer").
 *
 * The page knows the build it is (`__GLYPH_BUILD__`) and remembers the last one that ran here. When they differ, the
 * releases between the two are read from the changelog (core/changelog.ts) and shown in a sheet from the foot of the
 * screen, newest first, each with what its deploy said about it. The build is remembered as soon as the sheet has
 * been decided on, so it shows once whether it is read, swiped away or never opened.
 *
 * A first launch shows nothing: there is no "before" to compare with, and the guide is what a new install gets.
 */

const SEEN_KEY = 'glyph-seen-build';
/** A moment after launch, once the list has painted and an update's reload has settled. */
const DELAY_MS = 1_500;
const BUILD = /^\d{14}$/;

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(build: string): void {
  try {
    localStorage.setItem(SEEN_KEY, build);
  } catch {
    // Shown again next launch at worst.
  }
}

export function WhatsNewSheet({ sources, hold }: { sources: readonly string[] | undefined; hold: boolean }) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const panel = useRef<HTMLElement>(null);
  const close = () => setReleases(null);
  const drag = useSheetDrag(panel, close);
  useBack(releases !== null, close);

  useEffect(() => {
    if (hold) return undefined;
    const now = __GLYPH_BUILD__;
    const seen = readSeen();
    if (!BUILD.test(now) || seen === now) return undefined;
    if (!seen || !BUILD.test(seen) || seen > now) {
      writeSeen(now);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchReleases(sources, controller.signal).then((all) => {
        if (controller.signal.aborted) return;
        writeSeen(now);
        const fresh = releasesSince(all, seen, now);
        if (fresh.length) setReleases(fresh);
      });
    }, DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sources, hold]);

  if (!releases) return null;
  const newest = releases[0]!;
  return (
    <div className={sheet.scrim} onClick={close}>
      <section ref={panel} className={sheet.sheet} role="dialog" aria-modal="true" aria-label="What's new" onClick={(e) => e.stopPropagation()}>
        <span className={sheet.grip} aria-hidden="true" {...drag} />
        <SheetTitle>What's new in {newest.version}</SheetTitle>
        <SheetNote>{releases.length === 1 ? 'Ghost.md just updated.' : `Ghost.md just updated, ${releases.length} releases at once.`}</SheetNote>
        <SheetGroup>
          {releases.map((release) => (
            <SheetRow
              key={release.build}
              label={`${release.version} · ${releaseWhen(release)}`}
              hint={[release.notes ?? 'Fixes and small changes.', release.apk ? `Installed as Ghost.md ${release.apk}.` : null].filter(Boolean).join(' ')}
            />
          ))}
        </SheetGroup>
        <SheetGroup>
          <SheetRow label="Done" onPress={close} />
        </SheetGroup>
      </section>
    </div>
  );
}
