import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, PanelLeft, Plus, X } from '@glacier/icons';
import { Menu, MenuItem, MenuSeparator, MenuSub } from '@glacier/react';
import {
  joinGroup,
  leaveGroup,
  membersOf,
  newGroup,
  NO_GROUPS,
  recolourGroup,
  renameGroup,
  toggleGroup,
  ungroup,
  type TabGroup,
  type TabGroups,
} from './tabGroups.ts';
import { isCanvasBody } from '../canvas/jsonCanvas.ts';
import { isBookBody } from '../book/book.ts';
import { noteTitle, type Note } from '../core/store.ts';
import { motionScale } from '../core/preferences.ts';
import { useWorkspaces, WORKSPACE_HUES } from '../core/workspaces.ts';
import { setTopBarTools } from '../core/topBarTools.ts';
import { House } from '../art/Icons.tsx';
import { wispSides } from '../art/wispSides.ts';
import { scrollSideways } from '../core/scrollSideways.ts';
import styles from './NoteTabs.module.css';

/**
 * The row across the top of a note: the notes that are open, and the way to
 * the rest of them (Matt: "add tabs at the top of the app for the different
 * notes that are open", and "add a sidebar that opens as a floating card, add
 * a sidebar icon on the top left of the page").
 *
 * Both asks are one bar. The sidebar's icon is the row's first thing, which
 * puts it at the top left of the page without a second back word fighting the
 * note's own; the tabs run beside it and scroll sideways when there are more
 * than fit. A tap changes note without leaving the screen; the cross closes a
 * tab, and the note behind it carries on existing, it is only no longer open.
 *
 * The row lives inside the note's header pane (editor/NoteScreen.tsx), so the
 * note scrolls under it and the header's own height already accounts for it.
 */

interface NoteTabsProps {
  /** The open notes, in the order they were opened. */
  tabs: Note[];
  activeId: string;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  /** A new note in a new tab: the + at the end of the row, as a browser and Obsidian have it. */
  onNew?: () => void;
  /** Chrome-style groups over the tabs (notes/tabGroups.ts); the tabs arrive already drawn in their groups' order. */
  groups?: TabGroups;
  onGroups?: (next: TabGroups) => void;
  /** Close several tabs at once: a whole group. */
  onCloseTabs?: (ids: string[]) => void;
  /** The floating list of every note; absent where the list is already beside the note (the desktop sidebar). */
  onSidebar?: () => void;
  sidebarOpen?: boolean;
  /** The right-hand aside (aside/Aside.tsx): a book's index, or the workspace's notes; the icon is the sidebar's, mirrored. */
  onAside?: () => void;
  asideOpen?: boolean;
  /** The home page (home/HomeScreen.tsx), and whether it is the page showing. */
  onHome?: () => void;
  atHome?: boolean;
  /**
   * A tab dragged to sit somewhere else in the row (notes/openTabs.ts). `grouped` says the drag has already settled
   * which group the tab is in (`onGroups`); without it - a move by the keys - the row works that out from where it lands.
   */
  onMove?: (id: string, to: number, grouped?: boolean) => void;
  /** Back and forward through where he has been (notes/visited.ts), beside the sidebar's button. */
  onGoBack?: () => void;
  onGoOn?: () => void;
  canGoBack?: boolean;
  canGoOn?: boolean;
  /**
   * A canvas renamed from its tab (Matt: "I also need a way to rename canvases maybe through the tabs context
   * menu?"). Only a canvas: a note is named by its first line, which is written in the note itself, where a
   * canvas has no line to write - it is named by `title:` in its front matter (core/frontMatter.ts), and the
   * only way to that was the cog. Absent, and no tab offers it.
   */
  onRename?: (id: string, title: string) => void;
}

/** How far a pointer must travel before a press on a tab is a drag rather than a click. */
const TRAVEL = 6;
/** How long a press has to stay put before it picks the tab up rather than pulling the row along. */
const HOLD_MS = 220;

