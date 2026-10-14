import { randomBytes, randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { fromBase64Url } from '../src/app/core/sync/crypto.ts';
import { GlyphAccount, GlyphApiError } from './glyph.ts';
import { buildServer, VERSION } from './server.ts';
// The app's typeface, for the sign-in page: scripts/build-mcp.mjs folds the file into the bundle as a data URL.
import INTER from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2';

/**
 * The MCP server hosted on the box, for everyone (docs/MCP.md, "Hosted"): Claude connects to
 * https://attack.fm/glyph/api/mcp, the person signs in on a page here once, and the same tools as the local server
 * answer over HTTP. Matt: "run the server on our node so that the user doesn't need to".
 *
 * Notes are end-to-end encrypted, so the server has to hold the account key to serve them, and it does the one way
 * Matt chose: **in memory only**. The sign-in page unwraps the key in the person's browser - the password never
 * reaches this server, only the login half the sync service already sees - and hands the key to this process for the
 * session; it is kept as a key object the process cannot export, never written anywhere, and gone when the session
 * ends, when Claude disconnects, or when the process restarts. While a session lasts, this process can read that
 * account's notes; the page says so in plain words before asking for the password.
 *
 * The rest is OAuth 2.1 as the MCP spec asks of a remote server, with the SDK's own handlers: dynamic client
 * registration, an authorization code with PKCE, refresh tokens, revocation. Every store is a map in memory, so a
 * restart signs everyone out and Claude simply asks them to sign in again. The service is reached through
 * glyph-api, which proxies /glyph/api/mcp to it (server/src/mcp_proxy.rs), so nothing in the shared Caddy
 * configuration changes; the discovery documents live under that path, where the client library looks for them.
 */

export interface HostedOptions {
  /** The server's own URL, as Claude sees it: `https://attack.fm/glyph/api/mcp`. */
  issuer: string;
  /** The sync service this process talks to: the loopback one on the box. */
  api: string;
  /** The sync service as the person's browser reaches it, for the sign-in page. */
  apiPublic: string;
  fetcher?: typeof fetch;
  /** Rate limits on the sign-in endpoints: on by default; off in tests. */
  rateLimit?: boolean;
  now?: () => number;
}

interface AuthRequest {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  expiresAt: number;
}

interface IssuedCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  sessionId: string;
  expiresAt: number;
}

interface Session {
  id: string;
  handle: string;
  clientId: string;
  account: GlyphAccount;
  createdAt: number;
  lastUsed: number;
  /** The sync service would not renew its token: the person has to sign in again. */
  lapsed: boolean;
}

interface Issued {
  sessionId: string;
  clientId: string;
  expiresAt: number;
}

const REQUEST_MS = 10 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const ACCESS_MS = 60 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** A session nobody has used for this long is over, key and all. */
const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const SCOPE = 'notes';

const token = () => randomBytes(32).toString('base64url');

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

/** The page's icons: strokes on currentColor on the app's own 24 grid (art/Icons.tsx), so they sit with the words. */
const ICON = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M7.5 11h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-5A2.5 2.5 0 0 1 7.5 11z',
  key: 'M4 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0zM10.8 12.2 20 3M17 6l2 2M14.5 8.5l2 2',
  leave: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  mark: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0zM12 7.5V13M12 16.5v.01',
};
const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * The picture at the top: the app's Welcome shape (art/Shapes.tsx) on the faint grid of its Blank one - a dot lands
 * and a line writes out, rests, and again - in the page's ink, moving as it does in the app.
 */
function art(): string {
  const dots: string[] = [];
  for (let x = 20; x <= 100; x += 10) for (let y = 20; y <= 100; y += 10) dots.push(`<circle cx="${x}" cy="${y}" r="1"/>`);
  return `<svg class="art" viewBox="0 0 120 120" aria-hidden="true"><g class="grid" fill="currentColor">${dots.join('')}</g><circle class="bullet" cx="37" cy="60" r="22" fill="currentColor"/><rect class="line" x="64" y="52" width="48" height="16" rx="8" fill="currentColor"/></svg>`;
}

