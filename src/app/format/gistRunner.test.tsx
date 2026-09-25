import { beforeEach, describe, expect, it, vi } from 'vitest';

// A phone, as far as the modules loaded underneath are concerned: any native command answers like a current binary.
vi.mock('../core/tauri.ts', () => ({ isTauri: () => true, invoke: vi.fn(async () => ({ nativeGeneration: 14, nativeVersion: '1.2.0', present: false })) }));
vi.mock('../core/ai.ts', async () => {
  const actual = await vi.importActual<typeof import('../core/ai.ts')>('../core/ai.ts');
  return {
    ...actual,
    listModels: vi.fn(async () => [{ id: 'qwen3.5-2b', present: true }, { id: 'qwen3.5-4b', present: true }]),
    generate: vi.fn((options: { prompt: string; model: string; maxTokens: number }) => ({
      done: Promise.resolve({ text: `# Gist of ${options.prompt.split('\n')[0]}.\n`, ms: 5, truncated: false, outputTokens: 6, thinking: false }),
      cancel: () => undefined,
    })),
  };
});

import { generate, listModels } from '../core/ai.ts';
import { bodyHash } from './formatter.ts';
import { gistFor, runGists, useGists } from './gist.ts';
import { readGist } from './results.ts';

describe('the gist runner', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(generate).mockClear();
  });

  it('writes a gist for a note the home page showed, with the smallest model, and keeps it against the body', async () => {
    // useGists is a hook; its module-level list of bodies is what the runner reads, so seed it the way the page would.
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const host = document.createElement('div');
    const root = createRoot(host);
    const notes = [{ id: 'n1', body: 'things for tomorrow\n- milk\n', updatedAt: 2 }, { id: 'n2', body: '', updatedAt: 1 }] as never[];
    function Home() {
      useGists(notes);
      return null;
    }
    act(() => root.render(<Home />));
    await runGists();
    expect(listModels).toHaveBeenCalled();
    expect(vi.mocked(generate).mock.calls[0]?.[0]).toMatchObject({ model: 'qwen3.5-2b', maxTokens: 40 });
    expect(readGist('n1')).toMatchObject({ text: 'Gist of things for tomorrow', for: bodyHash('things for tomorrow\n- milk\n'), model: 'qwen3.5-2b', head: 'things for tomorrow' });
    expect(gistFor('n1', 'things for tomorrow\n- milk\n')).toBe('Gist of things for tomorrow');
    // The empty note is never asked about, and a note with a gist is not asked twice.
    await runGists();
    expect(vi.mocked(generate)).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
