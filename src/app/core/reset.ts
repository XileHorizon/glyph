import { plugins } from '../plugins/registry.ts';
import { invoke, isTauri } from './tauri.ts';

/**
 * Starting over: everything a person made or chose on this phone goes, and
 * Glyph reloads on the welcome guide. Developer settings, from where this is
 * reached, stay on. The downloaded models stay unless asked to go too: they
 * are gigabytes a person waited for, and a reset to test the app is not a
 * reason to fetch them again.
 *
 * On the phone the notes, recordings and pictures are Rust's (`reset.rs`,
 * native generation 11); the page clears what it keeps itself. In a browser
 * everything is the page's.
 */

/** The binary generation that has `reset_local_data`. */
const RESET_GENERATION = 11;

/**
 * Every key the page writes, except developer mode. Plugins' keys come from
 * their manifests (plugins/registry.ts), switched on or not; `glyph-projects`
 * is what the 0.4.x projects feature left behind.
 */
const KEYS = ['glyph-preferences', 'glyph-guide-seen', 'glyph-refine-queue', 'glyph-last-capture', 'glyph-haptics', 'glyph-notes', 'glyph-side-key', 'glyph-format-queue', 'glyph-ai-results', 'glyph-projects', 'glyph-workspaces', 'glyph-guide-started', 'glyph-guide-page', 'glyph-sample-note'];

export async function resetLocalData({ models }: { models: boolean }): Promise<void> {
  if (isTauri()) {
    const generation = await invoke<{ nativeGeneration?: number }>('ota_status').then(
      (status) => status.nativeGeneration ?? 0,
      () => 0,
    );
    if (generation < RESET_GENERATION) throw new Error('Resetting needs the newest Ghost.md. Install it from Settings > Updates.');
    await invoke<void>('reset_local_data', { models });
  } else {
    await new Promise<void>((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }
      const request = indexedDB.deleteDatabase('glyph-images');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
  for (const key of [...KEYS, ...plugins.storageKeys()]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing there to clear, or nowhere to clear it from.
    }
  }
  window.location.reload();
}
