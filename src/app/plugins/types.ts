import type { ComponentType } from 'react';
import type { MarkDetailsProvider } from '../core/markDetails.ts';

/**
 * What a plugin is, and every place it can reach into Glyph.
 *
 * Matt: "build plugin support and extract the notion stuff into a plugin that
 * ships standard", built in and switchable, with GitHub projects the second
 * standard plugin. A plugin is a module that ships inside Glyph and arrives
 * with its updates. It says what it is and what it needs in a manifest, and
 * adds itself to the app only through the extension points below. Nothing in
 * the app names a plugin: the note's cog, the list swipe, the recorder, the
 * formatter and Settings each ask the registry (plugins/registry.ts) for
 * whatever the switched-on plugins offer there.
 *
 * The manifest is enforced, not decorative. A plugin reaches the phone only
 * through its `PluginHost` (plugins/host.ts), and the host refuses a native
 * command, a storage key or a permission the manifest did not declare. That
 * keeps Settings > Plugins honest about what each one does. It is also the
 * seam for plugins from outside Glyph later, which would get the same host
 * over a message bridge instead of a function call.
 */

// ---- the manifest ------------------------------------------------------------------------

export type Permission =
  /** Reads and changes notes other than through the screen showing them. */
  | 'notes'
  /** Talks to a service outside the phone (the hosts are listed). */
  | 'network'
  /** Runs the phone's language model. */
  | 'ai'
  /** Hears commands while a note is being recorded. */
  | 'voice'
  /** Calls commands built into the app binary (listed under `native`). */
  | 'native';

export interface PluginManifest {
  /** Stable, lowercase: the key its switch and its storage are kept under. */
  id: string;
  name: string;
  /** One sentence, for its row in Settings > Plugins. */
  description: string;
  version: string;
  author: string;
  /** Ships with Glyph and is on until switched off. */
  standard: boolean;
  /** Everything it may do, each with the reason shown to the person. */
  permissions: readonly { kind: Permission; why: string }[];
  /** The outside hosts it talks to, shown with the network permission. */
  hosts?: readonly string[];
  /** The binary it needs: a native generation at least this, and the commands it calls. */
  native?: { generation: number; commands: readonly string[] };
  /** The localStorage keys it owns; a reset clears them. */
  storage: readonly string[];
}

// ---- what a plugin is handed -----------------------------------------------------------------

export interface PluginHost {
  readonly manifest: PluginManifest;
  /** Whether this binary has what the manifest's `native` asks for. */
  nativeReady(): Promise<boolean>;
  /** A native command the manifest lists. Anything else is refused. */
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** The plugin's own keys, as JSON. A key the manifest does not list is refused. */
  storage: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  };
  /** Opens a page in the browser (network permission). */
  openUrl(url: string): Promise<void>;
  /** Asserts a permission the manifest declares, for plugin code that reaches core modules directly. */
  require(permission: Permission): void;
}

// ---- extension points ---------------------------------------------------------------------------

/** A row under "Linked to" on a note's cog sheet, and the page it opens. */
export interface NoteLink {
  id: string;
  label: string;
  icon: ComponentType;
  /** The row's second line for this note: what it is linked to, or what linking does. */
  hint(noteId: string): string;
  /** Whether it can be used on this binary; a reason when it cannot. */
  unavailable?(): Promise<string | null>;
  /** The page, inside the sheet. `onDone` goes back to the note's settings. */
  Picker: ComponentType<{ noteId: string; onDone: () => void }>;
  /**
   * The name of what this note is linked to ("Glyph Tasks", "attackfm/app"),
   * or null when it isn't: the mark the note carries at its top and in the
   * list (plugins/LinkMarks.tsx). Read on every draw; keep it cheap.
   */
  linked?(noteId: string): string | null;
}

/** The note on screen, for actions that change it: edits go through its editor, so each is an undo step. */
export interface NoteEditing {
  noteId: string;
  body(): string;
  /** Replaces the first line `find` accepts with what `next` makes of it. Answers whether one was found. */
  replaceLine(find: (text: string, line: number) => boolean, next: (text: string) => string): boolean;
  /** A sentence shown on the note for a few seconds. */
  say(message: string): void;
}

/** A row under the links on a note's cog sheet: something to do with the note. */
export interface NoteAction {
  id: string;
  label: string;
  icon: ComponentType;
  /** Whether the row shows for this note at all. */
  visible(noteId: string): boolean;
  hint(noteId: string, body: string): string;
  enabled(noteId: string, body: string): boolean;
  run(editing: NoteEditing): Promise<void>;
}

/** Swiping a list item left in a note. */
export interface ItemAction {
  id: string;
  /** The word on the tile behind the item, and while it runs. */
  label: string;
  busyLabel: string;
  /** Whether swiping does anything on this note right now. */
  available(noteId: string): boolean;
  /** `text` is the item's words; the item's line is found again by them. */
  run(text: string, editing: NoteEditing): Promise<void>;
}

/** What the recorder offers a voice command while it runs. */
export interface CaptureContext {
  /** The note this take is writing into. */
  noteId(): string;
  /** The last thing said: a phrase of this take, or items just put in another note. */
  lastSaid(): { kind: 'take'; text: string } | { kind: 'items'; noteId: string; lines: string[] } | null;
  /** Makes `text` the last thing said. */
  said(text: string): void;
  /** The chip above the recorder: working ("Sending to Board"), done ("In Notion on Board"), or failed (a sentence). */
  status(status: { state: 'working' | 'done' | 'failed'; lead?: string; title: string }): void;
  /** Makes the words `text` of this take a link to `url`, wherever the spoken cues put them. */
  link(text: string, url: string): void;
  /** Adds a line of markdown to the end of this take. */
  append(markdown: string): void;
  /** Changes another note's body, keeping the take in step when it is writing to that note. */
  updateNote(noteId: string, change: (body: string) => string): Promise<void>;
}

