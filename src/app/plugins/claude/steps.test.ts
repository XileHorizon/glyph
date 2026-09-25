import { describe, expect, it } from 'vitest';
import { CAN_DO, guides, LOCAL_FILE_URL, MCP_URL } from './steps.ts';

describe('the words of Settings › Claude', () => {
  it('points Claude at the MCP server beside this build’s sync service, and at the one-file server published beside the app', () => {
    expect(MCP_URL).toMatch(/\/glyph\/api\/mcp$/);
    expect(LOCAL_FILE_URL).toMatch(/\/glyph\/mcp\/glyph-mcp\.mjs$/);
    expect(new URL(MCP_URL).origin).toBe(new URL(LOCAL_FILE_URL).origin);
  });

  it('has the hosted way carry the address and the Claude Code line, and the local way the file, the sign-in and the way out', () => {
    const [hosted, local] = guides(null);
    expect(hosted!.steps[0]!.snippets).toEqual([MCP_URL, `claude mcp add --transport http glyph ${MCP_URL}`]);
    expect(hosted!.steps.map((s) => s.title)).toContain('To end it');
    const local0 = local!.steps[0]!.snippets![0]!;
    expect(local0).toContain(LOCAL_FILE_URL);
    expect(local!.steps.flatMap((s) => s.snippets ?? []).some((s) => s.endsWith('logout'))).toBe(true);
  });

  it('fills the sign-in command with the handle this device is signed in with, or leaves a blank to fill', () => {
    const signIn = (handle: string | null) => guides(handle)[1]!.steps[1]!.snippets![0];
    expect(signIn('matt')).toBe('node ~/glyph-mcp.mjs login matt');
    expect(signIn(null)).toBe('node ~/glyph-mcp.mjs login <your handle>');
  });

  it('says what the eight tools do, one row each', () => {
    expect(CAN_DO).toHaveLength(8);
    expect(new Set(CAN_DO.map((t) => t.name)).size).toBe(8);
  });
});
