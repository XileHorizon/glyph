import { Ghost } from '../art/Ghost.tsx';
import { useState, type FormEvent } from 'react';
import { KeyRound, LogOut, RefreshCw, ShieldCheck } from '@glacier/icons';
import { Input, Switch } from '@glacier/react';
import { changePassword, handleProblem, newRecoveryCodes, passwordProblem, recover, signIn, signUp, useAccount } from '../core/account/account.ts';
import { setLiveEnabled, useLiveEnabled } from '../core/live/enabled.ts';
import { preferences } from '../core/preferences.ts';
import { signOutHere, syncNow, syncedWhen, useSyncStatus } from '../core/sync/engine.ts';
import { PaneHero, PaneSection, RowAction, SettingRow, SettingsCallout, SettingsFootnote } from './kit/settingsKit.tsx';

/**
 * Account: a Glyph account keeps notes, their recordings and pictures, and settings the same on every device
 * (docs/SYNC.md). Everything is sealed on the device before it is sent, so the page says so plainly, and says the one
 * consequence that follows: a password and every recovery code lost is an account nobody can open, us included.
 */

type Mode = 'in' | 'up' | 'recover';

function Codes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <PaneSection
      title="Recovery codes"
      description="Keep these somewhere safe, away from this device. Each opens your account once if the password is lost. They are shown this once and never again."
      footer={<RowAction onPress={onDone}>I've kept them</RowAction>}
    >
      <div className="setk-codes" data-testid="recovery-codes">
        {codes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
      <SettingRow label="Copy all" onPress={() => void navigator.clipboard?.writeText(codes.join('\n'))} />
    </PaneSection>
  );
}

function SignedOut({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const [mode, setMode] = useState<Mode>('in');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const offline = preferences().localOnly;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const early = handleProblem(handle) ?? (mode !== 'in' ? passwordProblem(password) : null);
    if (early) return setProblem(early);
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'up') onCodes((await signUp(handle, password)).codes);
      else if (mode === 'recover') onCodes((await recover(handle, code, password)).codes);
      else await signIn(handle, password);
      void syncNow();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const verb = mode === 'up' ? 'Create account' : mode === 'recover' ? 'Recover and set password' : 'Sign in';
  return (
    <>
      {offline ? <SettingsCallout>“Nothing leaves the phone” is on in Developer, so nothing syncs until it is off.</SettingsCallout> : null}
      <Ghost scene="signed-out" align="center" />
      <PaneSection
        title={mode === 'up' ? 'New account' : mode === 'recover' ? 'Recover' : 'Sign in'}
        description="Keep your notes, recordings and settings the same on your phone and computer. They are encrypted on the device first: the service stores only what it cannot read."
      >
        <form className="setk-form" onSubmit={(e) => void submit(e)}>
          <Input aria-label="Handle" placeholder="Handle" autoComplete="username" autoCapitalize="none" spellCheck={false} value={handle} onChange={(e) => setHandle(e.target.value)} />
          {mode === 'recover' ? (
            <Input aria-label="Recovery code" placeholder="Recovery code" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          ) : null}
          <Input
            aria-label={mode === 'recover' ? 'New password' : 'Password'}
            placeholder={mode === 'recover' ? 'New password' : 'Password'}
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {problem ? (
            <p className="setk-form__problem" role="alert">
              {problem}
            </p>
          ) : null}
          <button type="submit" className="app-word setk-form__submit" disabled={busy || !handle || !password || (mode === 'recover' && !code)}>
            {busy ? 'One moment…' : verb}
          </button>
        </form>
      </PaneSection>
      <PaneSection>
        {mode !== 'in' ? <SettingRow label="I have an account" onPress={() => setMode('in')} /> : null}
        {mode !== 'up' ? <SettingRow label="Create an account" onPress={() => setMode('up')} /> : null}
        {mode !== 'recover' ? <SettingRow label="Lost the password" hint="Use one of your recovery codes." onPress={() => setMode('recover')} /> : null}
      </PaneSection>
      <SettingsFootnote>
        Your password never leaves this device, and nobody can reset it for you: without it or a recovery code, the notes in an account can't be opened by anyone. Notes on this device stay here either
        way.
      </SettingsFootnote>
    </>
  );
}

