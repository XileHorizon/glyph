/// <reference types="vite/client" />

/**
 * The build-time settings the page reads: none at the moment. Only names
 * prefixed `VITE_` from the gitignored `.env` would be exposed to the page at
 * all - the deploy credentials in the same file are not.
 */
interface ImportMetaEnv {
  readonly VITE_UNUSED?: never;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** UTC `YYYYMMDDHHMMSS` of the `vite build` this page came from; see vite.config.ts. */
declare const __GLYPH_BUILD__: string;
/** package.json's version at that build. */
declare const __GLYPH_VERSION__: string;
/** Fingerprint of the source this build was made from (scripts/testReport/source.mjs). */
declare const __GLYPH_SOURCE__: string;
/** A staging build: installed beside the real app under its own id, never updated over the air. */
declare const __GLYPH_STAGING__: boolean;

/**
 * The boot handshake between the inline loader in index.html and every copy of
 * main.tsx that loads. Absent in a browser and under the dev server, where
 * there is only ever one frontend and it simply mounts.
 */
interface GlyphBoot {
  /** The module URL that should mount; undefined until the loader has decided. */
  chosen?: string;
  /** Called with nothing once `chosen` is set, by modules that loaded first. */
  waiting: Array<() => void>;
  /** Each loaded module's mount function, by module URL, so the loader can fall back. */
  mounters: Record<string, () => void>;
  /** The OTA build running, or null for the embedded frontend. */
  build: string | null;
  /** Set by the frontend that mounted. */
  mounted?: boolean;
}

interface Window {
  __glyphBoot?: GlyphBoot;
}
