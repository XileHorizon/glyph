import { generate, listModels, MODELS, modelName } from '../../core/ai.ts';
import { preferences } from '../../core/preferences.ts';
import { isTauri } from '../../core/tauri.ts';
import { host } from './manifest.ts';

/**
 * Projects: a GitHub repo a note is about, read by the model on the phone into
 * a short context pack that goes with the note whenever it is formatted.
 *
 * Matt: "bring back linking projects and have the local AI go through and
 * examine them where possible for context". A note about AttackFM formats
 * better knowing what AttackFM is, what its parts are called, and which names
 * are people and which are features.
 *
 * - Reading is GitHub's API from the page (it answers any origin): the repo's
 *   description and default branch, its file tree, and a handful of files
 *   that say what the project is - the README, AGENTS.md, a few
 *   docs, and the manifest (package.json, Cargo.toml, …). A private repo needs
 *   a token, kept on this phone only.
 * - Distilling is the formatter's model, on the phone (`ai_generate`), asked
 *   for a plain summary of names, parts and terms. No model on the phone (or a
 *   browser) keeps the README's opening instead, so a link always gives
 *   something.
 * - What is kept, and which note links to which project, is the plugin's
 *   storage: `glyph-github-projects`, `glyph-project-links`,
 *   `glyph-github-token`, all cleared by a reset. Through the plugin's host
 *   (plugins/host.ts), like its network and model use.
 */

/** Not `glyph-projects`: the 0.4.x projects feature left entries of another shape there. */
const PROJECTS_KEY = 'glyph-github-projects';
const LINKS_KEY = 'glyph-project-links';
const TOKEN_KEY = 'glyph-github-token';

/** Characters of repo text handed to the model: about four thousand tokens. */
const SOURCE_CHARS = 16_000;
const FILE_CHARS = 6_000;
const MAX_FILES = 8;

export interface Project {
  id: string;
  owner: string;
  repo: string;
  url: string;
  branch: string;
  description: string;
  /** The files that were read. */
  files: string[];
  /** The context pack: what the model wrote, or the README's opening. */
  pack: string;
  /** The model that wrote the pack, or null when it is the README's opening. */
  packModel: string | null;
  packedAt: number;
}

// ---- storage ------------------------------------------------------------------------------

function read<T>(key: string, fallback: T): T {
  return host.storage.get<T>(key, fallback) ?? fallback;
}

function write(key: string, value: unknown): void {
  host.storage.set(key, value);
}

export function projects(): Project[] {
  const kept = read<unknown>(PROJECTS_KEY, []);
  return Array.isArray(kept)
    ? kept.filter((p): p is Project => typeof p === 'object' && p !== null && typeof (p as Project).owner === 'string' && typeof (p as Project).repo === 'string' && typeof (p as Project).pack === 'string')
    : [];
}

/**
 * A README as plain words for a fallback briefing: HTML, images, badges and
 * link targets gone, blank runs squeezed.
 */
export function readmeWords(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-=*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function saveProject(project: Project): void {
  write(PROJECTS_KEY, [project, ...projects().filter((p) => p.id !== project.id)]);
}

export function removeProject(id: string): void {
  write(PROJECTS_KEY, projects().filter((p) => p.id !== id));
  // A copy: what a read answers is shared with every other read of it (plugins/host.ts).
  const links = { ...read<Record<string, string>>(LINKS_KEY, {}) };
  for (const [note, project] of Object.entries(links)) if (project === id) delete links[note];
  write(LINKS_KEY, links);
}

export function projectFor(noteId: string): Project | null {
  const id = read<Record<string, string>>(LINKS_KEY, {})[noteId];
  return id ? (projects().find((p) => p.id === id) ?? null) : null;
}

export function linkProject(noteId: string, projectId: string | null): void {
  const links = { ...read<Record<string, string>>(LINKS_KEY, {}) };
  if (projectId) links[noteId] = projectId;
  else delete links[noteId];
  write(LINKS_KEY, links);
}

/** What the model is given with a note linked to a project, or null. */
export function projectContextFor(noteId: string): string | null {
  const project = projectFor(noteId);
  if (!project?.pack.trim()) return null;
  return `This note is about the project ${project.owner}/${project.repo}. What is known about it, for spelling names and understanding terms (do not add any of it to the note):\n\n${project.pack.trim()}`;
}

export function githubToken(): string {
  return read<string>(TOKEN_KEY, '');
}

export function setGithubToken(token: string): void {
  if (token.trim()) write(TOKEN_KEY, token.trim());
  else host.storage.remove(TOKEN_KEY);
}

// ---- reading a repo ----------------------------------------------------------------------

/** `owner` and `repo` from "https://github.com/o/r", "github.com/o/r.git", "o/r". */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const text = input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/^github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/.*)?$/.exec(text);
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : null;
}

/**
 * Which files say what a project is, most telling first: the README, notes
 * for AI tools (which are summaries of the codebase), a few docs, and the
 * manifest. Vendored and generated folders are skipped.
 */
