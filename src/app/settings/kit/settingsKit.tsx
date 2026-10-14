import type { ReactNode } from 'react';
import { ChevronRight } from '@glacier/icons';
import '../settings.css';

/**
 * The settings vocabulary, on loan from AttackFM (src/app/settings/kit there)
 * and dressed in ink. Every pane says what it says through these, so the
 * panes cannot each grow a dialect: one card (PaneSection), one row
 * (SettingRow), one hero, one callout, one empty state, one footnote.
 *
 * What changed on the way over: no tints. AttackFM colours each section's
 * icon chip; Glyph has one ink and one paper, so a chip is ink on paper-2 and
 * a tile is the same, and a danger row is plain words. SegmentedControl stays
 * the VALUE input everywhere in settings, as in the kit's own rules.
 *
 * The classes are global (`setk-*`, `settingsScreen__*`) rather than a CSS
 * module, deliberately: settings.css is one file that styles the whole
 * surface, shell and kit together, and reads like a stylesheet.
 */

// --- the card ---------------------------------------------------------------

interface PaneSectionProps {
  /** ONE heading style: a small-caps muted caption above the card. */
  title?: string;
  /** A muted introduction between the title and the card. */
  description?: ReactNode;
  /** A muted footnote BELOW the card: status readouts, attached to their group. */
  footer?: ReactNode;
  children: ReactNode;
}

/** The group card. Rows inside share one surface and hairline separators. */
export function PaneSection({ title, description, footer, children }: PaneSectionProps) {
  return (
    <section className="setk">
      {title ? <div className="setk__title">{title}</div> : null}
      {description ? <div className="setk__desc">{description}</div> : null}
      <div className="setk__card">{children}</div>
      {footer ? <div className="setk__footer">{footer}</div> : null}
    </section>
  );
}

// --- the row ----------------------------------------------------------------

interface SettingRowProps {
  icon?: ReactNode;
  label: ReactNode;
  /** The caption, bound under the label. */
  hint?: ReactNode;
  /** Trailing control: Switch, SegmentedControl, Button. */
  control?: ReactNode;
  /** Trailing muted text for display rows. */
  value?: ReactNode;
  /** Makes the whole row the button; a chevron appears by itself. */
  onPress?: () => void;
  /** `trailing` seats the control at the row's end; `stacked` gives it the full width below the text. */
  layout?: 'trailing' | 'stacked';
  disabled?: boolean;
  /** Why the row is disabled, said one way everywhere. */
  disabledReason?: string;
}

export function SettingRow({ icon, label, hint, control, value, onPress, layout = 'trailing', disabled, disabledReason }: SettingRowProps) {
  const off = disabled || Boolean(disabledReason);
  const body = (
    <>
      {icon ? <span className="setk-row__icon">{icon}</span> : null}
      <span className="setk-row__text">
        <span className="setk-row__label">{label}</span>
        {hint ? <span className="setk-row__hint">{hint}</span> : null}
        {disabledReason ? <span className="setk-row__why">{disabledReason}</span> : null}
      </span>
      {value != null ? <span className="setk-row__value">{value}</span> : null}
      {control != null && layout === 'trailing' ? <span className="setk-row__control">{control}</span> : null}
      {onPress ? (
        <span className="setk-row__chevron" aria-hidden="true">
          <ChevronRight size={18} />
        </span>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <button type="button" className="setk-row setk-row--press" disabled={off} onClick={onPress}>
        {body}
      </button>
    );
  }
  return (
    <div
      className="setk-row"
      data-disabled={off || undefined}
      data-stacked={layout === 'stacked' || undefined}
      // `inert`, not just the CSS: pointer-events:none stops a tap but not a
      // Tab, and a disabled row was still keyboard-operable without it.
      inert={off || undefined}
    >
      <div className="setk-row__main">{body}</div>
      {control != null && layout === 'stacked' ? <div className="setk-row__wide">{control}</div> : null}
    </div>
  );
}

// --- the hero ---------------------------------------------------------------

interface PaneHeroProps {
  glyph?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** A line under the meta with a dot: what state the thing is in. */
  status?: { text: string; pulse?: boolean };
  trailing?: ReactNode;
  /** The whole hero pressable, without looking like a button (About's version). */
  onPress?: () => void;
}

/** One anatomy for "this thing, at a glance". */
export function PaneHero({ glyph, title, meta, status, trailing, onPress }: PaneHeroProps) {
  const inner = (
    <>
      {glyph ? <span className="setk-hero__glyph">{glyph}</span> : null}
      <span className="setk-hero__body">
        <span className="setk-hero__title">{title}</span>
        {meta ? <span className="setk-hero__meta">{meta}</span> : null}
        {status ? (
          <span className="setk-hero__status" data-pulse={status.pulse || undefined}>
            <span className="setk-hero__dot" aria-hidden="true" />
            {status.text}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="setk-hero__trailing">{trailing}</span> : null}
    </>
  );
  if (onPress) {
    return (
      <button type="button" className="setk-hero setk-hero--press" onClick={onPress}>
        {inner}
      </button>
    );
  }
  return <div className="setk-hero">{inner}</div>;
}

// --- the banner -------------------------------------------------------------

interface SettingsCalloutProps {
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

/** One banner: a paper-2 card with a hairline, for the thing happening now. */
export function SettingsCallout({ icon, action, children }: SettingsCalloutProps) {
  return (
    <div className="setk-callout">
      {icon ? <span className="setk-callout__icon">{icon}</span> : null}
      <div className="setk-callout__body">{children}</div>
      {action ? <div className="setk-callout__action">{action}</div> : null}
    </div>
  );
}

// --- gated / empty ----------------------------------------------------------

interface SettingsEmptyProps {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: { label: string; onPress: () => void };
}

/** One shape for "this pane needs something you have not set up". */
export function SettingsEmpty({ icon, title, body, action }: SettingsEmptyProps) {
  return (
    <div className="setk-empty">
      {icon ? <span className="setk-empty__icon">{icon}</span> : null}
      <span className="setk-empty__title">{title}</span>
      {body ? <span className="setk-empty__body">{body}</span> : null}
      {action ? (
        <button type="button" className="app-word setk-empty__action" onClick={action.onPress}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

// --- the footnote -----------------------------------------------------------

/** A small muted paragraph for the things that are true but not rows. */
export function SettingsFootnote({ children }: { children: ReactNode }) {
  return <p className="setk-footnote">{children}</p>;
}

// --- a word that acts -------------------------------------------------------

/** The quiet action a row carries: a word in ink, the app's own button. */
export function RowAction({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="app-word setk-action" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  );
}

// --- pick one ---------------------------------------------------------------

/** A radio drawn as a ring with an ink dot when chosen; the row's control. */
export function Pick({ checked, label, onPress, disabled }: { checked: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={checked} aria-label={label} className="setk-pick" onClick={onPress} disabled={disabled} data-haptic="selection">
      <span className="setk-pick__dot" aria-hidden="true" />
    </button>
  );
}
