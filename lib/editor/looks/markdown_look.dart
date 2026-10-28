/// The markdown renderer's rule book. Ports `src/app/editor/markdown.module.css` rule for rule: the classes
/// `glyph_highlight.dart` and `glyph_lines.dart` hand out, each with the declarations the stylesheet gives it,
/// read through the tokens. The CSS rule is cited beside each.
///
/// Two families, as there: the inline classes (`h1` to `mark`) land on runs of text, the line classes (`lineH1` to
/// `lineHr`) on the line. The class names are the stylesheet's own, without the hash a CSS module adds.
///
/// What differs:
/// - `.editor` and `.editor[data-grow]` size the host element; the sliver and the column do that here.
/// - `.figure` (a picture under its line) is the picture widget's, with the media piece.
/// - `text-underline-offset: 0.2em` on a link: Flutter's underline sits where the font puts it.
/// - `cursor: pointer` on a to-do's box: the input layer's.
/// - `:global(.app-split) ... .cm-content { padding-block-end }` is `LookEnv.contentBottom`, which whoever knows
///   the layout sets.
/// - The transparent borders round a quote and a block of code exist there because CodeMirror measures a line
///   without its margins; they are kept as they are, so a line's box is the page's to the pixel.
library;

import 'package:flutter/painting.dart' show Radius;

import '../view/margin_marks.dart';
import 'look.dart';

/// The class names of markdown.module.css, as `styles.name` is in the web's TypeScript.
abstract final class MarkdownClass {
  static const String h1 = 'h1', h2 = 'h2', h3 = 'h3', h4 = 'h4', h5 = 'h5', h6 = 'h6';
  static const String strong = 'strong', em = 'em', strike = 'strike', code = 'code';
  static const String codeKeyword = 'codeKeyword', codeString = 'codeString', codeComment = 'codeComment', codeType = 'codeType';
  static const String codeProperty = 'codeProperty', codeName = 'codeName', codeLiteral = 'codeLiteral', codePunctuation = 'codePunctuation';
  static const String codeMacro = 'codeMacro', codeMeta = 'codeMeta';
  static const String link = 'link', url = 'url', quote = 'quote', list = 'list', hr = 'hr', codeInfo = 'codeInfo', taskMarker = 'taskMarker';
  static const String mark = 'mark';
  static const String lineH1 = 'lineH1', lineH2 = 'lineH2', lineH3 = 'lineH3', lineH4 = 'lineH4';
  static const String lineQuote = 'lineQuote', lineQuoteTop = 'lineQuoteTop', lineQuoteFoot = 'lineQuoteFoot';
  static const String lineItem = 'lineItem';
  static const String lineCode = 'lineCode', lineCodeTop = 'lineCodeTop', lineCodeFoot = 'lineCodeFoot';
  static const String lineHr = 'lineHr';
}

double _weight(LookEnv e, String name) => e.t.len('glacier-font-weight-$name');

/// `--hang`, the marker's measured width, from the line's `style` attribute (glyph_lines.dart); `var(--hang, 0px)`.
double _hang(Props p) => p.element?.styleLength('--hang') ?? 0;

/// Margin's column (margin_marks.dart): room at the start of every line while the editor says `data-marks="margin"`,
/// as the page's `.cm-marginMarks .cm-content { padding-inline-start: var(--margin-marks) }`. Nothing otherwise.
double _marks(LookEnv e) => e.attrs[marginAttribute] == 'margin' ? marginColumn(e.body) : 0;

/// The mark in Margin's column, at the note's own size and weight whatever its line is set in (`.cm-hangMark`).
void _marginMark(Props p, LookEnv e) {
  p
    ..fontSize = e.body * marginMarkScale
    ..weight = _weight(e, 'regular')
    ..trackingPx(0)
    ..color = e.t.color('glacier-text-subtle');
}

bool _first(LookElement el, LineContext c) => c.first;
bool _afterNoFront(LookElement el, LineContext c) => c.after == 'cm-frontNone';
bool _afterFrontFold(LookElement el, LineContext c) => c.after == 'cm-frontFold';

