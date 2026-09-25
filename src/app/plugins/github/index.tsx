import { GitBranch } from '@glacier/icons';
import { fireNativeHaptic } from '../../core/haptics.ts';
import { itemAt, linkedLine, unsentItems } from '../../core/itemLinks.ts';
import type { GlyphPlugin, NoteEditing } from '../types.ts';
import { githubDetails, rememberIssue } from './details.ts';
import { canWriteIssues, createIssue, NEEDS_TOKEN } from './issues.ts';
import { manifest } from './manifest.ts';
import { RepoMark } from './marks.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { GitHubPane } from './GitHubPane.tsx';
import { projectContextFor, projectContextVersion, projectFor, projects, type Project } from './repos.ts';

/**
 * The GitHub plugin, standard in Glyph: a note linked to a repo works with
 * that repo both ways.
 *
 * Matt: "a GitHub issues plugin that allows us to sync list items with GitHub
 * project issues, or make it part of an overall GitHub plugin that's provided
 * by default like Notion". One plugin, one link on a note, two things done
 * with it:
 *
 * - **Issues.** A list item sent becomes an issue on the repo, and its words
 *   become a link to it. From then on the item and the issue are the same
 *   thing: the pill on the item says whether it is open, ticking the box
 *   closes the issue, and an issue closed on GitHub ticks the box
 *   (details.ts, editor/doneSync.ts). Sending needs a token; reading doesn't.
 * - **Context.** The repo is read on the phone into a short briefing that goes
 *   with the note whenever the model formats it (repos.ts).
 *
 * Where it shows: "GitHub repo" under Linked to on a note's cog, "Send list to
 * GitHub" beside it, a swipe on a list item, a quiet "GitHub" after an item
 * not sent yet, and in Settings the repos and the token.
 */

/**
 * Sends list items to the linked repo: each becomes an issue, and its words a
 * link to it, edited into the note so it is one undo per item and saves like
 * typing. Items are found again by their words after each send, since the note
 * can change while GitHub answers.
 */
async function sendItems(project: Project, items: readonly { text: string }[], editing: NoteEditing): Promise<void> {
  let sent = 0;
  for (const item of items) {
    try {
      const issue = await createIssue(project, item.text);
      rememberIssue(issue);
      if (editing.replaceLine((text, line) => itemAt(text, line)?.text === item.text, (text) => linkedLine(text, issue.url, 'github'))) sent += 1;
    } catch (failure) {
      editing.say(failure instanceof Error ? failure.message : String(failure));
      return;
    }
  }
  if (sent) {
    fireNativeHaptic('success');
    editing.say(`${sent === 1 ? 'Made 1 issue' : `Made ${sent} issues`} in ${project.owner}/${project.repo}.`);
  }
}

export const githubPlugin: GlyphPlugin = {
  manifest,
  icon: GitBranch,
  settings: {
    Pane: GitHubPane,
    summary: () => {
      const count = projects().length;
      return count ? `${count} ${count === 1 ? 'repo' : 'repos'}${canWriteIssues() ? ', issues on' : ''}` : 'Repos, issues and context';
    },
  },
  noteLinks: [
    {
      id: 'github-repo',
      label: 'GitHub repo',
      icon: RepoMark,
      hint(noteId) {
        const project = projectFor(noteId);
        if (!project) return 'A repo for this note: its list items can go there as issues, and the AI reads it for context.';
        return canWriteIssues()
          ? `${project.owner}/${project.repo}. List items can go there as issues.`
          : `${project.owner}/${project.repo}. Add a token in Settings to send items as issues.`;
      },
      Picker: ProjectPicker,
      linked(noteId) {
        const project = projectFor(noteId);
        return project ? `${project.owner}/${project.repo}` : null;
      },
    },
  ],
  noteActions: [
    {
      id: 'github-send-list',
      label: 'Send list to GitHub',
      icon: RepoMark,
      visible: (noteId) => projectFor(noteId) !== null,
      hint(noteId, body) {
        if (!canWriteIssues()) return NEEDS_TOKEN;
        const project = projectFor(noteId);
        const unsent = unsentItems(body).length;
        if (!unsent) return 'Every item is already an issue.';
        return `${unsent} ${unsent === 1 ? 'item isn’t' : 'items aren’t'} there yet. Each becomes an issue in ${project?.owner}/${project?.repo} and a link.`;
      },
      enabled: (_noteId, body) => canWriteIssues() && unsentItems(body).length > 0,
      async run(editing) {
        const project = projectFor(editing.noteId);
        if (project) await sendItems(project, unsentItems(editing.body()), editing);
      },
    },
  ],
  itemAction: {
    id: 'github-send-item',
    label: 'GitHub',
    busyLabel: 'Sending…',
    available: (noteId) => canWriteIssues() && projectFor(noteId) !== null,
    async run(text, editing) {
      const project = projectFor(editing.noteId);
      if (project) await sendItems(project, [{ text }], editing);
    },
  },
  /** The quiet "GitHub" after each item not sent yet, once a repo is linked and a token is in. */
  suggest(noteId, body) {
    const project = projectFor(noteId);
    if (!project || !canWriteIssues()) return [];
    return unsentItems(body).map((item) => ({
      line: item.line,
      label: 'GitHub',
      busyLabel: 'Sending',
      run: (editing: NoteEditing) => sendItems(project, [{ text: item.text }], editing),
    }));
  },
  marks: githubDetails,
  formatContext: { for: projectContextFor, version: projectContextVersion },
};
