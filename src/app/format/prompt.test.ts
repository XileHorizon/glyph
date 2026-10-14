import { describe, expect, it } from 'vitest';
import { MODES } from './modes.ts';
import { budgetFor, ENHANCE_PROMPT, outputBudget, promptFor, SUMMARIZE_PROMPT, SYSTEM_PROMPT } from './prompt.ts';

describe('the prompts', () => {
  it('has one per mode, each keeping links as tokens and asking for markdown alone', () => {
    for (const { id } of MODES) {
      const prompt = promptFor(id);
      expect(prompt.startsWith('You are the editor inside Ghost.md')).toBe(true);
      expect(prompt).toContain('[the words](link-1)');
      expect(prompt.endsWith('no code fence around it.')).toBe(true);
    }
    expect(promptFor('format')).toBe(SYSTEM_PROMPT);
    expect(promptFor('summarize')).toBe(SUMMARIZE_PROMPT);
    expect(promptFor('enhance')).toBe(ENHANCE_PROMPT);
    expect(new Set([SYSTEM_PROMPT, SUMMARIZE_PROMPT, ENHANCE_PROMPT]).size).toBe(3);
  });

  it('gives a summary less room than the note and an enhancement more', () => {
    const chars = 2000; // about 500 tokens
    expect(budgetFor('format', chars)).toBe(outputBudget(chars));
    expect(budgetFor('summarize', chars)).toBeLessThan(budgetFor('format', chars));
    expect(budgetFor('enhance', chars)).toBeGreaterThan(budgetFor('format', chars));
    // Floors for a tiny note, ceilings for a huge one.
    expect(budgetFor('summarize', 10)).toBe(160);
    expect(budgetFor('enhance', 10)).toBe(512);
    expect(budgetFor('summarize', 100_000)).toBe(768);
    expect(budgetFor('enhance', 100_000)).toBe(4096);
  });
});
