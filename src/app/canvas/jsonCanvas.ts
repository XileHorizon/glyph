/**
 * JSON Canvas (jsoncanvas.org, 1.0), the open format Obsidian's canvas is written in, read and written as it is.
 *
 * Matt's choices (2026-09-20): a canvas in Glyph is the spec verbatim, so a canvas made here opens in Obsidian and an
 * Obsidian canvas opens here, rather than a grammar of Glyph's own. A canvas is either a note whose body is the JSON
 * (docs/CANVAS.md), named by front matter since Obsidian names one by its file and Glyph has no files, or a
 * ```canvas fence in an ordinary note. This file is the format and its geometry, and knows nothing of the screen.
 *
 * Read leniently, written exactly: a node or edge that is not what the spec says is left out rather than the whole
 * canvas refused, since one bad card should not lose the other forty; what is kept is written back with only the
 * fields the spec names, in the order the spec names them, so a round trip changes nothing a person meant.
 */

/** The spec's colour: one of six presets, "1" to "6", or a hex colour like "#FF0000". */
export type CanvasColor = string;

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type End = 'none' | 'arrow';

interface NodeBase {
  id: string;
  /** Pixels, in the canvas's own space. The spec says integers. */
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export type CanvasNode =
  | (NodeBase & { type: 'text'; text: string })
  | (NodeBase & { type: 'file'; file: string; subpath?: string })
  | (NodeBase & { type: 'link'; url: string })
  | (NodeBase & { type: 'group'; label?: string; background?: string; backgroundStyle?: 'cover' | 'ratio' | 'repeat' });

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  /** The spec's defaults: nothing at the start, an arrow at the end. */
  fromEnd?: End;
  toEnd?: End;
  color?: CanvasColor;
  label?: string;
}

/** Nodes in ascending z-order, as the spec has them: the first is drawn first, under the rest. */
export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const ENDS: readonly End[] = ['none', 'arrow'];
const STYLES = ['cover', 'ratio', 'repeat'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined);
const oneOf = <T extends string>(value: unknown, of: readonly T[]): T | undefined => (typeof value === 'string' && (of as readonly string[]).includes(value) ? (value as T) : undefined);
/** A colour the spec allows: a preset digit, or a hex colour. Anything else is read as no colour. */
const color = (value: unknown): CanvasColor | undefined => (typeof value === 'string' && /^([1-6]|#[0-9a-f]{6}|#[0-9a-f]{3})$/i.test(value) ? value : undefined);

function readNode(value: unknown): CanvasNode | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const x = num(value.x);
  const y = num(value.y);
  const width = num(value.width);
  const height = num(value.height);
  if (!id || x === undefined || y === undefined || width === undefined || height === undefined) return null;
  const base: NodeBase = { id, x, y, width, height };
  const c = color(value.color);
  if (c) base.color = c;
  switch (value.type) {
    case 'text': {
      const text = str(value.text);
      return text === undefined ? null : { ...base, type: 'text', text };
    }
    case 'file': {
      const file = str(value.file);
      if (!file) return null;
      const subpath = str(value.subpath);
      return subpath && subpath.startsWith('#') ? { ...base, type: 'file', file, subpath } : { ...base, type: 'file', file };
    }
    case 'link': {
      const url = str(value.url);
      return url ? { ...base, type: 'link', url } : null;
    }
    case 'group': {
      const node: CanvasNode = { ...base, type: 'group' };
      const label = str(value.label);
      const background = str(value.background);
      const backgroundStyle = oneOf(value.backgroundStyle, STYLES);
      if (label) node.label = label;
      if (background) node.background = background;
      if (backgroundStyle) node.backgroundStyle = backgroundStyle;
      return node;
    }
    default:
      return null;
  }
}

function readEdge(value: unknown, nodes: ReadonlySet<string>): CanvasEdge | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const fromNode = str(value.fromNode);
  const toNode = str(value.toNode);
  if (!id || !fromNode || !toNode || !nodes.has(fromNode) || !nodes.has(toNode)) return null;
  const edge: CanvasEdge = { id, fromNode, toNode };
  const fromSide = oneOf(value.fromSide, SIDES);
  const toSide = oneOf(value.toSide, SIDES);
  const fromEnd = oneOf(value.fromEnd, ENDS);
  const toEnd = oneOf(value.toEnd, ENDS);
  const c = color(value.color);
  const label = str(value.label);
  if (fromSide) edge.fromSide = fromSide;
  if (toSide) edge.toSide = toSide;
  if (fromEnd) edge.fromEnd = fromEnd;
  if (toEnd) edge.toEnd = toEnd;
  if (c) edge.color = c;
  if (label) edge.label = label;
  return edge;
}

