import { useEffect, useState } from 'react';
import { SheetGroup, SheetNote, SheetRow, SheetTitle } from '../kit.tsx';
import { boardFor, linkBoard, listBoards, startNotionSignIn, useNotionAccount, type Board } from './client.ts';
import { NotionMark } from './marks.tsx';

/**
 * The boards Notion let Glyph see, one to choose for a note, on the note's cog
 * sheet. Not signed in, it offers sign-in, and the list appears when Glyph
 * comes back from the browser.
 */
export function BoardPicker({ noteId, onDone }: { noteId: string; onDone: () => void }) {
  const { account, problem } = useNotionAccount();
  const [chosen, setChosen] = useState<Board | null>(() => boardFor(noteId));
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  useEffect(() => {
    if (!account?.connected) return undefined;
    let live = true;
    void listBoards().then(
      (found) => live && setBoards(found),
      (failure: unknown) => live && setTrouble(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      live = false;
    };
  }, [account?.connected]);

  const choose = (board: Board | null) => {
    linkBoard(noteId, board);
    setChosen(board);
    onDone();
  };

  if (account === null) return <SheetNote>Checking Notion…</SheetNote>;
  if (!account.connected) {
    return (
      <>
        <SheetTitle>Sign in to Notion</SheetTitle>
        {problem ? <SheetNote>{problem}</SheetNote> : null}
        <SheetNote>Notion opens in your browser and asks which boards Ghost.md may use. Pick them, then come back here.</SheetNote>
        <SheetGroup>
          <SheetRow
            icon={NotionMark}
            label="Sign in with Notion"
            onPress={() => void startNotionSignIn().catch((e: unknown) => setTrouble(e instanceof Error ? e.message : String(e)))}
          />
        </SheetGroup>
        {trouble ? <SheetNote>{trouble}</SheetNote> : null}
      </>
    );
  }
  return (
    <>
      <SheetTitle>Where tasks go</SheetTitle>
      <SheetNote>{`Boards in ${account.workspaceName || 'Notion'} that Ghost.md can see.`}</SheetNote>
      {trouble ? <SheetNote>{trouble}</SheetNote> : null}
      <SheetGroup>
        {boards === null ? (
          <SheetRow label="Looking for boards…" />
        ) : boards.length ? (
          boards.map((board) => <SheetRow key={board.id} icon={NotionMark} label={board.title} chosen={chosen?.id === board.id} onPress={() => choose(board)} />)
        ) : (
          <SheetRow label="No boards yet" hint="Sign in again from Settings > Notion and tick the boards you want." />
        )}
      </SheetGroup>
      {chosen ? (
        <SheetGroup>
          <SheetRow label="Don’t send this note to Notion" onPress={() => choose(null)} />
        </SheetGroup>
      ) : null}
    </>
  );
}
