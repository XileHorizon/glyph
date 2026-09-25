import { useState } from 'react';
import { SheetField, SheetGroup, SheetHeading, SheetNote, SheetRow, SheetTitle } from '../kit.tsx';
import { RepoMark } from './marks.tsx';
import { addProject, githubToken, linkProject, projectFor, projects, setGithubToken, type Project, type Step } from './repos.ts';

/**
 * The projects kept on this phone, one to link to a note, and a way to add
 * one: paste a GitHub link (and a token for a private repo), and watch it
 * being read and distilled on the phone before it is linked.
 */
export function ProjectPicker({ noteId, onDone }: { noteId: string; onDone: () => void }) {
  const [chosen, setChosen] = useState<Project | null>(() => projectFor(noteId));
  const [known, setKnown] = useState<Project[]>(() => projects());
  const [link, setLink] = useState('');
  const [token, setToken] = useState(() => githubToken());
  const [showToken, setShowToken] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const choose = (project: Project | null) => {
    linkProject(noteId, project?.id ?? null);
    setChosen(project);
    onDone();
  };

  const add = async () => {
    setTrouble(null);
    setGithubToken(token);
    try {
      const added = await addProject(link, setStep);
      setKnown(projects());
      setStep(null);
      choose(added);
    } catch (failure) {
      setStep(null);
      setTrouble(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const working = step !== null;
  return (
    <>
      <SheetTitle>Project</SheetTitle>
      <SheetNote>The model on your phone reads the repo’s README and docs and keeps a short briefing, so names and terms come out right when this note is formatted.</SheetNote>

      {known.length ? (
        <SheetGroup>
          {known.map((p) => (
            <SheetRow
              key={p.id}
              icon={RepoMark}
              label={`${p.owner}/${p.repo}`}
              hint={p.packModel ? `Read by ${p.packModel}.` : 'Kept from its README.'}
              chosen={chosen?.id === p.id}
              onPress={() => choose(p)}
              disabled={working}
            />
          ))}
        </SheetGroup>
      ) : null}

      <SheetHeading>Add a GitHub repo</SheetHeading>
      <SheetGroup>
        <SheetField
          label="Link"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="github.com/owner/repo"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={working}
        />
        {showToken ? (
          <SheetField
            label="Token, for a private repo"
            type="password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={working}
          />
        ) : (
          <SheetRow label="Private repo?" hint="Add a GitHub token that can read it. It stays on this phone." onPress={() => setShowToken(true)} disabled={working} />
        )}
        <SheetRow label={working ? 'Reading…' : 'Read and link'} hint={step ? describeStep(step) : undefined} onPress={() => void add()} disabled={working || !link.trim()} />
      </SheetGroup>
      {step?.kind === 'distilling' && step.text ? <SheetNote>{step.text.slice(-240)}</SheetNote> : null}
      {trouble ? <SheetNote>{trouble}</SheetNote> : null}

      {chosen ? (
        <SheetGroup>
          <SheetRow label="Don’t link a project" onPress={() => choose(null)} disabled={working} />
        </SheetGroup>
      ) : null}
    </>
  );
}

function describeStep(step: Step): string {
  switch (step.kind) {
    case 'reading':
      return 'Asking GitHub about the repo…';
    case 'files':
      return step.done < step.total ? `Reading ${step.done + 1} of ${step.total} files…` : 'Read the files.';
    default:
      return `${step.model} is reading it${step.tokensPerSecond ? `, ${Math.round(step.tokensPerSecond)} words a second` : ''}…`;
  }
}