export function NoteTabs({
  tabs,
  activeId,
  onOpen,
  onClose,
  onSidebar,
  sidebarOpen,
  onAside,
  asideOpen,
  onHome,
  atHome = false,
  onMove,
  onGoBack,
  onGoOn,
  canGoBack = false,
  canGoOn = false,
  onNew,
  onRename,
  groups = NO_GROUPS,
  onGroups,
  onCloseTabs,
}: NoteTabsProps) {
  /*
   * The menus a group's chip and a tab open, and the chip being renamed. A chip opens its menu on a right-click or a
   * long press - it is never dragged, so a finger's hold is free.
   *
   * A tab is dragged by a finger's hold, so its menu is the end of that hold rather than its start: held and moved,
   * the tab is carried; held and let go where it was, the menu opens (Matt: "Can't open tabs context menu on mobile
   * it just highlights the tab text"). A mouse keeps its right-click. The highlighting was the phone's own: a long
   * press with nothing to stop it selects the words under it, so the tabs take no selection at all (the stylesheet's
   * `user-select`), and the menu the phone would raise is refused here whatever raises it.
   */
  const [menu, setMenu] = useState<{ kind: 'group' | 'tab'; id: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The tab whose name is open as a field, and the words in it: a canvas being renamed in the row. */
  const [naming, setNaming] = useState<{ id: string; draft: string } | null>(null);
  /**
   * The end of a rename, however it ends: the field closes first, so the blur that follows it finds nothing open and
   * cannot keep the same name twice. A name is only sent on if it is a name and is not the one the tab already has.
   */
  const keepName = (id: string, was: string, keep: boolean) => {
    const kept = naming?.draft.trim() ?? '';
    setNaming(null);
    if (keep && kept && kept !== was) onRename?.(id, kept);
  };
  const pointer = useRef<string>('mouse');
  const change = (next: TabGroups) => onGroups?.(next);
  const startGroup = (noteId: string) => {
    const made = newGroup(groups, noteId);
    change(made.groups);
    // Named "Group" to begin with, and straight into its name to be called something better.
    setRenaming(made.id);
  };
  const spaces = useWorkspaces();
  /*
   * Dragging a tab along the row (Matt: "Add dragging around tabs into different positions"). The row reorders under
   * the finger rather than a ghost following it: the tab being dragged is the tab in the row, and it swaps with a
   * neighbour the moment the pointer passes that neighbour's middle.
   *
   * The drag is followed on the window rather than on the tab, and deliberately: reordering moves the tab's own
   * element in the DOM, which drops a pointer capture held on it. Held that way, a drag lost its end - no pointerup
   * ever arrived at the tab - and every later tap was swallowed as "the click that ends a drag". The window sees the
   * whole gesture whatever React does to the row underneath.
   *
   * A mouse drags once it has actually travelled, since a plain click emits a move of no distance. A finger waits a
   * moment first, because the row scrolls sideways and a flick along it must stay a flick - the same reason a phone's
   * home screen waits before it lets you move an icon.
   */
  const row = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState<string | null>(null);
  /** A drag ends in a click somewhere in the row, which must not also open a note. */
  const dragged = useRef(false);

  /**
   * Which place in the row the pointer is over: how many of the OTHER tabs' middles it has passed.
   *
   * The tab being dragged is skipped on purpose. It carries an offset so it can follow the finger, which moves the
   * box it would be measured by, and measuring it made the row swap and swap back as the offset chased the answer
   * that had caused it.
   */
  const placeAt = (x: number, dragging: string): number => {
    // A folded group is its chip on screen and all its tabs in the order, so passing it passes every one of them.
    const items = row.current ? [...row.current.querySelectorAll<HTMLElement>('[data-tab], [data-group-chip][data-collapsed]')] : [];
    let place = 0;
    for (const item of items) {
      if (item.dataset.tabId === dragging) continue;
      const box = item.getBoundingClientRect();
      if (x > box.left + box.width / 2) place += item.dataset.tab === undefined ? Number(item.dataset.count) || 0 : 1;
    }
    return place;
  };

  /**
   * Which group a dragged tab belongs in, by what it is dragged over (Matt: "Allow dragging into tab groups"), the way
   * Chrome decides it: over a tab of a group, or the group's chip, it is in that group; over a tab of none, over the
   * + or past either end of the row, it is in none. Between two things - the few pixels of gap - it stays as it was.
   * `undefined` is that last answer.
   *
   * It used to be read off where the tab landed: in a group only when dropped between two of its tabs. So a group of
   * one could never be dragged into, nor a group at either end, nor a folded one, which draws no tabs to land between.
   */
  const groupAt = (x: number, dragging: string): string | null | undefined => {
    const box = row.current;
    if (!box) return undefined;
    const things = [...box.querySelectorAll<HTMLElement>('[data-tab], [data-group-chip], [data-new-tab]')].filter((el) => el.dataset.tabId !== dragging);
    if (!things.length) return undefined;
    const first = things[0]!.getBoundingClientRect();
    const last = things[things.length - 1]!.getBoundingClientRect();
    if (x < first.left || x > last.right) return null;
    for (const el of things) {
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right) continue;
      if (el.dataset.groupChip) return el.dataset.groupChip;
      if (el.dataset.newTab !== undefined) return null;
      return el.dataset.groupId ?? null;
    }
    return undefined;
  };

  /*
   * The outline of the tab being read (`.glide`), and the gap in the row's line under it (NoteTabs.module.css `.tabs`).
   * The tab draws no outline of its own: its sides would run straight down to the line, and with the tab see-through
   * there is nothing to cover their foot where the curves take over (Matt: "Add the glass effect to the tabs"). This
   * one stops a curve's height above the line, and its curves hang from its two lower corners down onto it. It is the
   * same outline that slides from tab to tab, so a slide needs no hand-over at either end.
   *
   * Measured in the row's scrolled coordinates, where both are drawn. The gap starts a pixel inside each curve's outer
   * end - the outline's 1px border, which the curves are placed inside - so the line runs on into the curve with no
   * break; placed from the tab's outer edge, it stopped a pixel short of both.
   */
  const glide = useRef<HTMLSpanElement>(null);
  const outlineOf = (tab: HTMLElement | null | undefined) => {
    const box = row.current;
    if (!box || !tab) return null;
    const flare = parseFloat(getComputedStyle(box).getPropertyValue('--tab-flare')) || 0;
    const within = box.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    const left = at.left - within.left + box.scrollLeft;
    return {
      box: { left: `${left}px`, width: `${at.width}px`, top: `${at.top - within.top}px`, height: `${Math.max(0, at.height - flare)}px` },
      hole: { '--tab-hole-start': `${left + 1 - flare}px`, '--tab-hole-end': `${left + at.width - 1 + flare}px` },
    };
  };
  const placeOutline = () => {
    const box = row.current;
    const outline = glide.current;
    if (!box || !outline) return;
    const at = outlineOf(box.querySelector<HTMLElement>('[data-tab][data-active]'));
    if (at) {
      outline.dataset.on = '';
      Object.assign(outline.style, at.box);
    } else delete outline.dataset.on;
    for (const [name, value] of Object.entries(at?.hole ?? { '--tab-hole-start': '0px', '--tab-hole-end': '0px' })) box.style.setProperty(name, value);
  };
  // After every drawing of the row: a tab opened, closed, renamed, moved into a group or out of one each moves it.
  useLayoutEffect(placeOutline);

  /*
   * A flick along the row keeps going and slows to a stop (Matt: "Scrolling through the tabs doesn't have momentum").
   * The row is panned by hand rather than by the engine - a finger on it may be about to pick a tab up instead
   * (`takeHold`), so the pan is spent on `scrollLeft` as the finger moves - and a hand-panned scroller stops dead when
   * the finger lifts, where the engine would have carried it on. So the speed the finger left at is carried on here,
   * losing a fifteenth of itself each frame, until it is slower than a pixel every few frames or the row reaches its
   * end. A new touch on the row stops it where it is, as a finger stops a scrolling page.
   */
  const coasting = useRef(0);
  const coast = (box: HTMLElement, speed: number) => {
    let last = performance.now();
    let left = box.scrollLeft;
    let pace = speed;
    const step = (now: number) => {
      const frames = Math.min(4, (now - last) / 16.67);
      last = now;
      left += pace * 16.67 * frames;
      pace *= (1 - 1 / 15) ** frames;
      const end = box.scrollWidth - box.clientWidth;
      box.scrollLeft = left;
      if (Math.abs(pace) < 0.02 || left <= 0 || left >= end) return;
      coasting.current = requestAnimationFrame(step);
    };
    coasting.current = requestAnimationFrame(step);
  };

  const takeHold = (event: React.PointerEvent<HTMLDivElement>) => {
    cancelAnimationFrame(coasting.current);
    if (!onMove || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    const id = tab?.dataset.tabId;
    if (!id) return;
    // The cross is not a handle: pressing it means close, whatever the finger does next.
    if ((event.target as HTMLElement).closest('[data-close]')) return;

    const from = event.clientX;
    /*
     * One rule for a finger and a mouse alike: press and hold to pick a tab up (Matt: "the clicking and dragging is
     * eating me moving the tabs - the tabs should only move when I press and hold"). A mouse used to reorder the
     * moment it had travelled a few pixels, so a click that slid under the hand carried the tab with it.
     */
    let on = false;
    /** Whether the finger went anywhere once the tab was picked up: a hold that did not is a menu, not a move. */
    let travelled = false;
    /*
     * The groups as they were when the tab was picked up, and the group it is in now. Each move says where it belongs
     * from these, not from the last move's answer: a tab dragged out of a group of one empties it, and an empty group
     * goes, so worked out move by move, passing over the next tab would lose the group for good. From the start, it
     * comes back the moment the tab is back over it. A folded group takes the tab only when it is let go, since
     * joining a folded group hides the tab, and a tab hidden under the finger cannot be carried on.
     */
    const base = groups;
    let joined: string | null = base.of[id] ?? null;
    let dropInto: string | null = null;
    const hold = window.setTimeout(() => {
      on = true;
      setMoving(id);
    }, HOLD_MS);

    // Where along the tab it was taken hold of, so it hangs off the finger at the point it was picked up rather than
    // jumping its middle to the pointer.
    const grabbed = from - tab.getBoundingClientRect().left;

    const follow = (x: number) => {
      const el = row.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);
      if (!el) return;
      // Measured with the offset off, since a transform moves the box it would otherwise be measured from.
      el.style.transform = '';
      const home = el.getBoundingClientRect().left;
      el.style.transform = `translateX(${Math.round(x - grabbed - home)}px)`;
      // The tab being read carries its gap in the line along with it.
      placeOutline();
    };

    /*
     * Before the hold fires, a finger going sideways pans the row instead of picking a tab up (Matt: "I should be
     * able to scroll left or right on the tabs to see overflowing ones"). The row keeps `touch-action: pan-y`, so a
     * vertical swipe still scrolls the page natively and the sideways movement arrives here to be spent on
     * scrollLeft. It is the phone's own convention: swipe to move along, press and hold to pick something up.
     */
    let panned = from;
    /** How fast the finger is going along the row, in pixels a millisecond, smoothed so one odd frame cannot throw it. */
    let pace = 0;
    let paced = event.timeStamp;
    const along = (moved: PointerEvent) => {
      // Not held yet: this is a drag across the row, so it moves the row rather than anything in it.
      if (!on) {
        const step = panned - moved.clientX;
        if (Math.abs(moved.clientX - from) >= TRAVEL && row.current) {
          window.clearTimeout(hold);
          row.current.scrollLeft += step;
          const since = moved.timeStamp - paced;
          if (since > 0) {
            pace = pace * 0.7 + (step / since) * 0.3;
            paced = moved.timeStamp;
          }
          panned = moved.clientX;
          // A pan is not a tap: letting go must not open the tab it started on.
          dragged.current = true;
        }
        return;
      }
      dragged.current = true;
      travelled = true;
      const into = groupAt(moved.clientX, id);
      dropInto = null;
      if (into !== undefined && into !== joined) {
        const folded = !!into && base.list.find((g) => g.id === into)?.collapsed;
        if (folded) dropInto = into;
        else {
          joined = into;
          onGroups?.(into ? joinGroup(base, id, into) : leaveGroup(base, id));
        }
      }
      onMove(id, placeAt(moved.clientX, id), true);
      // After the row has been told where the tab belongs, not before: the tab has to follow the finger even between
      // two places (Matt: "moving tabs doesn't look like you're actually moving it, doesn't follow my finger").
      follow(moved.clientX);
    };
    const done = () => {
      window.clearTimeout(hold);
      window.removeEventListener('pointermove', along);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      // Let go and it settles into its place, rather than snapping there.
      const el = row.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);
      if (el) el.style.transform = '';
      // Let go mid-flick: the row carries on at the speed it was going. A tab picked up was not a flick.
      if (!on && row.current && Math.abs(pace) > 0.05) coast(row.current, pace);
      placeOutline();
      if (dropInto) onGroups?.(joinGroup(base, id, dropInto));
      // Held in one place and let go: the menu a mouse gets from a right-click. The tap that ends it must not also
      // open the note, so it is swallowed the way the end of a drag is.
      if (on && !travelled && event.pointerType !== 'mouse' && onGroups) {
        dragged.current = true;
        setMenu({ kind: 'tab', id });
      }
      setMoving(null);
      // The click that ends the drag is swallowed below; this clears the flag even when the gesture ends
      // somewhere that sends no click at all.
      if (dragged.current) window.setTimeout(() => {
        dragged.current = false;
      }, 0);
    };
    window.addEventListener('pointermove', along);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  };

  /*
   * Which ends of the row go to smoke: the right while there are tabs past it, the left once the row has been scrolled
   * away from its start and never at the start itself (Matt: "Blur the right side of the tabs and the left when
   * scrolled with the wisp animation but don't apply it to the left when it's scrolled all the way"). Watched rather
   * than worked out once: tabs are added, closed, dragged and renamed, workspaces put a pill in front of a name, the
   * window changes width and the row is scrolled, and each of those can open an end or close one.
   *
   * Each open end fades (NoteTabs.module.css `[data-fade-start]`, `[data-fade-end]`) and wears the wisp
   * (art/wispSides.ts), the smoke a page makes under its header turned on its side. The filter is set here rather than
   * in the stylesheet because it is made for the row's size; where it can't be had - the wisp switched off, reduced
   * motion, a row too big for the filter's budget - the fade is left on its own.
   */
  const [ends, setEnds] = useState({ start: false, end: false });
  useEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    const look = () => {
      const past = el.scrollWidth - el.clientWidth;
      const start = past > 1 && el.scrollLeft > 1;
      const end = past > 1 && el.scrollLeft < past - 1;
      setEnds((was) => (was.start === start && was.end === end ? was : { start, end }));
      el.style.filter = wispSides(el.clientWidth, el.clientHeight, start, end) ?? '';
      // A tab that changed width without the row being drawn again - its font arriving, the window resized.
      placeOutline();
    };
    look();
    const watch = new ResizeObserver(look);
    watch.observe(el);
    // Not the outline: it is sized by `look` itself, so watching it would answer every look with another.
    for (const tab of el.children) if (tab !== glide.current) watch.observe(tab);
    el.addEventListener('scroll', look, { passive: true });
    return () => {
      watch.disconnect();
      el.removeEventListener('scroll', look);
    };
    // `placeOutline` reads only the row itself, so a fresh one each render changes nothing worth watching again for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  /** Moving a tab without a pointer: the arrow keys with the platform's own modifier, as a browser's tab strip does. */
  const nudge = (id: string, at: number) => (event: React.KeyboardEvent) => {
    if (!onMove || !(event.metaKey || event.ctrlKey)) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onMove(id, at + (event.key === 'ArrowLeft' ? -1 : 1));
  };

  /*
   * The slot the screen's own controls are drawn into (core/topBarTools.ts). The bar offers the place; the screen
   * that owns those buttons fills it, because they hold the editor's state and cannot be lifted up here without it.
   */
  const slot = useCallback((element: HTMLDivElement | null) => setTopBarTools(element), []);

  /*
   * The tab being read slides to the one opened (Matt: "add an animation so the tab slides between items"). Measured
   * after the row has drawn the new tab as the active one, and before it is painted: the outline (`.glide`,
   * `placeOutline`) is sent back to the last tab and slides to the new one, taking on its width as it goes, with the
   * gap in the line beneath it. Nothing slides from a tab that has closed, to or from the list, while a tab is being
   * dragged, or for someone who has asked their phone for less motion.
   */
  const wasActive = useRef(activeId);
  useLayoutEffect(() => {
    const from = wasActive.current;
    wasActive.current = activeId;
    const box = row.current;
    const outline = glide.current;
    if (!box || !outline || !from || !activeId || from === activeId || moving) return undefined;
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const tab = (id: string) => box.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);
    const start = tab(from);
    const end = tab(activeId);
    if (!start || !end || typeof outline.animate !== 'function') return undefined;
    const leaving = outlineOf(start);
    const to = outlineOf(end);
    if (!leaving || !to) return undefined;
    const timing: KeyframeAnimationOptions = { duration: 220 * motionScale(), easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' };
    const along = ({ left, width }: { left: string; width: string }) => ({ left, width });
    const slide = outline.animate([along(leaving.box), along(to.box)], timing);
    // The gap in the line under it travels with it (NoteTabs.module.css `@property --tab-hole-start`).
    const gap = box.animate([leaving.hole, to.hole], timing);
    const land = () => {
      slide.cancel();
      gap.cancel();
    };
    slide.onfinish = land;
    // Another tab chosen mid-slide: this one lands at once, and the next sets off from where the last tab was.
    return () => {
      slide.onfinish = null;
      land();
    };
    // Only a change of tab starts a slide; a drag in progress is read, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  if (!onSidebar && !onGoBack && tabs.length === 0) return null;
  return (
    <div className={styles.bar}>
      <div className={styles.top}>
      {/* Home, first in the bar and before the sidebar's button (Matt: "Add a 'home' button", then "Move the home
          button to the left of the sidebar button"), drawn as a house (art/Icons.tsx). */}
      {onHome ? (
        <button
          type="button"
          className={styles.sidebar}
          onClick={onHome}
          aria-label="Home"
          title="Home"
          aria-current={atHome ? 'page' : undefined}
          data-on={atHome || undefined}
        >
          <House size={20} strokeWidth={2.1} />
        </button>
      ) : null}
      {onSidebar ? (
        <button
          type="button"
          className={styles.sidebar}
          onClick={onSidebar}
          data-sidebar-toggle
          aria-label="All your notes"
          aria-expanded={sidebarOpen ?? false}
          data-on={sidebarOpen || undefined}
        >
          <PanelLeft size={20} strokeWidth={2.1} aria-hidden="true" />
        </button>
      ) : null}
      {/* Where he has been: the same two arrows a browser has, in the same place, beside the sidebar's button. */}
      {onGoBack && onGoOn ? (
        <>
          <button type="button" className={styles.step} onClick={onGoBack} disabled={!canGoBack} aria-label="Back to where you were">
            <ArrowLeft size={19} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button type="button" className={styles.step} onClick={onGoOn} disabled={!canGoOn} aria-label="Forward again">
            <ArrowRight size={19} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </>
      ) : null}
        {/* The screen's own controls, at the far end (Matt: "Move the controls for the note into the topbar"). */}
        <div ref={slot} className={styles.slot} />
        {/* The aside's toggle, last of all: the sidebar's icon reversed (Matt: "a sidebar toggle on the right with the icon reversed"). */}
        {onAside ? (
          <button
            type="button"
            className={`${styles.sidebar} ${styles.mirrored}`}
            onClick={onAside}
            data-aside-toggle
            aria-label="Book index and notes"
            aria-expanded={asideOpen ?? false}
            data-on={asideOpen || undefined}
          >
            <PanelLeft size={20} strokeWidth={2.1} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/*
        The tabs, on their own line under the controls (Matt: "put the tabs on the next line down"), and no line at
        all when nothing is open (Matt: "This row can be hidden when there are no tabs open") - a note opened from
        the list used to carry an empty strip for tabs it did not have.
      */}
      {tabs.length > 0 ? (
        <div
          ref={row}
          className={styles.tabs}
          data-fade-start={ends.start || undefined}
          data-fade-end={ends.end || undefined}
          role="tablist"
          aria-label="Notes you have open"
          onPointerDown={takeHold}
          onWheel={scrollSideways}
          onClickCapture={(event) => {
            if (!dragged.current) return;
            dragged.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span ref={glide} className={styles.glide} aria-hidden="true" />
          {tabs.map((note, at) => {
            const title = noteTitle(note.body) || 'Untitled';
            const active = note.id === activeId;
            const groupId = groups.of[note.id];
            const group = groupId ? groups.list.find((g) => g.id === groupId) : undefined;
            const firstOfGroup = !!group && groups.of[tabs[at - 1]?.id ?? ''] !== group.id;
            const chip = group && firstOfGroup ? (
              <GroupChip
                key={`group-${group.id}`}
                group={group}
                count={tabs.filter((t) => groups.of[t.id] === group.id).length}
                renaming={renaming === group.id}
                onToggle={() => change(toggleGroup(groups, group.id))}
                onMenu={() => setMenu({ kind: 'group', id: group.id })}
                onRename={(name) => {
                  change(renameGroup(groups, group.id, name));
                  setRenaming(null);
                }}
                menu={
                  menu?.kind === 'group' && menu.id === group.id ? (
                    <Menu open onOpenChange={(open) => !open && setMenu(null)} trigger={<span className={styles.menuAnchor} />} placement="bottom-start" aria-label={`${group.name} group`}>
                      <MenuItem onSelect={() => setRenaming(group.id)}>Rename</MenuItem>
                      <MenuSub label="Colour">
                        {WORKSPACE_HUES.map((hue) => (
                          <MenuItem key={hue} onSelect={() => change(recolourGroup(groups, group.id, hue))} icon={<span className={styles.hueDot} data-hue={hue} aria-hidden="true" />}>
                            {hue === 'ink' ? 'Ink' : hue[0]!.toUpperCase() + hue.slice(1)}
                          </MenuItem>
                        ))}
                      </MenuSub>
                      <MenuSeparator />
                      <MenuItem onSelect={() => change(ungroup(groups, group.id))}>Ungroup</MenuItem>
                      <MenuItem danger onSelect={() => onCloseTabs?.(membersOf(groups, group.id, tabs.map((t) => t.id)))}>
                        Close group
                      </MenuItem>
                    </Menu>
                  ) : null
                }
              />
            ) : null;
            // A folded group draws only its chip.
            if (group?.collapsed) return chip;
            // The workspace the note is filed in, worn as its own coloured pill in front of the name (Matt: "show the
            // workspace pill first on the tab"). Two notes called Monday are told apart by colour before either is read.
            const space = spaces.list.find((w) => w.id === spaces.of[note.id]) ?? null;
            return [
              chip,
              <span
                key={note.id}
                data-tab
                data-tab-id={note.id}
                className={styles.tab}
                data-active={active || undefined}
                data-moving={moving === note.id || undefined}
                data-group={group ? group.hue : undefined}
                data-group-id={group ? group.id : undefined}
                onPointerDownCapture={(event) => {
                  pointer.current = event.pointerType;
                }}
                onContextMenu={(event) => {
                  // Always refused: on a phone this is the press-and-hold callout, which would land on top of the
                  // drag and the menu the hold itself opens (`takeHold`). A mouse's right-click opens the menu here.
                  event.preventDefault();
                  if (pointer.current !== 'mouse' || !onGroups) return;
                  setMenu({ kind: 'tab', id: note.id });
                }}
              >
                {naming?.id === note.id ? (
                  /* The canvas's name, written where the tab's name was. Enter keeps it, Escape leaves it, and
                     leaving the field keeps it too - a phone has no Escape and losing the words to a stray tap
                     would be worse than a name kept by accident, which is one more rename to put right. */
                  <input
                    className={styles.name}
                    value={naming.draft}
                    aria-label="Canvas name"
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setNaming({ id: note.id, draft: event.currentTarget.value })}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={() => keepName(note.id, title, true)}
                    onKeyDown={(event) => {
                      // Enter keeps it here rather than by blurring the field: measured in the browser, the blur that
                      // a blur() raises never reached the handler, and the field sat open with the new name in it.
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        keepName(note.id, title, true);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        keepName(note.id, title, false);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={styles.name}
                    onKeyDown={nudge(note.id, at)}
                    onClick={() => onOpen(note.id)}
                    // Said rather than shown twice: the pill is a colour to the eye and the workspace's name to a reader.
                    aria-label={space ? `${title}, in ${space.name}` : title}
                  >
                    {space ? (
                      <span className={styles.space} data-hue={space.hue ?? 'ink'} aria-hidden="true">
                        {space.name}
                      </span>
                    ) : null}
                    <span className={styles.title}>{title}</span>
                  </button>
                )}
                <button type="button" data-close className={styles.close} onClick={() => onClose(note.id)} aria-label={`Close ${title}`}>
                  <X size={15} strokeWidth={2.4} aria-hidden="true" />
                </button>
                {/* The group's colour along the foot of each of its tabs, as Chrome draws a group - drawn in, not
                    taken away, under the one being read, which stays open onto the note (NoteTabs.module.css). */}
                {group ? <span className={styles.groupLine} data-hue={group.hue} aria-hidden="true" /> : null}
                {menu?.kind === 'tab' && menu.id === note.id ? (
                  <Menu open onOpenChange={(open) => !open && setMenu(null)} trigger={<span className={styles.menuAnchor} />} placement="bottom-start" aria-label={`${title} tab`}>
                    {/* A canvas is named by its front matter and has no first line to write, so the row offers it. */}
                    {onRename && (isCanvasBody(note.body) || isBookBody(note.body)) ? <MenuItem onSelect={() => setNaming({ id: note.id, draft: title })}>Rename</MenuItem> : null}
                    <MenuItem onSelect={() => startGroup(note.id)}>Add to a new group</MenuItem>
                    {groups.list.filter((g) => g.id !== groupId).length ? (
                      <MenuSub label="Add to group">
                        {groups.list
                          .filter((g) => g.id !== groupId)
                          .map((g) => (
                            <MenuItem key={g.id} onSelect={() => change(joinGroup(groups, note.id, g.id))} icon={<span className={styles.hueDot} data-hue={g.hue} aria-hidden="true" />}>
                              {g.name}
                            </MenuItem>
                          ))}
                      </MenuSub>
                    ) : null}
                    {groupId ? <MenuItem onSelect={() => change(leaveGroup(groups, note.id))}>Remove from group</MenuItem> : null}
                    <MenuSeparator />
                    <MenuItem onSelect={() => onClose(note.id)}>Close tab</MenuItem>
                  </Menu>
                ) : null}
              </span>,
            ];
          })}
          {/* After the last tab, so it moves along with the row: a new note, in a tab of its own. Not a tab itself
              (no `data-tab`), so dragging and the hold never take it for one. */}
          {onNew ? (
            <button type="button" className={styles.newTab} data-new-tab onClick={onNew} aria-label="New note in a new tab" title="New note">
              <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A group's chip, before its first tab: its name in its colour, as Chrome draws one. A tap folds the group to the chip
 * and opens it again; a right-click or a long press opens its menu (rename, colour, ungroup, close). Folded, it says
 * how many tabs it holds. It is not a tab - no `data-tab` - so the drag and the hold pass it by.
 */
function GroupChip({
  group,
  count,
  renaming,
  onToggle,
  onMenu,
  onRename,
  menu,
}: {
  group: TabGroup;
  count: number;
  renaming: boolean;
  onToggle: () => void;
  onMenu: () => void;
  onRename: (name: string) => void;
  menu: React.ReactNode;
}) {
  const [draft, setDraft] = useState(group.name);
  useEffect(() => {
    if (renaming) setDraft(group.name);
  }, [renaming, group.name]);
  return (
    <span className={styles.group} data-hue={group.hue} data-group-chip={group.id} data-collapsed={group.collapsed || undefined} data-count={count}>
      {renaming ? (
        <input
          className={styles.groupName}
          value={draft}
          aria-label="Group name"
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRename(draft);
            else if (event.key === 'Escape') onRename(group.name);
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.groupChip}
          aria-expanded={!group.collapsed}
          aria-label={`${group.name}, ${count} ${count === 1 ? 'tab' : 'tabs'}${group.collapsed ? ', folded' : ''}`}
          onClick={onToggle}
          onContextMenu={(event) => {
            event.preventDefault();
            onMenu();
          }}
        >
          {group.name}
          {/* Open or folded alike, so folding a group leaves its chip the size it was (Matt: "changing tab groups to
              closed slightly changes the size of the tab group labels") - the count only arriving on folding made
              the chip grow by it and pushed every tab after it along. */}
          <span className={styles.groupCount}>{count}</span>
        </button>
      )}
      {menu}
    </span>
  );
}
