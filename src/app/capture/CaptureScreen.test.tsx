import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, listNotes, noteTitle } from '../core/store.ts';
import { CaptureScreen } from './CaptureScreen.tsx';

const capture = vi.hoisted(() => ({
  handlers: null as { onPartial: (text: string) => void; onSegment: (segment: { text: string; startMs: number; endMs: number }) => void } | null,
  session: null as {
    kind: 'whisper';
    wantsSamples: false;
    keepsAudio: false;
    push: () => void;
    positionMs: () => number;
    stop: () => Promise<{ recordedMs: null; transcript: string }>;
    cancel: () => void;
  } | null,
}));

vi.mock('./engine.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engine.ts')>();
  return {
    ...actual,
    startCapture: vi.fn(async (handlers) => {
      capture.handlers = handlers;
      if (!capture.session) throw new Error('test capture session was not configured');
      return capture.session;
    }),
  };
});

beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.scrollTo = () => undefined;
  capture.handlers = null;
  capture.session = {
    kind: 'whisper',
    wantsSamples: false,
    keepsAudio: false,
    push: () => undefined,
    positionMs: () => 2600,
    // Native stop drains the final decode after the page has stopped receiving
    // capture://segment events. This is intentionally longer than the event.
    stop: async () => ({ recordedMs: null, transcript: 'add to the note labeled Go pack sunscreen' }),
    cancel: () => undefined,
  };
  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
});

afterEach(() => cleanup());

describe('native stop transcript handoff', () => {
  it('offers the full stop-time append to Go and never creates a note from a truncated phrase event', async () => {
    await createNote('go', 'Go');
    const onFinish = vi.fn();
    render(<CaptureScreen fromAssistant={false} onFinish={onFinish} />);

    await waitFor(() => expect(capture.handlers).not.toBeNull());
    await act(async () => {
      // The terminal words never arrive as a committed event.
      capture.handlers!.onSegment({ text: 'add to the note labeled Go pack', startMs: 0, endMs: 1800 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));

    // The full native stop result, not Take's event-only segments, reaches the
    // classifier. A confirmation is offered before any mutation happens.
    await screen.findByRole('region', { name: 'Add to Go' });
    let notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe('Go');

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));

    notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(noteTitle(notes[0]!.body)).toBe('Go');
    expect(notes[0]?.body).toContain('Pack sunscreen');
    expect(notes[0]?.body).not.toMatch(/add to the note labeled/i);
  });

  it('keeps a native-only terminal suffix when the stopped recording is an ordinary note', async () => {
    capture.session!.stop = async () => ({ recordedMs: null, transcript: 'Weekend plans include packing sunscreen' });
    const onFinish = vi.fn();
    render(<CaptureScreen fromAssistant={false} onFinish={onFinish} />);

    await waitFor(() => expect(capture.handlers).not.toBeNull());
    await act(async () => {
      capture.handlers!.onSegment({ text: 'Weekend plans include packing', startMs: 0, endMs: 1500 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));

    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    const notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toContain('sunscreen');
  });
});
