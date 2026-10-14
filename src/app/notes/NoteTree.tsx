import { Ghost } from '../art/Ghost.tsx';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Archive, Book, ChevronRight, ChevronsDownUp, ChevronsUpDown, Ellipsis, FolderPlus, Mic, RotateCcw, Search, Settings, SquarePen, Trash2, X } from '@glacier/icons';
import { noteTitle, type Note } from '../core/store.ts';
import { useWorkspaces, type Workspace } from '../core/workspaces.ts';
import { bookIndex, placeOf } from '../book/book.ts';
import { NotePeek } from './NotePeek.tsx';
import { WorkspaceSheet } from './WorkspaceSheet.tsx';
import { ARCHIVE_FOLDER, noteTree, readClosed, readTrashOpen, writeClosed, writeTrashOpen } from './tree.ts';
import styles from './NoteTree.module.css';

/**
 * The sidebar: one tree of notes, the same whether it sits beside the note on a desktop or opens over it on a phone
 * (Matt: "Make the sidebar on desktop the same sidebar that shows up in the pop-up sidebar. Make it more similar to the
 * obsidian sidebar"). It was two things - the whole home list squeezed into a column on the desktop, and a flat list
 * in the pop-up - that did the same job differently.
 *
 * Shaped like Obsidian's file explorer: a row of small tools across the top, the workspaces as folders that fold shut,
 * the notes filed in none below them, and the archive as a last folder that starts shut. Each note keeps its drawing
 * underneath its name (Matt chose the full preview over Obsidian's bare names), and the open one wears a ring rather
 * than a fill, so what is drawn inside it sits on the same paper as everywhere else.
 *
 * `onClose` makes it the pop-up: a close button joins the tools. `notices` is what the desktop sidebar must still
 * carry now that it is no longer the home list - an update waiting, a memo waiting - since there is no other screen
 * on a desktop to show them. They sit at the bottom, over the foot.
 */

