import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The app's own look, token for token (src/main.tsx), so a shared note reads here as it does in Ghost.md.
import '@glacier/tokens/css/fonts.css';
import '@fontsource-variable/inter/opsz.css';
import '@glacier/tokens/css/tokens.css';
import '@glacier/react/styles.css';
import '../app/app.css';
import '../app/ink.css';
import '../app/editor/codeThemes.css';
import { Reader } from './Reader.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Reader />
  </StrictMode>,
);