/// markdown.module.css.
final LookSheet markdownLook = LookSheet('editor/markdown.module.css', <LookRule>[
  // --- inline runs -------------------------------------------------------------------------------------------------

  // .h1 { font-size: var(--app-h1); line-height: 1.08; letter-spacing: -0.035em;
  //       font-weight: var(--glacier-font-weight-bold);
  //       color: color-mix(in srgb, var(--glacier-text) 88%, transparent); }
  LookRule(MarkdownClass.h1, (p, e) {
    p
      ..fontSize = e.heading(1)
      ..lineHeight = 1.08
      ..trackingEm(-0.035)
      ..weight = _weight(e, 'bold')
      ..color = e.t.colorOf('color-mix(in srgb, var(--glacier-text) 88%, transparent)');
  }),
  // .h2 { font-size: var(--app-h2); line-height: 1.12; letter-spacing: -0.03em; font-weight: bold; }
  LookRule(MarkdownClass.h2, (p, e) {
    p
      ..fontSize = e.heading(2)
      ..lineHeight = 1.12
      ..trackingEm(-0.03)
      ..weight = _weight(e, 'bold');
  }),
  // .h3 { font-size: var(--app-h3); line-height: 1.2; letter-spacing: -0.02em; font-weight: semibold; }
  LookRule(MarkdownClass.h3, (p, e) {
    p
      ..fontSize = e.heading(3)
      ..lineHeight = 1.2
      ..trackingEm(-0.02)
      ..weight = _weight(e, 'semibold');
  }),
  // .h4 { font-size: var(--app-h4); line-height: 1.3; letter-spacing: -0.01em; font-weight: semibold; }
  LookRule(MarkdownClass.h4, (p, e) {
    p
      ..fontSize = e.heading(4)
      ..lineHeight = 1.3
      ..trackingEm(-0.01)
      ..weight = _weight(e, 'semibold');
  }),
  // .h5 { font-size: var(--app-h5); font-weight: semibold; }
  LookRule(MarkdownClass.h5, (p, e) {
    p
      ..fontSize = e.heading(5)
      ..weight = _weight(e, 'semibold');
  }),
  // .h6 { font-size: var(--app-h6); font-weight: semibold; color: var(--glacier-text-subtle); }
  LookRule(MarkdownClass.h6, (p, e) {
    p
      ..fontSize = e.heading(6)
      ..weight = _weight(e, 'semibold')
      ..color = e.t.color('glacier-text-subtle');
  }),
  // .strong { font-weight: var(--glacier-font-weight-bold); }
  LookRule(MarkdownClass.strong, (p, e) => p.weight = _weight(e, 'bold')),
  // .em { font-style: italic; }
  LookRule(MarkdownClass.em, (p, e) => p.italic = true),
  // .strike { text-decoration: line-through; }
  LookRule(MarkdownClass.strike, (p, e) {
    p
      ..lineThrough = true
      ..underline = false;
  }),
  // .code { font-family: var(--glacier-font-mono); color: var(--glacier-accent-text);
  //         font-feature-settings: var(--app-mono-features); letter-spacing: 0; }
  LookRule(MarkdownClass.code, (p, e) {
    p
      ..families = e.monoFamilies
      ..color = e.t.color('glacier-accent-text')
      ..pageFeatures = false
      ..trackingPx(0);
  }),
  // .codeKeyword { color: var(--code-keyword); font-weight: var(--code-keyword-weight); }
  LookRule(MarkdownClass.codeKeyword, (p, e) {
    p.color = e.code.color('keyword');
    if (e.code.keywordWeight != null) p.weight = e.code.keywordWeight!;
  }),
  // .codeString { color: var(--code-string); }
  LookRule(MarkdownClass.codeString, (p, e) => p.color = e.code.color('string')),
  // .codeComment { color: var(--code-comment); font-style: italic; }
  LookRule(MarkdownClass.codeComment, (p, e) {
    p
      ..color = e.code.color('comment')
      ..italic = true;
  }),
  // .codeType { color: var(--code-type); font-weight: var(--code-name-weight); }
  LookRule(MarkdownClass.codeType, (p, e) {
    p.color = e.code.color('type');
    if (e.code.nameWeight != null) p.weight = e.code.nameWeight!;
  }),
  // .codeProperty { color: var(--code-property); }
  LookRule(MarkdownClass.codeProperty, (p, e) => p.color = e.code.color('property')),
  // .codeName { color: var(--code-name); font-weight: var(--code-name-weight); }
  LookRule(MarkdownClass.codeName, (p, e) {
    p.color = e.code.color('name');
    if (e.code.nameWeight != null) p.weight = e.code.nameWeight!;
  }),
  // .codeLiteral { color: var(--code-literal); font-weight: var(--code-name-weight); }
  LookRule(MarkdownClass.codeLiteral, (p, e) {
    p.color = e.code.color('literal');
    if (e.code.nameWeight != null) p.weight = e.code.nameWeight!;
  }),
  // .codePunctuation { color: var(--code-punctuation); }
  LookRule(MarkdownClass.codePunctuation, (p, e) => p.color = e.code.color('punctuation')),
  // .codeMacro { color: var(--code-macro); font-weight: var(--code-name-weight); }
  LookRule(MarkdownClass.codeMacro, (p, e) {
    p.color = e.code.color('macro');
    if (e.code.nameWeight != null) p.weight = e.code.nameWeight!;
  }),
  // .codeMeta { color: var(--code-meta); }
  LookRule(MarkdownClass.codeMeta, (p, e) => p.color = e.code.color('meta')),
  // .link { color: var(--glacier-accent-text); font-weight: var(--glacier-font-weight-medium);
  //         text-decoration: underline; text-underline-offset: 0.2em; }
  LookRule(MarkdownClass.link, (p, e) {
    p
      ..color = e.t.color('glacier-accent-text')
      ..weight = _weight(e, 'medium')
      ..underline = true
      ..lineThrough = false;
  }),
  // .url { color: var(--glacier-text-muted); text-decoration: none; }
  LookRule(MarkdownClass.url, (p, e) {
    p
      ..color = e.t.color('glacier-text-muted')
      ..underline = false
      ..lineThrough = false;
  }),
  // .quote { color: var(--glacier-text-muted); }
  LookRule(MarkdownClass.quote, (p, e) => p.color = e.t.color('glacier-text-muted')),
  // .list { color: var(--glacier-text); font-variant-numeric: tabular-nums; }
  LookRule(MarkdownClass.list, (p, e) {
    p
      ..color = e.t.color('glacier-text')
      ..tabular = true;
  }),
  // .hr { color: var(--glacier-text-subtle); }
  LookRule(MarkdownClass.hr, (p, e) => p.color = e.t.color('glacier-text-subtle')),
  // .codeInfo { color: var(--glacier-accent-text); }
  LookRule(MarkdownClass.codeInfo, (p, e) => p.color = e.t.color('glacier-accent-text')),
  // .taskMarker { color: var(--glacier-accent-text); font-weight: var(--glacier-font-weight-medium);
  //               font-family: var(--glacier-font-mono); cursor: pointer; }
  LookRule(MarkdownClass.taskMarker, (p, e) {
    p
      ..color = e.t.color('glacier-accent-text')
      ..weight = _weight(e, 'medium')
      ..families = e.monoFamilies;
  }),
  // Keep this rule LAST of the inline ones: `.mark` and `.strong` are one class each, so order decides, and the
  // marker has to win.
  // .mark { color: var(--glacier-text-subtle); font-weight: var(--glacier-font-weight-regular);
  //         text-decoration: none; }
  LookRule(MarkdownClass.mark, (p, e) {
    p
      ..color = e.t.color('glacier-text-subtle')
      ..weight = _weight(e, 'regular')
      ..underline = false
      ..lineThrough = false;
  }),

  // --- lines -------------------------------------------------------------------------------------------------------

  // .editor :global(.cm-line) { padding-inline: var(--app-gutter); }
  LookRule(
    'cm-line',
    null,
    classes: 2,
    box: (p, e) {
      p
        ..paddingStart = e.gutter + _marks(e)
        ..paddingEnd = e.gutter;
    },
  ),
  // .editor .cm-line.lineH1, .editor .cm-line.lineH2 { padding-block-start: var(--glacier-space-8); }
  LookRule(MarkdownClass.lineH1, null, classes: 3, box: (p, e) => p.paddingTop = e.t.space(8)),
  LookRule(MarkdownClass.lineH2, null, classes: 3, box: (p, e) => p.paddingTop = e.t.space(8)),
  // .editor .cm-line.lineH3, .editor .cm-line.lineH4 { padding-block-start: var(--glacier-space-6); }
  LookRule(MarkdownClass.lineH3, null, classes: 3, box: (p, e) => p.paddingTop = e.t.space(6)),
  LookRule(MarkdownClass.lineH4, null, classes: 3, box: (p, e) => p.paddingTop = e.t.space(6)),
  // .editor .cm-line.lineH1:first-child (and H2, H3, H4) { padding-block-start: 0; }
  for (final name in const <String>[MarkdownClass.lineH1, MarkdownClass.lineH2, MarkdownClass.lineH3, MarkdownClass.lineH4])
    LookRule(name, null, classes: 4, when: _first, box: (p, e) => p.paddingTop = 0),
  // .editor .cm-frontNone + .cm-line.lineH1 (and H2, H3, H4) { padding-block-start: 0; }
  for (final name in const <String>[MarkdownClass.lineH1, MarkdownClass.lineH2, MarkdownClass.lineH3, MarkdownClass.lineH4])
    LookRule(name, null, classes: 4, when: _afterNoFront, box: (p, e) => p.paddingTop = 0),
  // .editor .cm-frontFold + .cm-line.lineH1 (and H2, H3, H4) { padding-block-start: var(--glacier-space-6); }
  for (final name in const <String>[MarkdownClass.lineH1, MarkdownClass.lineH2, MarkdownClass.lineH3, MarkdownClass.lineH4])
    LookRule(name, null, classes: 4, when: _afterFrontFold, box: (p, e) => p.paddingTop = e.t.space(6)),
  // .editor .cm-line.lineQuote { margin-inline: var(--app-gutter);
  //   padding-inline: calc(var(--glacier-shape-accent-edge) + 0.75em) 0; border-inline-start: 0;
  //   background-image: linear-gradient(var(--glacier-border-strong), var(--glacier-border-strong));
  //   background-size: var(--glacier-shape-accent-edge) 100%; background-position: left top;
  //   background-repeat: no-repeat; background-clip: padding-box; }
  LookRule(
    MarkdownClass.lineQuote,
    null,
    classes: 3,
    box: (p, e) {
      final edge = e.t.len('glacier-shape-accent-edge');
      p
        ..marginStart = e.gutter + _marks(e)
        ..marginEnd = e.gutter
        ..paddingStart = edge + p.em(0.75)
        ..paddingEnd = 0
        ..borderStart = 0
        ..barWidth = edge
        ..barColor = e.t.color('glacier-border-strong');
    },
  ),
  // .editor .cm-line.lineQuoteTop { border-block-start: 0.35em solid transparent; padding-block-start: 0.2em; }
  LookRule(
    MarkdownClass.lineQuoteTop,
    null,
    classes: 3,
    box: (p, e) {
      p
        ..borderTop = p.em(0.35)
        ..paddingTop = p.em(0.2);
    },
  ),
  // .editor .cm-line.lineQuoteFoot { border-block-end: 0.35em solid transparent; padding-block-end: 0.2em; }
  LookRule(
    MarkdownClass.lineQuoteFoot,
    null,
    classes: 3,
    box: (p, e) {
      p
        ..borderBottom = p.em(0.35)
        ..paddingBottom = p.em(0.2);
    },
  ),
  // .editor .cm-line.lineItem { padding-inline-start: calc(var(--app-gutter) + var(--hang, 0px));
  //   text-indent: calc(-1 * var(--hang, 0px)); }
  LookRule(
    MarkdownClass.lineItem,
    null,
    classes: 3,
    box: (p, e) {
      p
        ..paddingStart = e.gutter + _marks(e) + _hang(p)
        ..textIndent = -_hang(p);
    },
  ),
  // .editor .cm-line.lineQuote.lineItem {
  //   padding-inline-start: calc(var(--glacier-shape-accent-edge) + 0.75em + var(--hang, 0px)); }
  LookRule(
    MarkdownClass.lineItem,
    null,
    classes: 4,
    when: (el, c) => el.has(MarkdownClass.lineQuote),
    box: (p, e) => p.paddingStart = e.t.len('glacier-shape-accent-edge') + p.em(0.75) + _hang(p),
  ),
  // .editor .cm-line.lineCode { font-family: var(--glacier-font-mono);
  //   font-feature-settings: var(--app-mono-features); letter-spacing: 0;
  //   font-size: calc(var(--app-body) * 0.82); background: var(--code-bg); background-clip: padding-box;
  //   color: var(--code-fg); tab-size: 2; margin-inline: var(--app-gutter); padding-inline: 0.85em;
  //   text-indent: 0; }
  LookRule(
    MarkdownClass.lineCode,
    (p, e) {
      p
        ..families = e.monoFamilies
        ..pageFeatures = false
        ..trackingPx(0)
        ..fontSize = e.body * 0.82
        ..color = e.code.color('fg')
        ..tabSize = 2;
    },
    classes: 3,
    box: (p, e) {
      final ground = e.code.color('bg');
      p
        ..background = ((_) => ground)
        // `background` is the shorthand: it puts `background-image` back to none, and a quote's bar is one
        // (`.lineQuote`, the rule before this). A block of code in a quote is the card alone, with no bar down it.
        ..barWidth = 0
        ..barColor = null
        ..marginStart = e.gutter + _marks(e)
        ..marginEnd = e.gutter
        ..paddingStart = p.em(0.85)
        ..paddingEnd = p.em(0.85)
        ..textIndent = 0;
    },
  ),
  // .editor .cm-line.lineCodeTop { border-block-start: 0.5em solid transparent; padding-block-start: 0.55em;
  //   border-start-start-radius: var(--glacier-radius-lg) calc(var(--glacier-radius-lg) + 0.5em);
  //   border-start-end-radius: var(--glacier-radius-lg) calc(var(--glacier-radius-lg) + 0.5em); }
  LookRule(
    MarkdownClass.lineCodeTop,
    null,
    classes: 3,
    box: (p, e) {
      final corner = Radius.elliptical(e.t.radius('lg'), e.t.radius('lg') + p.em(0.5));
      p
        ..borderTop = p.em(0.5)
        ..paddingTop = p.em(0.55)
        ..topStart = corner
        ..topEnd = corner;
    },
  ),
  // .editor .cm-line.lineCodeFoot { border-block-end: 0.5em solid transparent; padding-block-end: 0.55em;
  //   border-end-start-radius / border-end-end-radius: the same; }
  LookRule(
    MarkdownClass.lineCodeFoot,
    null,
    classes: 3,
    box: (p, e) {
      final corner = Radius.elliptical(e.t.radius('lg'), e.t.radius('lg') + p.em(0.5));
      p
        ..borderBottom = p.em(0.5)
        ..paddingBottom = p.em(0.55)
        ..bottomStart = corner
        ..bottomEnd = corner;
    },
  ),
  // .editor .cm-line.lineHr { color: var(--glacier-text-subtle); }
  LookRule(MarkdownClass.lineHr, (p, e) => p.color = e.t.color('glacier-text-subtle'), classes: 3),

  // --- Margin (margin_marks.dart) --------------------------------------------------------------------------------

  // A line whose leading mark hangs in the column: its words start after its indent, and its mark hangs back by
  // `--hang` (the column, or the mark where it is wider). After the list's and the quote's own, which it overrides.
  LookRule(
    marginLineClass,
    null,
    classes: 5,
    box: (p, e) {
      final indent = p.element?.styleLength('--hang-indent') ?? 0;
      final quote = p.element?.has(MarkdownClass.lineQuote) ?? false;
      p
        ..paddingStart = (quote ? e.t.len('glacier-shape-accent-edge') + p.em(0.75) : e.gutter + _marks(e)) + indent
        ..textIndent = -_hang(p);
    },
  ),
  // The mark itself; and what is inside it, so a heading's own class under it does not set it large again.
  LookRule(marginMarkClass, _marginMark, classes: 2),
  LookRule.under(marginMarkClass, _marginMark, classes: 2),
  // The indent before a hung mark takes no room in the column, so every mark starts on one rail whatever its depth;
  // the words keep the indent (`--hang-indent`), so a nested item is still nested.
  LookRule(marginIndentClass, (p, e) => p..fontSize = 0.01..trackingPx(0), classes: 2),
  // Margin is set tighter than the other views (Kevin, 2026-10-28: "the line spacing feels a little too generous"):
  // the lines closer, and less room over a heading.
  LookRule('cm-line', (p, e) {
    if (_marks(e) > 0) p.lineHeight = marginLineHeight;
  }, classes: 2),
  for (final (name, space) in const <(String, int)>[(MarkdownClass.lineH1, 5), (MarkdownClass.lineH2, 5), (MarkdownClass.lineH3, 4), (MarkdownClass.lineH4, 4)])
    LookRule(name, null, classes: 3, box: (p, e) {
      if (_marks(e) > 0) p.paddingTop = e.t.space(space);
    }),
]);
