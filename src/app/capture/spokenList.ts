/**
 * "A list with Parkersburg West Virginia Marietta Ohio Baltimore Maryland and
 * Detroit Michigan": the items of a spoken list, one string each.
 *
 * Kevin's list was places, and places are the case that splitting on commas
 * gets wrong in both directions: Whisper writes "Parkersburg, West Virginia,
 * Marietta, Ohio", so a comma split makes eight items of four, and it often
 * writes no commas at all, so there is nothing to split on. A US state name
 * ends a place, so when every item of the list ends in one, the state is the
 * separator and each item reads "City, State". Anything else falls back to
 * the ordinary spoken split (semicolons, then commas and "and", then
 * short runs of bare words).
 */

const STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];

const ABBREVIATIONS: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

const BY_WORDS = new Map(STATES.map((state) => [state.toLowerCase(), state]));
const LONGEST = Math.max(...STATES.map((state) => state.split(' ').length));

const capitalised = (words: readonly string[]) => words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/** The state spelled by `words` from `at`, longest first, and how many words it took. */
function stateAt(words: readonly string[], at: number): { state: string; length: number } | null {
  for (let length = Math.min(LONGEST, words.length - at); length >= 1; length -= 1) {
    const state = BY_WORDS.get(words.slice(at, at + length).join(' ').toLowerCase());
    if (state) return { state, length };
  }
  const word = words[at] ?? '';
  const abbreviation = /^[A-Z]{2}$/.test(word) ? ABBREVIATIONS[word] : undefined;
  return abbreviation ? { state: abbreviation, length: 1 } : null;
}

/** "Parkersburg West Virginia Marietta Ohio" as places, or null when it is not a list made only of them. */
function placesIn(text: string): string[] | null {
  const words = text
    .replace(/[.,;:!?"“”]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const places: string[] = [];
  let city: string[] = [];
  for (let at = 0; at < words.length; ) {
    const word = words[at] ?? '';
    // "…Maryland and Detroit Michigan": the "and" between two places.
    if (!city.length && places.length && /^(?:and|&|then|also)$/i.test(word)) {
      at += 1;
      continue;
    }
    const state = stateAt(words, at);
    if (state && city.length) {
      places.push(`${capitalised(city)}, ${state.state}`);
      city = [];
      at += state.length;
      continue;
    }
    // A state with no city before it is the city's own name: "New York New York", "Kansas City Missouri".
    const taken = state?.length ?? 1;
    city.push(...words.slice(at, at + taken));
    at += taken;
  }
  return places.length >= 2 && !city.length ? places : null;
}

/** The items of a spoken list, one string each, in the order said. */
export function spokenListItems(text: string): string[] {
  const cleaned = text.trim().replace(/[.!?]+$/, '').trim();
  if (!cleaned) return [];
  const places = placesIn(cleaned);
  if (places) return places;
  // A model is asked to separate its items with semicolons, which keeps a comma inside one item.
  if (cleaned.includes(';')) return cleaned.split(/\s*;\s*/).map((item) => item.trim()).filter(Boolean);
  const said = cleaned.split(/\s*(?:,|\band\b)\s*/i).map((item) => item.trim()).filter(Boolean);
  if (said.length > 1) return said;
  // "Milk eggs bread": short bare words said one after another are items too.
  const words = cleaned.split(/\s+/);
  return words.length >= 2 && words.length <= 8 && words.every((word) => /^[\p{L}\p{N}'-]+$/u.test(word)) ? words : [cleaned];
}
