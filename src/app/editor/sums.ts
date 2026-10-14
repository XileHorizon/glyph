import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * Sums (Matt picked them from the list of new formats): a line that starts with `=` works itself out.
 *
 *   = 450 + 120 * 2          → 690
 *   - = $1,200 / 3           → $400
 *
 * The answer is drawn after the line in quiet ink and is never written into the note, so the note reads the same
 * anywhere and a changed number is answered at once. Only arithmetic: numbers, `+ - * /`, `^` for powers, `%` after
 * a number for a percent, and brackets. A currency sign or thousands commas come back on the answer. Anything else - a word, a
 * sum that can't be done - draws nothing.
 */

/** The start of a line, past an indent, a bullet and a quote mark, then `=` and a space. */
const LEAD = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:>\s*)?)=\s+(.+)$/;
const CURRENCY = /[$€£¥₹]/;

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string };

function tokens(expr: string): Token[] | null {
  const out: Token[] = [];
  const text = expr.replace(/\s+/g, '');
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const number = /^[$€£¥₹]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?%?/.exec(rest);
    if (number) {
      const digits = number[1]!.replace(/,/g, '') + (number[2] ?? '');
      let value = Number(digits);
      if (number[0].endsWith('%')) value /= 100;
      out.push({ kind: 'num', value });
      i += number[0].length;
      continue;
    }
    const op = /^[-+*/^()×÷]/.exec(rest);
    if (!op) return null;
    out.push({ kind: 'op', value: op[0] === '×' ? '*' : op[0] === '÷' ? '/' : op[0] });
    i += 1;
  }
  return out;
}

/** A small precedence-climbing evaluator: no `eval`, nothing but numbers in and a number out. */
function evaluate(list: Token[]): number | null {
  let at = 0;
  const peek = () => list[at];
  const take = () => list[at++];
  const isOp = (value: string) => {
    const token = peek();
    return token?.kind === 'op' && token.value === value;
  };
  const primary = (): number | null => {
    if (isOp('-')) {
      take();
      const value = power();
      return value === null ? null : -value;
    }
    if (isOp('+')) {
      take();
      return power();
    }
    if (isOp('(')) {
      take();
      const value = sum();
      if (!isOp(')')) return null;
      take();
      return value;
    }
    const token = take();
    return token?.kind === 'num' ? token.value : null;
  };
  const power = (): number | null => {
    const base = primary();
    if (base === null) return null;
    if (!isOp('^')) return base;
    take();
    const exponent = power();
    return exponent === null ? null : base ** exponent;
  };
  const product = (): number | null => {
    let value = power();
    while (value !== null && (isOp('*') || isOp('/'))) {
      const op = (take() as { value: string }).value;
      const right = power();
      if (right === null) return null;
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number | null => {
    let value = product();
    while (value !== null && (isOp('+') || isOp('-'))) {
      const op = (take() as { value: string }).value;
      const right = product();
      if (right === null) return null;
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  const value = sum();
  return value !== null && at === list.length && Number.isFinite(value) ? value : null;
}

/** The answer to a sum as it should read, or null when the text isn't one. */
export function answer(expr: string): string | null {
  const list = tokens(expr);
  // A sum has at least one operator between numbers: `= 450` alone is a number, not a question.
  if (!list || !list.some((t) => t.kind === 'op' && t.value !== '(' && t.value !== ')')) return null;
  const value = evaluate(list);
  if (value === null) return null;
  const sign = CURRENCY.exec(expr)?.[0] ?? '';
  const grouped = /\d,\d{3}/.test(expr) || Boolean(sign);
  const rounded = Math.round(value * 100) / 100;
  const decimals = sign && !Number.isInteger(rounded) ? 2 : 0;
  const text = Math.abs(rounded).toLocaleString('en-US', {
    useGrouping: grouped,
    minimumFractionDigits: decimals,
    maximumFractionDigits: sign ? 2 : 6,
  });
  return `${rounded < 0 ? '−' : ''}${sign}${text}`;
}

/** The sum on a line, if the line is one: where its expression starts, and its answer. */
export function sumOnLine(text: string): { answer: string } | null {
  const found = LEAD.exec(text);
  if (!found) return null;
  const result = answer(found[2] ?? '');
  return result === null ? null : { answer: result };
}

class AnswerWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: AnswerWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-sumAnswer';
    span.textContent = this.text;
    span.setAttribute('aria-label', `equals ${this.text}`);
    return span;
  }
}

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    let line = state.doc.lineAt(from);
    for (;;) {
      const sum = sumOnLine(line.text);
      const inCode = sum ? /Code|FrontMatter|Comment|Math/.test(tree.resolveInner(line.from, 1).name) : false;
      if (sum && !inCode) builder.add(line.to, line.to, Decoration.widget({ widget: new AnswerWidget(sum.answer), side: 1 }));
      if (line.to >= to || line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const theme = EditorView.baseTheme({
  '.cm-sumAnswer': {
    marginInlineStart: '0.6em',
    color: 'var(--app-ink-3, currentColor)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  '.cm-sumAnswer::before': {
    content: '"→ "',
  },
});

export function sums(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorate(update.view);
        }
      },
      { decorations: (value) => value.decorations },
    ),
    theme,
  ];
}
