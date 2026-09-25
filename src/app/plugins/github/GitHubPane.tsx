import { useState } from 'react';
import { GitBranch } from '@glacier/icons';
import { PaneSection, RowAction, SettingRow, SettingsEmpty, SettingsFootnote } from '../../settings/kit/settingsKit.tsx';
import { githubToken, projects, removeProject, setGithubToken, type Project } from './repos.ts';

/**
 * The GitHub plugin's page in Settings: the repos read on this phone, each with
 * what wrote its briefing and a way to forget it, and the token, which private
 * repos need to be read and every repo needs before a note's list items can go
 * there as issues. Linking a repo to a note is on the note, from its cog.
 */
export function GitHubPane() {
  const [known, setKnown] = useState<Project[]>(() => projects());
  const [hasToken, setHasToken] = useState(() => githubToken() !== '');
  /** The token being typed, before it is kept. */
  const [typed, setTyped] = useState('');

  return (
    <>
      <PaneSection title="Repos" description="Repos the model on your phone has read. A note linked to one is formatted knowing its names and terms, and its list items can go there as issues.">
        {known.length ? (
          known.map((p) => (
            <SettingRow
              key={p.id}
              icon={<GitBranch size={16} />}
              label={`${p.owner}/${p.repo}`}
              hint={`${p.packModel ? `Read by ${p.packModel}` : 'Kept from its README'}, ${new Date(p.packedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.`}
              control={
                <RowAction
                  onPress={() => {
                    removeProject(p.id);
                    setKnown(projects());
                  }}
                >
                  Forget
                </RowAction>
              }
            />
          ))
        ) : (
          <SettingsEmpty icon={<GitBranch size={22} />} title="No repos yet." body="Open a note, tap More, and choose GitHub repo to link one." />
        )}
      </PaneSection>

      <PaneSection title="Token" description="A token lets Ghost.md read private repos and make and close issues from your notes. It stays on this phone.">
        {hasToken ? (
          <SettingRow
            label="A token is kept"
            hint="Issues can be made and closed from a linked note."
            control={
              <RowAction
                onPress={() => {
                  setGithubToken('');
                  setHasToken(false);
                  setTyped('');
                }}
              >
                Forget
              </RowAction>
            }
          />
        ) : (
          <SettingRow
            label="No token"
            hint="Public repos are read without one, but sending list items as issues needs it."
            layout="stacked"
            control={
              <div className="ghp-token">
                {/* A plain field, not the kit's: this pane is reached through the plugin registry, which every test loads. */}
                <input
                  className="ghp-tokenField"
                  type="password"
                  inputMode="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="github_pat_…"
                  aria-label="GitHub token"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                />
                <RowAction
                  disabled={!typed.trim()}
                  onPress={() => {
                    setGithubToken(typed);
                    setHasToken(githubToken() !== '');
                    setTyped('');
                  }}
                >
                  Keep it
                </RowAction>
              </div>
            }
          />
        )}
      </PaneSection>

      <SettingsFootnote>Only the repo goes to the model, and the model runs on your phone. Issues carry the words of the items you send, and nothing else.</SettingsFootnote>
    </>
  );
}
