import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The build stamps vite.config.ts defines; tests get fixed stand-ins.
  define: {
    __GLYPH_BUILD__: JSON.stringify('20260101000000'),
    __GLYPH_VERSION__: JSON.stringify('0.0.0-test'),
    __GLYPH_SOURCE__: JSON.stringify('test-source'),
    __GLYPH_STAGING__: JSON.stringify(false),
  },
  test: {
    environment: 'jsdom',
    // The test report's parsers are tested with the page (scripts/testReport).
    include: ['src/**/*.test.{ts,tsx}', 'mcp/**/*.test.ts', 'scripts/**/*.test.mjs'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
    /*
     * The first test of a file that mounts an editor is a cold CodeMirror render: about four seconds on this Mac
     * idle, and past the default five with a second suite or a cargo build on the machine - three such tests timed
     * out and refused a deploy at its test step with everything else green. Re-proven after 1.5.0-68: the same
     * three took 8.2, 10.0 and 10.1 seconds under twelve yes-hogs, so fifteen held by a third and no more. A render
     * slowed by load still passes at this; a test that has really hung still fails at it.
     */
    testTimeout: 20000,
  },
});