export function pickFiles(paths: readonly string[]): string[] {
  const usable = paths.filter((p) => !/(^|\/)(node_modules|vendor|dist|build|target|\.git)\//.test(p));
  const rank = (path: string): number => {
    const name = path.split('/').pop()?.toLowerCase() ?? '';
    const depth = path.split('/').length - 1;
    if (depth === 0 && /^readme(\.|$)/.test(name)) return 0;
    if (depth === 0 && /^agents\.md$/.test(name)) return 1;
    if (/^docs\/[^/]*design[^/]*\.md$/i.test(path)) return 2;
    if (depth === 0 && /^(package\.json|cargo\.toml|pyproject\.toml|go\.mod|pubspec\.yaml)$/.test(name)) return 3;
    if (/^docs\/[^/]+\.md$/i.test(path)) return 4;
    if (depth === 0 && /^(contributing|architecture|overview)\.md$/.test(name)) return 5;
    return Number.POSITIVE_INFINITY;
  };
  return usable
    .map((path) => ({ path, rank: rank(path) }))
    .filter((f) => Number.isFinite(f.rank))
    .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length)
    .slice(0, MAX_FILES)
    .map((f) => f.path);
}

/** The repo's shape in a few lines: its top-level folders and how many files each holds. */
export function outline(paths: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const top = path.includes('/') ? `${path.split('/')[0]}/` : path;
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([top, n]) => (top.endsWith('/') ? `${top} (${n} ${n === 1 ? 'file' : 'files'})` : top))
    .join('\n');
}

async function github<T>(path: string, token: string, raw = false): Promise<T> {
  host.require('network');
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.status === 404) throw new Error(token ? 'GitHub can’t find that repo with this token.' : 'GitHub can’t find that repo. If it’s private, add a token.');
  if (response.status === 401) throw new Error('GitHub didn’t accept that token.');
  if (response.status === 403) throw new Error('GitHub is limiting requests right now. Try again in a while, or add a token.');
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return (raw ? response.text() : response.json()) as Promise<T>;
}

export type Step =
  | { kind: 'reading' }
  | { kind: 'files'; done: number; total: number }
  | { kind: 'distilling'; model: string; tokensPerSecond: number; text: string };

const DISTILL_PROMPT = `You read a software project's own documents and write a short briefing for someone taking voice notes about it. Plain text, no markdown headings, at most 250 words:

1. One or two sentences on what the project is and who it is for.
2. Its main parts, as a short list of names with a few words each.
3. Names and terms that will come up in notes and how they are spelled: features, components, services, people or teams if the documents name them.
4. What the documents say is current work or open problems, if they say.

Only what the documents say. No guesses, no advice, no introduction and no closing remark.`;

/** Reads a repo, distils it on the phone, keeps it, and answers the project. */
export async function addProject(input: string, onStep: (step: Step) => void): Promise<Project> {
  const parsed = parseRepo(input);
  if (!parsed) throw new Error('That doesn’t look like a GitHub repo. Paste a link like github.com/owner/repo.');
  const token = githubToken();
  onStep({ kind: 'reading' });
  const meta = await github<{ default_branch: string; description: string | null; html_url: string; full_name: string }>(`repos/${parsed.owner}/${parsed.repo}`, token);
  const [owner = parsed.owner, repo = parsed.repo] = meta.full_name.split('/');
  const tree = await github<{ tree: Array<{ path: string; type: string }> }>(`repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`, token);
  const paths = tree.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  const chosen = pickFiles(paths);

  const texts: string[] = [];
  for (const [i, path] of chosen.entries()) {
    onStep({ kind: 'files', done: i, total: chosen.length });
    const text = await github<string>(`repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(meta.default_branch)}`, token, true).catch(() => '');
    if (text.trim()) texts.push(`--- ${path} ---\n${text.slice(0, FILE_CHARS)}`);
  }
  onStep({ kind: 'files', done: chosen.length, total: chosen.length });

  const source = [`Repository: ${owner}/${repo}`, meta.description ? `Description: ${meta.description}` : '', `Folders:\n${outline(paths)}`, ...texts]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, SOURCE_CHARS);

  const readme = texts.find((t) => /^--- readme/i.test(t))?.replace(/^--- [^\n]+\n/, '') ?? meta.description ?? '';
  let pack = readmeWords(readme).slice(0, 1500).trim();
  let packModel: string | null = null;
  host.require('ai');
  const model = await distillModel();
  if (model) {
    try {
      const run = generate({
        model,
        system: DISTILL_PROMPT,
        prompt: source,
        maxTokens: 700,
        temperature: 0.2,
        onProgress: (progress) => {
          if (progress.phase === 'generating' || progress.phase === 'prefill' || progress.phase === 'loading') {
            onStep({ kind: 'distilling', model: modelName(model), tokensPerSecond: progress.tokensPerSecond, text: progress.partial });
          }
        },
      });
      const output = await run.done;
      if (output.text.trim()) {
        pack = output.text.trim();
        packModel = model;
      }
    } catch (failure) {
      console.warn('[glyph] project not distilled, keeping the README:', failure);
    }
  }

  const project: Project = {
    id: `${owner}/${repo}`.toLowerCase(),
    owner,
    repo,
    url: meta.html_url,
    branch: meta.default_branch,
    description: meta.description ?? '',
    files: chosen,
    pack,
    packModel,
    packedAt: Date.now(),
  };
  saveProject(project);
  return project;
}

/** The model to distil with: the one chosen for formatting if it is here, else the quickest one here. */
async function distillModel(): Promise<string | null> {
  if (!isTauri()) return null;
  const present = new Set((await listModels().catch(() => [])).filter((m) => m.present).map((m) => m.id));
  const chosen = preferences().formatModel;
  if (present.has(chosen)) return chosen;
  return [...MODELS].sort((a, b) => a.bytes - b.bytes).find((m) => present.has(m.id))?.id ?? null;
}

/** Changes when a note's project, or its pack, does: for "the note has changed since" checks. */
export function projectContextVersion(noteId: string): number {
  const project = projectFor(noteId);
  return project ? project.packedAt : 0;
}