export interface NoteTreeProps {
  notes: Note[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onCommands?: () => void;
  onSettings?: () => void;
  onSpeak?: () => void;
  onClose?: () => void;
  notices?: ReactNode;
  /** The notes in the trash (core/trash.ts), newest first, and what can be done with them. */
  trashed?: Note[];
  onRestore?: (note: Note) => void;
  onDestroy?: (note: Note) => void;
  onEmptyTrash?: () => void;
}

function Tool({ label, onClick, children, end }: { label: string; onClick: () => void; children: ReactNode; end?: boolean }) {
  return (
    <button type="button" className={styles.tool} data-end={end || undefined} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

export function NoteTree({
  notes,
  activeId,
  onOpen,
  onNew,
  onCommands,
  onSettings,
  onSpeak,
  onClose,
  notices,
  trashed = [],
  onRestore,
  onDestroy,
  onEmptyTrash,
}: NoteTreeProps) {
  const spaces = useWorkspaces();
  const tree = useMemo(() => noteTree(notes, spaces), [notes, spaces]);
  const [closed, setClosed] = useState<Set<string>>(readClosed);
  const [manage, setManage] = useState<Workspace | 'new' | null>(null);

  const setAndKeep = (next: Set<string>) => {
    writeClosed(next);
    setClosed(next);
  };
  const toggle = (id: string) => {
    const next = new Set(closed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAndKeep(next);
  };
  const every = [...tree.folders.map((folder) => folder.id), ...(tree.archived.length ? [ARCHIVE_FOLDER] : [])];
  const allShut = every.length > 0 && every.every((id) => closed.has(id));
  const shutOrOpenAll = () => setAndKeep(allShut ? new Set() : new Set(every));

  /** Every page's book, for the rows' marks (book/book.ts). */
  const inBooks = useMemo(() => bookIndex(notes), [notes]);

  const row = (note: Note) => {
    const title = noteTitle(note.body);
    const place = placeOf(inBooks, note);
    return (
      <li key={note.id}>
        <button
          type="button"
          className={styles.row}
          data-active={note.id === activeId || undefined}
          aria-current={note.id === activeId ? 'page' : undefined}
          onClick={() => onOpen(note.id)}
          // A row can be dragged onto a canvas, where it becomes a card of that note (canvas/CanvasView.tsx; Matt's
          // choice 8: "drag a note from the sidebar on a wide screen"). The title travels as text, so anything else
          // that takes a drop gets the note's name and nothing stranger.
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-glyph-note', note.id);
            event.dataTransfer.setData('text/plain', title || 'Untitled');
            event.dataTransfer.effectAllowed = 'copy';
          }}
        >
          <span className={styles.rowTitle} data-untitled={title ? undefined : ''}>
            {title || 'Untitled'}
          </span>
          {/* A page of a book says which (docs/BOOKS.md): the mark, and the book's name. */}
          {place ? (
            <span className={styles.rowBook} title={`Page ${place.at + 1} of ${place.title}`}>
              <Book size={12} aria-hidden="true" />
              <span className={styles.rowBookName}>{place.title}</span>
            </span>
          ) : null}
          <NotePeek body={note.body} className={styles.rowPeek} />
        </button>
      </li>
    );
  };

  const folder = (id: string, name: ReactNode, count: number, children: Note[], extra?: { hue?: string; space?: Workspace; icon?: ReactNode }) => {
    const open = !closed.has(id);
    return (
      <li key={id} className={styles.folder}>
        <div className={styles.folderRow}>
          <button type="button" className={styles.folderToggle} aria-expanded={open} onClick={() => toggle(id)}>
            <ChevronRight className={styles.chevron} data-open={open || undefined} size={15} strokeWidth={2.2} aria-hidden="true" />
            {extra?.icon ?? <span className={styles.hue} data-hue={extra?.hue ?? 'ink'} aria-hidden="true" />}
            <span className={styles.folderName}>{name}</span>
            <span className={styles.count}>{count}</span>
          </button>
          {extra?.space ? (
            <button type="button" className={styles.folderMore} onClick={() => setManage(extra.space ?? null)} aria-label={`Rename, recolour or remove ${extra.space.name}`}>
              <Ellipsis size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {open ? (
          children.length ? (
            <ul className={styles.inside}>{children.map(row)}</ul>
          ) : (
            <p className={styles.emptyFolder}>Nothing here yet.</p>
          )
        ) : null}
      </li>
    );
  };

  /*
   * The trash (Matt: "Send deleted notes to a trash folder where we can empty it to perma delete notes or restore
   * notes"): last, under the archive, and shut until opened. A note in it is not opened from here - it has been thrown
   * away - but brought back, or deleted for good. Emptying asks once, on the button itself: the first press turns it
   * into the question, a second press within a few seconds answers it. A dialog for it would be the only one in the
   * app; deleting one note for good needs no question, since it has an Undo.
   */
  const [trashOpen, setTrashOpen] = useState(readTrashOpen);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return undefined;
    const timer = window.setTimeout(() => setAsking(false), 4000);
    return () => window.clearTimeout(timer);
  }, [asking]);
  const trashFolder = trashed.length ? (
    <li key="trash" className={styles.folder}>
      <div className={styles.folderRow}>
        <button
          type="button"
          className={styles.folderToggle}
          aria-expanded={trashOpen}
          onClick={() => {
            writeTrashOpen(!trashOpen);
            setTrashOpen(!trashOpen);
          }}
        >
          <ChevronRight className={styles.chevron} data-open={trashOpen || undefined} size={15} strokeWidth={2.2} aria-hidden="true" />
          <Trash2 className={styles.archiveIcon} size={14} strokeWidth={2.1} aria-hidden="true" />
          <span className={styles.folderName}>Trash</span>
          <span className={styles.count}>{trashed.length}</span>
        </button>
        {onEmptyTrash ? (
          <button
            type="button"
            className={styles.emptyTrash}
            data-asking={asking || undefined}
            onClick={() => {
              if (!asking) return setAsking(true);
              setAsking(false);
              onEmptyTrash();
            }}
          >
            {asking ? `Delete ${trashed.length} for good?` : 'Empty'}
          </button>
        ) : null}
      </div>
      {trashOpen ? (
        <ul className={styles.inside}>
          {trashed.map((note) => {
            const title = noteTitle(note.body);
            return (
              <li key={note.id} className={styles.trashRow}>
                <span className={styles.rowTitle} data-untitled={title ? undefined : ''}>
                  {title || 'Untitled'}
                </span>
                {onRestore ? (
                  <button type="button" className={styles.trashAction} onClick={() => onRestore(note)} aria-label={`Restore ${title || 'Untitled'}`} title="Restore">
                    <RotateCcw size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                ) : null}
                {onDestroy ? (
                  <button type="button" className={styles.trashAction} data-danger onClick={() => onDestroy(note)} aria-label={`Delete ${title || 'Untitled'} for good`} title="Delete for good">
                    <X size={15} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  ) : null;

  const nothing = !notes.length && !trashed.length;
  return (
    <div className={styles.tree} data-popup={onClose ? '' : undefined}>
      <div className={styles.tools} role="toolbar" aria-label="Notes">
        <Tool label="New note" onClick={onNew}>
          <SquarePen size={17} strokeWidth={2.1} aria-hidden="true" />
        </Tool>
        <Tool label="New workspace" onClick={() => setManage('new')}>
          <FolderPlus size={17} strokeWidth={2.1} aria-hidden="true" />
        </Tool>
        {onCommands ? (
          <Tool label="Search and commands" onClick={onCommands}>
            <Search size={17} strokeWidth={2.1} aria-hidden="true" />
          </Tool>
        ) : null}
        {every.length ? (
          <Tool label={allShut ? 'Open every folder' : 'Fold every folder'} onClick={shutOrOpenAll}>
            {allShut ? <ChevronsUpDown size={17} strokeWidth={2.1} aria-hidden="true" /> : <ChevronsDownUp size={17} strokeWidth={2.1} aria-hidden="true" />}
          </Tool>
        ) : null}
        {onClose ? (
          <Tool label="Close" onClick={onClose} end>
            <X size={17} strokeWidth={2.2} aria-hidden="true" />
          </Tool>
        ) : null}
      </div>

      <div className={styles.scroll}>
        {nothing ? (
          <div className={styles.empty}>
            <Ghost scene="no-notes" className={styles.emptyArt} />
            <p className={styles.emptyWords}>No notes yet.</p>
          </div>
        ) : (
          <ul className={styles.list} aria-label="Your notes">
            {tree.folders.map((f) => folder(f.id, f.name, f.notes.length, f.notes, { hue: f.hue, space: spaces.list.find((s) => s.id === f.id) }))}
            {tree.loose.map(row)}
            {tree.archived.length
              ? folder(ARCHIVE_FOLDER, 'Archive', tree.archived.length, tree.archived, {
                  icon: <Archive className={styles.archiveIcon} size={14} strokeWidth={2.1} aria-hidden="true" />,
                })
              : null}
            {trashFolder}
          </ul>
        )}
      </div>

      {/*
        At the bottom, over the foot, with room all round (Matt: "the new version banner should go at the bottom of the
        sidebar and have padding around the outside"). At the top it pushed every note down the moment an update
        arrived, and it sat flush against the tools.
      */}
      {notices ? <div className={styles.notices}>{notices}</div> : null}

      {onSpeak || onSettings ? (
        <div className={styles.foot}>
          {onSpeak ? (
            <button type="button" className={styles.speak} onClick={onSpeak}>
              <Mic size={16} strokeWidth={2.2} aria-hidden="true" />
              Speak
            </button>
          ) : null}
          {onSettings ? (
            <Tool label="Settings" onClick={onSettings} end>
              <Settings size={17} strokeWidth={2.1} aria-hidden="true" />
            </Tool>
          ) : null}
        </div>
      ) : null}

      <WorkspaceSheet which={manage} onClose={() => setManage(null)} />
    </div>
  );
}
