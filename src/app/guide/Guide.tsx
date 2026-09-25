import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from '../art/Icons.tsx';
import { WispText } from '../art/WispText.tsx';
import { useBack } from '../core/back.ts';
import { useSwipeNav } from '../core/swipe.ts';
import { ArrowDown, CloudOff, ShieldCheck, Smartphone, WifiOff } from '@glacier/icons';
import { SideKey as SideKeyArt, Tips as TipsArt } from '../art/Shapes.tsx';
import { isAndroid } from '../core/platform.ts';
import { setPreferences, usePreferences, type ThemePref } from '../core/preferences.ts';
import { gb, MODELS, modelName, useModels } from '../core/ai.ts';
import { isTauri } from '../core/tauri.ts';
import { GUIDE_PAGES as PAGES, type GuidePage as Page } from './pages.ts';
import { MarksTable } from './MarksTable.tsx';
import { AntiAiStage } from './AntiAiStage.tsx';
import { useWispEdge } from '../art/wispEdge.ts';
import { HeadsUp } from './HeadsUp.tsx';
import { SideKeyWaves } from './SideKeyWaves.tsx';
import styles from './Guide.module.css';

/**
 * The walkthrough: set up the side key, then learn to talk in markdown.
 *
 * Shown once on first launch and any time from Settings. Four pages set as
 * type, like the rest of the app, with Back and Next where the thumb is.
 *
 * The side-key page is the one that matters most and the one Glyph can do the
 * least about: Android will not let an app make itself the assistant (the role
 * is marked not requestable), and the side key's own setting belongs to the
 * phone maker. So the page does the three things it can - opens the right
 * settings screen, tells the person exactly which rows to tap on THEIR phone,
 * and checks the result when they come back - and is honest that this replaces
 * Gemini or Bixby.
 *
 * The markdown page renders every example through the real speech rules (see
 * phrases.ts), so what it shows is what a capture writes.
 */

interface GuideProps {
  /**
   * The page showing, held by the caller: the guide unmounts while a capture is
   * on screen (see App), and a person who went off to test the side key from
   * page 2 should come back to page 2.
   */
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Start a voice note from the last page. */
  onTry: () => void;
  /** The reader held the side key before the guide got to it (tooSoon.ts): one line says so, at the top of the page. */
  tooSoon?: boolean;
}

/*
 * The activity's assistant helpers (MainActivity.GlyphHost). Every one is
 * optional: they arrive in native 0.3.1, and an over-the-air page can be
 * running on an older APK that has none of them.
 */
function bridge() {
  return window.GlyphHost;
}

function isAssistantNow(): boolean | null {
  try {
    const host = bridge();
    return host?.isAssistant ? host.isAssistant() : null;
  } catch {
    return null;
  }
}

/** 'samsung', 'pixel', or 'other' - the side key lives in a different place on each. */
function phoneKind(): 'samsung' | 'pixel' | 'other' {
  let maker: string;
  try {
    maker = bridge()?.deviceMaker?.() ?? '';
  } catch {
    maker = '';
  }
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/samsung/i.test(maker) || /\bSM-[A-Z0-9]/.test(ua)) return 'samsung';
  if (/google/i.test(maker) || /\bPixel\b/.test(ua)) return 'pixel';
  return 'other';
}


/**
 * What the nudge says when Next is waiting at the bottom of a page, one picked
 * each time a page opens (Matt: "a 'Down Here' button … put 6 different sassy
 * phrases it could use").
 */
const NUDGES = ['Down here.', 'Keep scrolling, hon.', 'It’s not up there.', 'Scroll. I’ll wait.', 'The good bit’s lower.', 'Thumb down. Literally.'] as const;

/** How long a page is read before the nudge fades in, and how close to the end counts as the bottom. */
const NUDGE_AFTER_MS = 2400;
const BOTTOM_SLACK_PX = 24;

