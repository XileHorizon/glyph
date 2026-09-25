import { invoke as tauriInvoke, isTauri } from '../core/tauri.ts';
import type { Permission, PluginHost, PluginManifest } from './types.ts';


/**
 * A plugin wrote to its storage: whatever draws from it (a note's link marks,
 * the cog sheet's hints) reads again. Plugins keep what a note is linked to in
 * their own keys, so this is the one place a change is seen.
 */
const storageListeners = new Set<() => void>();

function storageChanged(): void {
  storageListeners.forEach((listener) => listener());
}

export function onPluginStorage(listener: () => void): () => void {
  storageListeners.add(listener);
  return () => {
    storageListeners.delete(listener);
  };
}

/**
 * A plugin's one way onto the phone, cut to its manifest.
 *
 * Each call checks the manifest before doing anything: a native command it did
 * not list, a storage key it does not own, or a permission it did not ask for
 * throws, naming the plugin, the moment the code runs. A built-in plugin that
 * reaches past its manifest fails its first test rather than quietly doing
 * something Settings > Plugins never said it does.
 */

export class PluginPermissionError extends Error {
  constructor(manifest: PluginManifest, what: string) {
    super(`The ${manifest.name} plugin didn't declare ${what}.`);
    this.name = 'PluginPermissionError';
  }
}

let generation: Promise<number> | null = null;

/**
 * Each key's value as last parsed, with the text it was parsed from. A plugin reads its storage in hot places - the
 * Notion and GitHub links once per keystroke through their suggestions, the token on every render of a note - and
 * each read was a `JSON.parse` (measured: about a hundred parses for forty-one keystrokes). A read still asks
 * localStorage for the text, which is cheap and can never be stale however the key was written; it parses only when
 * the text is not the one parsed last. The value is shared, so a plugin that changes one copies it first.
 */
const parsed = new Map<string, { raw: string; value: unknown }>();

/** The binary's native generation (src-tauri/src/ota.rs), read once. */
function nativeGeneration(): Promise<number> {
  if (!isTauri()) return Promise.resolve(0);
  generation ??= tauriInvoke<{ nativeGeneration?: number }>('ota_status').then(
    (status) => status.nativeGeneration ?? 0,
    () => 0,
  );
  return generation;
}

export function createHost(manifest: PluginManifest, invoke: typeof tauriInvoke = tauriInvoke): PluginHost {
  const declared = (permission: Permission) => manifest.permissions.some((p) => p.kind === permission);
  const require = (permission: Permission) => {
    if (!declared(permission)) throw new PluginPermissionError(manifest, `the “${permission}” permission`);
  };
  const owns = (key: string) => {
    if (!manifest.storage.includes(key)) throw new PluginPermissionError(manifest, `the storage key “${key}”`);
  };

  return {
    manifest,
    require,
    async nativeReady() {
      if (!manifest.native) return false;
      return (await nativeGeneration()) >= manifest.native.generation;
    },
    invoke<T>(command: string, args?: Record<string, unknown>) {
      if (!declared('native')) return Promise.reject(new PluginPermissionError(manifest, 'the “native” permission'));
      if (!manifest.native?.commands.includes(command)) {
        return Promise.reject(new PluginPermissionError(manifest, `the native command “${command}”`));
      }
      return invoke<T>(command, args);
    },
    storage: {
      get<T>(key: string, fallback: T): T {
        owns(key);
        try {
          const raw = localStorage.getItem(key);
          if (raw === null) return fallback;
          const last = parsed.get(key);
          if (last && last.raw === raw) return last.value as T;
          const value = JSON.parse(raw) as T;
          parsed.set(key, { raw, value });
          return value;
        } catch {
          return fallback;
        }
      },
      set(key: string, value: unknown) {
        owns(key);
        parsed.delete(key);
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          // No storage: it lasts as long as the page.
        }
        storageChanged();
      },
      remove(key: string) {
        owns(key);
        parsed.delete(key);
        storageChanged();
        try {
          localStorage.removeItem(key);
        } catch {
          // Nothing to remove.
        }
      },
    },
    async openUrl(url: string) {
      require('network');
      if (isTauri()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } else {
        window.open(url, '_blank', 'noopener');
      }
    },
  };
}
