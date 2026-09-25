import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from '@glacier/icons';
import { ArrowLeft } from '../art/Icons.tsx';
import { onBack } from '../core/back.ts';
import { useSwipeNav } from '../core/swipe.ts';
import { useWispEdge } from '../art/wispEdge.ts';
import './settings.css';

/**
 * The settings surface: a full-screen page that opens on the list of
 * sections and pushes into one. The shape is AttackFM's MobileSettings; the
 * words are Glyph's: `← Notes` in the top bar to leave, "Settings" as the
 * page's title over the clustered list, a section's own word over its pane,
 * and `← Settings` to come back out of one. Both titles are title-sized rather
 * than display-sized, so the rows start near the top (Matt: "add back button
 * at the top of settings and make settings header smaller … make settings in
 * top bar like the ← notes").
 *
 * The page can also be left the way a person came: the phone's back gesture,
 * or a swipe to the right across it, steps out of a pane and then closes the
 * page; a swipe to the left goes forward again, back into the pane just left. One handler, registered while the page is open, answers by depth.
 * Every fresh open lands on the list, and the rows arrive one after another.
 */

export interface SettingsSection {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  /** The row's second line: the section's state, read live. */
  summary?: string;
  /** Rows with the same group share one card. */
  group: number;
}

interface SettingsScreenProps {
  open: boolean;
  onClose: () => void;
  sections: SettingsSection[];
  /** Asked from inside a pane: land on another one (About's knock opens Developer). */
  goTo?: { id: string; nonce: number } | null;
}

export function SettingsScreen({ open, onClose, sections, goTo }: SettingsScreenProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Which way the pane came in: pushed from the right going deeper, from the
  // left coming back, so the motion says which.
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  // The pane a back step just left, for a forward swipe to return to.
  const [left, setLeft] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // The list or the pane showing goes to smoke under its header (art/wispEdge.ts).
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setActiveId(null);
      setLeft(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && goTo) {
      setDirection('in');
      setActiveId(goTo.id);
    }
  }, [open, goTo]);

  // A section that left the array (developer mode switched off inside it)
  // drops back to the list rather than onto a pane that no longer exists.
  const active = sections.find((s) => s.id === activeId) ?? null;
  useEffect(() => {
    if (activeId && !active) setActiveId(null);
  }, [activeId, active]);

  const enter = useCallback((id: string) => {
    setDirection('in');
    setLeft(null);
    setActiveId(id);
  }, []);

  const back = useCallback(() => {
    if (activeId !== null) {
      setDirection('out');
      setLeft(activeId);
      setActiveId(null);
    } else {
      onClose();
    }
  }, [activeId, onClose]);

  const forward = useCallback(() => {
    if (activeId === null && left && sections.some((s) => s.id === left)) {
      setDirection('in');
      setActiveId(left);
    }
  }, [activeId, left, sections]);

  useEffect(() => {
    if (!open) return undefined;
    return onBack(() => {
      back();
      return true;
    });
  }, [open, back]);

  useSwipeNav(root, { onBack: back, onForward: forward }, open);
  useWispEdge(scroller, open && (active?.id ?? 'list'));

  if (!open) return null;

  const clusters = sections.reduce<SettingsSection[][]>((groups, section) => {
    const last = groups[groups.length - 1];
    if (last && last[0]!.group === section.group) last.push(section);
    else groups.push([section]);
    return groups;
  }, []);

  let row = 0;
  return (
    <div ref={root} className="settingsScreen" role="dialog" aria-modal="true" aria-label="Settings" data-view={active ? 'pane' : 'list'} data-direction={direction}>
      {active ? (
        <>
          <header className="settingsScreen__head">
            <button type="button" className="app-word settingsScreen__headWord" onClick={back}>
              <ArrowLeft /> Settings
            </button>
          </header>
          <div ref={scroller} className="settingsScreen__pane" key={active.id}>
            <h1 className="settingsScreen__display">{active.label}</h1>
            {active.content}
          </div>
        </>
      ) : (
        <>
          {/*
            The way out and the screen's name in one row (Matt: "move settings back arrow next to settings label,
            replace the back to notes with just putting the settings text there, remove some of the space on the
            top"). It read "← Notes" over a display-sized "Settings" underneath, which named the screen twice and
            spent a third of the first page saying so. The arrow still leaves for the notes, which is what it is
            told to say aloud.
          */}
          <header className="settingsScreen__head">
            <button type="button" className="app-word settingsScreen__headWord" onClick={onClose} aria-label="Back to your notes">
              <ArrowLeft /> Settings
            </button>
          </header>
          <nav ref={scroller} className="settingsScreen__list" key="list">
            {clusters.map((cluster) => (
              <div key={cluster[0]!.id} className="settingsScreen__cluster">
                <div className="settingsScreen__group">
                  {cluster.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className="settingsScreen__row"
                      style={{ '--i': row++ } as React.CSSProperties}
                      onClick={() => enter(section.id)}
                    >
                      <span className="settingsScreen__rowIcon">{section.icon}</span>
                      <span className="settingsScreen__rowText">
                        <span className="settingsScreen__rowLabel">{section.label}</span>
                        {section.summary ? <span className="settingsScreen__rowSummary">{section.summary}</span> : null}
                      </span>
                      <ChevronRight size={18} className="settingsScreen__rowChevron" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {left ? <p className="settingsScreen__hint">Swipe left to go back into {sections.find((s) => s.id === left)?.label ?? 'the page'}.</p> : null}
          </nav>
        </>
      )}
    </div>
  );
}
