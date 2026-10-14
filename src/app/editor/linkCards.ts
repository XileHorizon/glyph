import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { LINK_PREVIEW_READY, openLink, pathOf, previewFor, siteOf, wantPreview } from '../core/linkPreview.ts';
import { markNameFor } from '../core/markDetails.ts';
import { onPreferences, preferences } from '../core/preferences.ts';
import { linkedOn } from './linkedRows.ts';

/**
 * Link preview cards (Matt: "add link preview cards"): a line that is only a link gets a card under it, with the
 * page's title, its site and a line of what it's about.
 *
 *   https://www.airbnb.com/rooms/1234
 *   - [The cabin](https://www.airbnb.com/rooms/1234)
 *
 * The line keeps its text, as a picture's line does (editor/images.ts), and the card is a block widget under it, so
 * the caret and the saved note are exactly as before. A tap on the card opens the page. A link a plugin already
 * reads (a Notion task, a GitHub issue) has its own row, and a link in the middle of words stays a link.
 *
 * The title comes from core/linkPreview.ts, and only for a card on screen; until then, or without it, the card
 * says the site and the path. Link previews off (Settings > Type) draws no cards at all.
 */

/** The whole line is a link: bare, `<bare>`, or `[words](address)`, optionally as a list item or a to-do. */
const ONLY_LINK = /^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?(?:<?(https?:\/\/[^\s<>]+?)>?|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))\s*$/;
const FENCE = /^\s*(```|~~~)/;

export interface LinkLine {
  url: string;
  /** The link's own words, for `[words](address)`. */
  words: string | null;
}

/** The link a line is, or null when the line is anything more or less than one link. */
export function linkLine(text: string): LinkLine | null {
  const found = ONLY_LINK.exec(text);
  if (!found) return null;
  const url = (found[1] ?? found[3] ?? '').replace(/[.,;:!?]+$/, '');
  if (!url) return null;
  // A link a plugin reads has its own row under the line (editor/linkedRows.ts).
  if (linkedOn(text) || markNameFor(url)) return null;
  return { url, words: found[2]?.trim() || null };
}

class CardWidget extends WidgetType {
  readonly face: string;

  constructor(
    readonly url: string,
    readonly words: string | null,
  ) {
    super();
    const known = previewFor(url);
    this.face = [known?.title, known?.site, known?.description].join('|');
  }

  eq(other: CardWidget): boolean {
    return other.url === this.url && other.words === this.words && other.face === this.face;
  }

  toDOM(): HTMLElement {
    wantPreview(this.url);
    const known = previewFor(this.url);
    const site = known?.site || siteOf(this.url);
    const card = document.createElement('div');
    card.className = 'cm-linkCard';
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open ${known?.title || this.words || site}`);

    const badge = document.createElement('span');
    badge.className = 'cm-linkCard-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = (site.match(/[\p{L}\p{N}]/u)?.[0] ?? '·').toUpperCase();

    const body = document.createElement('span');
    body.className = 'cm-linkCard-body';
    const title = document.createElement('span');
    title.className = 'cm-linkCard-title';
    title.textContent = known?.title || this.words || site;
    body.append(title);
    if (known?.description) {
      const about = document.createElement('span');
      about.className = 'cm-linkCard-about';
      about.textContent = known.description;
      body.append(about);
    }
    const where = document.createElement('span');
    where.className = 'cm-linkCard-where';
    where.textContent = `${siteOf(this.url)}${pathOf(this.url)}`;
    body.append(where);

    card.append(badge, body);
    // Space above and below as padding on a wrapper: a block widget is measured whole, margins and all left out.
    const wrap = document.createElement('div');
    wrap.className = 'cm-linkCardWrap';
    wrap.append(card);
    const open = () => void openLink(this.url).catch(() => undefined);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    return wrap;
  }

  /** The card's own taps are its own: the editor doesn't move the caret under them. */
  ignoreEvent(): boolean {
    return true;
  }
}

const refresh = StateEffect.define<null>();

function decorate(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!preferences().linkPreviews) return builder.finish();
  let fence: string | null = null;
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    const marker = FENCE.exec(line.text)?.[1];
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      continue;
    }
    if (fence) continue;
    const link = linkLine(line.text);
    if (link) builder.add(line.to, line.to, Decoration.widget({ widget: new CardWidget(link.url, link.words), block: true, side: 1 }));
  }
  return builder.finish();
}

const cards = StateField.define<DecorationSet>({
  create: decorate,
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(refresh))) return decorate(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A preview arrived, or the setting changed: rebuild the cards. */
const listen = ViewPlugin.fromClass(
  class {
    private readonly off: () => void;
    private readonly onReady = () => this.view.dispatch({ effects: refresh.of(null) });
    constructor(readonly view: EditorView) {
      window.addEventListener(LINK_PREVIEW_READY, this.onReady);
      const unprefs = onPreferences(this.onReady);
      this.off = () => {
        window.removeEventListener(LINK_PREVIEW_READY, this.onReady);
        unprefs();
      };
    }
    destroy() {
      this.off();
    }
  },
);

const theme = EditorView.baseTheme({
  '.cm-linkCard': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.7em',
    maxInlineSize: '32rem',
    padding: '0.6em 0.75em',
    borderRadius: 'var(--glacier-radius-lg, 0.75rem)',
    border: '1px solid var(--app-rule, var(--glacier-border-subtle))',
    background: 'var(--app-paper-2, var(--glacier-surface))',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    outlineOffset: '2px',
  },
  '.cm-linkCardWrap': {
    paddingBlock: '0.25em 0.6em',
    // Level with the words: a block widget sits outside the lines, which take the gutter as padding.
    paddingInline: 'calc(var(--app-safe-left, 0px) + var(--app-gutter, 0px)) calc(var(--app-safe-right, 0px) + var(--app-gutter, 0px))',
  },
  '.cm-linkCard:active': {
    background: 'color-mix(in srgb, currentColor 8%, var(--app-paper-2, transparent))',
  },
  '.cm-linkCard-badge': {
    flex: 'none',
    display: 'grid',
    placeItems: 'center',
    inlineSize: '2.1em',
    blockSize: '2.1em',
    borderRadius: '0.55em',
    background: 'color-mix(in srgb, currentColor 10%, transparent)',
    fontWeight: '600',
    fontSize: '0.9em',
  },
  '.cm-linkCard-body': {
    display: 'flex',
    flexDirection: 'column',
    minInlineSize: '0',
    gap: '0.1em',
  },
  '.cm-linkCard-title': {
    fontWeight: '600',
    lineHeight: '1.3',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: '2',
    WebkitBoxOrient: 'vertical',
  },
  '.cm-linkCard-about': {
    fontSize: '0.86em',
    lineHeight: '1.35',
    color: 'var(--app-ink-2, inherit)',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: '2',
    WebkitBoxOrient: 'vertical',
  },
  '.cm-linkCard-where': {
    fontSize: '0.8em',
    color: 'var(--app-ink-3, inherit)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export function linkCards(): Extension {
  return [cards, listen, theme];
}
