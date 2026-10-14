import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ClaudePane } from './ClaudePane.tsx';
import { MCP_URL } from './steps.ts';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const written: string[] = [];

function show(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Connecting Claude"]');
const press = (element: Element | null | undefined) => act(() => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const buttonSaying = (within: ParentNode, words: string) => Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.includes(words));

beforeEach(() => {
  written.length = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => (written.push(text), Promise.resolve()) } });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('Settings › Claude', () => {
  it('says the address Claude connects to, and copies it', () => {
    const pane = show(<ClaudePane />);
    expect(pane.textContent).toContain(MCP_URL);
    press(buttonSaying(pane, 'Copy'));
    expect(written).toEqual([MCP_URL]);
    expect(buttonSaying(pane, 'Copied')).toBeTruthy();
  });

  it('opens the instructions drawer on the hosted way, with the Claude Code line to copy, and closes on Escape', () => {
    const pane = show(<ClaudePane />);
    expect(dialog()).toBeNull();
    press(buttonSaying(pane, 'How to connect'));
    const card = dialog();
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain(`claude mcp add --transport http glyph ${MCP_URL}`);
    expect(card!.textContent).toContain('Sign in on the page that opens');
    // A Copy on a snippet copies that snippet, and says so for a moment.
    const copies = Array.from(card!.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy"]'));
    press(copies[1]);
    expect(written).toEqual([`claude mcp add --transport http glyph ${MCP_URL}`]);
    expect(card!.querySelector('button[aria-label="Copied"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it('opens on the local way from its own row, with the file, the sign-in and the way out', () => {
    const pane = show(<ClaudePane />);
    press(buttonSaying(pane, 'On your own computer'));
    const card = dialog();
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('glyph-mcp.mjs login');
    expect(card!.textContent).toContain('glyph-mcp.mjs logout');
    expect(card!.textContent).not.toContain('--transport http');
    // The segments switch ways without closing.
    press(buttonSaying(card!, 'Hosted'));
    expect(dialog()!.textContent).toContain('--transport http');
    // The close closes.
    press(card!.querySelector('button[aria-label="Close"]'));
    expect(dialog()).toBeNull();
  });
});
