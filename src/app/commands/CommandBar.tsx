import { Ghost } from '../art/Ghost.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette } from '@glacier/react';
import { useBack } from '../core/back.ts';
import { paletteCommands, type PaletteDoing, type PaletteWorld } from './palette.ts';

/**
 * The command palette on screen: the kit's `CommandPalette` over Glyph's own list of doings (commands/palette.ts).
 *
 * The kit binds ⌘K itself and does the searching, the grouping and the cursor. Two things are Glyph's:
 *
 * - **A phone has no ⌘.** The way in there is a row in the notes drawer, which calls `openCommands` (notes/),
 *   so this holds the open state rather than the kit.
 * - **The back gesture closes it.** Glyph stacks back handlers by depth (core/back.ts), so a palette over a note must
 *   take the gesture and close, leaving the note where it was - without it, back would step out of the note behind.
 */

export interface CommandBarProps {
  world: PaletteWorld;
  doing: PaletteDoing;
  /** Handed back a function that opens the palette, for whatever chrome wants to offer it. */
  onReady?: (open: () => void) => void;
}

export function CommandBar({ world, doing, onReady }: CommandBarProps) {
  const [open, setOpen] = useState(false);
  /*
   * The opener is handed over ONCE, on mount, through a ref.
   *
   * Depending on `onReady` itself was a loop waiting to happen, and it happened: a caller passing an inline function
   * gives a new identity on every render, so the effect ran again, the caller's state changed, and it rendered again -
   * about twenty-five times a second on a phone, which is a warm battery and a janky app. Held in a ref, no caller can
   * loop it, whatever it passes.
   */
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    ready.current?.(() => setOpen(true));
  }, []);
  // Over everything else, so it closes first and the note behind it stays open.
  useBack(open, () => setOpen(false));

  // The list is rebuilt as the app changes under it: a note opened, a tab closed, a workspace chosen.
  const commands = useMemo(() => paletteCommands(world, doing), [world, doing]);
  const descriptors = useMemo(() => commands.map((command) => command.descriptor), [commands]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      commands={descriptors}
      onRun={(id) => commands.find((command) => command.descriptor.id === id)?.run()}
      placeholder="What would you like to do?"
      emptyLabel={
        <span style={{ display: 'grid', justifyItems: 'center', gap: 'var(--glacier-space-3)', paddingBlock: 'var(--glacier-space-4)' }}>
          <Ghost scene="search-nothing" />
          Nothing by that name.
        </span>
      }
    />
  );
}
