import { useState } from 'react';
import { BookOpen, Bot, KeyRound, Laptop, Link2 } from '@glacier/icons';
import { useAccount } from '../../core/account/account.ts';
import { PaneHero, PaneSection, RowAction, SettingRow, SettingsCallout, SettingsFootnote } from '../../settings/kit/settingsKit.tsx';
import { ClaudeGuide } from './ClaudeGuide.tsx';
import { CAN_DO, MCP_URL, type Way } from './steps.ts';

/**
 * Settings › Claude: Claude on your notes, through the MCP server (docs/MCP.md). What it is, the address Claude
 * connects to with a Copy, the instructions drawer (ClaudeGuide.tsx) for either way in, what Claude can do once it is
 * connected, and where the key lives - said here because it is the one thing a person should know before they sign
 * in on the page Claude opens.
 */
export function ClaudePane() {
  const account = useAccount();
  const handle = account.session?.handle ?? null;
  const [guide, setGuide] = useState<Way | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <>
      <PaneSection>
        <PaneHero glyph={<Bot size={22} />} title="Claude, on your notes" meta="Read, add to and change your notes from Claude, on any device you use it from. A note it makes or changes arrives here at the next sync, as one typed on a phone would." />
      </PaneSection>

      <PaneSection title="Connect" description="Two ways in: hosted, with nothing to install; or a file on your own computer, which keeps your key there.">
        <SettingRow icon={<BookOpen size={16} />} label="How to connect" hint="The steps, for claude.ai, Claude Desktop and Claude Code." onPress={() => setGuide('hosted')} />
        <SettingRow
          icon={<Link2 size={16} />}
          label="Server address"
          hint={MCP_URL}
          control={
            <RowAction
              onPress={() => {
                void navigator.clipboard?.writeText(MCP_URL);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </RowAction>
          }
        />
        <SettingRow icon={<Laptop size={16} />} label="On your own computer" hint="One file, run with Node. Your key never leaves the machine." onPress={() => setGuide('local')} />
      </PaneSection>

      <PaneSection title="What Claude can do" description="Ask in words. Behind them are eight tools, and every one reads your notes fresh before it acts, so Claude sees what your phone last wrote.">
        {CAN_DO.map((tool) => (
          <SettingRow key={tool.name} label={tool.name} hint={tool.words} />
        ))}
      </PaneSection>

      <PaneSection title="Your key">
        <SettingsCallout icon={<KeyRound size={18} />}>
          Your notes are end-to-end encrypted, so whatever reads them holds your account key. Hosted, Ghost.md’s server keeps it in memory only while Claude is connected, never on disk, and forgets it when
          you disconnect or after a week unused. On your own computer, it never leaves the machine.
        </SettingsCallout>
      </PaneSection>

      <SettingsFootnote>
        Claude sees the words of the notes it reads, as it sees anything you paste into it. It cannot delete a note: it can archive one, which you can undo here. This plugin’s switch shows or hides
        this page; connecting and disconnecting Claude is done in Claude.
        {handle ? ` Signed in here as ${handle}; the same handle and password sign Claude in.` : ' Sign in to an account first: Claude connects to the same one.'}
      </SettingsFootnote>

      <ClaudeGuide way={guide} handle={handle} onClose={() => setGuide(null)} />
    </>
  );
}
