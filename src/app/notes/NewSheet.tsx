import { useRef, useState } from 'react';
import { Book, Link2, SquarePen, Workflow } from '@glacier/icons';
import { useBack } from '../core/back.ts';
import { SheetField, SheetGroup, SheetRow, SheetTitle } from '../plugins/kit.tsx';
import sheet from '../editor/NoteSettings.module.css';
import { useSheetDrag } from '../editor/sheetDrag.ts';

/**
 * What the + makes (Matt: "make the plus button ask if they want to create a canvas, note or memo"; memos were then
 * taken out of the app - "we're going to focus on notes and canvases"): a small sheet with the two, in the note's
 * settings' own look, from every + there is - the home dock's, the tab strip's and the sidebar's - so a + means the
 * same thing wherever it is. A tap on the scrim, the back gesture or a drag down closes it and makes nothing.
 *
 * And a copy of something shared with you (share/share.ts, docs/SHARING.md): "From a shared link" takes a link to a
 * shared note or book and saves it into this library as your own copy.
 */
export interface NewSheetProps {
  open: boolean;
  onClose: () => void;
  onNote: () => void;
  onCanvas: () => void;
  onBook: () => void;
  /** Saves a copy of a shared note or book from its link; answers nothing, or throws what went wrong. */
  onFromLink?: (link: string) => Promise<void>;
}

export function NewSheet({ open, onClose, onNote, onCanvas, onBook, onFromLink }: NewSheetProps) {
  const panel = useRef<HTMLElement>(null);
  const drag = useSheetDrag(panel, onClose);
  useBack(open, onClose);
  /** The shared link being pasted, while its field is open; null when it is not. */
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const close = () => {
    setLink(null);
    setProblem(null);
    onClose();
  };
  const fork = async () => {
    if (!onFromLink || !link?.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      await onFromLink(link.trim());
      close();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const pick = (make: () => void) => () => {
    onClose();
    make();
  };
  return (
    <div className={sheet.scrim} onClick={close}>
      <section ref={panel} className={sheet.sheet} role="dialog" aria-modal="true" aria-label="New" onClick={(e) => e.stopPropagation()}>
        <span className={sheet.grip} aria-hidden="true" {...drag} />
        <SheetTitle>New</SheetTitle>
        <SheetGroup>
          <SheetRow icon={SquarePen} label="Note" hint="A page of markdown, typed or said." onPress={pick(onNote)} />
          <SheetRow icon={Workflow} label="Canvas" hint="Cards on a page with lines between them." onPress={pick(onCanvas)} />
          <SheetRow icon={Book} label="Book" hint="Notes in an order, with an index." onPress={pick(onBook)} />
          {onFromLink && link === null ? (
            <SheetRow icon={Link2} label="From a shared link" hint="A copy of a note or book someone shared with you." onPress={() => setLink('')} />
          ) : null}
        </SheetGroup>
        {onFromLink && link !== null ? (
          <SheetGroup>
            <SheetField
              label="Shared link"
              value={link}
              autoFocus
              placeholder="Paste the link"
              autoComplete="off"
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fork();
              }}
            />
            <SheetRow icon={Link2} label={busy ? 'Saving…' : 'Save a copy'} hint={problem ?? 'Yours to change; the shared one stays as it is.'} onPress={() => void fork()} />
          </SheetGroup>
        ) : null}
      </section>
    </div>
  );
}
