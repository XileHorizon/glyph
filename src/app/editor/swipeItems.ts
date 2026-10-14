import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { tickNow, type Approaching } from '../core/detentFeel.ts';
import { fireMicroTick, fireNativeHaptic } from '../core/haptics.ts';
import { itemAt } from '../core/itemLinks.ts';

/**
 * Swiping a list item left in the note hands it to a plugin's item action
 * (plugins/types.ts `ItemAction`): the Notion plugin's sends it as a task.
 *
 * Matt chose all three ways for a list item to become a task: saying it,
 * swiping the item, and sending a whole list. This is the swipe. When a
 * switched-on plugin offers an action on this note, a to-do or bullet line
 * that is not a link yet can be dragged left: the line follows the finger, a
 * tile behind it grows with the action's word, and letting go past the point
 * where it counts runs it (the tile says so until it is done; the Notion
 * action makes the line's words a link to the task). Short of it, the line
 * springs back.
 *
 * Only a mostly horizontal drag that starts on such a line counts; anything
 * else is left to the editor, so typing, selecting and scrolling are as they
 * were. The tile lives in the scroller, not in the content, so CodeMirror's
 * own DOM is never touched beyond the line's transform while it moves.
 */

const INTENT_PX = 12;
const ARM_FRACTION = 0.3;

export interface SwipeAction {
  /** The tile's word while dragged, and while it runs. */
  label: string;
  busyLabel: string;
  /** Runs on the item's words; resolves when it is done. */
  run: (text: string) => Promise<void>;
}

interface Options {
  /** The action a swipe runs on this note right now, or null for none. Read when a swipe starts. */
  action: () => SwipeAction | null;
}

export function swipeItemAction({ action }: Options): Extension {
  return ViewPlugin.fromClass(
    class {
      private gesture: {
        id: number;
        x: number;
        y: number;
        line: HTMLElement;
        text: string;
        action: SwipeAction;
        intent: 'undecided' | 'horizontal' | 'vertical';
        dx: number;
        width: number;
        approaching: Approaching;
      } | null = null;
      private tile: HTMLElement | null = null;

      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener('pointerdown', this.down);
        view.contentDOM.addEventListener('pointermove', this.move, { passive: false });
        view.contentDOM.addEventListener('pointerup', this.up);
        view.contentDOM.addEventListener('pointercancel', this.cancel);
      }

      destroy() {
        this.view.contentDOM.removeEventListener('pointerdown', this.down);
        this.view.contentDOM.removeEventListener('pointermove', this.move);
        this.view.contentDOM.removeEventListener('pointerup', this.up);
        this.view.contentDOM.removeEventListener('pointercancel', this.cancel);
        this.tile?.remove();
      }

      private down = (event: PointerEvent) => {
        const offered = event.button === 0 ? action() : null;
        if (!offered) return;
        const line = (event.target as HTMLElement | null)?.closest?.('.cm-line') as HTMLElement | null;
        if (!line) return;
        let pos: number;
        try {
          pos = this.view.posAtDOM(line);
        } catch {
          return;
        }
        const docLine = this.view.state.doc.lineAt(pos);
        const item = itemAt(docLine.text, docLine.number);
        if (!item) return;
        this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, line, text: item.text, action: offered, intent: 'undecided', dx: 0, width: line.offsetWidth || 1, approaching: { lastTickAt: -Infinity, lastDistance: 0 } };
      };

      private move = (event: PointerEvent) => {
        const g = this.gesture;
        if (!g || g.id !== event.pointerId) return;
        const dx = event.clientX - g.x;
        const dy = event.clientY - g.y;
        if (g.intent === 'undecided') {
          if (Math.abs(dx) < INTENT_PX && Math.abs(dy) < INTENT_PX) return;
          g.intent = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.5 ? 'horizontal' : 'vertical';
          if (g.intent === 'vertical') {
            this.gesture = null;
            return;
          }
        }
        event.preventDefault();
        const wasArmed = -g.dx >= g.width * ARM_FRACTION;
        g.dx = Math.min(0, dx);
        const distance = -g.dx / g.width;
        // Felt coming, then felt arriving; backing out of it, the lightest tick (core/detentFeel.ts).
        if (tickNow(g.approaching, [ARM_FRACTION], distance, event.timeStamp)) fireMicroTick();
        const isArmed = distance >= ARM_FRACTION;
        if (isArmed !== wasArmed) fireNativeHaptic(isArmed ? 'medium' : 'selection');
        g.line.style.transform = `translateX(${g.dx}px)`;
        g.line.style.transition = 'none';
        this.showTile(g.line, -g.dx, g.width, g.action.label);
      };

      private up = (event: PointerEvent) => {
        const g = this.gesture;
        if (!g || g.id !== event.pointerId) return;
        this.gesture = null;
        if (g.intent !== 'horizontal') return;
        const armed = -g.dx >= g.width * ARM_FRACTION;
        g.line.style.transition = 'transform 200ms ease-out';
        g.line.style.transform = '';
        if (!armed) {
          this.hideTile();
          return;
        }
        this.showTile(g.line, g.width * ARM_FRACTION, g.width, g.action.busyLabel);
        void g.action.run(g.text).finally(() => this.hideTile());
      };

      private cancel = () => {
        const g = this.gesture;
        this.gesture = null;
        if (g) {
          g.line.style.transition = 'transform 200ms ease-out';
          g.line.style.transform = '';
        }
        this.hideTile();
      };

      /** The tile behind the line, filling toward the point where it counts, with the action's word. */
      private showTile(line: HTMLElement, reach: number, width: number, word: string) {
        const scroller = this.view.scrollDOM;
        if (!this.tile) {
          this.tile = document.createElement('div');
          this.tile.className = 'cm-swipeItem';
          this.tile.setAttribute('aria-hidden', 'true');
          scroller.appendChild(this.tile);
        }
        const lineBox = line.getBoundingClientRect();
        const scrollBox = scroller.getBoundingClientRect();
        const progress = Math.min(1, reach / (width * ARM_FRACTION));
        Object.assign(this.tile.style, {
          top: `${lineBox.top - scrollBox.top + scroller.scrollTop}px`,
          height: `${lineBox.height}px`,
          width: `${Math.max(0, reach)}px`,
          right: '0px',
        });
        this.tile.dataset.armed = progress >= 1 ? '' : undefined;
        if (progress < 1) delete this.tile.dataset.armed;
        this.tile.style.setProperty('--progress', String(progress));
        this.tile.textContent = word;
      }

      private hideTile() {
        this.tile?.remove();
        this.tile = null;
      }
    },
  );
}

/** The tile's look, in the page's ink: grey while dragged, ink once it counts. */
export const swipeItemTheme = EditorView.baseTheme({
  '.cm-scroller': { position: 'relative' },
  '.cm-swipeItem': {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    borderRadius: '10px',
    color: 'var(--glacier-text-muted)',
    background: 'var(--app-wash, var(--glacier-surface-sunken))',
    opacity: 'calc(0.4 + var(--progress, 0) * 0.6)',
    pointerEvents: 'none',
    zIndex: '2',
  },
  '.cm-swipeItem[data-armed]': {
    color: 'var(--app-paper, var(--glacier-bg))',
    background: 'var(--app-ink, var(--glacier-text))',
  },
});
