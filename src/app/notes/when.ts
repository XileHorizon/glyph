/** A timestamp a person reads rather than parses: "2 hr ago", "Yesterday", "Tuesday", "March 4". */
export function when(ms: number, now = Date.now()): string {
  const delta = now - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return 'Just now';
  if (delta < hour) return `${Math.floor(delta / minute)} min ago`;
  if (delta < day) return `${Math.floor(delta / hour)} hr ago`;
  if (delta < 2 * day) return 'Yesterday';
  if (delta < 7 * day) return new Date(ms).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}
