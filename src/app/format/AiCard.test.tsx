import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AiCard } from './AiCard.tsx';

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

describe('the AI card', () => {
  it('names the model, says it runs on the phone, and what it is doing', () => {
    const card = show(<AiCard model="qwen3.5-4b" phase="prefill" doing="Formatting" promptTokens={684} promptTokensDone={256} outputTokens={0} tokensPerSecond={0} elapsedMs={4000} />);
    expect(card.textContent).toContain('Qwen3.5 4B');
    expect(card.textContent).toContain('On this phone');
    expect(card.textContent).toContain('Reading the note, 256 of 684.');
    expect(card.textContent).toContain('Nothing leaves the phone.');
    expect(card.querySelectorAll('dt').length).toBeGreaterThan(0);
  });

  it('shows the engine’s readings when a binary reports them, with bars for the shares', () => {
    const hardware = { rssBytes: 3.1e9, freeBytes: 5e9, totalBytes: 12e9, cpuPercent: 640, threads: 6, cores: 8, tempC: 41 };
    const card = show(<AiCard model="qwen3.5-2b" phase="generating" doing="Summarizing" promptTokens={100} promptTokensDone={100} outputTokens={42} tokensPerSecond={7.3} elapsedMs={32000} hardware={hardware} />);
    const text = card.textContent ?? '';
    expect(text).toContain('Summarizing, 7.3 tokens a second, 0:32.');
    expect(text).toContain('6 of 8');
    expect(text).toContain('640%');
    expect(text).toContain('3.1 GB of 12.0 GB');
    expect(text).toContain('41 °C');
    expect(text).toContain('42 tokens');
    const bars = [...card.querySelectorAll('dd span')].map((s) => (s as HTMLElement).style.inlineSize);
    expect(bars).toContain('80%'); // 640 of 800
    expect(bars).toContain('75%'); // 6 of 8
  });

  it('leaves out what nothing reports', () => {
    const card = show(<AiCard model="qwen3.5-4b" phase="loading" doing="Enhancing" promptTokens={0} promptTokensDone={0} outputTokens={0} tokensPerSecond={0} elapsedMs={0} />);
    expect(card.textContent).not.toContain('CPU');
    expect(card.textContent).not.toContain('°C');
    expect(card.textContent).toContain('Loading Qwen3.5 4B.');
  });
});
