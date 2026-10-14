import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SideKeyWaves } from './SideKeyWaves.tsx';
import { COMMON } from './sideKeys.ts';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  // No canvas in this document: the layer mounts empty and must not mind.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

function show(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('the waves from the side key', () => {
  it('sit on the edge the key is on, as far down the screen as the key is down the phone', () => {
    const shown = show(<SideKeyWaves spot={{ ...COMMON, edge: 'right', at: 0.42 }} />);
    const waves = shown.querySelector<HTMLCanvasElement>('[data-testid="side-key-waves"]');
    expect(waves?.tagName).toBe('CANVAS');
    expect(waves?.dataset.edge).toBe('right');
    expect(waves?.style.getPropertyValue('--at')).toBe('41.6%');
    expect(waves?.getAttribute('aria-hidden')).toBe('true');
  });

  it('take the left edge when the key is there', () => {
    const shown = show(<SideKeyWaves spot={{ ...COMMON, edge: 'left', at: 0.3 }} />);
    expect(shown.querySelector<HTMLElement>('[data-testid="side-key-waves"]')?.dataset.edge).toBe('left');
  });

  it('find a spot for this browser on their own, and leave cleanly', () => {
    const shown = show(<SideKeyWaves />);
    const waves = shown.querySelector<HTMLElement>('[data-testid="side-key-waves"]');
    expect(waves?.dataset.edge).toBe('right');
    expect(waves?.style.getPropertyValue('--at')).toMatch(/^\d+(\.\d)?%$/);
    expect(() => act(() => root?.unmount())).not.toThrow();
  });
});
