/**
 * The heads-up's gags (guide/AntiAiStage.tsx), and the order they play.
 *
 * Matt: "a heads up page that we use AI but say that it all runs on local
 * models on your phone then we're going to do three funny anti AI animations …"
 * The third, "no thinking for you", was cut the same day. Then the shape of a
 * gag changed: "show the datacenter first with the no datacenter water, then
 * slap the 'NO' over top of it, then animate away and we'll go to the seal".
 *
 * So each gag is one beat: its scene plays with its title and punchline, the
 * stamp slaps down over it, holds, and the whole thing goes back into smoke;
 * then the next. The last one stays on screen, still playing (Matt: "don't
 * cycle through the animation after the 'your phone is hot' one"). Pure, so the
 * order and the words are a test.
 */

export type Gag = 'water' | 'seal' | 'art' | 'hot';

export interface GagWords {
  /** The gag's name, big, under the scene. */
  title: string;
  /** Said while the scene plays. */
  line: string;
}

export const GAGS: Record<Gag, GagWords> = {
  water: {
    title: 'No datacenter water.',
    line: 'No server farm drank a lake and spat it back out glowing.',
  },
  seal: {
    title: 'No dying baby seals.',
    line: 'Nobody got clubbed so you could write a grocery list.',
  },
  art: {
    title: 'No stealing art.',
    line: 'No robot ran off with anyone’s painting to tidy your to-do list.',
  },
  hot: {
    title: 'Just hot phones.',
    line: 'Your phone may get warm while Ghost.md thinks. That’s the AI working right here. Everything’s A-OK.',
  },
};

/**
 * What lands on a scene when it has played: the NO over the things Glyph's AI
 * doesn't do, and an A-OK check over the one thing it does, a warm phone
 * (Matt: "make a 'just hot phones' section after and we want it to warn the
 * user the phone may get hot at some points using the app but everything will
 * be A-O-K"; the saying is spelled A-OK).
 */
export const STAMP: Record<Gag, 'no' | 'ok'> = { water: 'no', seal: 'no', art: 'no', hot: 'ok' };

/** How long each scene plays before the NO lands. The scene's CSS animations are timed to it. */
export const SCENE_MS: Record<Gag, number> = { water: 4200, seal: 3800, art: 4000, hot: 2600 };

/**
 * The stamp slapping down (450 ms), then time to read the words once it's all
 * played (Matt: "we also need more time between slides to read the text"), and
 * everything sliding away (from 3000 ms), with a breath after.
 */
export const SLAP_MS = 3500;

export interface Beat {
  gag: Gag;
  stamp: 'no' | 'ok';
  /** When the NO lands, from the start of the beat. */
  sceneMs: number;
  /** How long the beat is on screen. */
  ms: number;
}

/** What plays, in order. Only the datacenter for now (Matt: "remove the dying baby seal animation, just cut it down to the datacenter animation for now"); the seal and the heist are kept, drawn, to bring back. */
export const PLAYING: readonly Gag[] = ['water', 'hot'];

export const BEATS: readonly Beat[] = PLAYING.map((gag) => ({ gag, stamp: STAMP[gag], sceneMs: SCENE_MS[gag], ms: SCENE_MS[gag] + SLAP_MS }));

/** The beat at a turn of the loop: the turns count up for ever, so a single beat still starts over each time round. */
export function beatAt(turn: number): Beat {
  return BEATS[turn % BEATS.length]!;
}
