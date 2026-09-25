import { Download, Sparkles } from '@glacier/icons';
import { ProgressBar, Switch } from '@glacier/react';
import { DEFAULT_MODEL, gb, MODELS, useModels } from '../core/ai.ts';
import { setPreferences, usePreferences } from '../core/preferences.ts';
import { isTauri } from '../core/tauri.ts';
import { PaneSection, Pick, RowAction, SettingRow, SettingsCallout, SettingsEmpty, SettingsFootnote } from './kit/settingsKit.tsx';

/**
 * Formatting: which model rewrites notes, and which of them are on the phone.
 *
 * One card lists the catalogue. A model that is here has a radio to choose
 * it; one that is not has Get, which downloads it in the open and shows the
 * bytes arriving. A second card lists what is on the phone with Remove, so
 * the gigabytes are never invisible. Everything runs on the device, and the
 * page says so where a person would wonder.
 */
export function FormattingPane() {
  const prefs = usePreferences();
  const { models, download, problem, fetch, remove } = useModels();
  const chosen = prefs.formatModel;
  const present = new Set(models.filter((m) => m.present).map((m) => m.id));
  const onPhone = MODELS.filter((m) => present.has(m.id));
  const held = onPhone.reduce((sum, m) => sum + m.bytes, 0);
  const downloading = download ? MODELS.find((m) => m.id === download.id) : null;

  if (!isTauri()) {
    return (
      <SettingsEmpty
        icon={<Sparkles size={22} />}
        title="Formatting runs on the phone."
        body="The models are downloaded to and run on the device. Install Ghost.md on Android to use them; nothing leaves the phone."
      />
    );
  }

  return (
    <>
      <PaneSection title="On the phone" description="Every model runs on this phone. Nothing you write or say is sent anywhere to be formatted.">
        <SettingRow
          label="Local only"
          hint={
            prefs.localOnly
              ? 'On. No update checks, no downloads, and plugins that use the network are off. Ghost.md runs from what is on the phone.'
              : 'Turn off update checks, downloads, and every plugin that uses the network. Ghost.md then runs from what is on the phone.'
          }
          control={<Switch aria-label="Local only" checked={prefs.localOnly} onCheckedChange={(localOnly) => setPreferences({ localOnly })} />}
        />
      </PaneSection>

      {downloading && download ? (
        <SettingsCallout icon={<Download size={20} />}>
          <span>
            Getting {downloading.name}, {gb(download.received)} of {gb(download.total)}. Keep Ghost.md open.
          </span>
          <ProgressBar aria-label={`Downloading ${downloading.name}`} value={download.received} max={Math.max(download.total, 1)} size="sm" />
        </SettingsCallout>
      ) : null}
      {problem ? <SettingsCallout>{problem}</SettingsCallout> : null}

      <PaneSection title="Model" description="Which model rewrites your notes. Bigger is more careful, and slower. It runs on the phone; nothing is sent anywhere.">
        {MODELS.map((model) => {
          const here = present.has(model.id);
          const busy = download?.id === model.id;
          return (
            <SettingRow
              key={model.id}
              label={model.name}
              hint={`${model.about} ${gb(model.bytes)}.`}
              value={here ? 'On the phone' : busy ? 'Downloading' : undefined}
              control={
                here ? (
                  <Pick checked={chosen === model.id} label={`Use ${model.name}`} onPress={() => setPreferences({ formatModel: model.id })} />
                ) : (
                  <RowAction onPress={() => void fetch(model.id)} disabled={download !== null}>
                    Get
                  </RowAction>
                )
              }
            />
          );
        })}
      </PaneSection>

      <PaneSection title="On the phone" footer={onPhone.length ? `${gb(held)} of storage.` : undefined}>
        {onPhone.length ? (
          onPhone.map((model) => (
            <SettingRow
              key={model.id}
              label={model.name}
              value={gb(model.bytes)}
              control={
                <RowAction onPress={() => void remove(model.id).then(() => (chosen === model.id ? setPreferences({ formatModel: fallback(present, model.id) }) : undefined))}>
                  Remove
                </RowAction>
              }
            />
          ))
        ) : (
          <SettingRow label="Nothing downloaded yet" hint="Get a model above, or tap the robot on a note and it will offer to." />
        )}
      </PaneSection>

      <SettingsFootnote>The robot's Format, Summarize and Enhance are written by the chosen model from the note's own words. The note itself is never changed unless you tap Apply.</SettingsFootnote>
    </>
  );
}

/** The model to fall back to when the chosen one is removed: another that is here, else the default. */
function fallback(present: Set<string>, removed: string): string {
  const other = MODELS.find((m) => m.id !== removed && present.has(m.id));
  return other?.id ?? DEFAULT_MODEL;
}
