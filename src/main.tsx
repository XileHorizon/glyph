import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The token layer: fonts first, then the CSS custom properties every component
// reads. These resolve to the vendored token files.
import '@glacier/tokens/css/fonts.css';
// Inter again, with its optical-size axis. Same family name, declared after
// the kit's weight-only faces so these win: at the display sizes Glyph now
// sets its titles in, `opsz` draws Inter Display rather than a scaled-up text
// cut. The package comes with the kit's fonts, so this installs nothing new.
import '@fontsource-variable/inter/opsz.css';
import '@glacier/tokens/css/tokens.css';
// The compiled component styles, read straight from the vendored package
// rather than a copy in src/: a snapshot goes stale the moment the kit is
// rebuilt, and a stylesheet whose class hashes no longer match the JS silently
// unstyles every component.
import '@glacier/react/styles.css';
import './app/app.css';
// Last: the ink palette, which maps every token above onto paper and ink.
import './app/ink.css';
import './app/editor/codeThemes.css';
import { App } from './app/App.tsx';
import { followShares } from './app/share/share.ts';

// What this device shares follows its edits: a few seconds after a save, every share that changed is written again.
followShares();

let mounted = false;

function mount() {
  if (mounted) return;
  mounted = true;
  const root = document.getElementById('root')!;
  // A frontend that started to render and was then abandoned by the loader
  // can leave DOM behind; the one that mounts starts from an empty root.
  root.replaceChildren();
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // `__glyphBoot.mounted` is NOT set here: render only schedules, and a render
  // that throws would already have claimed success. App's first effect, which
  // runs after a real commit, reports it (core/ota.ts, settleBoot).
}

/*
 * The OTA handshake (see the loader in index.html). Inside the app, TWO copies
 * of this module can load in one launch - the one compiled into the APK, which
 * the page's own script tag always loads, and a newer one the loader added -
 * and exactly one may mount. Each asks `__glyphBoot` whether its own URL is the
 * chosen one, waiting if the loader has not decided yet, and registers its
 * mount so the loader can fall back to it. Everywhere else there is no
 * `__glyphBoot` and this simply mounts.
 */
const boot = window.__glyphBoot;
if (!boot) {
  mount();
} else {
  const self = import.meta.url;
  const same = (url: string | undefined) => {
    try {
      return url !== undefined && new URL(url, document.baseURI).href === self;
    } catch {
      return false;
    }
  };
  boot.mounters[self] = mount;
  const consider = () => {
    if (same(boot.chosen)) mount();
  };
  if (boot.chosen === undefined) boot.waiting.push(consider);
  else consider();
}
