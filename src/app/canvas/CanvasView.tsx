import { Ghost } from '../art/Ghost.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartNoAxesCombined, FileText, Image, Link2, LocateFixed, Maximize, Plus, Spline, SquarePen, Table } from '@glacier/icons';
import { imageUrl, IMAGE_READY, pickImage, saveImageFile } from '../core/images.ts';
import { Editor } from '../editor/Editor.tsx';
import { useBack } from '../core/back.ts';
import { SheetGroup, SheetRow, SheetTitle } from '../plugins/kit.tsx';
import sheet from '../editor/NoteSettings.module.css';
import { useSheetDrag } from '../editor/sheetDrag.ts';
import { NotePeek } from '../notes/NotePeek.tsx';
import { openLink } from '../core/linkPreview.ts';
import { shortUrl } from '../core/shortUrl.ts';
import {
  edgePaths,
  LABEL_LINE,
  fileTitle,
  isImageFile,
  isOnlyTable,
  joined,
  anchorOf,
  sidesOf,
  labelledEdge,
  labelledGroup,
  movedWithHeld,
  newEdge,
  newFileNode,
  newLinkNode,
  newPictureNode,
  newTextNode,
  CHART_CARD,
  TABLE_CARD,
  bounds,
  NEW_CARD,
  paintOf,
  resizedNode,
  withEdge,
  withNode,
  withoutEdge,
  withoutNode,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
} from './jsonCanvas.ts';
import { clampScale, FIT_ROOM, fitted, fittedTo, shown as shownBox, zoomedAt, type View } from './viewport.ts';
import styles from './CanvasView.module.css';

/**
 * A canvas drawn (docs/CANVAS.md): cards where the file puts them, lines between them, an infinite page under it all
 * that two fingers or a trackpad move and pinch. The first slice (Matt, 2026-09-20: "read and draw an Obsidian file"
 * first, editing second), so nothing here changes the canvas: it reads it faithfully, and a card that is a note or a
 * link opens on a tap.
 *
 * The drawing is one element, the world, moved and scaled with a transform: the cards sit at their own pixel
 * positions inside it, and the lines are one SVG laid over them in the same pixels, so a pinch scales everything at
 * once and nothing is laid out twice. The transform is written straight to the element as the fingers move, not
 * through React, so a pan is a style change and nothing else.
 *
 * A card of words is the note's own editor, read-only and in its peek mode, the way a home card draws a note
 * (notes/NotePeek.tsx) - so a card draws the same way a note does, and an editor is only made once a card is near the
 * screen, since a canvas may hold fifty and each costs a frame.
 *
 * The second slice edits (Matt: "continue progress on canvases"). A double-tap on the page makes a card of words
 * there, open with the keyboard up (Matt's choice, docs/CANVAS.md: "double-tap empty space ... Obsidian's move"), and
 * the + tool makes one mid-screen. A press held on a card lifts it, and it goes where the finger goes - the way a
 * board's card and a tab are moved (editor/boards.ts, notes/NoteTabs.tsx), so one habit serves the whole app; a plain
 * drag still pans, so a finger on a card never moves it by mistake. A double-tap on a card of words opens it to be
 * written in, its editor in the note's own mode and the words going straight into the canvas; a card open that way
 * can be taken off. Moving, opening and taking off were not put to Matt, so those are the app's conventions, not his
 * choices. Every change is the whole canvas handed back (`onChange`), which the note writes into its body as the
 * spec's JSON, so a canvas edited here still opens in Obsidian. Without `onChange` the canvas is read-only, as the
 * first slice was.
 *
 * Lines (the third slice, Matt's first pick): the Line tool turns the next two taps into a line, from the first
 * card tapped to the second, with an arrow at its end and its sides worked out from where the cards are; a tap on a
 * line picks it, and a picked line shows its words to be written and a cross to take it off. A tool rather than a
 * drag from a card's edge, because a finger has no hover to find an edge dot by, and the two taps read the same on
 * a phone and with a mouse.
 *
 * Sizes and groups (the fourth slice): a card open to be written in has a corner to drag that resizes it, no smaller
 * than a word and a cross; a held press on a group lifts it with everything wholly inside it (choice 5); a double-tap
 * on a group opens its name to be written, and a cross there takes the group off - the cards in it stay. Making a
 * group round cards is the + menu's, in the next slice with the other ways to add.
 *
 * More ways to add (the fifth slice, choice 8): the + is a sheet - words, a note chosen by its title, or a web
 * address - and a note dragged in from the sidebar lands as a card where it is dropped. Pictures wait, since Glyph
 * has no picture files of its own to point at; by voice belongs to the capture.
 *
 * Pictures, charts and tables (the seventh): the + also offers a picture from the phone or the computer, kept by the
 * picture store the notes use (core/images.ts) and drawn on its card; a chart, which is a card of words starting as
 * a Mermaid diagram and drawn as one; and a table. A picture file dropped on the canvas is kept and drawn the same.
 * The tools are a floating toolbar of icons at the bottom left, and the map sits at the bottom right.
 *
 * Navigation (the sixth, choice 10): a tap on a card's title zooms to the card, Shift+1 fits the whole canvas and
 * Shift+2 zooms to the card open or picked, both as buttons too, and a minimap in the corner draws every card small
 * with the screen's box over them; a tap on it goes there.
 *
 * Nothing is captured until a press has become a drag, so a tap still reaches the card it landed on; two fingers
 * move the page whatever they are on.
 */

export interface CanvasWiki {
  /** Whether a note by that title exists: a note card is drawn as a note, or as one waiting to be written. */
  known: (title: string) => boolean;
  /** Opens the note by that title, at an anchor when the card names one. */
  open: (title: string, at?: string) => void;
  /** The note's body by title, for drawing it small on its card; null where the note is not there. */
  body?: (title: string) => string | null;
  /** Every note's title, for choosing one to put on the canvas as a card. */
  titles?: () => string[];
}

export interface CanvasViewProps {
  canvas: Canvas;
  dark: boolean;
  wiki?: CanvasWiki;
  className?: string;
  /** The canvas after a change - a card moved, made, written in or taken off. Absent, the canvas cannot be changed. */
  onChange?: (canvas: Canvas) => void;
}

