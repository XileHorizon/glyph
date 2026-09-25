import { StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * Suggestions, inline: a quiet word at the end of a line for what a plugin
 * could do with it, tapped to do it.
 *
 * Matt: "render suggestions inline for stuff like adding a list item as a
 * Notion task and whatnot; I want the note to feel more alive with the
 * integrations while remaining minimalistic". So: a small outlined word in
 * the faintest ink after the line - "Notion" after a to-do that is not a task
 * yet - and nothing else. It is not on the line being typed (it would sit
 * against the caret and jump with every letter), it says its busy word while
 * it runs, and once the line has become what it offered (a link, for a task)
 * it is gone, because the plugin no longer offers it.
 *
 * The words come from `suggest(body)`, read on every change of the document
 * (the plugins' answers are pure and cheap: a regex per line). The widget
 * lives after the line's text as a decoration, so the note's own words are
 * never touched and the swipe on the line (swipeItems.ts) still works.
 */

export interface LineSuggestion {
  /** 1-based line. */
  line: number;
  label: string;
  busyLabel: string;
  run: () => Promise<void>;
}

interface Options {
  suggest: (body: string) => LineSuggestion[];
}

/** A line's suggestion started or finished running. */
const busyChanged = StateEffect.define<{ line: number; busy: boolean }>();

class SuggestWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly busy: boolean,
    readonly press: () => void,
    /** Told as a finger goes down on it, so the pill is not taken away before the tap finishes. */
    readonly held: () => void,
  ) {
    super();
  }

  eq(other: SuggestWidget): boolean {
    return other.label === this.label && other.busy === this.busy;
  }

  toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-suggest';
    button.textContent = this.label;
    if (this.busy) {
      button.dataset.busy = '';
      button.disabled = true;
    }
    /*
     * A press on the pill must not reach the editor, or the caret moves to this line, the pill is rebuilt without it
     * (a line being typed carries no suggestion) and the tap lands on nothing: the first press did nothing and the
     * second one worked (Matt: "sometimes i have to press the notion pill twice to create the notion task"). So the
     * press is kept from the editor, and the line is held from the moment a finger goes down until the tap is over.
     *
     * The two are stopped differently, and it matters. A pointer or mouse press has its default taken away, which is
     * what stops the caret moving. A TOUCH does not: a touchstart whose default is taken away never becomes a click,
     * and the pill stopped working on a phone altogether (Matt: "i can no longer tap notion pills to create tasks").
     * The touch is only kept from the editor, and the mouse press the phone sends after it is what moves no caret.
     */
    for (const kind of ['pointerdown', 'mousedown'] as const) {
      button.addEventListener(kind, (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.held();
      });
    }
    button.addEventListener('touchstart', (event) => {
      event.stopPropagation();
      this.held();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.press();
    });
    return button;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function lineSuggestions({ suggest }: Options): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly busy = new Set<number>();
      /** The line whose pill a finger is on: kept on screen even once the caret lands on that line. */
      private held: number | null = null;
      private gone = false;

      constructor(readonly view: EditorView) {
        this.decorations = this.build();
      }

      destroy(): void {
        this.gone = true;
      }

      update(update: ViewUpdate): void {
        const changed = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(busyChanged)));
        if (update.docChanged || update.selectionSet || changed) this.decorations = this.build();
      }

      private build(): DecorationSet {
        const { state } = this.view;
        const doc = state.doc;
        const caret = doc.lineAt(state.selection.main.head).number;
        const marks = [];
        for (const suggestion of suggest(doc.toString())) {
          const held = this.held === suggestion.line || this.busy.has(suggestion.line);
          if (suggestion.line < 1 || suggestion.line > doc.lines || (suggestion.line === caret && !held)) continue;
          const line = doc.line(suggestion.line);
          const busy = this.busy.has(suggestion.line);
          const widget = new SuggestWidget(
            busy ? suggestion.busyLabel : suggestion.label,
            busy,
            () => this.press(suggestion),
            () => this.hold(suggestion.line),
          );
          marks.push(Decoration.widget({ widget, side: 1 }).range(line.to));
        }
        return Decoration.set(marks, true);
      }

      /** A finger is on this line's pill: it stays put until the press is done with, however the caret moves. */
      private hold(line: number): void {
        this.held = line;
        const release = () => {
          if (this.held === line) this.held = null;
          window.removeEventListener('pointerup', release);
          window.removeEventListener('pointercancel', release);
        };
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
      }

      private press(suggestion: LineSuggestion): void {
        if (this.busy.has(suggestion.line)) return;
        this.busy.add(suggestion.line);
        this.view.dispatch({ effects: busyChanged.of({ line: suggestion.line, busy: true }) });
        void suggestion.run().finally(() => {
          this.busy.delete(suggestion.line);
          // The view may be gone by the time a slow send answers.
          if (!this.gone) this.view.dispatch({ effects: busyChanged.of({ line: suggestion.line, busy: false }) });
        });
      }
    },
    { decorations: (instance) => instance.decorations },
  );
  return [plugin, suggestTheme];
}

/** The word: faint, outlined, a step smaller than the line, and out of the way. */
const suggestTheme = EditorView.baseTheme({
  '.cm-suggest': {
    appearance: 'none',
    display: 'inline-block',
    textIndent: '0',
    marginInlineStart: '0.6em',
    padding: '0 0.6em',
    // A hairline of the word's own ink at less than half strength: seen on black paper and on white, never loud.
    border: '1px solid color-mix(in oklch, currentColor 45%, transparent)',
    borderRadius: '999px',
    background: 'transparent',
    color: 'var(--app-ink-3, currentColor)',
    font: 'inherit',
    fontSize: '0.68em',
    lineHeight: '1.7',
    verticalAlign: '0.15em',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    animation: 'cm-suggest-in 220ms ease-out both',
  },
  '.cm-suggest:active': {
    color: 'var(--app-ink, currentColor)',
  },
  '.cm-suggest[data-busy]': {
    color: 'var(--app-ink-4, currentColor)',
    borderStyle: 'dashed',
    cursor: 'default',
  },
  '@keyframes cm-suggest-in': {
    from: { opacity: '0', transform: 'translateX(-2px)' },
  },
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-suggest': { animation: 'none' },
  },
});
