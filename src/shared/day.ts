/** Day identity helpers. Times are passed in (ms since epoch); nothing here reads a clock. */

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of a UTC timestamp. */
export function utcDate(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  // Civil-from-days (Howard Hinnant), integer only.
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 0 = Sunday … 6 = Saturday, for a UTC timestamp. */
export function utcWeekday(ms: number): number {
  const days = Math.floor(ms / DAY_MS);
  return (((days + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

/** Day id: "YYYY-MM-DD#N" — the UTC opening date plus the day number. */
export function dayId(openedAtMs: number, dayNumber: number): string {
  return `${utcDate(openedAtMs)}#${dayNumber}`;
}

export function parseDayNumber(id: string): number {
  return Number(id.split('#')[1] ?? '0');
}

/** The next lock instant strictly after `fromMs`, at `hourUtc`:00 UTC. */
export function nextLockAt(fromMs: number, hourUtc: number): number {
  const dayStart = Math.floor(fromMs / DAY_MS) * DAY_MS;
  let t = dayStart + hourUtc * 3_600_000;
  if (t <= fromMs) t += DAY_MS;
  return t;
}

/** Every daily game post's title starts with this. */
export const DAY_TITLE_PREFIX = 'Chaos Engine · Day ';

/** Post title with the recovery marker (§2.1, §8). Never change the "Chaos Engine · Day N" prefix. */
export const dayTitleMarker = (n: number): string => `Chaos Engine · Day ${n}`;
export const dayTitle = (n: number, name: string): string => `${dayTitleMarker(n)} · ${name}`;
export const resultsMarker = (n: number): string => `Chaos Engine · Day ${n} results`;