/**
 * The canvas in `text`, or null where the text is not one. A canvas is a JSON object with a `nodes` or an `edges`
 * array (the spec makes both optional; an object with neither is not a canvas, it is `{}`). Nodes that are not nodes
 * are left out, as are edges to nodes that are not there, and a node's id appearing twice keeps the first.
 */
export function parseCanvas(text: string): Canvas | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.nodes) && !Array.isArray(value.edges)) return null;
  const nodes: CanvasNode[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value.nodes) ? value.nodes : []) {
    const node = readNode(entry);
    if (node && !seen.has(node.id)) {
      seen.add(node.id);
      nodes.push(node);
    }
  }
  const edges: CanvasEdge[] = [];
  const edgeIds = new Set<string>();
  for (const entry of Array.isArray(value.edges) ? value.edges : []) {
    const edge = readEdge(entry, seen);
    if (edge && !edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  }
  return { nodes, edges };
}

/** The canvas as the spec writes it, two spaces in, a newline at the end, the way Obsidian saves one. */
export function serializeCanvas(canvas: Canvas): string {
  return `${JSON.stringify({ nodes: canvas.nodes, edges: canvas.edges }, null, 2)}\n`;
}

// ---- a canvas as a note ---------------------------------------------------------------------

/** A front matter fence, `---` or `+++`, on a line of its own. */
const FENCE = /^(---|\+\+\+)\s*$/;

/**
 * The body after its front matter, where it opens with one: what `withoutFrontMatter` (core/store.ts) does, but
 * without putting the title back as a first line - a canvas's first line is `{`, and the title is the note's name.
 */
function afterFrontMatter(body: string): string {
  const lines = body.split('\n');
  if (!FENCE.test(lines[0] ?? '')) return body;
  for (let n = 1; n < Math.min(lines.length, 40); n += 1) {
    if (FENCE.test(lines[n] ?? '')) return lines.slice(n + 1).join('\n');
  }
  return body;
}

/** The canvas a note's body is, or null for a note that is words: front matter, then the JSON and nothing else. */
export function canvasOf(body: string): Canvas | null {
  const rest = afterFrontMatter(body).trim();
  return rest.startsWith('{') ? parseCanvas(rest) : null;
}

/** Whether the note is a canvas rather than words: cheap enough to ask of every note in a list. */
export function isCanvasBody(body: string): boolean {
  return canvasOf(body) !== null;
}

/**
 * A canvas note's body: the title as front matter, which is how the note gets its name (core/store.ts `noteTitle`
 * reads `title:`), then the canvas exactly as the spec writes it. Quoted, so a title with a colon in it stays one line.
 */