function PasswordForm({ onCodes, onDone }: { onCodes: (codes: string[]) => void; onDone: () => void }) {
  const [what, setWhat] = useState<'password' | 'codes'>('password');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (what === 'password') {
        await changePassword(current, next);
        onDone();
      } else {
        onCodes((await newRecoveryCodes(current)).codes);
      }
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PaneSection title={what === 'password' ? 'Change password' : 'New recovery codes'} footer={<RowAction onPress={onDone}>Cancel</RowAction>}>
      <form className="setk-form" onSubmit={(e) => void submit(e)}>
        <Input aria-label="Current password" placeholder="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        {what === 'password' ? (
          <Input aria-label="New password" placeholder="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        ) : null}
        {problem ? (
          <p className="setk-form__problem" role="alert">
            {problem}
          </p>
        ) : null}
        <button type="submit" className="app-word setk-form__submit" disabled={busy || !current || (what === 'password' && !next)}>
          {busy ? 'One moment…' : what === 'password' ? 'Change password' : 'Make new codes'}
        </button>
        <button type="button" className="app-word" onClick={() => setWhat(what === 'password' ? 'codes' : 'password')}>
          {what === 'password' ? 'Make new recovery codes instead' : 'Change the password instead'}
        </button>
      </form>
    </PaneSection>
  );
}

export function AccountPane() {
  const account = useAccount();
  const status = useSyncStatus();
  const live = useLiveEnabled();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);

  if (codes) return <Codes codes={codes} onDone={() => setCodes(null)} />;
  if (!account.session) return <SignedOut onCodes={setCodes} />;

  const statusText =
    status.phase === 'syncing'
      ? 'Syncing'
      : status.phase === 'error'
        ? (status.message ?? 'Not synced')
        : status.lastAt
          ? `Synced ${syncedWhen(status.lastAt)}`
          : account.unlocked
            ? 'Waiting to sync'
            : 'Sign in again to sync';
  return (
    <>
      <PaneSection>
        <PaneHero glyph={<ShieldCheck size={22} />} title={account.session.handle} meta="End-to-end encrypted" status={{ text: statusText, pulse: status.phase === 'syncing' }} />
      </PaneSection>
      {status.conflicts ? (
        <SettingsCallout>
          {status.conflicts === 1 ? 'A note was' : `${status.conflicts} notes were`} changed on two devices at once. Both versions are kept as separate notes.
        </SettingsCallout>
      ) : null}
      {editing ? (
        <PasswordForm
          onCodes={(next) => {
            setEditing(false);
            setCodes(next);
          }}
          onDone={() => setEditing(false)}
        />
      ) : (
        <PaneSection title="Sync" footer="Notes, their recordings and pictures, and your settings. The model you downloaded and Developer settings stay on each device.">
          <SettingRow icon={<RefreshCw size={20} />} label="Sync now" onPress={() => void syncNow()} disabled={status.phase === 'syncing'} />
          {/* Live sync (docs/LIVE.md), on by hand while it is being tried: off, nothing of it is loaded at all. */}
          <SettingRow
            label="Live typing (trial)"
            hint="A note open on two of your devices shows what is typed on either as it is typed, end to end encrypted like everything else. Starts with the next note you open."
            control={<Switch aria-label="Live typing" checked={live} onCheckedChange={setLiveEnabled} />}
          />
          <SettingRow icon={<KeyRound size={20} />} label="Password and recovery codes" onPress={() => setEditing(true)} />
          <SettingRow icon={<LogOut size={20} />} label="Sign out" hint="Your notes stay on this device." onPress={() => void signOutHere()} />
        </PaneSection>
      )}
    </>
  );
}
