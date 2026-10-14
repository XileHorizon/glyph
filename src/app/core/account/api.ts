/**
 * The one way the page talks to Glyph's account and sync service (server/src/accounts.rs, server/src/sync.rs).
 *
 * Served from attack.fm for now (Matt: "for now just use attack.fm domains"), and one setting away from anywhere else:
 * `VITE_GLYPH_API` at build time. Errors come back as the service words them, `{ error }`, so what the person reads is
 * what the service meant.
 */

export const API_BASE: string = (import.meta.env.VITE_GLYPH_API as string | undefined)?.replace(/\/+$/, '') || 'https://attack.fm/glyph/api';

/** A request the service refused, with its status and its own words. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The body a refusal carried, for the ones that are data rather than words (a 409 says what won). */
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

/** How long a request may take before it is given up on. A recording is allowed a good deal longer. */
const TIMEOUT_MS = 30_000;

export interface CallOptions {
  token?: string | null;
  body?: unknown;
  /** Raw bytes rather than JSON: a recording. */
  bytes?: Uint8Array;
  timeoutMs?: number;
  /** Swapped in by the tests. */
  fetcher?: typeof fetch;
}

/** A JSON call to `/v1/<path>`. */
export async function call<T>(method: string, path: string, options: CallOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) throw refusal(response.status, body);
  return body as T;
}

/** A call that answers bytes: a recording, with its revision. */
export async function callBytes(method: string, path: string, options: CallOptions = {}): Promise<{ bytes: Uint8Array<ArrayBuffer>; rev: number }> {
  const response = await send(method, path, options);
  if (!response.ok) {
    const text = await response.text();
    throw refusal(response.status, text ? (JSON.parse(text) as unknown) : null);
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()), rev: Number(response.headers.get('x-glyph-rev') ?? 0) };
}

async function send(method: string, path: string, options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.bytes) {
    headers['Content-Type'] = 'application/octet-stream';
    body = options.bytes as unknown as BodyInit;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    return await (options.fetcher ?? fetch)(`${API_BASE}/v1/${path}`, { method, headers, body, signal: controller.signal });
  } catch (failure) {
    if (controller.signal.aborted) throw new ApiError(0, 'The sync service took too long to answer.');
    throw new ApiError(0, failure instanceof Error && failure.message ? 'The sync service could not be reached.' : String(failure));
  } finally {
    clearTimeout(timer);
  }
}

function refusal(status: number, body: unknown): ApiError {
  const words = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : null;
  return new ApiError(status, words ?? `The sync service answered ${status}.`, body);
}