export function canvasNoteBody(title: string, canvas: Canvas): string {
  const safe = title.replace(/["\n]/g, "'").trim() || 'Canvas';
  return `---\ntitle: "${safe}"\n---\n${serializeCanvas(canvas)}`;
}

// ---- changing a canvas ----------------------------------------------------------------------

/**
 * The note's body with its canvas replaced and everything else kept: the front matter that names it, character for
 * character, then the canvas as the spec writes it. `canvasNoteBody` is for a new note; this is for a note being
 * edited, whose front matter may hold more than a title.
 */
export function withCanvas(body: string, canvas: Canvas): string {
  const lines = body.split('\n');
  if (FENCE.test(lines[0] ?? '')) {
    for (let n = 1; n < Math.min(lines.length, 40); n += 1) {
      if (FENCE.test(lines[n] ?? '')) return `${lines.slice(0, n + 1).join('\n')}\n${serializeCanvas(canvas)}`;
    }
  }
  return serializeCanvas(canvas);
}

/** An id for a new node or edge: sixteen hex characters, the shape Obsidian gives its own. */
export function newCanvasId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let n = 0; n < bytes.length; n += 1) bytes[n] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The size a new card of words starts at, in the canvas's pixels: Obsidian's, so a canvas made here looks like one. */
export const NEW_CARD = { width: 260, height: 120 };

/** A new card of words, empty, with its top-left corner at (x, y). It goes last, so it is drawn on top. */
export function newTextNode(x: number, y: number, id = newCanvasId()): CanvasNode {
  return { id, type: 'text', x: Math.round(x), y: Math.round(y), width: NEW_CARD.width, height: NEW_CARD.height, text: '' };
}

/** A new card that is a note, by its title: the spec's file node, named as Obsidian names a note's file. */
export function newFileNode(title: string, x: number, y: number, id = newCanvasId()): CanvasNode {
  const name = title.trim().replace(/[\\/]/g, '-') || 'Untitled';
  return { id, type: 'file', x: Math.round(x), y: Math.round(y), width: NEW_CARD.width, height: 160, file: `${name}.md` };
}

/** A new card that is one of Glyph's own pictures, by the name the picture store keeps it under (core/images.ts). */
export function newPictureNode(name: string, x: number, y: number, id = newCanvasId()): CanvasNode {
  return { id, type: 'file', x: Math.round(x), y: Math.round(y), width: NEW_CARD.width, height: 200, file: name };
}

/** What a new chart card starts with: a small Mermaid diagram to change, drawn as a diagram on the card. */
export const CHART_CARD = '```mermaid\nflowchart LR\n  A[Start] --> B[Then]\n  B --> C[Done]\n```\n';
/** Whether a card of words is nothing but a table, which is then drawn edge to edge (canvas/CanvasView.tsx). */
export function isOnlyTable(text: string): boolean {
  const lines = text.trim().split('\n');
  return lines.length >= 2 && lines.every((line) => /^\s*\|.*\|\s*$/.test(line));
}

/** What a new table card starts with. */
export const TABLE_CARD = '| Thing | Note |\n| --- | --- |\n| One | |\n| Two | |\n';

/** A new card that is a web address; a bare address is given https. Null for no address at all. */
export function newLinkNode(url: string, x: number, y: number, id = newCanvasId()): CanvasNode | null {
  const given = url.trim();
  if (!given) return null;
  const address = /^[a-z][a-z0-9+.-]*:/i.test(given) ? given : `https://${given}`;
  return { id, type: 'link', x: Math.round(x), y: Math.round(y), width: NEW_CARD.width, height: 100, url: address };
}

/** The canvas with this node in place of the one with its id, or added at the end where there was none. */
export function withNode(canvas: Canvas, node: CanvasNode): Canvas {
  const at = canvas.nodes.findIndex((n) => n.id === node.id);
  const nodes = at < 0 ? [...canvas.nodes, node] : canvas.nodes.map((n) => (n.id === node.id ? node : n));
  return { nodes, edges: canvas.edges };
}

/** The canvas without this node, and without any edge that joined it. */
export function withoutNode(canvas: Canvas, id: string): Canvas {
  return { nodes: canvas.nodes.filter((n) => n.id !== id), edges: canvas.edges.filter((e) => e.fromNode !== id && e.toNode !== id) };
}

/** A new line from one card to another: an arrow at its end, its sides chosen from where the cards are (`sidesOf`). */
export function newEdge(fromNode: string, toNode: string, id = newCanvasId()): CanvasEdge {
  return { id, fromNode, toNode };
}

/** The canvas with this line in place of the one with its id, or added at the end where there was none. */
export function withEdge(canvas: Canvas, edge: CanvasEdge): Canvas {
  const at = canvas.edges.findIndex((e) => e.id === edge.id);
  const edges = at < 0 ? [...canvas.edges, edge] : canvas.edges.map((e) => (e.id === edge.id ? edge : e));
  return { nodes: canvas.nodes, edges };
}

export function withoutEdge(canvas: Canvas, id: string): Canvas {
  return { nodes: canvas.nodes, edges: canvas.edges.filter((e) => e.id !== id) };
}

/** The line with these words on it, or with none: the spec has no empty label, so blank takes the label off. */
export function labelledEdge(edge: CanvasEdge, label: string): CanvasEdge {
  const words = label.trim();
  const { label: _was, ...rest } = edge;
  return words ? { ...rest, label: words } : rest;
}

/** Whether a line already joins these two cards, either way round: a second one would only lie on the first. */
export function joined(canvas: Canvas, a: string, b: string): boolean {
  return canvas.edges.some((e) => (e.fromNode === a && e.toNode === b) || (e.fromNode === b && e.toNode === a));
}

/** The smallest a card can be made, in the canvas's pixels: room for a word and the cross. */
export const LEAST_CARD = { width: 120, height: 60 };

/** The node made this size, to the pixel and no smaller than `LEAST_CARD`; its top-left corner stays put. */
export function resizedNode(node: CanvasNode, width: number, height: number): CanvasNode {
  return { ...node, width: Math.max(LEAST_CARD.width, Math.round(width)), height: Math.max(LEAST_CARD.height, Math.round(height)) };
}

/** The nodes a group holds: every other node whose box is wholly inside the group's, as Obsidian counts them. */
export function heldBy(canvas: Canvas, group: CanvasNode): CanvasNode[] {
  return canvas.nodes.filter(
    (n) => n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height,
  );
}

/**
 * The canvas with this node moved to (x, y) - and, for a group, everything it holds moved with it by the same
 * amount (choice 5: "cards inside move with it"). A card moved on its own leaves its group where it is.
 */
export function movedWithHeld(canvas: Canvas, node: CanvasNode, x: number, y: number): Canvas {
  const dx = Math.round(x) - node.x;
  const dy = Math.round(y) - node.y;
  const moving = new Set(node.type === 'group' ? [node.id, ...heldBy(canvas, node).map((n) => n.id)] : [node.id]);
  return { nodes: canvas.nodes.map((n) => (moving.has(n.id) ? movedNode(n, n.x + dx, n.y + dy) : n)), edges: canvas.edges };
}

/** Room a new group leaves around the cards it is drawn round, in the canvas's pixels. */
export const GROUP_ROOM = 40;

/**
 * A new group drawn round these nodes with room to spare, placed first so it is drawn under everything (the spec's
 * z-order is the array's). Null for no nodes: a group holds something.
 */
export function newGroupAround(canvas: Canvas, ids: readonly string[], label?: string, id = newCanvasId()): Canvas | null {
  const held = canvas.nodes.filter((n) => ids.includes(n.id));
  if (!held.length) return null;
  const box = bounds({ nodes: held, edges: [] })!;
  const group: CanvasNode = {
    id,
    type: 'group',
    x: box.x - GROUP_ROOM,
    y: box.y - GROUP_ROOM - 24,
    width: box.width + GROUP_ROOM * 2,
    height: box.height + GROUP_ROOM * 2 + 24,
    ...(label ? { label } : {}),
  };
  return { nodes: [group, ...canvas.nodes], edges: canvas.edges };
}

/** The group with these words as its name, or with none. */
export function labelledGroup(node: CanvasNode, label: string): CanvasNode {
  if (node.type !== 'group') return node;
  const words = label.trim();
  const { label: _was, ...rest } = node;
  return words ? { ...rest, label: words } : rest;
}

/** The node moved so its top-left corner is at (x, y), to the pixel, as the spec keeps positions. */
export function movedNode(node: CanvasNode, x: number, y: number): CanvasNode {
  return { ...node, x: Math.round(x), y: Math.round(y) };
}

// ---- geometry -------------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest box around every node, or null for an empty canvas. */
export function bounds(canvas: Canvas): Box | null {
  if (!canvas.nodes.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of canvas.nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface Point {
  x: number;
  y: number;
}

const centre = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** The middle of a node's side: where an edge attaches. */
export function anchorOf(node: Box, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
  }
}

/** Which way a side faces, as a unit step. */
const NORMAL: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/**
 * The sides an edge leaves and arrives by when it does not say: the side of each node that faces the other, by
 * whichever of across or down the two are further apart in. Obsidian writes the sides it chose; another writer may
 * not, and the spec allows it.
 */
export function sidesOf(from: Box, to: Box, edge: Pick<CanvasEdge, 'fromSide' | 'toSide'>): { from: Side; to: Side } {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const across = Math.abs(dx) >= Math.abs(dy);
  const out: Side = across ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  const back: Side = across ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom';
  return { from: edge.fromSide ?? out, to: edge.toSide ?? back };
}

/** The size of an arrow head, in the canvas's pixels; the line stops short of the tip by this much. */
export const HEAD = 10;

export interface EdgePath {
  /** The curve, as an SVG path: from one anchor to the other, stopping short of any arrow head. */
  d: string;
  /** The head at each end, as an SVG path of a filled triangle, where that end is an arrow. */
  fromHead: string | null;
  toHead: string | null;
  /** Where its label sits: along the curve, over open canvas rather than over a card (`labelPlace`). */
  mid: Point;
  /** The label's words as lines, broken where one line would not fit between the cards; none without a label. */
  lines: string[];
}

function head(tip: Point, side: Side): string {
  const n = NORMAL[side];
  // The base of the head sits back along the side's normal; the wings sit across it.
  const base = { x: tip.x + n.x * HEAD, y: tip.y + n.y * HEAD };
  const wing = HEAD * 0.55;
  const a = { x: base.x - n.y * wing, y: base.y + n.x * wing };
  const b = { x: base.x + n.y * wing, y: base.y - n.x * wing };
  return `M${tip.x} ${tip.y}L${a.x} ${a.y}L${b.x} ${b.y}Z`;
}

/**
 * The line for one edge, as `edgePaths` draws it among the others. Null where either node is missing. The edge is
 * found by its id: where the canvas holds a different copy, the canvas's is drawn.
 */
export function edgePath(canvas: Canvas, edge: CanvasEdge): EdgePath | null {
  return edgePaths(canvas).get(edge.id) ?? null;
}

// ---- keeping lines apart -----------------------------------------------------------------------

/** How far apart two line ends on the same side of a card are set. */
export const END_SPREAD = 28;
/**
 * How close two arrow heads on different cards may come before they are moved apart along their sides. Two lines
 * into the facing sides of neighbouring cards landed at the same height, their heads base to base in the gap, and
 * read as one shape (Matt: "they look joined like a diamond"). Three heads' lengths, wide enough that two heads are
 * plainly two.
 */
export const HEAD_CLEAR = 56;
/** A line end keeps this far from a side's corners. */
const END_MARGIN = 16;

/** A unit step along a side: the way an end moves when it is set apart from another. */
const ALONG: Record<Side, Point> = { top: { x: 1, y: 0 }, bottom: { x: 1, y: 0 }, left: { x: 0, y: 1 }, right: { x: 0, y: 1 } };

/** One end of one line: which card and side it is on, how far along the side it has been set, and where it goes. */
interface LineEnd {
  edge: CanvasEdge;
  node: CanvasNode;
  side: Side;
  /** Whether a head is drawn at this end. */
  arrow: boolean;
  /** How far along the side from its middle this end sits, in the canvas's pixels. */
  offset: number;
  /** The centre of the card at the line's other end, for ordering ends along a side so lines do not cross. */
  other: Point;
}

const sideLength = (node: Box, side: Side): number => (side === 'top' || side === 'bottom' ? node.width : node.height);
/** A point's coordinate along a side's axis. */
const along = (p: Point, side: Side): number => (side === 'top' || side === 'bottom' ? p.x : p.y);
/** A point's coordinate across a side's axis. */
const across = (p: Point, side: Side): number => (side === 'top' || side === 'bottom' ? p.y : p.x);

function keptOnSide(end: LineEnd, offset: number): number {
  const half = Math.max(0, sideLength(end.node, end.side) / 2 - END_MARGIN);
  return Math.max(-half, Math.min(half, offset));
}

/** Where an end is now: the side's middle, moved along it by the end's offset. */
function pointOf(end: LineEnd): Point {
  const a = anchorOf(end.node, end.side);
  const step = ALONG[end.side];
  return { x: a.x + step.x * end.offset, y: a.y + step.y * end.offset };
}

/**
 * Ends that share one side of one card are set along it, evenly about the middle, in the order their far ends come
 * along that axis so the lines leave without crossing. A side too short for the spread packs them closer.
 */
function spreadShared(ends: readonly LineEnd[]): void {
  const shared = new Map<string, LineEnd[]>();
  for (const end of ends) {
    const key = `${end.node.id}/${end.side}`;
    shared.set(key, [...(shared.get(key) ?? []), end]);
  }
  for (const group of shared.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => along(a.other, a.side) - along(b.other, b.side));
    const first = group[0]!;
    const room = Math.max(0, sideLength(first.node, first.side) - 2 * END_MARGIN);
    const step = Math.min(END_SPREAD, room / (group.length - 1));
    group.forEach((end, i) => {
      end.offset = keptOnSide(end, (i - (group.length - 1) / 2) * step);
    });
  }
}

/**
 * Two heads on different cards nearer each other than `HEAD_CLEAR` are moved apart, each along its own side, until
 * they are that far apart or a side runs out. Which goes which way: away from the other along the side's axis; when
 * they are level, the one whose line comes from further along that axis goes that way. Two passes settle what one
 * move undoes.
 */
function partHeads(ends: readonly LineEnd[]): void {
  const heads = ends.filter((end) => end.arrow);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < heads.length; i += 1) {
      for (let j = i + 1; j < heads.length; j += 1) {
        const a = heads[i]!;
        const b = heads[j]!;
        if (a.node.id === b.node.id || a.edge.id === b.edge.id) continue;
        const pa = pointOf(a);
        const pb = pointOf(b);
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) >= HEAD_CLEAR) continue;
        for (const [self, other, selfAt, otherAt] of [
          [a, b, pa, pb],
          [b, a, pb, pa],
        ] as const) {
          // Along this end's own side: how far apart they are already, and how far they need to be, given how far
          // apart they are across it, which moving along the side cannot change.
          const gapAcross = Math.abs(across(selfAt, self.side) - across(otherAt, self.side));
          const have = along(selfAt, self.side) - along(otherAt, self.side);
          const need = Math.sqrt(Math.max(0, HEAD_CLEAR * HEAD_CLEAR - gapAcross * gapAcross));
          const short = need - Math.abs(have);
          if (short <= 0) continue;
          let way = Math.sign(have);
          if (way === 0) way = Math.sign(along(self.other, self.side) - along(other.other, self.side)) || (self === a ? -1 : 1);
          self.offset = keptOnSide(self, self.offset + (way * short) / 2);
        }
      }
    }
  }
}

