import '@testing-library/jest-dom/vitest';

/*
 * jsdom has no layout: CodeMirror measures its text by asking ranges for rectangles, and a measure scheduled on the
 * animation clock can fire after the test that made the view has finished - an uncaught TypeError that failed no
 * test and still made Vitest exit 1, which stopped a deploy at its test step with every test green.
 */
// Only where there is a document: the files that run under `@vitest-environment node` (the MCP server's, the live
// relay's) have no Range, and a bare reference threw before any of their tests could run.
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
