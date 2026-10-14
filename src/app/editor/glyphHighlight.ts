import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import styles from './Editor.module.css';

/**
 * The inline half of the renderer: what every run of markdown looks like,
 * including the syntax itself.
 *
 * This is the whole trick Glyph is built on, and it costs almost nothing.
 * Lezer's markdown grammar already tags every delimiter - `#`, `**`, `>`,
 * backtick, `-`, `[`, `]` - as `processingInstruction`, and the highlighter
 * emits one span per run carrying the UNION of the tags covering it. So inside
 * `**bold**` the asterisks arrive with both `strong` and `processingInstruction`
 * while the word between them arrives with only `strong`. One rule styles the
 * content, one rule dims the markers, and the markers never leave the document
 * because nothing here touches the document: decorations style ranges of the
 * real text.
 *
 * That is the difference between this design and every rich-text engine. In
 * Lexical or Tiptap the `**` is consumed the moment the mark is recognised, and
 * keeping it would mean fighting the model on every keystroke.
 *
 * ORDER IS LOAD-BEARING. `.mark` and `.strong` have the same specificity, so
 * the one declared later in the CSS file wins - and the marker must win, or a
 * `**` inside a bold run renders bold and the dimming silently does nothing for
 * exactly the case the feature exists for. `processingInstruction` is last here
 * and `.mark` is last in `Editor.module.css`; keep both that way.
 */
export const glyphHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: styles.h1 },
  { tag: tags.heading2, class: styles.h2 },
  { tag: tags.heading3, class: styles.h3 },
  { tag: tags.heading4, class: styles.h4 },
  { tag: tags.heading5, class: styles.h5 },
  { tag: tags.heading6, class: styles.h6 },

  { tag: tags.strong, class: styles.strong },
  { tag: tags.emphasis, class: styles.em },
  { tag: tags.strikethrough, class: styles.strike },
  { tag: tags.monospace, class: styles.code },
  // `x^2^` and `H~2~O` are both `special(content)`, so the highlighter cannot tell one from the other: they are
  // drawn by node name instead (editor/extended.ts).

  { tag: tags.link, class: styles.link },
  { tag: tags.url, class: styles.url },
  { tag: tags.quote, class: styles.quote },
  { tag: tags.list, class: styles.list },
  { tag: tags.contentSeparator, class: styles.hr },
  { tag: tags.labelName, class: styles.codeInfo },
  // `[ ]` and `[x]`: an atom rather than a marker, because a task box is a
  // control the eye looks for, not punctuation it should look past.
  { tag: tags.atom, class: styles.taskMarker },

  // Code inside a fenced block, parsed by its own language (language.ts), in
  // the code theme chosen for the page's side (codeThemes.ts): each kind of
  // token a custom property. Ink draws them in weight and shade; the coloured
  // themes in colour.
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.self], class: styles.codeKeyword },
  { tag: [tags.macroName], class: styles.codeMacro },
  { tag: [tags.meta, tags.annotation, tags.special(tags.variableName)], class: styles.codeMeta },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: styles.codeString },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: styles.codeComment },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.namespace], class: styles.codeType },
  { tag: [tags.propertyName, tags.attributeName, tags.attributeValue], class: styles.codeProperty },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName)], class: styles.codeName },
  { tag: [tags.number, tags.bool, tags.null, tags.literal], class: styles.codeLiteral },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], class: styles.codePunctuation },

  // Every delimiter in the language. Keep last; see the note above.
  { tag: tags.processingInstruction, class: styles.mark },
]);
