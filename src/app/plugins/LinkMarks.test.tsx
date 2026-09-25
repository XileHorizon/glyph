import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { addWorkspace, fileNote, removeWorkspace, setWorkspaceHue, workspaces } from '../core/workspaces.ts';
import { LinkMarks } from './LinkMarks.tsx';

vi.mock('./registry.ts', () => ({ useNoteLinks: () => [] }));

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
  for (const w of workspaces().list) removeWorkspace(w.id);
});

describe('the workspace on the note', () => {
  it('wears the workspace the note is filed in as a pill in its hue, first in the row, and opens the cog on a tap', () => {
    const cabin = addWorkspace('Cabin', 'moss')!;
    fileNote('n1', cabin.id);
    const onPress = vi.fn();
    const shown = show(<LinkMarks noteId="n1" onPress={onPress} />);
    const pill = shown.querySelector('[data-hue]') as HTMLElement;
    expect(pill.textContent).toBe('Cabin');
    expect(pill.getAttribute('data-hue')).toBe('moss');
    const row = shown.querySelector('button')!;
    expect(row.getAttribute('aria-label')).toBe('In the workspace Cabin. Change in this note’s settings.');
    act(() => row.click());
    expect(onPress).toHaveBeenCalledTimes(1);
    // Filed elsewhere, or its hue changed, the pill follows.
    act(() => setWorkspaceHue(cabin.id, 'rose'));
    expect(shown.querySelector('[data-hue]')?.getAttribute('data-hue')).toBe('rose');
    act(() => fileNote('n1', null));
    expect(shown.querySelector('[data-hue]')).toBeNull();
    expect(shown.querySelector('button')).toBeNull();
  });

  it('says nothing on a note in no workspace with no links, and stays the marks alone on a list row', () => {
    expect(show(<LinkMarks noteId="n2" onPress={() => {}} />).children).toHaveLength(0);
    const cabin = addWorkspace('Cabin')!;
    fileNote('n3', cabin.id);
    expect(show(<LinkMarks noteId="n3" compact />).querySelector('[data-hue]')).toBeNull();
  });
});