export function Guide({ index, onIndex: setIndex, onClose, onTry, tooSoon }: GuideProps) {
  const page: Page = PAGES[index] ?? 'welcome';
  const last = index === PAGES.length - 1;

  // Next waits at the bottom of the page: it only shows once the page has been scrolled to its end. Until then, after
  // a moment, a nudge fades in where it will be, and a tap on the nudge takes the reader down. A page that fits the
  // screen is already at its bottom. Watched as the page scrolls, resizes, or grows (the heads-up types itself in).
  const pageRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [nudgeDue, setNudgeDue] = useState(false);
  // On the heads-up, the nudge waits for the gags to have played once, through the hot phone (Matt), not for a timer.
  const [watched, setWatched] = useState(false);
  const [nudge, setNudge] = useState<string>(NUDGES[0]);
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return undefined;
    setNudgeDue(false);
    setNudge(NUDGES[Math.floor(Math.random() * NUDGES.length)] ?? NUDGES[0]);
    const check = () => setAtBottom(el.scrollHeight - el.clientHeight - el.scrollTop <= BOTTOM_SLACK_PX);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const resized = new ResizeObserver(check);
    resized.observe(el);
    const grown = new MutationObserver(check);
    grown.observe(el, { childList: true, subtree: true });
    const timer = page === 'welcome' ? 0 : window.setTimeout(() => setNudgeDue(true), NUDGE_AFTER_MS);
    return () => {
      el.removeEventListener('scroll', check);
      resized.disconnect();
      grown.disconnect();
      window.clearTimeout(timer);
    };
  }, [page]);
  const nudgeReady = page === 'welcome' ? watched : nudgeDue;
  // Content slipping behind the top bar goes to smoke: the app's wisp edge (art/wispEdge.ts).
  const topRef = useRef<HTMLElement>(null);
  // And into the fade over its buttons at the foot (Matt: "anywhere we use the dark gradient color overlay we should
  // include a slight wisp effect").
  useWispEdge(pageRef, page, topRef, { foot: true });
  const toBottom = () => pageRef.current?.scrollTo({ top: pageRef.current.scrollHeight, behavior: 'smooth' });

  // The phone's back gesture (and Escape) steps back through the guide before
  // it closes it; a swipe right does the same, and a swipe left is Next.
  const stepBack = () => {
    if (index > 0) setIndex(index - 1);
    else onClose();
  };
  useBack(true, stepBack);
  const root = useRef<HTMLDivElement>(null);
  useSwipeNav(root, {
    onBack: stepBack,
    onForward: () => {
      if (!last && atBottom) setIndex(index + 1);
    },
  });

  return (
    <div ref={root} className={styles.guide} role="dialog" aria-modal="true" aria-label="How to use Ghost.md">
      <header ref={topRef} className={`app-headerPane ${styles.top}`}>
        <span className={styles.progress}>
          {index + 1} of {PAGES.length}
        </span>
        <button type="button" className={`app-word ${styles.skip}`} onClick={onClose}>
          {last ? 'Close' : 'Skip'}
        </button>
      </header>

      {/*
        The rings from the side key wait for its page, where the key is the subject (Matt: "remove the animation … until we
        get to that step"). Drawn here, outside the scrolling page, so they stay put while it scrolls (Matt: "the ripples
        should stay where they are and not scroll with the page"); inside it, the page's wisp edge (a filter) would make
        their fixed position scroll along.
      */}
      {page === 'sidekey' ? <SideKeyWaves /> : null}
      <div ref={pageRef} className={styles.page} key={page}>
        {/* The reader held the side key before the guide got to it (tooSoon.ts): one line, out of smoke like the rest. */}
        {tooSoon ? (
          <p className={styles.tooSoon} role="status">
            <WispText text="Not yet, finish reading." pace={18} />
          </p>
        ) : null}
        {page === 'welcome' ? <Welcome onWatched={() => setWatched(true)} /> : null}
        {page === 'theme' ? <Theme /> : null}
        {page === 'model' ? <Model /> : null}
        {page === 'sidekey' ? <SideKey /> : null}
        {page === 'marks' ? <Marks /> : null}
        {page === 'tips' ? <Tips /> : null}
      </div>

      <nav className={styles.dock} aria-label="Guide">
        <button
          type="button"
          className={`app-word ${styles.nav}`}
          onClick={() => setIndex(index - 1)}
          disabled={index === 0}
          data-hidden={index === 0 ? '' : undefined}
        >
          Back
        </button>
        <span className={styles.nextSlot}>
          <button
            type="button"
            className={`app-pill ${styles.primary} ${styles.nudge}`}
            data-shown={(!atBottom && nudgeReady) || undefined}
            aria-hidden={atBottom || !nudgeReady}
            tabIndex={atBottom || !nudgeReady ? -1 : 0}
            onClick={toBottom}
          >
            <ArrowDown size={18} strokeWidth={2.6} aria-hidden="true" />
            {nudge}
          </button>
          {last ? (
            <button
              type="button"
              className={`app-pill ${styles.primary} ${styles.next}`}
              data-shown={atBottom || undefined}
              aria-hidden={!atBottom}
              tabIndex={atBottom ? 0 : -1}
              onClick={() => {
                onClose();
                onTry();
              }}
            >
              <span className={styles.dot} aria-hidden="true" />
              Try it
            </button>
          ) : (
            <button
              type="button"
              className={`app-pill ${styles.primary} ${styles.next}`}
              data-shown={atBottom || undefined}
              aria-hidden={!atBottom}
              tabIndex={atBottom ? 0 : -1}
              onClick={() => setIndex(index + 1)}
            >
              Next
            </button>
          )}
        </span>
      </nav>
    </div>
  );
}