/** A command heard while recording, tried before Glyph's own. */
export interface VoiceCommand<Parsed = unknown> {
  id: string;
  /** The command in a finished phrase, or null. */
  parse(text: string): Parsed | null;
  /** What it will do, for the recorder to ask before it does it: "Send “Book the cabin” to Notion". */
  describe(parsed: Parsed, ctx: CaptureContext): { title: string; action: string };
  /** Acts on it, once confirmed. Answers the words of the phrase to keep in the take, or null to keep none. */
  run(parsed: Parsed, ctx: CaptureContext): string | null;
}

/**
 * "New item for AttackFM in Notion": a word an item command can end its note's
 * name with, and what happens to the items once they are in that note's list.
 */
export interface ItemTarget {
  /** The word, lowercase: "notion". */
  word: string;
  afterAdd(noteId: string, lines: string[], ctx: CaptureContext): void;
}

/** Something to say, suggested in a pause while recording. */
export interface Tip {
  say: string;
  does: string;
}

/** Background the formatter hands the model with a note. */
export interface FormatContext {
  for(noteId: string): string | null;
  /** Changes when `for` would say something new, so the note is formatted again. */
  version(noteId: string): number;
}

/**
 * A quiet word at the end of a line of the note: what a plugin could do with
 * that line, tapped to do it. "Notion" after a to-do that could be a task.
 * Offered only for what is possible right now, so a note with nothing linked
 * shows none. The editor draws them faint, hides the one on the line being
 * typed, and shows the busy word while it runs (editor/suggestions.ts).
 */
export interface Suggestion {
  /** 1-based line in the note. */
  line: number;
  /** The word: "Notion". */
  label: string;
  /** The word while it runs: "Sending". */
  busyLabel: string;
  run(editing: NoteEditing): Promise<void>;
}

/**
 * An inline formatting a plugin adds to the Markdown of notes: the text
 * between two runs of `delimiter`, drawn with `look`. The editor's markdown
 * parses it (editor/language.ts) as a node named `name`, with a `${name}Mark`
 * for each delimiter run, which stays visible and dimmed like every other
 * mark (docs/DESIGN.md §3.2). Typed, not spoken: the voice cues don't know it.
 */
export interface InlineFormat {
  /** The node's name, capitalised, unique across plugins: "Spoiler". */
  name: string;
  /** One to three of the same character, none Markdown already uses (`*`, `_`, `~`, `` ` ``, brackets, `#`, `!`): "||". */
  delimiter: string;
  /** How the text between the delimiters looks. */
  look: FormatLook;
  /**
   * The word that says it while recording, the way "bold … end bold" says
   * bold (capture/markdown.ts): "spoiler" for "spoiler … end spoiler". Absent,
   * the formatting is typed only, and the guide says so.
   */
  cue?: string;
  /** One line on what it is for, for the guide's marks page: "A dotted line under a fact to check later." */
  about?: string;
  /** Its own mark on the Style page, where a plugin brings several: the plugin's icon otherwise. */
  icon?: ComponentType<{ size?: number }>;
  /**
   * A name in brackets after the mark, turned into extra CSS for those words alone: `==the key==(green)` is a green
   * highlight (Matt: "Add a colour option on the highlight supporting the colour names from the glacierUI kit").
   *
   * It is the same shape as a note on a mark (editor/markNotes.ts), and the two share the brackets: a name this
   * answers is a colour, anything else is still a note. Answer null for a name the mark does not know, and the words
   * keep the mark's own look - an unknown colour is never nothing.
   */
  tint?: (name: string) => string | null;
}

export type FormatLook =
  /** Smoke: every letter bent and blurred without rest (editor/wispFormat.ts), plain only while the caret is in the text. */
  | { kind: 'wisp' }
  /**
   * A style on the text, as CSS: `{ kind: 'style', css: 'text-decoration: underline' }`. With `clearAtCaret` the
   * style lifts while the caret is in the words (a redaction's bar), so they can still be edited.
   */
  | { kind: 'style'; css: string; clearAtCaret?: boolean };

export interface GlyphPlugin {
  manifest: PluginManifest;
  icon: ComponentType<{ size?: number }>;
  /** Its page in Settings, and the page's one-line reading. */
  settings?: { Pane: ComponentType; summary(): string };
  noteLinks?: readonly NoteLink[];
  noteActions?: readonly NoteAction[];
  itemAction?: ItemAction;
  voice?: readonly VoiceCommand[];
  itemTargets?: readonly ItemTarget[];
  tips?: (recentTitle: string | null) => Tip[];
  formatContext?: FormatContext;
  /** The words offered on the lines of a note as it stands (pure: read on every change). */
  suggest?: (noteId: string, body: string) => Suggestion[];
  /**
   * What its item marks link to, read back: a task's status and facts for the
   * pill on the item and the card a tap opens (core/markDetails.ts). For marks
   * named with the plugin's id.
   */
  marks?: MarkDetailsProvider;
  /** Inline formattings of its own in every note: text between its delimiters, drawn its way. */
  formats?: readonly InlineFormat[];
}
