/**
 * Where a person has been, so the arrows in the app's tab bar can go back and forward through it (App.tsx,
 * notes/NoteTabs.tsx).
 *
 * Matt: "Add the back and forward arrows in the top bar to the right of the button used to toggle the sidebar and
 * make sure we have full forward and backwards support".
 *
 * A trail of places, and where along it we are now. A place is the list or one note, which are the two routes the bar
 * appears on; a recording or the Academy is a thing you are doing rather than a place you went, so neither joins the
 * trail and coming out of one leaves you where you were.
 *
 * It behaves the way a browser's arrows do, because that is what a person expects of arrows: going somewhere new
 * after going back forgets what was ahead. Notes get deleted, so a step skips any place that is no longer there
 * rather than landing on nothing.
 *
 * Pure, and tested in visited.test.ts: App.tsx holds the trail in state and does the going.
 */

/** A place: 'list', or a note by id. */
export type Place = string;

export interface Trail {
  places: Place[];
  /** Where along `places` we are now. */
  at: number;
}

/** As many places as anyone will step through by hand; older ones fall off the start. */
export const MOST_PLACES = 30;

export const notePlace = (id: string): Place => `note:${id}`;
export const noteIdOf = (place: Place): string | null => (place.startsWith('note:') ? place.slice(5) : null);

export const FIRST: Trail = { places: ['list'], at: 0 };

/** Where the trail stands, or null for an empty one. */
export const placeAt = (trail: Trail): Place | null => trail.places[trail.at] ?? null;

/**
 * Somewhere new: it goes after where we are, and anything that was ahead is forgotten - the browser's rule, and the
 * only one that keeps forward meaning "where I just came back from". Arriving where you already are changes nothing,
 * so a note re-rendering or the list refreshing does not fill the trail with itself.
 */
export function went(trail: Trail, place: Place): Trail {
  if (trail.places[trail.at] === place) return trail;
  const places = [...trail.places.slice(0, trail.at + 1), place];
  const kept = places.slice(-MOST_PLACES);
  return { places: kept, at: kept.length - 1 };
}

/** The nearest place before this one that is still there, or null when there is none. */
export function backFrom(trail: Trail, there: (place: Place) => boolean): Trail | null {
  for (let i = trail.at - 1; i >= 0; i -= 1) {
    const spot = trail.places[i];
    if (spot !== undefined && there(spot)) return { places: trail.places, at: i };
  }
  return null;
}

/** The nearest place after this one that is still there, or null when there is none. */
export function onFrom(trail: Trail, there: (place: Place) => boolean): Trail | null {
  for (let i = trail.at + 1; i < trail.places.length; i += 1) {
    const spot = trail.places[i];
    if (spot !== undefined && there(spot)) return { places: trail.places, at: i };
  }
  return null;
}

/** Whether the arrows can do anything, for drawing them live or dead. */
export const canGoBack = (trail: Trail, there: (place: Place) => boolean): boolean => backFrom(trail, there) !== null;
export const canGoOn = (trail: Trail, there: (place: Place) => boolean): boolean => onFrom(trail, there) !== null;
