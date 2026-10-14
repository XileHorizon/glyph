import { useEffect, useState } from 'react';
import { SquareKanban } from '@glacier/icons';
import { PaneSection, RowAction, SettingRow, SettingsCallout, SettingsEmpty, SettingsFootnote } from '../../settings/kit/settingsKit.tsx';
import { isTauri } from '../../core/tauri.ts';
import { forgetTaskDetails } from './details.ts';
import { disconnectNotion, listBoards, notionAvailable, startNotionSignIn, useNotionAccount, type Board } from './client.ts';

/**
 * The Notion plugin's page in Settings: signing in, and the boards Glyph can
 * send tasks to.
 *
 * One card says whether Glyph is signed in and to which workspace, with Sign
 * in or Sign out. Signing in opens Notion in the browser, where the person
 * picks the pages and boards Glyph may use; coming back to Glyph collects the
 * sign-in by itself. A second card lists the boards that were shared, so it is
 * plain whether the board a note should send to is one of them. Which note
 * sends to which board is chosen on the note, from its cog.
 */
export function NotionPane() {
  const { account, problem, refresh } = useNotionAccount();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  useEffect(() => {
    void notionAvailable().then(setAvailable);
  }, []);

  useEffect(() => {
    if (!account?.connected) {
      setBoards(null);
      return;
    }
    setWaiting(false);
    let live = true;
    void listBoards().then(
      (found) => live && setBoards(found),
      (failure: unknown) => live && setTrouble(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      live = false;
    };
  }, [account?.connected]);

  if (available === false) {
    return isTauri() ? (
      <SettingsEmpty
        icon={<SquareKanban size={22} />}
        title="Notion needs the newest Ghost.md."
        body="Install the latest version from Settings > Updates, then come back here to sign in."
      />
    ) : (
      <SettingsEmpty icon={<SquareKanban size={22} />} title="Notion works in the app." body="Sign in from Ghost.md on your phone, where your sign-in can be kept safe." />
    );
  }

  const signIn = async () => {
    setTrouble(null);
    try {
      await startNotionSignIn();
      setWaiting(true);
    } catch (failure) {
      setTrouble(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <>
      {problem || trouble ? <SettingsCallout>{problem ?? trouble}</SettingsCallout> : null}

      <PaneSection title="Account" description="Ghost.md sends list items to your Notion boards as tasks. Nothing else in your notes goes to Notion.">
        {account?.connected ? (
          <SettingRow
            label={`Signed in to ${account.workspaceName || 'Notion'}`}
            hint="To give Ghost.md more boards, sign in again and pick them."
            control={
              <RowAction
                onPress={() => {
                  forgetTaskDetails();
                  void disconnectNotion().then(refresh);
                }}
              >
                Sign out
              </RowAction>
            }
          />
        ) : (
          <SettingRow
            label={waiting ? 'Finish signing in on Notion' : 'Not signed in'}
            hint={waiting ? 'Pick the boards Ghost.md can use, then come back here.' : 'Notion opens in your browser and asks which pages and boards Ghost.md may use.'}
            control={<RowAction onPress={() => void signIn()}>{waiting ? 'Open again' : 'Sign in'}</RowAction>}
          />
        )}
      </PaneSection>

      {account?.connected ? (
        <PaneSection title="Boards" description="The boards Notion let Ghost.md see. Link one to a note from the cog on that note.">
          {boards === null ? (
            <SettingRow label="Looking for boards…" />
          ) : boards.length ? (
            boards.map((board) => <SettingRow key={board.id} icon={<SquareKanban size={16} />} label={board.title} hint={`Tasks are named by “${board.titleProperty}”.`} />)
          ) : (
            <SettingRow label="No boards shared yet" hint="Sign in again and tick the boards you want on Notion's page." />
          )}
        </PaneSection>
      ) : null}

      <SettingsFootnote>Signing in goes through attack.fm to finish the handshake with Notion. Your notes never do.</SettingsFootnote>
    </>
  );
}
