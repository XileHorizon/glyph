import { appendBody } from './appendBody.ts';
import { placeInstruction, type InstructionArea } from './listAppend.ts';

/**
 * Quotes model-proposed user text as literal Markdown text. The visible text is
 * preserved, but model output cannot create headings, links, images, emphasis,
 * code, tables, HTML, block quotes, or list structure.
 */
export function literalMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]{}()<>#+\-.!|>]/g, '\\$&');
}

export function listTitle(heard: string): string {
  const title = heard.trim();
  return title === title.toLowerCase() ? title.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`) : title;
}

export function instructionCreateBody(title: string, content: string | null): string {
  const safeTitle = literalMarkdown(title.trim());
  const safeContent = content === null ? null : literalMarkdown(content.trim());
  return `${safeTitle}${safeContent ? `\n\n${safeContent}` : ''}`;
}

export interface SameNoteInstructionPreview {
  /** Exact draft body/revision content used by compare-and-swap. */
  beforeBody: string;
  /** Exact command result, including the capture transcript already saved. */
  afterBody: string;
  /** New stable base beneath this capture's transcript for later autosaves. */
  baseAfter: string;
  captureMarkdown: string;
  added: string[];
}

/**
 * Applies an inferred append to the stable body below an active capture, then
 * reconstructs the full draft. Keeping baseAfter separate is the key handoff:
 * later autosaves append the transcript once, rather than restoring the old
 * base or duplicating words already captured.
 */
export function previewSameNoteInstruction(
  baseBefore: string,
  captureMarkdown: string,
  content: string,
  placement: InstructionArea,
): SameNoteInstructionPreview {
  const placed = placeInstruction(baseBefore, literalMarkdown(content), placement);
  return {
    beforeBody: appendBody(baseBefore, captureMarkdown),
    afterBody: appendBody(placed.body, captureMarkdown),
    baseAfter: placed.body,
    captureMarkdown,
    added: placed.added,
  };
}

/** Compose a later capture draft from the post-command base without loss or duplication. */
export function resumeSameNoteCapture(baseAfter: string, captureMarkdown: string): string {
  return appendBody(baseAfter, captureMarkdown);
}
