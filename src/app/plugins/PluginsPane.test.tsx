import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PluginsPane } from './PluginsPane.tsx';
import { reachLine } from './reach.ts';
import { manifest as claude } from './claude/index.tsx';
import { manifest as notion } from './notion/manifest.ts';

// The Glacier kit reads matchMedia as it loads; jsdom has none. Hoisted, so it is there before the imports run.
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

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

const press = (element: Element | null | undefined) => act(() => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const cardOf = (pane: ParentNode, name: string) => Array.from(pane.querySelectorAll('section')).find((s) => s.querySelector('.setk-hero__title')?.textContent === name);
const buttonSaying = (within: ParentNode, words: string) => Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.trim() === words);

describe('Settings › Plugins', () => {
  it('has a card for every plugin that ships, Claude among them, each with its switch', () => {
    const pane = show(<PluginsPane />);
    const names = Array.from(pane.querySelectorAll('.setk-hero__title')).map((t) => t.textContent);
    expect(names).toEqual(['Plugins', 'Notion', 'GitHub', 'Marks', 'Claude']);
    expect(pane.querySelector('[aria-label="Claude plugin"]')).not.toBeNull();
    expect(pane.textContent).toContain('4 of 4 on');
  });

  it('says what a plugin may reach in one line, and the reasons a press away', () => {
    expect(reachLine(notion)).toBe('Your notes · The internet (api.notion.com, attack.fm) · Voice commands · Built-in app commands');
    expect(reachLine(claude)).toBe('Your notes · The internet (attack.fm)');
    const pane = show(<PluginsPane />);
    const card = cardOf(pane, 'Claude')!;
    expect(card.textContent).toContain(reachLine(claude));
    expect(card.textContent).not.toContain(claude.permissions[0]!.why);
    press(buttonSaying(card, 'Why'));
    expect(card.textContent).toContain(claude.permissions[0]!.why);
    expect(buttonSaying(card, 'Less')).toBeTruthy();
  });

  it('opens a plugin’s own page from its card', () => {
    const opened: string[] = [];
    const pane = show(<PluginsPane onOpen={(id) => opened.push(id)} />);
    const card = cardOf(pane, 'Claude')!;
    press(Array.from(card.querySelectorAll('button.setk-row--press')).find((b) => b.textContent?.includes('Read and write your notes from Claude')));
    expect(opened).toEqual(['plugin:claude']);
  });
});