/** Where along the curve a label is tried, the middle first and then either way from it. */
const LABEL_TRIES = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.15, 0.85];
/** About what a label's letters take at the label's size (CanvasView.module.css `.label`, 13px), and a line's height. */
const LABEL_LETTER = 6.8;
export const LABEL_LINE = 15;
/** How many lines a label may be broken into to fit between cards. */
const LABEL_LINES_MOST = 3;

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The words broken into `count` lines of about equal length, never inside a word; fewer where there are not the
 * words. Each line is aimed at an equal share of what is still to be placed, and takes the next word when that
 * lands nearer the aim than stopping short does.
 */
export function brokenInto(words: string, count: number): string[] {
  const parts = words.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (!line) {
      line = part;
      continue;
    }
    const linesLeft = count - lines.length;
    if (linesLeft <= 1) {
      line = `${line} ${part}`;
      continue;
    }
    const rest = parts.slice(i).join(' ').length;
    const aim = (line.length + 1 + rest) / linesLeft;
    const taken = line.length + 1 + part.length;
    if (Math.abs(taken - aim) <= Math.abs(line.length - aim)) {
      line = `${line} ${part}`;
    } else {
      lines.push(line);
      line = part;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Where a label sits, and on how many lines: the first point along the curve, trying the middle and then either
 * way from it, where the label's box is over open canvas and not over a card (Matt: "the text that's on arrow paths
 * sometimes overlaps content and we can't read the boxes below"); on one line first, and where one line fits
 * nowhere, on two, then three, so words longer than the gap between two cards fit down it. Groups are open canvas.
 * Where nothing fits anywhere, one line at the middle, and the label's own halo does what it can.
 */
function labelPlace(p0: Point, c1: Point, c2: Point, p3: Point, label: string | undefined, cards: readonly Box[]): { at: Point; lines: string[] } {
  const at = (t: number): Point => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
  };
  const whole = label ? [label] : [];
  for (let count = 1; count <= LABEL_LINES_MOST; count += 1) {
    const lines = label ? brokenInto(label, count) : [];
    if (count > 1 && lines.length < count) break;
    const width = Math.max(40, Math.max(6, ...lines.map((line) => line.length)) * LABEL_LETTER + 8);
    const height = Math.max(1, lines.length) * LABEL_LINE + 5;
    for (const t of LABEL_TRIES) {
      const p = at(t);
      const box = { x: p.x - width / 2, y: p.y - height / 2, width, height };
      if (!cards.some((card) => overlaps(box, card))) return { at: p, lines: label ? lines : [] };
    }
  }
  return { at: at(0.5), lines: whole };
}

/** The curve between two ends as they have been set, its heads, and its label's place. */
function pathBetween(from: LineEnd, to: LineEnd, edge: CanvasEdge, cards: readonly Box[]): EdgePath {
  const a = pointOf(from);
  const b = pointOf(to);
  const na = NORMAL[from.side];
  const nb = NORMAL[to.side];
  // The curve ends at the base of a head, not its tip, so the line never pokes through the point.
  const start = from.arrow ? { x: a.x + na.x * HEAD, y: a.y + na.y * HEAD } : a;
  const end = to.arrow ? { x: b.x + nb.x * HEAD, y: b.y + nb.y * HEAD } : b;
  const reach = Math.max(30, Math.min(Math.hypot(end.x - start.x, end.y - start.y) * 0.4, 200));
  const c1 = { x: start.x + na.x * reach, y: start.y + na.y * reach };
  const c2 = { x: end.x + nb.x * reach, y: end.y + nb.y * reach };
  const label = labelPlace(start, c1, c2, end, edge.label, cards);
  return {
    d: `M${start.x} ${start.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`,
    fromHead: from.arrow ? head(a, from.side) : null,
    toHead: to.arrow ? head(b, to.side) : null,
    mid: label.at,
    lines: label.lines,
  };
}

/**
 * The lines of a canvas, by edge id: each a curve out of one side and into the other, bowing further the further
 * apart the nodes are, the way Obsidian draws one; the heads the edge asks for (an arrow at the end unless it says
 * otherwise); and where its label sits. Drawn together rather than one by one, because where one line's end goes
 * depends on the others': ends on a shared side are set along it (`spreadShared`), heads that would meet are moved
 * apart (`partHeads`), and a label keeps off the cards (`labelPlace`). An edge whose node is missing is left out.
 */
export function edgePaths(canvas: Canvas): Map<string, EdgePath> {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node] as const));
  const ends: LineEnd[] = [];
  const lines: { edge: CanvasEdge; from: LineEnd; to: LineEnd }[] = [];
  for (const edge of canvas.edges) {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    if (!from || !to) continue;
    const sides = sidesOf(from, to, edge);
    const start: LineEnd = { edge, node: from, side: sides.from, arrow: (edge.fromEnd ?? 'none') === 'arrow', offset: 0, other: centre(to) };
    const finish: LineEnd = { edge, node: to, side: sides.to, arrow: (edge.toEnd ?? 'arrow') === 'arrow', offset: 0, other: centre(from) };
    ends.push(start, finish);
    lines.push({ edge, from: start, to: finish });
  }
  spreadShared(ends);
  partHeads(ends);
  const cards = canvas.nodes.filter((node) => node.type !== 'group');
  const out = new Map<string, EdgePath>();
  for (const { edge, from, to } of lines) out.set(edge.id, pathBetween(from, to, edge, cards));
  return out;
}