/**
 * The sign-in page, in the app's own clothes: Inter, carried in the bundle so the page needs nothing from anywhere;
 * the ink scale from ink.css, paper by day and the same page printed in reverse by night; the shape art above and
 * icons drawn on the same grid as the app's. A state is said with a word and a shape, not a colour, so the one
 * message the page can show is ink with a mark beside it. What the page does - derive, sign in, unwrap, hand over -
 * is the script at the bottom, and none of it moved.
 */
function loginPage({ request, who, apiPublic, base, deny }: { request: string; who: string; apiPublic: string; base: string; deny: string }): string {
  const name = escapeHtml(who);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ghost.md · Let ${name} use your notes</title>
<style>
  @font-face { font-family: 'Inter Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: url(${INTER}) format('woff2-variations'); }
  :root {
    color-scheme: light dark;
    --g1: oklch(0.995 0 0); --g3: oklch(0.955 0 0); --g4: oklch(0.925 0 0); --g5: oklch(0.895 0 0); --g7: oklch(0.8 0 0); --g9: oklch(0.56 0 0); --g11: oklch(0.36 0 0); --g12: oklch(0.16 0 0);
  }
  @media (prefers-color-scheme: dark) {
    :root { --g1: oklch(0.11 0 0); --g3: oklch(0.17 0 0); --g4: oklch(0.205 0 0); --g5: oklch(0.24 0 0); --g7: oklch(0.34 0 0); --g9: oklch(0.6 0 0); --g11: oklch(0.8 0 0); --g12: oklch(0.965 0 0); }
  }
  :root { --paper: var(--g1); --paper-2: var(--g3); --paper-3: var(--g5); --rule: var(--g4); --ink: var(--g12); --ink-2: var(--g11); --ink-3: var(--g9); --ink-4: var(--g7); }
  * { box-sizing: border-box; }
  html { background: var(--paper); }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    background: var(--paper); color: var(--ink);
    font-family: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.5;
    -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;
  }
  main { width: 100%; max-width: 420px; }
  .art { display: block; width: 76px; height: 76px; overflow: visible; color: var(--ink); margin: 0 0 20px -8px; }
  .art .grid { color: var(--ink-4); }
  .art * { transform-box: fill-box; }
  .art .bullet { transform-origin: center; animation: bullet 5s cubic-bezier(0.2, 0.8, 0.2, 1) infinite; }
  .art .line { transform-origin: left center; animation: bullet-line 5s cubic-bezier(0.2, 0.8, 0.2, 1) infinite; }
  @keyframes bullet { 0% { transform: scale(0); } 8% { transform: scale(1.1); } 14%, 90% { transform: none; } 100% { transform: scale(0); } }
  @keyframes bullet-line { 0%, 10% { transform: scaleX(0); } 26%, 88% { transform: none; } 98%, 100% { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) { .art .bullet, .art .line { animation: none; } }
  .brand { display: flex; align-items: center; gap: 0.5em; margin: 0 0 10px; font-size: 0.875rem; font-weight: 600; letter-spacing: -0.01em; color: var(--ink-3); }
  .brand b { color: var(--ink); font-weight: 700; }
  .brand i { font-style: normal; color: var(--ink-4); }
  h1 { margin: 0 0 12px; font-size: clamp(2rem, 6.4vw, 2.375rem); line-height: 1.06; font-weight: 700; letter-spacing: -0.04em; text-wrap: balance; }
  .lead { margin: 0 0 22px; font-size: 1.0625rem; color: var(--ink-2); text-wrap: pretty; }
  .facts { list-style: none; margin: 0 0 26px; padding: 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
  .facts li { display: flex; gap: 14px; padding: 13px 0; font-size: 0.9375rem; line-height: 1.45; color: var(--ink-2); text-wrap: pretty; }
  .facts li + li { border-top: 1px solid var(--rule); }
  .facts svg { flex: none; width: 1.35em; height: 1.35em; margin-top: 0.05em; color: var(--ink); }
  .facts strong { color: var(--ink); font-weight: 600; }
  form { display: grid; gap: 14px; }
  label { display: grid; gap: 6px; font-size: 0.875rem; font-weight: 500; color: var(--ink); }
  input {
    width: 100%; margin: 0; padding: 0.85rem 0.95rem; font: inherit; font-size: 1rem; line-height: 1.25; color: var(--ink);
    background: var(--paper-2); border: 1px solid var(--rule); border-radius: 0.625rem; appearance: none;
  }
  input::placeholder { color: var(--ink-4); }
  input:focus { outline: 2px solid var(--ink); outline-offset: 2px; border-color: var(--ink); }
  .actions { display: grid; gap: 10px; margin-top: 6px; }
  button {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.5em; width: 100%; margin: 0; padding: 0.9rem 1.2rem;
    font: inherit; font-size: 1rem; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--ink); background: var(--ink); color: var(--paper);
  }
  button svg { width: 1.1em; height: 1.1em; }
  button[disabled] { opacity: 0.55; cursor: wait; }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  .quiet { background: transparent; color: var(--ink-2); border-color: var(--rule); }
  .quiet:hover { border-color: var(--ink-4); color: var(--ink); }
  .err { display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 12px 14px; font-size: 0.9375rem; line-height: 1.4; color: var(--ink); background: var(--paper-2); border-radius: 0.625rem; }
  .err[hidden] { display: none; }
  .err svg { flex: none; width: 1.3em; height: 1.3em; margin-top: 0.02em; }
</style>
</head>
<body>
<main data-request="${escapeHtml(request)}" data-api="${escapeHtml(apiPublic)}" data-base="${escapeHtml(base)}" data-deny="${escapeHtml(deny)}">
  ${art()}
  <p class="brand"><b>Ghost.md</b><i>·</i><span>Connect</span></p>
  <h1>Let <b>${name}</b> use your notes.</h1>
  <p class="lead">Sign in to your Ghost.md account. ${name} will be able to read your notes, add to them and change them, until you disconnect it.</p>
  <ul class="facts">
    <li>${icon(ICON.lock)}<span><strong>Still end-to-end encrypted.</strong> Your password stays in this browser; the sync service sees the same login half it sees from your phone.</span></li>
    <li>${icon(ICON.key)}<span><strong>Your key, held in memory.</strong> Signing in unlocks your account key here and hands it to Ghost.md's server, which keeps it in memory only, never on disk, while this connection lasts. In that time the server can read your notes: that is what lets ${name}.</span></li>
    <li>${icon(ICON.leave)}<span><strong>Disconnect ${name} and it ends.</strong> So does a week of not using it.</span></li>
  </ul>
  <form id="form" novalidate>
    <label>Handle<input name="handle" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <p class="err" id="err" role="alert" hidden>${icon(ICON.mark)}<span id="err-words"></span></p>
    <div class="actions">
      <button type="submit" id="go"><span id="go-words">Allow</span>${icon(ICON.arrow)}</button>
      <button type="button" class="quiet" id="cancel">Cancel</button>
    </div>
  </form>
</main>
<script>
(() => {
  const main = document.querySelector('main');
  const REQUEST = main.dataset.request, API = main.dataset.api, BASE = main.dataset.base, DENY = main.dataset.deny;
  const form = document.getElementById('form'), go = document.getElementById('go'), goWords = document.getElementById('go-words'), err = document.getElementById('err'), errWords = document.getElementById('err-words');
  const enc = new TextEncoder();
  const b64u = (b) => btoa(String.fromCharCode(...b)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const unb64u = (t) => { const p = t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4); const r = atob(p); const o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const say = (words) => { errWords.textContent = words; err.hidden = false; go.disabled = false; goWords.textContent = 'Allow'; };
  // The same halves the app derives (core/sync/crypto.ts): the login half goes to the sync service, the wrap half opens the key here.
  async function derive(password, handle) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('glyph/v1/' + handle.trim().toLowerCase()), iterations: 600000 }, base, 512));
    const wrapKey = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, false, ['decrypt']);
    return { login: hex(bits.slice(0, 32)), wrapKey };
  }
  async function unwrap(wrapped, wrapKey) {
    const b = unb64u(wrapped);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: enc.encode('account-key') }, wrapKey, b.slice(12)));
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    err.hidden = true;
    go.disabled = true;
    goWords.textContent = 'Signing in…';
    const handle = form.handle.value.trim(), password = form.password.value;
    if (!handle || !password) return say(handle ? 'The password is missing.' : 'The handle is missing.');
    try {
      const { login, wrapKey } = await derive(password, handle);
      const r = await fetch(API + '/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, loginSecret: login }) });
      const a = await r.json().catch(() => ({}));
      if (!r.ok) return say(a.error || 'The sync service refused the sign-in.');
      const raw = await unwrap(a.wrapped, wrapKey).catch(() => null);
      if (!raw) return say('This account’s key would not open with that password.');
      const c = await fetch(BASE + '/authorize/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: REQUEST, handle: a.account.handle, token: a.token, accountKey: b64u(raw) }) });
      const j = await c.json().catch(() => ({}));
      if (!c.ok) return say(j.error || 'Could not finish signing in.');
      location.assign(j.redirect);
    } catch (failure) {
      // A fetch that never got an answer throws a TypeError; anything else is worth its own words.
      say(failure instanceof TypeError ? 'Could not reach Ghost.md’s sync service. Check the connection and try again.' : 'Something went wrong: ' + (failure && failure.message ? failure.message : failure));
    }
  });
  document.getElementById('cancel').addEventListener('click', () => location.assign(DENY));
})();
</script>
</body>
</html>`;
}

/** The hosted server as an express app, and what it holds, for the entry point and the tests. */
export function hostedApp(options: HostedOptions) {
  const issuer = options.issuer.replace(/\/+$/, '');
  const base = new URL(issuer).pathname;
  const api = options.api.replace(/\/+$/, '');
  const apiPublic = options.apiPublic.replace(/\/+$/, '');
  const now = options.now ?? (() => Date.now());
  const rateLimit = options.rateLimit === false ? false : undefined;

  const clients = new Map<string, OAuthClientInformationFull>();
  const requests = new Map<string, AuthRequest>();
  const codes = new Map<string, IssuedCode>();
  const sessions = new Map<string, Session>();
  const accessTokens = new Map<string, Issued>();
  const refreshTokens = new Map<string, Issued>();

  const clientsStore: OAuthRegisteredClientsStore = {
    getClient: (clientId) => clients.get(clientId),
    registerClient: (client) => {
      const full = { ...(client as OAuthClientInformationFull), client_id: (client as OAuthClientInformationFull).client_id ?? randomUUID(), client_id_issued_at: Math.floor(now() / 1000) };
      clients.set(full.client_id, full);
      return full;
    },
  };

  /** A session is over: its tokens go, and with them the key. */
  function endSession(id: string): void {
    sessions.delete(id);
    for (const [t, issued] of accessTokens) if (issued.sessionId === id) accessTokens.delete(t);
    for (const [t, issued] of refreshTokens) if (issued.sessionId === id) refreshTokens.delete(t);
  }

  function issue(session: Session, clientId: string): OAuthTokens {
    const access = token();
    const refresh = token();
    accessTokens.set(access, { sessionId: session.id, clientId, expiresAt: now() + ACCESS_MS });
    refreshTokens.set(refresh, { sessionId: session.id, clientId, expiresAt: now() + REFRESH_MS });
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_MS / 1000, refresh_token: refresh, scope: SCOPE };
  }

  /** What has run out: requests, codes, tokens, and sessions nobody has used for a week. */
  function sweep(): void {
    const at = now();
    for (const [id, r] of requests) if (r.expiresAt < at) requests.delete(id);
    for (const [c, issued] of codes) if (issued.expiresAt < at) codes.delete(c);
    for (const [t, issued] of accessTokens) if (issued.expiresAt < at) accessTokens.delete(t);
    for (const [t, issued] of refreshTokens) if (issued.expiresAt < at) refreshTokens.delete(t);
    for (const session of [...sessions.values()]) {
      const alive = [...refreshTokens.values()].some((i) => i.sessionId === session.id) || [...accessTokens.values()].some((i) => i.sessionId === session.id);
      if (!alive || session.lastUsed + IDLE_MS < at) endSession(session.id);
    }
  }

  const provider: OAuthServerProvider = {
    get clientsStore() {
      return clientsStore;
    },
    async authorize(client, params, res) {
      sweep();
      const id = token();
      requests.set(id, { client, params, expiresAt: now() + REQUEST_MS });
      const deny = new URL(params.redirectUri);
      deny.searchParams.set('error', 'access_denied');
      deny.searchParams.set('error_description', 'The person did not sign in.');
      if (params.state) deny.searchParams.set('state', params.state);
      res
        .status(200)
        .set('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'self' ${new URL(apiPublic).origin}; form-action 'none'; base-uri 'none'`)
        .set('Cache-Control', 'no-store')
        .set('Referrer-Policy', 'no-referrer')
        .type('html')
        .send(loginPage({ request: id, who: client.client_name?.trim() || 'Claude', apiPublic, base: issuer, deny: deny.href }));
    },
    async challengeForAuthorizationCode(client, code) {
      const issued = codes.get(code);
      if (!issued || issued.clientId !== client.client_id || issued.expiresAt < now()) throw new InvalidGrantError('That code is not one of ours, or has run out.');
      return issued.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const issued = codes.get(code);
      codes.delete(code);
      if (!issued || issued.clientId !== client.client_id || issued.expiresAt < now()) throw new InvalidGrantError('That code is not one of ours, or has run out.');
      if (redirectUri && redirectUri !== issued.redirectUri) throw new InvalidGrantError('The redirect does not match the one the code was made for.');
      const session = sessions.get(issued.sessionId);
      if (!session) throw new InvalidGrantError('That sign-in is over; sign in again.');
      return issue(session, client.client_id);
    },
    async exchangeRefreshToken(client, refreshToken) {
      const issued = refreshTokens.get(refreshToken);
      if (!issued || issued.clientId !== client.client_id || issued.expiresAt < now()) throw new InvalidGrantError('That refresh token is not one of ours, or has run out.');
      refreshTokens.delete(refreshToken);
      const session = sessions.get(issued.sessionId);
      if (!session || session.lapsed) {
        if (session) endSession(session.id);
        throw new InvalidGrantError('That sign-in is over; sign in again.');
      }
      return issue(session, client.client_id);
    },
    async verifyAccessToken(access): Promise<AuthInfo> {
      const issued = accessTokens.get(access);
      if (!issued || issued.expiresAt < now()) throw new InvalidTokenError('That token is not one of ours, or has run out.');
      const session = sessions.get(issued.sessionId);
      if (!session || session.lapsed) {
        if (session) endSession(session.id);
        throw new InvalidTokenError('That sign-in is over; sign in again.');
      }
      return { token: access, clientId: issued.clientId, scopes: [SCOPE], expiresAt: Math.floor(issued.expiresAt / 1000), extra: { sessionId: session.id } };
    },
    async revokeToken(_client, request: OAuthTokenRevocationRequest) {
      const issued = accessTokens.get(request.token) ?? refreshTokens.get(request.token);
      accessTokens.delete(request.token);
      refreshTokens.delete(request.token);
      // Disconnecting Claude ends the session, and with it the key.
      if (issued) endSession(issued.sessionId);
    },
  };

  const metadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: [SCOPE],
    // The OpenID form of the same document, for a client that looks for that one: no identity tokens are issued.
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['none'],
    service_documentation: 'https://github.com/InfamousVague/glyph/blob/main/docs/MCP.md',
  };
  const resourceMetadataUrl = `${issuer}/.well-known/oauth-protected-resource`;
  const protectedResource = { resource: issuer, authorization_servers: [issuer], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Ghost.md notes' };

  const app = express();
  // Behind glyph-api and Caddy on the box, both on loopback: the person's own address is what the limits count.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  const json = (value: unknown) => (_req: Request, res: Response) => res.set('Cache-Control', 'no-store').json(value);
  app.get(`${base}/.well-known/oauth-protected-resource`, json(protectedResource));
  app.get(`${base}/.well-known/oauth-authorization-server`, json(metadata));
  app.get(`${base}/.well-known/openid-configuration`, json(metadata));
  app.get(`${base}/jwks`, json({ keys: [] }));
  app.get(`${base}/health`, (_req, res) => {
    sweep();
    res.set('Cache-Control', 'no-store').json({ ok: true, version: VERSION, sessions: sessions.size });
  });

  app.use(`${base}/authorize`, authorizationHandler({ provider, rateLimit }));
  app.use(`${base}/token`, tokenHandler({ provider, rateLimit }));
  app.use(`${base}/register`, clientRegistrationHandler({ clientsStore, rateLimit }));
  app.use(`${base}/revoke`, revocationHandler({ provider, rateLimit }));

  /** The sign-in page's answer: the person's token and, unwrapped in their browser, the account key. */
  app.post(`${base}/authorize/complete`, express.json({ limit: '16kb' }), async (req: Request, res: Response) => {
    const body = req.body as { request?: unknown; handle?: unknown; token?: unknown; accountKey?: unknown };
    const request = typeof body.request === 'string' ? requests.get(body.request) : undefined;
    if (!request || request.expiresAt < now()) {
      res.status(400).json({ error: 'This sign-in page has run out. Go back to Claude and connect again.' });
      return;
    }
    if (typeof body.token !== 'string' || typeof body.accountKey !== 'string' || typeof body.handle !== 'string') {
      res.status(400).json({ error: 'The sign-in was incomplete.' });
      return;
    }
    let key: CryptoKey;
    try {
      const raw = fromBase64Url(body.accountKey);
      if (raw.length !== 32) throw new Error('not 32 bytes');
      // Not extractable: this process can use the key and never read it out.
      key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      raw.fill(0);
    } catch (failure) {
      // The message the person reads says what they can act on; the reason goes to the journal, because the last
      // time this fired it was not the key at all - it was a Node without WebCrypto (mcp/webcrypto.ts).
      process.stderr.write(`glyph-mcp: the account key was refused: ${failure instanceof Error ? failure.message : String(failure)}\n`);
      res.status(400).json({ error: globalThis.crypto?.subtle ? 'That is not an account key.' : 'This server cannot open an account key. Its administrator will find the reason in its log.' });
      return;
    }
    const id = randomUUID();
    let handle = body.handle;
    let account: GlyphAccount;
    try {
      // The token is the sync service's to judge, and renewing it is how it is judged; the key is judged by opening the notes.
      account = new GlyphAccount(
        { v: 1, api, handle, accountId: 0, token: body.token, accountKey: '', deviceKey: null },
        {
          key,
          fetcher: options.fetcher,
          lapsed: () => {
            const session = sessions.get(id);
            if (session) session.lapsed = true;
          },
        },
      );
      await account.resume();
      handle = account.handle;
      await account.pull();
    } catch (failure) {
      const words = failure instanceof GlyphApiError ? failure.message : 'That key does not open this account’s notes.';
      res.status(failure instanceof GlyphApiError ? 401 : 400).json({ error: words });
      return;
    }
    requests.delete(body.request as string);
    const session: Session = { id, handle, clientId: request.client.client_id, account, createdAt: now(), lastUsed: now(), lapsed: false };
    sessions.set(id, session);
    const code = token();
    codes.set(code, { clientId: request.client.client_id, codeChallenge: request.params.codeChallenge, redirectUri: request.params.redirectUri, sessionId: id, expiresAt: now() + CODE_MS });
    const redirect = new URL(request.params.redirectUri);
    redirect.searchParams.set('code', code);
    if (request.params.state) redirect.searchParams.set('state', request.params.state);
    res.json({ redirect: redirect.href });
  });

  /** MCP itself: one request, one answer, no session held open (the account's own session is the state). */
  app.post(base, requireBearerAuth({ verifier: provider, resourceMetadataUrl }), express.json({ limit: '4mb' }), async (req: Request, res: Response) => {
    const sessionId = (req.auth?.extra as { sessionId?: string } | undefined)?.sessionId;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`).json({ error: 'That sign-in is over; sign in again.' });
      return;
    }
    session.lastUsed = now();
    const server = buildServer(session.account, {
              // The connections this account has: every session signed in with its handle, this one included.
              connections: () => [...sessions.values()].filter((s) => s.handle === session.handle).length,
              // Sign out everywhere: every one of them ended, tokens and keys with them; the answer to this call
              // still goes out, since the transport it rides is already open.
              signOutEverywhere: () => {
                const ids = [...sessions.values()].filter((s) => s.handle === session.handle).map((s) => s.id);
                for (const id of ids) endSession(id);
                return ids.length;
              },
            });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notHere = (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ error: 'This server answers POST only: one request, one answer.' });
  };
  app.get(base, notHere);
  app.delete(base, notHere);

  return { app, sessions, sweep };
}
