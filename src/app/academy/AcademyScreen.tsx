import { ArrowLeft, Check, GraduationCap, ListChecks, RotateCcw, Wand2 } from '@glacier/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { CHAPTERS, LESSONS, lessonsIn, readProgress, writeProgress, type Lesson } from './lessons.ts';
import { Playground } from './Playground.tsx';
import styles from './AcademyScreen.module.css';

/**
 * Glyph Academy: markdown taught a mark at a time, by typing it (Matt: "we need a Glyph Academy section that teaches
 * you markdown then teaches you the extra stuff we have. Build the academy section start with just the markdown
 * basics set it up as a live code type thing where it teaches you then you type it and see it format below").
 *
 * A lesson says what a mark does and shows one line using it; then the person writes their own, in a field with the
 * note's own drawing of it underneath, changing as they type (academy/Playground.tsx). The moment what they typed
 * has the mark in it the lesson is ticked and Next appears - but nothing is taken away, so they can carry on playing
 * with it. **Show me** writes the example into the field for anyone who would rather start from something that works,
 * and a lesson can always be skipped.
 *
 * Progress is kept (academy/lessons.ts), so the Academy opens at the first lesson not passed, and any lesson can be
 * taken again from the summary at the end. Nothing typed here is saved as a note: it is a page to play on.
 *
 * The chapters are the teaching order, and markdown basics is the first of them; Glyph's own marks are the next, and
 * until they are written the summary points at the cheat sheet, which has every one of them.
 */

export function AcademyScreen({ onDone, onCheatSheet }: { onDone: () => void; onCheatSheet: () => void }) {
  const [done, setDone] = useState<Set<string>>(readProgress);
  /**
   * The lesson in hand, held until Next is pressed. It cannot be worked out from what has been learned: passing a
   * lesson would then move the page on the instant the mark was typed, and the whole point is to stay and watch it
   * format. Empty is the summary at the end.
   */
  const [at, setAt] = useState<string>(() => firstLeft(readProgress()));
  const [typed, setTyped] = useState('');
  const [hinting, setHinting] = useState(false);

  const lesson = useMemo(() => LESSONS.find((one) => one.id === at) ?? null, [at]);

  useBack(true, onDone);

  // A new lesson starts on a clean page, with its hint put away.
  const showing = lesson?.id ?? '';
  const was = useRef(showing);
  useEffect(() => {
    if (was.current === showing) return;
    was.current = showing;
    setTyped('');
    setHinting(false);
  }, [showing]);

  const passed = Boolean(lesson && lesson.passes(typed));
  // Ticked the moment the mark appears, and only once: the tick is a fact about the person, not about the field.
  useEffect(() => {
    if (!lesson || !passed || done.has(lesson.id)) return;
    fireNativeHaptic('success');
    setDone((before) => {
      const next = new Set(before).add(lesson.id);
      writeProgress(next);
      return next;
    });
  }, [lesson, passed, done]);

  const learned = LESSONS.filter((one) => done.has(one.id)).length;

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <button type="button" className={styles.back} onClick={onDone} aria-label="Close the Academy">
          <ArrowLeft size={20} />
        </button>
        <h1 className={styles.heading}>
          <GraduationCap size={18} aria-hidden="true" /> Ghost.md Academy
        </h1>
        <p className={styles.count} aria-label={`${learned} of ${LESSONS.length} learned`}>
          {learned}/{LESSONS.length}
        </p>
      </header>

      {/* A bar for every lesson: faint to come, ink for learned, lit for the one being taken. */}
      <ol className={styles.bars} aria-hidden="true">
        {LESSONS.map((one) => (
          <li
            key={one.id}
            className={styles.bar}
            {...(done.has(one.id) ? { 'data-done': '' } : {})}
            {...(one.id === lesson?.id ? { 'data-now': '' } : {})}
          />
        ))}
      </ol>

      <main className={styles.page}>
        {lesson ? (
          <LessonCard
            lesson={lesson}
            typed={typed}
            onTyped={setTyped}
            passed={passed}
            hinting={hinting}
            onHint={() => setHinting(true)}
            onShowMe={() => setTyped(lesson.example)}
            onNext={() => setAt(after(lesson.id))}
          />
        ) : (
          <Summary
            done={done}
            onAgain={(id) => setAt(id)}
            onStartOver={() => {
              setDone(new Set());
              writeProgress(new Set());
              setAt(LESSONS[0]?.id ?? '');
            }}
            onCheatSheet={onCheatSheet}
          />
        )}
      </main>
    </div>
  );
}