/** How far off the screen a card's editor is made, in screen pixels. */
const NEAR_PX = 300;
/** How far a finger moves before a press is a drag rather than a tap, in screen pixels. */
const SLOP_PX = 4;
/** Two taps this close in time and place are a double-tap: a new card on the page, or a card of words opened. */
const DOUBLE_MS = 350;
const DOUBLE_PX = 24;
/** How long a press stays put before it lifts the card under it rather than panning the page: the boards' own wait. */
const HOLD_MS = 220;

/** Where two fingers are, as one point between them and the distance apart; one finger is its point and no distance. */
function grip(pointers: Map<number, { x: number; y: number }>): { x: number; y: number; distance: number } {
  const [a, b] = [...pointers.values()];
  if (!a) return { x: 0, y: 0, distance: 0 };
  if (!b) return { x: a.x, y: a.y, distance: 0 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

export function CanvasView({ canvas, dark, wiki, className, onChange }: CanvasViewProps) {
  const host = useRef<HTMLDivElement>(null);
  /*
   * The canvas as it is being changed: the one handed in, with a card part-way through a drag on top of it. Every
   * change goes out through `onChange` and comes back as the next `canvas`; between the two, and while a finger is
   * still moving a card, this is what is drawn.
   */
  const [live, setLive] = useState(canvas);
  useEffect(() => setLive(canvas), [canvas]);
  const editable = !!onChange;
  /** The card of words open to be written in, by id. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Drawing a line: waiting for its first card, or for its second with the first chosen. */
  const [lining, setLining] = useState<{ from: string | null } | null>(null);
  /** The line picked by a tap, by id: its words are shown to be written, and its cross to take it off. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The + sheet, and the step it is at: choosing what to add, a note's title, or a web address. */
  const [adding, setAdding] = useState<'what' | 'note' | 'link' | null>(null);
  /** A browser's pictures arrive from storage after the card is drawn: drawn again when one does (core/images.ts). */
  const [, pictureArrived] = useState(0);
  useEffect(() => {
    const again = () => pictureArrived((n) => n + 1);
    window.addEventListener(IMAGE_READY, again);
    return () => window.removeEventListener(IMAGE_READY, again);
  }, []);
  /** The card last tapped or opened: what Shift+2 and the zoom button go to. */
  const [chosen, setChosen] = useState<string | null>(null);
  const change = useCallback(
    (next: Canvas) => {
      setLive(next);
      onChange?.(next);
    },
    [onChange],
  );
  const world = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: FIT_ROOM, y: FIT_ROOM, scale: 1 });
  /** Whether a finger or a wheel has moved the view: until then, a screen that changes size fits the canvas again. */
  const touched = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** Where the fingers took hold and what the view was then: every move is measured from here, not from the last. */
  const hold = useRef<{ view: View; x: number; y: number; distance: number } | null>(null);
  /** Whether this press became a drag: the tap that would follow it is not one, and no card opens. */
  const dragged = useRef(false);
  /** The card a held press lifted, where the press was, and the canvas as it was then: the move is measured from there. */
  const carrying = useRef<{ node: CanvasNode; x: number; y: number; base: Canvas } | null>(null);
  /** The wait for a press on a card to become a hold; cleared by movement or by letting go. */
  const holdTimer = useRef(0);
  /** The card lifted, for its look while it is carried. */
  const [lifted, setLifted] = useState<string | null>(null);
  /** The last tap, and what it was on, for telling a double-tap. */
  const lastTap = useRef<{ at: number; x: number; y: number; on: string | null } | null>(null);

  /** The view again, as state, for what is drawn from it (the minimap): written once a frame at most. */
  const [viewShown, setViewShown] = useState<View>(view.current);
  /** The minimap grown, from a press on it, until a press lands on the canvas itself. */
  const [mapBig, setMapBig] = useState(false);
  const viewFrame = useRef(0);
  const apply = useCallback(() => {
    const el = world.current;
    if (!el) return;
    const { x, y, scale } = view.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    // The dots under the cards move and scale with them (CanvasView.module.css `.canvas`).
    const page = host.current;
    if (page) {
      page.style.setProperty('--canvas-x', `${x}px`);
      page.style.setProperty('--canvas-y', `${y}px`);
      page.style.setProperty('--canvas-scale', String(scale));
    }
    cancelAnimationFrame(viewFrame.current);
    viewFrame.current = requestAnimationFrame(() => setViewShown({ ...view.current }));
  }, []);

  const fit = useCallback(() => {
    const el = host.current;
    if (!el) return;
    view.current = fitted(canvas, el.clientWidth, el.clientHeight);
    touched.current = false;
    apply();
  }, [canvas, apply]);

  // The canvas opens fitted to the screen, and follows the screen's size until it has been moved by hand.
  useEffect(() => {
    fit();
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const watcher = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [fit]);

  const takeHold = () => {
    const at = grip(pointers.current);
    hold.current = { view: { ...view.current }, x: at.x, y: at.y, distance: at.distance };
  };

  /** The point of the canvas under a point of the screen. */
  const under = (clientX: number, clientY: number) => {
    const rect = host.current?.getBoundingClientRect();
    const { x, y, scale } = view.current;
    return { x: (clientX - (rect?.left ?? 0) - x) / scale, y: (clientY - (rect?.top ?? 0) - y) / scale };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Typing in a card that is open: the press is the editor's, for its caret and its selection.
    if (editing && target.closest('[data-editing]')) return;
    // A press on the canvas itself puts the grown minimap back.
    setMapBig(false);
    // A press is a tap until it moves: a tap on a card that opens something is the card's, and taking the pointer
    // here would take its click with it. It is only captured once it has become a drag.
    window.clearTimeout(holdTimer.current);
    if (!pointers.current.size) {
      dragged.current = false;
      carrying.current = null;
      // One finger on a card, on a canvas that can change: held still for a moment, it lifts the card.
      const id = editable ? target.closest<HTMLElement>('[data-card]')?.dataset.card : undefined;
      const node = id ? live.nodes.find((n) => n.id === id) : undefined;
      if (node) {
        const at = { x: event.clientX, y: event.clientY };
        const pointerId = event.pointerId;
        holdTimer.current = window.setTimeout(() => {
          if (pointers.current.size !== 1 || !pointers.current.has(pointerId)) return;
          carrying.current = { node, x: at.x, y: at.y, base: live };
          dragged.current = true;
          setLifted(node.id);
          try {
            host.current?.setPointerCapture(pointerId);
          } catch {
            // Already gone: nothing to hold.
          }
        }, HOLD_MS);
      }
    } else carrying.current = null;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    takeHold();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !hold.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = hold.current;
    const now = grip(pointers.current);
    if (!dragged.current) {
      if (pointers.current.size < 2 && Math.hypot(now.x - start.x, now.y - start.y) < SLOP_PX) return;
      // Moved before the hold: a pan, and the card stays where it is.
      window.clearTimeout(holdTimer.current);
      dragged.current = true;
      // The drag is the page's now, wherever the pointer goes: off a card, out of the window and back.
      for (const id of pointers.current.keys()) {
        try {
          host.current?.setPointerCapture(id);
        } catch {
          // A pointer already gone: nothing to hold.
        }
      }
    }
    // A card being carried: it follows the finger in the canvas's own pixels, and the page stays put.
    const carried = carrying.current;
    if (carried && pointers.current.size < 2) {
      const scale = view.current.scale;
      const { node } = carried;
      setLive(movedWithHeld(carried.base, node, node.x + (event.clientX - carried.x) / scale, node.y + (event.clientY - carried.y) / scale));
      return;
    }
    touched.current = true;
    // The point of the canvas that was under the fingers stays under them, whatever they do: a second finger's
    // spread scales about that point, and one finger's move carries it along.
    const scale = start.distance > 0 && now.distance > 0 ? clampScale((start.view.scale * now.distance) / start.distance) : start.view.scale;
    const underX = (start.x - start.view.x) / start.view.scale;
    const underY = (start.y - start.view.y) / start.view.scale;
    view.current = { x: now.x - underX * scale, y: now.y - underY * scale, scale };
    apply();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    window.clearTimeout(holdTimer.current);
    if (!pointers.current.delete(event.pointerId)) return;
    // A card let go where it was carried to: the canvas is handed on with it there.
    const carried = carrying.current;
    if (carried) {
      carrying.current = null;
      setLifted(null);
      const scale = view.current.scale;
      change(movedWithHeld(carried.base, carried.node, carried.node.x + (event.clientX - carried.x) / scale, carried.node.y + (event.clientY - carried.y) / scale));
    }
    if (pointers.current.size) takeHold();
    else hold.current = null;
  };

  /*
   * A tap closes whatever card was open. A second tap close on the heels of the first, in the same place, is a
   * double-tap: on the page it makes a new card of words there, open to be written in; on a card of words it opens
   * that card. A note card and a link card open on a single tap, as they did (`Card`), so a double-tap is kept for
   * the two things a single tap cannot mean.
   */
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dragged.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-editing]') || target.closest('button') || target.closest('[data-line-words]')) return;
    const id = target.closest<HTMLElement>('[data-card]')?.dataset.card;
    const node = id ? live.nodes.find((n) => n.id === id) : undefined;
    if (node && node.id !== chosen) setChosen(node.id);
    // A tap on a card's title zooms to the card (choice 10), on any canvas; the rest of the card does what it did.
    if (node && target.closest('[data-card-title]')) {
      zoomTo(node.id);
      return;
    }
    if (!editable) return;
    if (editing) setEditing(null);
    // A tap on a line picks it; a tap anywhere else lets it go.
    const lineId = target.closest<Element>('[data-line]')?.getAttribute('data-line') ?? null;
    if (lineId !== picked) setPicked(lineId);
    if (lineId) return;
    const pictureCard = node?.type === 'file' && isImageFile(node.file) && !node.file.includes('/');
    if (node && node.type !== 'text' && node.type !== 'group' && !pictureCard) return;
    const now = performance.now();
    const last = lastTap.current;
    const again = !!last && last.on === (node?.id ?? null) && now - last.at < DOUBLE_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_PX;
    if (again) {
      lastTap.current = null;
      if (node) setEditing(node.id);
      else addCard(event.clientX, event.clientY);
      return;
    }
    lastTap.current = { at: now, x: event.clientX, y: event.clientY, on: node?.id ?? null };
  };

  /** A new card of words centred on a point of the screen, open to be written in. */
  const addCard = (clientX: number, clientY: number) => {
    const at = under(clientX, clientY);
    const card = newTextNode(at.x - NEW_CARD.width / 2, at.y - NEW_CARD.height / 2);
    change(withNode(live, card));
    setEditing(card.id);
  };

  /** The middle of the screen, in the canvas's pixels, where a card added from the + lands. */
  const middle = () => {
    const el = host.current;
    const rect = el?.getBoundingClientRect();
    return under((rect?.left ?? 0) + (rect?.width ?? 0) / 2, (rect?.top ?? 0) + (rect?.height ?? 0) / 2);
  };
  /** A new card of words in the middle of the screen, from the + sheet. */
  const addCardHere = () => {
    const at = middle();
    const card = newTextNode(at.x - NEW_CARD.width / 2, at.y - NEW_CARD.height / 2);
    change(withNode(live, card));
    setEditing(card.id);
  };
  const addNoteCard = (title: string, at = middle()) => {
    const card = newFileNode(title, at.x - NEW_CARD.width / 2, at.y - 80);
    change(withNode(live, card));
    setChosen(card.id);
  };
  /** A card of words that starts as something: a chart, a table. Open to be written in at once. */
  const addStartedCard = (text: string) => {
    const at = middle();
    const card = { ...newTextNode(at.x - NEW_CARD.width / 2, at.y - 90), text, height: 180 };
    change(withNode(live, card));
    setEditing(card.id);
  };
  const addPictureCard = (name: string, at = middle()) => {
    const card = newPictureNode(name, at.x - NEW_CARD.width / 2, at.y - 100);
    change(withNode(live, card));
    setChosen(card.id);
  };
  /** A picture chosen from the phone or the computer, kept the way a note's pictures are kept, then a card of it. */
  const addPicture = async () => {
    const name = await pickImage();
    if (name) addPictureCard(name);
  };
  const addLinkCard = (url: string) => {
    const at = middle();
    const card = newLinkNode(url, at.x - NEW_CARD.width / 2, at.y - 50);
    if (card) {
      change(withNode(live, card));
      setChosen(card.id);
    }
  };

  /** Zoom to a card: the view fitted to its box, no larger than life. */
  const zoomTo = useCallback(
    (id: string) => {
      const el = host.current;
      const node = live.nodes.find((n) => n.id === id);
      if (!el || !node) return;
      view.current = fittedTo(node, el.clientWidth, el.clientHeight);
      touched.current = true;
      apply();
    },
    [live, apply],
  );

  // Shift+1 fits the whole canvas, Shift+2 zooms to the card open or picked (choice 10), as in Obsidian.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.shiftKey || (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]'))) return;
      if (event.key === '!' || event.code === 'Digit1') fit();
      else if ((event.key === '@' || event.code === 'Digit2') && (editing ?? chosen)) zoomTo((editing ?? chosen)!);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, zoomTo, editing, chosen]);

  /** A note dragged in from the sidebar (notes/NoteTree.tsx), or a picture file dropped from the computer: a card where it lands. */
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editable) return;
    const at = under(event.clientX, event.clientY);
    const picture = [...(event.dataTransfer.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (picture) {
      event.preventDefault();
      // A file the store cannot read (not a picture after all, or one it cannot decode) makes no card, and says why.
      void saveImageFile(picture)
        .then((name) => addPictureCard(name, at))
        .catch((error: unknown) => console.warn('[glyph] picture not kept:', error));
      return;
    }
    const title = event.dataTransfer.getData('application/x-glyph-note') ? event.dataTransfer.getData('text/plain') : '';
    if (!title) return;
    event.preventDefault();
    addNoteCard(title, at);
  };

  const writeCard = (id: string, text: string) => {
    const node = live.nodes.find((n) => n.id === id);
    if (node?.type === 'text' && node.text !== text) change(withNode(live, { ...node, text }));
  };

  const resizeCard = (id: string, width: number, height: number) => {
    const node = live.nodes.find((n) => n.id === id);
    if (node) change(withNode(live, resizedNode(node, width, height)));
  };
  /** While the corner is dragged the card is drawn at its size; the canvas is handed on when the corner is let go. */
  const previewSize = (id: string, width: number, height: number) => {
    setLive((was) => {
      const node = was.nodes.find((n) => n.id === id);
      return node ? withNode(was, resizedNode(node, width, height)) : was;
    });
  };
  const nameGroup = (id: string, label: string) => {
    const node = live.nodes.find((n) => n.id === id);
    if (node?.type === 'group' && (node.label ?? '') !== label.trim()) change(withNode(live, labelledGroup(node, label)));
  };

  const removeCard = (id: string) => {
    if (editing === id) setEditing(null);
    change(withoutNode(live, id));
  };

  const labelLine = (id: string, words: string) => {
    const line = live.edges.find((e) => e.id === id);
    if (line) change(withEdge(live, labelledEdge(line, words)));
  };

  const removeLine = (id: string) => {
    if (picked === id) setPicked(null);
    change(withoutEdge(live, id));
  };

  // Escape closes the card being written in, lets a picked line go, and puts the Line tool down.
  useEffect(() => {
    if (!editing && !picked && !lining) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setEditing(null);
      setPicked(null);
      setLining(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, picked, lining]);

  /*
   * Before any card sees a tap: the click at the end of a drag is the drag's and goes no further; and while a line is
   * being drawn, a tap on a card is the line's, so a note card or a link card must not open (a link card did, and
   * the page left for its address).
   */
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dragged.current) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (!lining) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-line-words]')) return;
    event.stopPropagation();
    event.preventDefault();
    const id = target.closest<HTMLElement>('[data-card]')?.dataset.card;
    const node = id ? live.nodes.find((n) => n.id === id) : undefined;
    if (!node || node.type === 'group') return;
    if (!lining.from) setLining({ from: node.id });
    else if (node.id !== lining.from && !joined(live, lining.from, node.id)) {
      const line = newEdge(lining.from, node.id);
      change(withEdge(live, line));
      setLining(null);
      setPicked(line.id);
    }
  };

  // A wheel pans, as it does in Obsidian; with the modifier held - which is also what a trackpad pinch arrives as -
  // it zooms about the pointer. Attached by hand: React's wheel is passive, and the page must not scroll instead.
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      touched.current = true;
      const was = view.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        view.current = zoomedAt(was, event.clientX - rect.left, event.clientY - rect.top, was.scale * Math.exp(-event.deltaY * 0.01));
      } else {
        view.current = { ...was, x: was.x - event.deltaX, y: was.y - event.deltaY };
      }
      apply();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [apply]);

  // Drawn together: where one line's end sits depends on the others' (jsonCanvas.ts `edgePaths`).
  const edges = useMemo(() => {
    const paths = edgePaths(live);
    return live.edges.map((edge) => ({ edge, path: paths.get(edge.id) ?? null })).filter((e) => e.path);
  }, [live]);
  const pickedLine = picked ? edges.find((e) => e.edge.id === picked) : undefined;

  return (
    <div
      ref={host}
      className={className ? `${styles.canvas} ${className}` : styles.canvas}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
      onClick={onClick}
      role={editable ? undefined : 'img'}
      aria-label={`A canvas of ${live.nodes.length} cards`}
      data-editable={editable || undefined}
      data-lining={lining ? (lining.from ? 'to' : 'from') : undefined}
      onDragOver={editable ? (event) => event.preventDefault() : undefined}
      onDrop={editable ? onDrop : undefined}
    >
      {!live.nodes.length ? (
        <div className={styles.emptyCanvas}>
          <Ghost scene="empty-canvas" align="center" className={styles.emptyCanvasArt} />
          <p className={styles.emptyCanvasWords}>{editable ? 'Double-tap to add a card.' : 'An empty canvas.'}</p>
        </div>
      ) : null}
      <div ref={world} className={styles.world}>
        {live.nodes.map((node) => (
          <Card
            key={node.id}
            node={node}
            dark={dark}
            wiki={wiki}
            root={host}
            editing={editing === node.id}
            lifted={lifted === node.id}
            lineFrom={lining?.from === node.id}
            onWrite={editable ? writeCard : undefined}
            onRemove={editable ? removeCard : undefined}
            onResize={editable ? resizeCard : undefined}
            onPreviewSize={editable ? previewSize : undefined}
            onName={editable ? nameGroup : undefined}
            scale={view}
          />
        ))}
        <svg className={styles.edges} aria-hidden="true">
          {edges.map(({ edge, path }) => {
            const paint = paintOf(edge.color);
            const style = paint && 'hex' in paint ? { '--app-space': paint.hex } : undefined;
            return (
              <g
                key={edge.id}
                className={styles.edge}
                data-hue={paint && 'hue' in paint ? paint.hue : undefined}
                data-line={editable ? edge.id : undefined}
                data-picked={picked === edge.id || undefined}
                style={style as React.CSSProperties}
              >
                {/* A wide, unseen stroke under the line, so a finger can land on it. */}
                {editable ? <path className={styles.lineHit} d={path!.d} /> : null}
                <path className={styles.line} d={path!.d} />
                {path!.fromHead ? <path className={styles.head} d={path!.fromHead} /> : null}
                {path!.toHead ? <path className={styles.head} d={path!.toHead} /> : null}
                {edge.label && picked !== edge.id ? (
                  // Its lines, one under another about the point: broken where one line would not fit between cards.
                  <text className={styles.label} x={path!.mid.x} y={path!.mid.y}>
                    {path!.lines.map((line, i) => (
                      <tspan key={i} x={path!.mid.x} dy={i === 0 ? -((path!.lines.length - 1) * LABEL_LINE) / 2 : LABEL_LINE}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {/* The picked line's words and its cross, over the line's middle, in the canvas's own pixels. */}
        {pickedLine ? <LineWords key={pickedLine.edge.id} edge={pickedLine.edge} at={pickedLine.path!.mid} onLabel={labelLine} onRemove={removeLine} /> : null}
      </div>
      {/* The toolbar: icons, floating at the bottom left (Matt: "a floating bottom left aligned toolbar and use
          iconography instead of text"). What a line needs next is said beside it while one is being drawn. */}
      <div className={styles.tools} role="toolbar" aria-label="Canvas tools">
        {editable ? (
          <>
            <button type="button" className={styles.tool} onClick={() => setAdding('what')} aria-label="Add a card" title="Add a card">
              <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.tool}
              data-on={lining ? '' : undefined}
              aria-pressed={!!lining}
              onClick={() => {
                setLining(lining ? null : { from: null });
                setPicked(null);
              }}
              aria-label={lining ? 'Stop drawing a line' : 'Draw a line: tap one card, then another'}
              title={lining ? 'Stop drawing a line' : 'Draw a line'}
            >
              <Spline size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </>
        ) : null}
        <button type="button" className={styles.tool} onClick={fit} aria-label="Fit the whole canvas on the screen (Shift+1)" title="Fit (Shift+1)">
          <Maximize size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
        {editing ?? chosen ? (
          <button type="button" className={styles.tool} onClick={() => zoomTo((editing ?? chosen)!)} aria-label="Zoom to the card (Shift+2)" title="To card (Shift+2)">
            <LocateFixed size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
        {lining ? <span className={styles.hint}>{lining.from ? 'Tap the card it goes to' : 'Tap the card it starts from'}</span> : null}
      </div>
      <Minimap
        canvas={live}
        view={viewShown}
        host={host}
        big={mapBig}
        onBig={() => setMapBig(true)}
        onGo={(x, y) => {
          const el = host.current;
          if (!el) return;
          const { scale } = view.current;
          view.current = { x: el.clientWidth / 2 - x * scale, y: el.clientHeight / 2 - y * scale, scale };
          touched.current = true;
          apply();
        }}
        onMove={(dx, dy) => {
          const { x, y, scale } = view.current;
          view.current = { x: x - dx * scale, y: y - dy * scale, scale };
          touched.current = true;
          apply();
        }}
      />
      {adding ? (
        <AddSheet
          step={adding}
          titles={wiki?.titles?.() ?? []}
          onClose={() => setAdding(null)}
          onWords={() => {
            setAdding(null);
            addCardHere();
          }}
          onNote={(title) => {
            setAdding(null);
            addNoteCard(title);
          }}
          onLink={(url) => {
            setAdding(null);
            addLinkCard(url);
          }}
          onPicture={() => {
            setAdding(null);
            void addPicture();
          }}
          onChart={() => {
            setAdding(null);
            addStartedCard(CHART_CARD);
          }}
          onTable={() => {
            setAdding(null);
            addStartedCard(TABLE_CARD);
          }}
          onStep={setAdding}
        />
      ) : null}
    </div>
  );
}

interface CardProps {
  node: CanvasNode;
  dark: boolean;
  wiki?: CanvasWiki;
  /** The canvas, which is what "near the screen" is measured against. */
  root: React.RefObject<HTMLDivElement | null>;
  /** Open to be written in: a card of words shows its editor as the note does, taking every tap and key. */
  editing?: boolean;
  /** Lifted by a held press and following the finger. */
  lifted?: boolean;
  /** The card a line being drawn starts from. */
  lineFrom?: boolean;
  onWrite?: (id: string, text: string) => void;
  onRemove?: (id: string) => void;
  /** The card made this size when its corner is let go, and drawn at each size on the way. */
  onResize?: (id: string, width: number, height: number) => void;
  onPreviewSize?: (id: string, width: number, height: number) => void;
  /** A group's name written. */
  onName?: (id: string, label: string) => void;
  /** The view's scale, read when a corner is dragged: screen pixels into the canvas's own. */
  scale?: React.RefObject<View>;
}

function Card({ node, dark, wiki, root, editing = false, lifted = false, lineFrom = false, onWrite, onRemove, onResize, onPreviewSize, onName, scale }: CardProps) {
  const paint = paintOf(node.color);
  // Opened to be written in: the keyboard comes up with it (Matt: "a text card appears under the fingers, keyboard up").
  const opened = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing) return undefined;
    const timer = window.setTimeout(() => opened.current?.querySelector<HTMLElement>('.cm-content')?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [editing]);
  const hue = paint && 'hue' in paint ? paint.hue : undefined;
  const place: React.CSSProperties = { left: node.x, top: node.y, width: node.width, height: node.height };
  if (paint && 'hex' in paint) (place as Record<string, string>)['--app-space'] = paint.hex;

  if (node.type === 'group') {
    return (
      <div className={styles.group} style={place} data-hue={hue} data-card={node.id} data-lifted={lifted || undefined} data-editing={editing || undefined}>
        {editing && onName ? (
          <span className={styles.groupLabel} data-editing>
            <input
              ref={(el) => el?.focus()}
              className={styles.groupField}
              defaultValue={node.label ?? ''}
              placeholder="Name this group"
              aria-label="The group's name"
              onBlur={(event) => onName(node.id, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              onPointerDown={(event) => event.stopPropagation()}
            />
            {onRemove ? (
              <button type="button" className={styles.remove} onClick={() => onRemove(node.id)} aria-label="Take this group off the canvas; its cards stay">
                ×
              </button>
            ) : null}
          </span>
        ) : node.label ? (
          <span className={styles.groupLabel}>{node.label}</span>
        ) : null}
      </div>
    );
  }

  /** The corner of an open card: dragged, it resizes the card, in the canvas's pixels whatever the zoom. */
  const corner = editing && onResize ? (
    <span
      className={styles.corner}
      aria-label="Drag to resize this card"
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        const at = { x: event.clientX, y: event.clientY };
        const size = { width: node.width, height: node.height };
        const zoom = scale?.current.scale ?? 1;
        const move = (moved: PointerEvent) => onPreviewSize?.(node.id, size.width + (moved.clientX - at.x) / zoom, size.height + (moved.clientY - at.y) / zoom);
        const done = (moved: PointerEvent) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', done);
          window.removeEventListener('pointercancel', done);
          onResize(node.id, size.width + (moved.clientX - at.x) / zoom, size.height + (moved.clientY - at.y) / zoom);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', done);
        window.addEventListener('pointercancel', done);
      }}
    />
  ) : null;

  if (node.type === 'text') {
    return (
      <div
        className={styles.card}
        style={place}
        data-hue={hue}
        data-card={node.id}
        data-editing={editing || undefined}
        data-lifted={lifted || undefined}
        data-line-from={lineFrom || undefined}
        // A card that is only a table draws the table edge to edge (Matt: "make the table fill the card").
        data-only={!editing && isOnlyTable(node.text) ? 'table' : undefined}
      >
        {editing ? (
          // Open: the note's own editor in its own mode, the words going straight into the canvas as they are typed.
          <div ref={opened} className={styles.words}>
            <Editor value={node.text} onChange={(text) => onWrite?.(node.id, text)} dark={dark} assist display="mixed" placeholder="Write something." grow diagrams />
          </div>
        ) : (
          <Near root={root} className={styles.words}>
            <Editor value={node.text} onChange={noop} dark={dark} assist={false} readOnly display="formatted" peek diagrams grow />
          </Near>
        )}
        {editing && onRemove ? (
          <button type="button" className={styles.remove} onClick={() => onRemove(node.id)} aria-label="Take this card off the canvas">
            ×
          </button>
        ) : null}
        {corner}
      </div>
    );
  }

  if (node.type === 'link') {
    // An address, opened the way a link in a note is (core/linkPreview.ts): the phone's browser, not a window of ours.
    return (
      <a
        className={`${styles.card} ${styles.linkCard}`}
        style={place}
        data-hue={hue}
        data-card={node.id}
        data-lifted={lifted || undefined}
        data-line-from={lineFrom || undefined}
        href={node.url}
        onClick={(event) => {
          event.preventDefault();
          // The title is the way to zoom to the card (choice 10), so a tap there does not open the address.
          if ((event.target as HTMLElement).closest('[data-card-title]')) return;
          void openLink(node.url);
        }}
      >
        <span className={styles.cardTitle} data-card-title>{shortUrl(node.url)}</span>
        <span className={styles.cardHint}>{node.url}</span>
      </a>
    );
  }

  // A file: a note by that name in Glyph, or a picture, or a file Glyph does not have.
  const title = fileTitle(node.file);
  const picture = isImageFile(node.file);
  // One of Glyph's own pictures, by the name the store keeps it under (core/images.ts); a picture from another vault
  // has a folder in its name and no such picture here, and is said to be elsewhere.
  const pictureUrl = picture && !node.file.includes('/') ? imageUrl(node.file) : null;
  if (pictureUrl) {
    return (
      <div className={`${styles.card} ${styles.pictureCard}`} style={place} data-hue={hue} data-card={node.id} data-lifted={lifted || undefined} data-editing={editing || undefined}>
        <img className={styles.picture} src={pictureUrl} alt="" draggable={false} />
        {editing && onRemove ? (
          <button type="button" className={styles.remove} onClick={() => onRemove(node.id)} aria-label="Take this picture off the canvas">
            ×
          </button>
        ) : null}
        {corner}
      </div>
    );
  }
  const known = !picture && !!wiki?.known(title);
  const body = known ? (wiki?.body?.(title) ?? null) : null;
  const at = node.subpath ? node.subpath.slice(1) : undefined;
  return (
    <div
      className={`${styles.card} ${styles.fileCard}`}
      style={place}
      data-hue={hue}
      data-card={node.id}
      data-lifted={lifted || undefined}
      data-line-from={lineFrom || undefined}
      data-waiting={known || picture ? undefined : ''}
      role={picture ? undefined : 'button'}
      tabIndex={picture ? undefined : 0}
      // A tap on the title zooms to the card (choice 10) rather than opening the note; the rest of the card opens it.
      onClick={picture ? undefined : (event) => !(event.target as HTMLElement).closest('[data-card-title]') && wiki?.open(title, at)}
      onKeyDown={picture ? undefined : (event) => (event.key === 'Enter' || event.key === ' ') && wiki?.open(title, at)}
    >
      <span className={styles.cardTitle} data-card-title>{title}</span>
      {body ? (
        <Near root={root}>
          <NotePeek body={body} className={styles.cardPeek} />
        </Near>
      ) : (
        <span className={styles.cardHint}>{picture ? 'A picture, in the vault it came from' : known ? '' : 'Not in Ghost.md yet'}</span>
      )}
    </div>
  );
}

/**
 * The minimap (choice 10), in the bottom corner: the whole canvas small, with the screen's box over it. Each kind
 * of card is told apart - words filled, a note outlined, a picture filled dark, a link outlined with a dot - and a
 * card with a colour wears it; the lines between cards are drawn between the sides they leave and arrive by, and a
 * group is its dashed box with its name when there is room. The map keeps the canvas's own shape inside its frame.
 *
 * A press on it grows it, and it stays grown until a press lands on the canvas (Matt: "make the minimap a bit
 * bigger when we click on it and allow clicking and dragging to navigate around the canvas"). A drag on the map,
 * small or grown, moves the screen's box with the finger - the view goes by what the finger moved, so nothing jumps
 * under it - and a tap on the grown map goes to the spot tapped. The map is drawn in one set of units, whatever its
 * size on the page, so where a finger is on it is read from the size it has at that moment, mid-growth included.
 */
const MINIMAP = { width: 180, height: 120, room: 8, big: 1.5 };
/** A press that moves this far, in pixels on the page, is a drag rather than a tap. */
const MAP_DRAG = 3;
function Minimap({
  canvas,
  view,
  host,
  big,
  onBig,
  onGo,
  onMove,
}: {
  canvas: Canvas;
  view: View;
  host: React.RefObject<HTMLDivElement | null>;
  big: boolean;
  onBig: () => void;
  onGo: (x: number, y: number) => void;
  onMove: (dx: number, dy: number) => void;
}) {
  /** The press under way: where the finger was last, on the page, and whether it has dragged. */
  const press = useRef<{ x: number; y: number; moved: boolean; wasBig: boolean } | null>(null);
  const box = bounds(canvas);
  if (!box || canvas.nodes.length < 2) return null;
  const el = host.current;
  const seen = shownBox(view, el?.clientWidth ?? 0, el?.clientHeight ?? 0);
  // The whole of the canvas and the screen's box together, so the screen is always drawn even when it is off the cards.
  const left = Math.min(box.x, seen.x);
  const top = Math.min(box.y, seen.y);
  const right = Math.max(box.x + box.width, seen.x + seen.width);
  const bottom = Math.max(box.y + box.height, seen.y + seen.height);
  const scale = Math.min((MINIMAP.width - MINIMAP.room * 2) / Math.max(right - left, 1), (MINIMAP.height - MINIMAP.room * 2) / Math.max(bottom - top, 1));
  // Centred in the frame, so a tall canvas sits in the middle of a wide map rather than against its left edge.
  const ox = MINIMAP.room + (MINIMAP.width - MINIMAP.room * 2 - (right - left) * scale) / 2;
  const oy = MINIMAP.room + (MINIMAP.height - MINIMAP.room * 2 - (bottom - top) * scale) / 2;
  const sx = (x: number) => ox + (x - left) * scale;
  const sy = (y: number) => oy + (y - top) * scale;
  /** Pixels on the page per unit of the map, at the size the map has now. */
  const unit = (rect: DOMRect) => (rect.width || MINIMAP.width) / MINIMAP.width;
  const go = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const k = unit(rect);
    onGo(left + ((event.clientX - rect.left) / k - ox) / scale, top + ((event.clientY - rect.top) / k - oy) / scale);
  };
  const kind = (n: CanvasNode) => (n.type === 'file' ? (isImageFile(n.file) ? 'picture' : 'note') : n.type);
  const groups = canvas.nodes.filter((n) => n.type === 'group');
  const cards = canvas.nodes.filter((n) => n.type !== 'group');
  return (
    <svg
      className={styles.minimap}
      viewBox={`0 0 ${MINIMAP.width} ${MINIMAP.height}`}
      data-big={big || undefined}
      role="img"
      aria-label="A map of the canvas; press to grow it, drag on it to move the screen, tap the grown map to go there"
      onPointerDown={(event) => {
        event.stopPropagation();
        press.current = { x: event.clientX, y: event.clientY, moved: false, wasBig: big };
        onBig();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer the browser is not tracking: the press still counts; only the drag past the edge is lost.
        }
      }}
      onPointerMove={(event) => {
        const p = press.current;
        if (!p || !event.buttons) return;
        const dx = event.clientX - p.x;
        const dy = event.clientY - p.y;
        if (!p.moved && Math.hypot(dx, dy) < MAP_DRAG) return;
        p.moved = true;
        p.x = event.clientX;
        p.y = event.clientY;
        const k = unit(event.currentTarget.getBoundingClientRect());
        onMove(dx / k / scale, dy / k / scale);
      }}
      onPointerUp={(event) => {
        const p = press.current;
        press.current = null;
        // A tap on the grown map goes there; the tap that grew it only grew it.
        if (p && !p.moved && p.wasBig) go(event);
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {groups.map((n) => (
        <g key={n.id} className={styles.mapGroup} data-hue={paintOf(n.color) && 'hue' in paintOf(n.color)! ? (paintOf(n.color) as { hue: string }).hue : undefined}>
          <rect x={sx(n.x)} y={sy(n.y)} width={Math.max(2, n.width * scale)} height={Math.max(2, n.height * scale)} rx={2} />
          {n.type === 'group' && n.label && n.width * scale > 36 ? (
            <text x={sx(n.x) + 3} y={sy(n.y) - 2} className={styles.mapLabel}>
              {n.label}
            </text>
          ) : null}
        </g>
      ))}
      {canvas.edges.map((edge) => {
        const from = canvas.nodes.find((n) => n.id === edge.fromNode);
        const to = canvas.nodes.find((n) => n.id === edge.toNode);
        if (!from || !to) return null;
        const sides = sidesOf(from, to, edge);
        const a = anchorOf(from, sides.from);
        const b = anchorOf(to, sides.to);
        return <line key={edge.id} className={styles.mapLine} x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)} />;
      })}
      {cards.map((n) => {
        const paint = paintOf(n.color);
        const hue = paint && 'hue' in paint ? paint.hue : undefined;
        const style = paint && 'hex' in paint ? ({ '--app-space': paint.hex } as React.CSSProperties) : undefined;
        const w = Math.max(3, n.width * scale);
        const h = Math.max(3, n.height * scale);
        return (
          <g key={n.id} className={styles.mapCard} data-kind={kind(n)} data-hue={hue} style={style}>
            <rect x={sx(n.x)} y={sy(n.y)} width={w} height={h} rx={1.5} />
            {kind(n) === 'link' ? <circle cx={sx(n.x) + w / 2} cy={sy(n.y) + h / 2} r={Math.min(2, h / 3)} /> : null}
          </g>
        );
      })}
      <rect className={styles.mapSeen} x={sx(seen.x)} y={sy(seen.y)} width={seen.width * scale} height={seen.height * scale} rx={1} />
    </svg>
  );
}

/** The + sheet: what to add, then a note's title or a web address, in the note's settings' own look (notes/NewSheet.tsx). */
function AddSheet({
  step,
  titles,
  onClose,
  onWords,
  onNote,
  onLink,
  onPicture,
  onChart,
  onTable,
  onStep,
}: {
  step: 'what' | 'note' | 'link';
  titles: string[];
  onClose: () => void;
  onWords: () => void;
  onNote: (title: string) => void;
  onLink: (url: string) => void;
  onPicture: () => void;
  onChart: () => void;
  onTable: () => void;
  onStep: (step: 'note' | 'link') => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const drag = useSheetDrag(panel, onClose);
  useBack(true, onClose);
  const [words, setWords] = useState('');
  const found = step === 'note' ? titles.filter((t) => t.toLowerCase().includes(words.trim().toLowerCase())).slice(0, 12) : [];
  return (
    <div className={sheet.scrim} onClick={onClose} onPointerDown={(event) => event.stopPropagation()}>
      <section ref={panel} className={sheet.sheet} role="dialog" aria-modal="true" aria-label="Add a card" onClick={(e) => e.stopPropagation()}>
        <span className={sheet.grip} aria-hidden="true" {...drag} />
        <SheetTitle>{step === 'what' ? 'Add a card' : step === 'note' ? 'Which note?' : 'Which address?'}</SheetTitle>
        {step === 'what' ? (
          <SheetGroup>
            <SheetRow icon={SquarePen} label="Words" hint="A card to write on." onPress={onWords} />
            <SheetRow icon={FileText} label="A note" hint="One of your notes, drawn small; tap it to open." onPress={() => onStep('note')} />
            <SheetRow icon={Link2} label="A link" hint="A web address, opened with a tap." onPress={() => onStep('link')} />
            <SheetRow icon={Image} label="A picture" hint="From your phone or computer, kept with your notes' pictures." onPress={onPicture} />
            <SheetRow icon={ChartNoAxesCombined} label="A chart" hint="A diagram, written as Mermaid and drawn on the card." onPress={onChart} />
            <SheetRow icon={Table} label="A table" hint="Rows and columns to fill in." onPress={onTable} />
          </SheetGroup>
        ) : (
          <div className={styles.addField}>
            <input
              className={styles.addInput}
              autoFocus
              value={words}
              placeholder={step === 'note' ? 'Type part of its title' : 'attack.fm/glyph'}
              aria-label={step === 'note' ? 'Part of the note’s title' : 'The web address'}
              inputMode={step === 'link' ? 'url' : 'text'}
              onChange={(event) => setWords(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                if (step === 'link') onLink(words);
                else if (found[0]) onNote(found[0]);
              }}
            />
            {step === 'link' ? (
              <button type="button" className={`app-word ${styles.addGo}`} onClick={() => onLink(words)} disabled={!words.trim()}>
                Add
              </button>
            ) : (
              <ul className={styles.addList} aria-label="Notes">
                {found.map((title) => (
                  <li key={title}>
                    <button type="button" className={styles.addRow} onClick={() => onNote(title)}>
                      {title}
                    </button>
                  </li>
                ))}
                {!found.length ? <li className={styles.addNone}>{words.trim() ? 'No note by that name.' : 'No notes yet.'}</li> : null}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** A picked line's words, written in place over its middle, and the cross that takes the line off. */
function LineWords({ edge, at, onLabel, onRemove }: { edge: CanvasEdge; at: { x: number; y: number }; onLabel: (id: string, words: string) => void; onRemove: (id: string) => void }) {
  const [words, setWords] = useState(edge.label ?? '');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => field.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const commit = () => {
    if (words.trim() !== (edge.label ?? '')) onLabel(edge.id, words);
  };
  return (
    <div className={styles.lineWords} style={{ left: at.x, top: at.y }} data-line-words onPointerDown={(event) => event.stopPropagation()}>
      <input
        ref={field}
        className={styles.lineField}
        value={words}
        placeholder="Words on the line"
        aria-label="Words on the line"
        onChange={(event) => setWords(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          }
        }}
      />
      <button type="button" className={styles.remove} onClick={() => onRemove(edge.id)} aria-label="Take this line off the canvas">
        ×
      </button>
    </div>
  );
}

/** Its children once the card is near the screen, and a blank until then: an editor costs a frame, a blank nothing. */
function Near({ root, className, children }: { root: React.RefObject<HTMLDivElement | null>; className?: string; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const me = el.current;
    if (!me || near || typeof IntersectionObserver === 'undefined') return undefined;
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { root: root.current, rootMargin: `${NEAR_PX}px` },
    );
    watcher.observe(me);
    return () => watcher.disconnect();
  }, [near, root]);
  return (
    <div ref={el} className={className ? `${styles.near} ${className}` : styles.near}>
      {near ? children : null}
    </div>
  );
}

function noop(): void {
  // Read-only: nothing typed comes back.
}