/**
 * The first page: a heads-up that there's AI in Glyph, and that all of it runs
 * on the phone.
 *
 * Matt: "a heads up page that we use AI but say that it all runs on local
 * models on your phone", with three funny anti-AI gags played over the top in
 * one ink and simple SVG (AntiAiStage.tsx): no clubbed baby seals, no
 * datacenter water gone toxic, and no help staying clever ("that one's on
 * you"). Then the headline, typed out of smoke (art/WispText.tsx), one
 * sentence, and four promises as ink icon pills that pop in one after
 * another. The headline comes first, then the gags (Matt: "move the heads up
 * … to the very top"); the side key's rings wait for the side-key page.
 */
function Welcome({ onWatched }: { onWatched: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <>
      {/* "Heads up: we use AI." big, a flame behind the AI; "Ethically, on your phone." under it (HeadsUp.tsx). */}
      <HeadsUp onDone={() => setShow(true)} />
      <AntiAiStage waiting={!show} onRound={onWatched} />
      <p className={styles.lead}>
        Ghost.md uses AI to turn what you say into notes. Every model runs right here on your phone, so nothing you say goes to a cloud, a company, or
        anyone. Unless you share them, I guess.
      </p>
      <ul className={styles.promises} aria-label="How Ghost.md’s AI works">
        {PROMISES.map(({ icon: Icon, label }, index) => (
          <li key={label} className={styles.promise} style={{ animationDelay: `${240 + index * 110}ms` }}>
            <span className={styles.promiseIcon} aria-hidden="true">
              <Icon size={18} strokeWidth={2.4} />
            </span>
            {label}
          </li>
        ))}
      </ul>
    </>
  );
}

const PROMISES = [
  { icon: Smartphone, label: 'Runs on your phone' },
  { icon: CloudOff, label: 'No cloud' },
  { icon: WifiOff, label: 'Works offline' },
  { icon: ShieldCheck, label: 'Nothing sent anywhere' },
] as const;

const THEME_CHOICES: Array<{ value: ThemePref; label: string; hint: string }> = [
  { value: 'dark', label: 'Dark', hint: 'Light words on black. Easier on the eyes at night.' },
  { value: 'light', label: 'Light', hint: 'Dark words on white, like paper.' },
  { value: 'system', label: 'Match the phone', hint: 'Follows your phone’s dark mode.' },
];

/**
 * Light or dark, asked up front, because in an app that is almost all type the
 * ground behind the words is most of the look. Each choice applies the moment
 * it is tapped - the guide itself changes colour under the thumb - so the
 * person decides by seeing, not by imagining. Changeable any time in Settings.
 *
 * The page used to flick the theme on and off by itself a few times, to show there was a choice (GloveSwitch, since
 * removed: Matt, "remove the effect that flicks it on and off and whatnot automatically it's annoying"). It stays
 * still now until a choice is tapped.
 */