/** One lesson: what the mark does, a line using it, and the live page to write your own on. */
function LessonCard({
  lesson,
  typed,
  onTyped,
  passed,
  hinting,
  onHint,
  onShowMe,
  onNext,
}: {
  lesson: Lesson;
  typed: string;
  onTyped: (text: string) => void;
  passed: boolean;
  hinting: boolean;
  onHint: () => void;
  onShowMe: () => void;
  onNext: () => void;
}) {
  const at = LESSONS.indexOf(lesson) + 1;
  return (
    <article className={styles.card}>
      <p className={styles.chapter}>
        {lesson.chapter} · {at} of {LESSONS.length}
      </p>
      <h2 className={styles.title}>{lesson.title}</h2>
      <p className={styles.teach}>{lesson.teach}</p>

      <div className={styles.example}>
        <pre className={styles.exampleText}>{lesson.example}</pre>
        <button type="button" className={`app-word ${styles.wordRow}`} onClick={onShowMe}>
          <Wand2 size={16} aria-hidden="true" /> Show me
        </button>
      </div>

      <p className={styles.task}>{lesson.task}</p>

      <Playground value={typed} onChange={onTyped} placeholder={lesson.example} />

      <div className={styles.foot}>
        {passed ? (
          <p className={styles.praise}>
            <Check size={18} aria-hidden="true" /> {lesson.praise}
          </p>
        ) : hinting ? (
          <p className={styles.hint}>{lesson.hint}</p>
        ) : (
          <button type="button" className="app-word" onClick={onHint}>
            Show me a hint
          </button>
        )}
        <button type="button" className={passed ? 'app-pill' : 'app-word'} onClick={onNext}>
          {passed ? 'Next' : 'Skip'}
        </button>
      </div>
    </article>
  );
}

/** The end: what was learned, anything to take again, and where the rest of the marks live. */
function Summary({
  done,
  onAgain,
  onStartOver,
  onCheatSheet,
}: {
  done: ReadonlySet<string>;
  onAgain: (id: string) => void;
  onStartOver: () => void;
  onCheatSheet: () => void;
}) {
  const all = done.size >= LESSONS.length;
  return (
    <article className={styles.card}>
      <h2 className={styles.title}>{all ? 'That is markdown.' : 'That is the end of the chapter.'}</h2>
      <p className={styles.teach}>
        {all
          ? 'Every mark in this chapter is one you can now write by hand, anywhere: in Ghost.md, and in any other app that knows markdown. Take any of them again below.'
          : 'You can come back to the ones you skipped whenever you like. Take any lesson again below.'}
      </p>

      {CHAPTERS.map((chapter) => (
        <section key={chapter} className={styles.chapterBlock}>
          <h3 className={styles.chapterName}>{chapter}</h3>
          <ul className={styles.list}>
            {lessonsIn(chapter).map((lesson) => (
              <li key={lesson.id}>
                <button type="button" className={styles.again} onClick={() => onAgain(lesson.id)}>
                  <span className={styles.againTick} {...(done.has(lesson.id) ? { 'data-done': '' } : {})} aria-hidden="true">
                    <Check size={14} />
                  </span>
                  <span className={styles.againName}>{lesson.title}</span>
                  <span className={styles.againMark}>{lesson.symbol}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className={styles.teach}>Ghost.md has marks of its own as well - boards, spoilers, callouts, anchors. They all live in the cheat sheet until their chapter is written.</p>
      <div className={styles.foot}>
        <button type="button" className="app-word" onClick={onStartOver}>
          <RotateCcw size={16} aria-hidden="true" /> Start again
        </button>
        <button type="button" className="app-pill" onClick={onCheatSheet}>
          <ListChecks size={16} aria-hidden="true" /> Cheat sheet
        </button>
      </div>
    </article>
  );
}

/** The first lesson still to learn, which is where the Academy opens; empty once they are all learned. */
function firstLeft(done: ReadonlySet<string>): string {
  return LESSONS.find((lesson) => !done.has(lesson.id))?.id ?? '';
}

/** The lesson after this one, in the order they are taught; empty at the end, which is the summary. */
function after(id: string): string {
  return LESSONS[LESSONS.findIndex((lesson) => lesson.id === id) + 1]?.id ?? '';
}
