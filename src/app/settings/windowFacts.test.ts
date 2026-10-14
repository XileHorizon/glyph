import { describe, expect, it } from 'vitest';
import { windowFacts } from './windowFacts.ts';

/**
 * The Developer page's Window facts, read off jsdom: an inset the page is not given reads as 0px rather than as the
 * words of the variable, and the engine is named from the agent string without a version being made up.
 */
describe('windowFacts', () => {
  it('reads the top inset as a length, the page and screen as sizes, and names the engine', () => {
    const facts = windowFacts();
    expect(facts.inset).toMatch(/px$/);
    expect(facts.page).toMatch(/^\d+ × \d+ @[\d.]+$/);
    expect(facts.screen).toMatch(/^\d+ × \d+$/);
    // jsdom's agent string carries no Chrome, so the engine is the WebKit it does name.
    expect(facts.engine).toBe('AppleWebKit/537.36');
  });

  it('names a WebView by its Chrome, and marks it a WebView', () => {
    const was = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 16; SM-F976B Build/BP2A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.51 Mobile Safari/537.36 wv', configurable: true });
    try {
      expect(windowFacts().engine).toBe('Chrome 140.0.7339.51 (WebView)');
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: was, configurable: true });
    }
  });
});