// ---- colour ---------------------------------------------------------------------------------

/** The page's hues (ink.css `[data-hue]`), which are what a workspace wears too (core/workspaces.ts). */
export type CanvasHue = 'rose' | 'ember' | 'amber' | 'moss' | 'sea' | 'violet';

/**
 * The spec's six presets - red, orange, yellow, green, cyan, purple, their exact values "intentionally not defined"
 * so each app paints them its own way - as the page's own hues (Matt: workspace hues, not a palette of the canvas's
 * own). A hex colour is a colour someone chose in Obsidian and is kept as it is.
 */
export function paintOf(color: CanvasColor | undefined): { hue: CanvasHue } | { hex: string } | null {
  switch (color) {
    case '1':
      return { hue: 'rose' };
    case '2':
      return { hue: 'ember' };
    case '3':
      return { hue: 'amber' };
    case '4':
      return { hue: 'moss' };
    case '5':
      return { hue: 'sea' };
    case '6':
      return { hue: 'violet' };
    default:
      return color && color.startsWith('#') ? { hex: color } : null;
  }
}

/** A file node's name as a note's title: the last part of the path, without `.md`. `Plans/Cabin trip.md` is "Cabin trip". */
export function fileTitle(file: string): string {
  const name = file.split('/').pop() ?? file;
  return name.replace(/\.md$/i, '');
}

/** Whether a file node points at a picture rather than a note. */
export function isImageFile(file: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(file);
}
