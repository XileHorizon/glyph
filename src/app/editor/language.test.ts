import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { LanguageDescription, ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { javascript } from '@codemirror/lang-javascript';
import { glyphMarkdown } from './language.ts';
import type { InlineFormat } from '../plugins/types.ts';

const spoiler: InlineFormat = { name: 'Spoiler', delimiter: '||', look: { kind: 'wisp' } };

/** JavaScript, already loaded, the way the language pack answers once it has fetched a language. */
const js = LanguageDescription.of({ name: 'JavaScript', alias: ['js'], extensions: ['js'], support: javascript() });

/** The node names in the document's syntax tree. */
function nodes(doc: string, formats: InlineFormat[] = [], codeLanguages: LanguageDescription[] = []): string[] {
  const state = EditorState.create({ doc, extensions: [glyphMarkdown(formats, codeLanguages)] });
  const names: string[] = [];
  syntaxTree(state).iterate({ enter: (node) => void names.push(node.name) });
  return names;
}

describe("the editor's markdown", () => {
  it('does not turn a line into a heading because a dash follows it', () => {
    expect(nodes('Places to go\n-')).not.toContain('SetextHeading2');
    expect(nodes('Places to go\n---')).not.toContain('SetextHeading2');
    expect(nodes('Places to go\n===')).not.toContain('SetextHeading1');
  });

  it('still makes headings from #, lists from -, and rules from ---', () => {
    expect(nodes('# Places to go')).toContain('ATXHeading1');
    expect(nodes('- snacks')).toContain('ListItem');
    expect(nodes('Places to go\n\n---')).toContain('HorizontalRule');
    expect(nodes('- [ ] Book the cabin')).toContain('TaskMarker');
  });

  it('parses a fenced block in its own language, and a fence with no language as plain code', () => {
    // The language's tree is mounted over the code text, so it is reached by resolving into it.
    const inside = (doc: string) => {
      const state = EditorState.create({ doc, extensions: [glyphMarkdown([], [js])] });
      const chain: string[] = [];
      for (let node: SyntaxNode | null = ensureSyntaxTree(state, doc.length, 5000)!.resolveInner(doc.indexOf('answer'), 1); node; node = node.parent) chain.push(node.name);
      return chain;
    };
    expect(inside('```js\nconst answer = 42; // why\n```')).toEqual(['VariableDefinition', 'VariableDeclaration', 'Script', 'FencedCode', 'Document']);
    expect(inside('```\nconst answer = 42;\n```')).toEqual(['CodeText', 'FencedCode', 'Document']);
    expect(inside('```cobol\nMOVE answer TO X.\n```')).toEqual(['CodeText', 'FencedCode', 'Document']);
  });

  it("parses a plugin's formatting between its delimiters, marks and all", () => {
    const names = nodes('The key is ||under the stone|| by the door.', [spoiler]);
    expect(names).toContain('Spoiler');
    expect(names.filter((name) => name === 'SpoilerMark')).toHaveLength(2);
    expect(nodes('||two secrets|| and ||another||', [spoiler]).filter((name) => name === 'Spoiler')).toHaveLength(2);
  });

  it('leaves a lone pipe, an unclosed run, and a longer run alone', () => {
    expect(nodes('a | b | c', [spoiler])).not.toContain('Spoiler');
    expect(nodes('||never closed', [spoiler])).not.toContain('Spoiler');
    expect(nodes('|||three|||', [spoiler])).not.toContain('Spoiler');
    expect(nodes('|| spaced out ||', [spoiler])).not.toContain('Spoiler');
  });

  it("knows nothing of a formatting whose plugin is off, and a table's pipes are still a table's", () => {
    expect(nodes('||secret||')).not.toContain('Spoiler');
    const table = nodes('| a | b |\n| - | - |\n| c || d |', [spoiler]);
    expect(table).toContain('Table');
    expect(table).not.toContain('Spoiler');
  });
});
