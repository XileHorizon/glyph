import { describe, expect, it } from 'vitest';
import { diagramsIn } from './mermaid.ts';

describe('mermaid fences in a note', () => {
  it('finds a fence and hands back what is between its lines', () => {
    const note = ['# Launch', '', '```mermaid', 'flowchart TD', '  A[Write it] --> B[Ship it]', '```', '', 'and then home', ''].join('\n');
    expect(diagramsIn(note)).toEqual([{ from: 3, to: 6, code: 'flowchart TD\n  A[Write it] --> B[Ship it]' }]);
  });

  it('takes the word however it is written, and squiggles as readily as backticks', () => {
    expect(diagramsIn('```Mermaid\nflowchart TD\n```')[0]?.code).toBe('flowchart TD');
    expect(diagramsIn('~~~mermaid\nflowchart TD\n~~~')[0]?.code).toBe('flowchart TD');
    expect(diagramsIn('````mermaid\nflowchart TD\n````')[0]?.code).toBe('flowchart TD');
  });

  it('leaves every other fence alone', () => {
    expect(diagramsIn('```js\nconst a = 1;\n```')).toEqual([]);
    expect(diagramsIn('```board\nTo do: a\n```')).toEqual([]);
    expect(diagramsIn('```\nplain\n```')).toEqual([]);
    // The word has to be the whole info string: a note about mermaids is not a diagram.
    expect(diagramsIn('```mermaid charts\nflowchart TD\n```')).toEqual([]);
  });

  it('reads several in one note, and skips a fence that never closes', () => {
    const two = ['```mermaid', 'flowchart TD', '```', 'words', '```mermaid', 'sequenceDiagram', '```'].join('\n');
    expect(diagramsIn(two).map((found) => found.code)).toEqual(['flowchart TD', 'sequenceDiagram']);
    expect(diagramsIn('```mermaid\nflowchart TD')).toEqual([]);
  });

  it('does not take the inside of a diagram for another one', () => {
    const nested = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', '```mermaid', 'flowchart LR', '```'].join('\n');
    expect(diagramsIn(nested).length).toBe(2);
    expect(diagramsIn(nested)[1]).toEqual({ from: 6, to: 8, code: 'flowchart LR' });
  });
});
