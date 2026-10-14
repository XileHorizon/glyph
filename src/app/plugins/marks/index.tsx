import { CircleQuestionMark, EyeOff, Highlighter, Megaphone, MessageSquareDashed, Plus } from '@glacier/icons';
import type { GlyphPlugin, InlineFormat, PluginManifest } from '../types.ts';

/**
 * Marks: the formatting Glyph adds to Markdown, all of it in one plugin
 * (Matt: "move all the additional formatting to one single plugin instead of
 * one of each like shout redact unsure etc"). Six marks, one switch in
 * Settings > Plugins, and each carries its own icon for the Style page
 * (editor/ContextMenu.tsx) and its own words for the guide's table
 * (guide/marks.ts).
 *
 * A mark is its delimiter and its look (plugins/types.ts `InlineFormat`): the
 * spoiler goes to smoke (editor/wispFormat.ts), the rest are CSS on the words
 * (editor/formatLooks.ts), in ink and paper only. Each is said as well as
 * typed: "highlight … end highlight" while recording (capture/markdown.ts).
 * Switched off, every one of them is plain text again.
 */

export const manifest: PluginManifest = {
  id: 'marks',
  name: 'Marks',
  description: 'Ghost.md’s own formatting on top of Markdown: a spoiler in smoke, a highlighter, an aside, a doubt, a shout and an addition. Typed or said.',
  version: '1.0.0',
  author: 'Ghost.md',
  standard: true,
  permissions: [],
  storage: [],
};

/**
 * The colours a highlight can be named (Matt: "Add a colour option on the highlight supporting the colour names from
 * the glacierUI kit"), which are the kit's own ramps and nothing invented here: `==the key==(green)`.
 *
 * A **name** is written in the note, never a colour, so the same reasoning as the workspace hues holds - the kit can
 * retune green without touching anybody's notes, and a name this build does not know stays the plain highlight with
 * its words as a note. The wash is mixed against the page the way the blue one is (app/ink.css `--app-mark`): a pale
 * wash on paper and a deep one on a dark page, with the words keeping the page's own ink so they stay readable.
 */
export const MARK_COLOURS = ['blue', 'red', 'amber', 'green', 'teal', 'purple', 'gray'] as const;
export type MarkColour = (typeof MARK_COLOURS)[number];

export function isMarkColour(name: string): name is MarkColour {
  return (MARK_COLOURS as readonly string[]).includes(name);
}

/** The wash for a named colour, or empty for a name this build does not know. */
export function washFor(name: string): string {
  const clean = name.trim().toLowerCase();
  if (!isMarkColour(clean)) return '';
  // Grey is the kit's own word for it; the token is spelled the American way.
  return `color-mix(in oklch, var(--glacier-${clean}-9) 34%, transparent)`;
}

/** The marks, in the order the Style page and the guide show them. */
export const MARKS: readonly InlineFormat[] = [
  {
    name: 'Spoiler',
    delimiter: '||',
    look: { kind: 'wisp' },
    cue: 'spoiler',
    about: 'The words go to smoke until you put the caret in them.',
    icon: EyeOff,
  },
  {
    name: 'Highlight',
    delimiter: '==',
    look: {
      kind: 'style',
      css: 'background: var(--app-mark, var(--app-wash)); border-radius: 0.2em; box-shadow: 0 0 0 0.12em var(--app-mark, var(--app-wash));',
    },
    cue: 'highlight',
    about: 'A wash of blue behind the words, for the line you will want again. Name a colour after it - ==this==(green) - for another.',
    icon: Highlighter,
    tint: (name) => {
      const wash = washFor(name);
      return wash ? `background: ${wash}; box-shadow: 0 0 0 0.12em ${wash};` : null;
    },
  },
  {
    name: 'Aside',
    delimiter: '%%',
    look: { kind: 'style', css: 'font-size: 0.88em; font-style: italic; color: var(--glacier-text-muted);' },
    cue: 'aside',
    about: 'A note to yourself inside the note: smaller, quieter, leaning.',
    icon: MessageSquareDashed,
  },
  {
    name: 'Unsure',
    delimiter: '??',
    look: {
      kind: 'style',
      css: 'text-decoration: underline dotted; text-decoration-color: var(--glacier-text-subtle); text-underline-offset: 0.22em; text-decoration-thickness: 0.09em;',
    },
    cue: 'unsure',
    about: 'A dotted line under a fact to check later. Add “(why)” after it and tapping the words shows that note.',
    icon: CircleQuestionMark,
  },
  {
    name: 'Shout',
    delimiter: '^^',
    look: { kind: 'style', css: 'font-variant-caps: all-small-caps; letter-spacing: 0.09em; font-weight: var(--glacier-font-weight-semibold);' },
    cue: 'shout',
    about: 'Spaced small capitals: emphasis that is not bold.',
    icon: Megaphone,
  },
  {
    name: 'Added',
    delimiter: '++',
    look: { kind: 'style', css: 'text-decoration: underline; text-underline-offset: 0.18em; text-decoration-thickness: 0.11em;' },
    cue: 'added',
    about: 'A line under what was added, the pair of struck-through for what went.',
    icon: Plus,
  },
];

export const marksPlugin: GlyphPlugin = {
  manifest,
  icon: Highlighter,
  formats: MARKS,
};