function Theme() {
  const { theme } = usePreferences();
  return (
    <>
      <h1 className={styles.title}>Light or dark?</h1>
      <p className={styles.lead}>Pick one to see it. You can change it later in Settings.</p>
      <div className={styles.choices} role="radiogroup" aria-label="Theme">
        {THEME_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={theme === choice.value}
            className={`${styles.choice} ${theme === choice.value ? 'app-inverse' : ''}`}
            data-selected={theme === choice.value ? '' : undefined}
            onClick={() => setPreferences({ theme: choice.value })}
          >
            <span className={styles.swatch} data-swatch={choice.value} aria-hidden="true">
              Aa
            </span>
            <span className={styles.choiceText}>
              <span className={styles.stepTitle}>{choice.label}</span>
              <span className={styles.note}>{choice.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Which model formats notes, asked up front like the theme: the choice is a
 * row per model with its size, the chosen one printed in reverse. Choosing
 * only sets the preference; the bytes come when Formatted is first opened,
 * or now, from the word under the list, so a phone on wifi tonight is ready
 * tomorrow. Changeable any time in Settings > Formatting.
 */
function Model() {
  const { formatModel } = usePreferences();
  const { models, download, problem, fetch } = useModels();
  const here = models.find((m) => m.id === formatModel)?.present ?? false;
  const chosen = MODELS.find((m) => m.id === formatModel);
  return (
    <>
      <h1 className={styles.title}>Choose your model</h1>
      <p className={styles.lead}>It rewrites your notes on the phone. Bigger is more careful, and slower. Nothing leaves the phone.</p>
      <div className={styles.choices} role="radiogroup" aria-label="Model">
        {MODELS.map((model) => (
          <button
            key={model.id}
            type="button"
            role="radio"
            aria-checked={formatModel === model.id}
            className={`${styles.choice} ${formatModel === model.id ? 'app-inverse' : ''}`}
            data-selected={formatModel === model.id ? '' : undefined}
            onClick={() => setPreferences({ formatModel: model.id })}
          >
            <span className={`${styles.swatch} ${styles.size}`} aria-hidden="true">
              {gb(model.bytes)}
            </span>
            <span className={styles.choiceText}>
              <span className={styles.stepTitle}>{model.name}</span>
              <span className={styles.note}>{model.about}</span>
            </span>
          </button>
        ))}
      </div>
      {isTauri() && chosen ? (
        <p className={styles.fine}>
          {download?.id === formatModel
            ? `Getting ${modelName(formatModel)}, ${gb(download.received)} of ${gb(download.total)}. Keep Ghost.md open.`
            : here
              ? `${chosen.name} is on the phone.`
              : problem
                ? problem
                : `${chosen.name} downloads the first time you ask the robot on a note, or `}
          {!here && download === null ? (
            <button type="button" className={`app-word ${styles.action}`} onClick={() => void fetch(formatModel)}>
              get it now
            </button>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

function SideKey() {
  const [held, setHeld] = useState<boolean | null>(() => isAssistantNow());
  const kind = useMemo(phoneKind, []);
  const canOpen = Boolean(bridge()?.openAssistantSettings);

  // The person leaves for Settings and comes back; look again when they do.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'visible') setHeld(isAssistantNow());
    };
    document.addEventListener('visibilitychange', recheck);
    return () => document.removeEventListener('visibilitychange', recheck);
  }, []);

  const open = useCallback(() => {
    try {
      bridge()?.openAssistantSettings?.();
    } catch {
      // Nothing to open on this build; the written steps still stand.
    }
  }, []);

  if (!isAndroid) {
    return (
      <>
        <SideKeyArt className={styles.art} />
        <h1 className={styles.title}>The side key is an Android thing.</h1>
        <p className={styles.lead}>Here, tap Speak at the bottom of your notes to start a voice note.</p>
      </>
    );
  }

  const assistantPath =
    kind === 'samsung'
      ? ['Settings', 'Apps', 'Choose default apps', 'Digital assistant app', 'Device assistance app', 'Ghost.md']
      : ['Settings', 'Apps', 'Default apps', 'Digital assistant app', 'Default digital assistant app', 'Ghost.md'];
  const keyPath =
    kind === 'samsung'
      ? ['Settings', 'Advanced features', 'Side button', 'Press and hold', 'Digital assistant']
      : kind === 'pixel'
        ? ['Settings', 'System', 'Gestures', 'Press and hold power button', 'Digital assistant']
        : ['Settings', 'search “press and hold”', 'Digital assistant'];

  return (
    <>
      <SideKeyArt className={styles.art} />
      <h1 className={styles.title}>Make the side key record.</h1>
      {held ? (
        <p className={styles.done} role="status">
          <span aria-hidden="true">✓</span> Ghost.md is your assistant.
        </p>
      ) : null}

      <ol className={styles.steps}>
        <li>
          <h2 className={styles.stepTitle}>Make Ghost.md your digital assistant.</h2>
          <Path parts={assistantPath} />
          {canOpen && !held ? (
            <button type="button" className={`app-word ${styles.action}`} onClick={open}>
              Open assistant settings <ArrowRight />
            </button>
          ) : null}
        </li>
        <li>
          <h2 className={styles.stepTitle}>Point the side key at it.</h2>
          <Path parts={keyPath} />
          {kind === 'samsung' ? (
            <p className={styles.note}>
              Choose Digital assistant, not Bixby. On a Fold this is the key under your thumb when the phone is open.
            </p>
          ) : null}
        </li>
        <li>
          <h2 className={styles.stepTitle}>Hold the key and talk.</h2>
          <p className={styles.note}>
            Ghost.md opens already listening, even on the lock screen. Let go and talk. If the phone is locked, the note is
            there once you unlock it.
          </p>
        </li>
        <li>
          <h2 className={styles.stepTitle}>Hold the side key again to stop.</h2>
          <p className={styles.note}>That saves the note. Tapping Done does the same.</p>
        </li>
        <li>
          <h2 className={styles.stepTitle}>Say where things go, and Ghost.md sorts it after.</h2>
          <p className={styles.note}>
            “Add oat milk to groceries” goes to your Groceries note, and the rest becomes a new note. You see where
            everything is going before anything is filed. Turn off Memo mode in Settings to get a plain new note every
            time.
          </p>
        </li>
      </ol>

      <p className={styles.fine}>
        This replaces {kind === 'samsung' ? 'Bixby or Gemini' : 'Gemini'} as your assistant. Switch back in the same place any
        time.
      </p>
    </>
  );
}

function Path({ parts }: { parts: string[] }) {
  return (
    <p className={styles.path}>
      {parts.map((part, i) => (
        <span key={part}>
          {i > 0 ? <span className={styles.sep} aria-hidden="true"> › </span> : null}
          <span className={i === parts.length - 1 ? styles.target : undefined}>{part}</span>
        </span>
      ))}
    </p>
  );
}

function Marks() {
  return (
    <>
      <h1 className={styles.title}>Every mark, side by side.</h1>
      <p className={styles.lead}>
        What you type is on the left, how the note reads it on the right. The marks stay on the page as you write, so you can always see what a line is doing.
      </p>
      <MarksTable />
    </>
  );
}

function Tips() {
  return (
    <>
      <TipsArt className={styles.art} />
      <h1 className={styles.title}>A few habits.</h1>
      <ol className={styles.steps}>
        <li>
          <h2 className={styles.stepTitle}>Pause before a cue word.</h2>
          <p className={styles.note}>A short pause before “heading” or “bullet point” starts a new sentence. That’s where Ghost.md listens for cues.</p>
        </li>
        <li>
          <h2 className={styles.stepTitle}>Or say the cue on its own.</h2>
          <p className={styles.note}>“Bullet point.” Pause. “Oat milk.” The cue waits for the next thing you say.</p>
        </li>
        <li>
          <h2 className={styles.stepTitle}>Stop for two seconds to start a paragraph.</h2>
          <p className={styles.note}>You don’t have to say it. The pause does it.</p>
        </li>
        <li>
          <h2 className={styles.stepTitle}>Talk normally.</h2>
          <p className={styles.note}>Ghost.md picks lists and to-dos out of normal speech. It never changes your words, only how they’re laid out.</p>
        </li>
        <li>
          <h2 className={styles.stepTitle}>Fix it after.</h2>
          <p className={styles.note}>A voice note lands at the top of your notes. Open it to fix anything. The markdown is all there.</p>
        </li>
      </ol>
    </>
  );
}
