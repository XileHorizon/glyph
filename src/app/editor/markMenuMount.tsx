import { createRoot } from 'react-dom/client';
import { MarkMenu, type MarkMenuProps } from './MarkMenu.tsx';

/**
 * Renders a linked line's drawer into a host over the page (editor/linkedRows.ts),
 * a React root of its own; answers how to take it down again.
 */
export function mountMarkMenu(host: HTMLElement, props: MarkMenuProps): () => void {
  const root = createRoot(host);
  root.render(<MarkMenu {...props} />);
  // Taken down after CodeMirror's own update has finished, never in the middle of a React render.
  return () => queueMicrotask(() => root.unmount());
}
