/**
 * Cron parser and scheduling helpers.
 *
 * Five-field POSIX-style cron (minute hour day-of-month month day-of-week).
 * Supports wildcards (*), lists (a,b,c), ranges (a-b), steps (*\/n), and
 * Sunday-as-7 normalization. Minute granularity only.
 *
 * Extracted from daemon/server.ts so it can be shared with the boot loader
 * and exercised by focused tests.
 */

export function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === '*') {
    const values: number[] = [];
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }
  // Comma-separated list
  if (field.includes(',')) {
    const values = new Set<number>();
    for (const part of field.split(',')) {
      const partValues = parseCronField(part, min, max);
      if (!partValues) return null;
      partValues.forEach((v) => values.add(v));
    }
    return Array.from(values).sort((a, b) => a - b);
  }
  // Step values: */n, start/n, start-end/n
  if (field.includes('/')) {
    const slashIdx = field.indexOf('/');
    const range = field.slice(0, slashIdx);
    const step = parseInt(field.slice(slashIdx + 1));
    if (isNaN(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (range !== '*') {
      if (range.includes('-')) {
        const [s, e] = range.split('-').map(Number);
        if (isNaN(s) || isNaN(e)) return null;
        start = s;
        end = e;
      } else {
        start = parseInt(range);
        if (isNaN(start)) return null;
      }
    }
    const values: number[] = [];
    for (let i = start; i <= end; i += step) values.push(i);
    return values;
  }
  // Range: n-m
  if (field.includes('-')) {
    const [s, e] = field.split('-').map(Number);
    if (isNaN(s) || isNaN(e) || s < min || e > max) return null;
    const values: number[] = [];
    for (let i = s; i <= e; i++) values.push(i);
    return values;
  }
  // Single value
  const value = parseInt(field);
  if (isNaN(value) || value < min || value > max) return null;
  return [value];
}

interface ParsedCron {
  minuteSet: Set<number>;
  hourSet: Set<number>;
  domSet: Set<number>;
  monthSet: Set<number>;
  dowSet: Set<number>;
  domIsWild: boolean;
  dowIsWild: boolean;
}

function parse(cron: string): ParsedCron | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField, domField, monthField, dowField] = parts;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 7);
  if (!minutes || !hours || !doms || !months || !dows) return null;
  return {
    minuteSet: new Set(minutes),
    hourSet: new Set(hours),
    domSet: new Set(doms),
    monthSet: new Set(months),
    // Normalize: 7 maps to 0 (both mean Sunday)
    dowSet: new Set(dows.map((d) => (d === 7 ? 0 : d))),
    domIsWild: domField === '*',
    dowIsWild: dowField === '*',
  };
}

function matches(parsed: ParsedCron, date: Date): boolean {
  if (!parsed.monthSet.has(date.getMonth() + 1)) return false;
  let dayMatch: boolean;
  if (parsed.domIsWild && parsed.dowIsWild) dayMatch = true;
  else if (parsed.domIsWild) dayMatch = parsed.dowSet.has(date.getDay());
  else if (parsed.dowIsWild) dayMatch = parsed.domSet.has(date.getDate());
  else dayMatch = parsed.domSet.has(date.getDate()) || parsed.dowSet.has(date.getDay());
  if (!dayMatch) return false;
  if (!parsed.hourSet.has(date.getHours())) return false;
  return parsed.minuteSet.has(date.getMinutes());
}

/**
 * Compute the next cron occurrence strictly after `fromTime` (defaults to
 * now). Returns `{isValid: false, nextRun: 0}` on malformed cron or if no
 * occurrence is found within four years.
 */
export function parseCron(cron: string, fromTime?: number): { isValid: boolean; nextRun: number } {
  const parsed = parse(cron);
  if (!parsed) return { isValid: false, nextRun: 0 };

  const base = fromTime !== undefined ? new Date(fromTime) : new Date();
  const candidate = new Date(base);
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(candidate);
  limit.setFullYear(limit.getFullYear() + 4);

  while (candidate < limit) {
    if (!parsed.monthSet.has(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setDate(1);
      candidate.setHours(0);
      candidate.setMinutes(0);
      continue;
    }
    let dayMatch: boolean;
    if (parsed.domIsWild && parsed.dowIsWild) dayMatch = true;
    else if (parsed.domIsWild) dayMatch = parsed.dowSet.has(candidate.getDay());
    else if (parsed.dowIsWild) dayMatch = parsed.domSet.has(candidate.getDate());
    else dayMatch = parsed.domSet.has(candidate.getDate()) || parsed.dowSet.has(candidate.getDay());
    if (!dayMatch) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0);
      candidate.setMinutes(0);
      continue;
    }
    if (!parsed.hourSet.has(candidate.getHours())) {
      const nextHour = [...parsed.hourSet].find((h) => h > candidate.getHours());
      if (nextHour !== undefined) {
        candidate.setHours(nextHour);
        candidate.setMinutes(0);
      } else {
        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(0);
        candidate.setMinutes(0);
      }
      continue;
    }
    if (!parsed.minuteSet.has(candidate.getMinutes())) {
      const nextMinute = [...parsed.minuteSet].find((m) => m > candidate.getMinutes());
      if (nextMinute !== undefined) {
        candidate.setMinutes(nextMinute);
      } else {
        candidate.setHours(candidate.getHours() + 1);
        candidate.setMinutes(0);
      }
      continue;
    }
    return { isValid: true, nextRun: candidate.getTime() };
  }
  return { isValid: false, nextRun: 0 };
}

/**
 * Find the most recent cron occurrence strictly after `lastRunAt` and at or
 * before `now`. Returns `null` if no occurrence fits the window, the cron is
 * malformed, or `lastRunAt` is not in the past.
 *
 * Used at daemon boot: if a schedule was supposed to fire while the daemon
 * was down, this identifies the most recent missed occurrence so the caller
 * can trigger one catch-up run. Older missed occurrences are intentionally
 * dropped to avoid a flood of invocations after a long outage.
 *
 * Complexity: iterates backward minute-by-minute from `now` to `lastRunAt`,
 * bounded at 14 days. For typical schedules the first matching minute is
 * found within a few hundred iterations.
 */
export function computeMissedRun(cron: string, lastRunAt: number, now: number): number | null {
  if (!Number.isFinite(lastRunAt) || lastRunAt <= 0 || lastRunAt >= now) return null;
  const parsed = parse(cron);
  if (!parsed) return null;

  const FOURTEEN_DAYS_MINUTES = 14 * 24 * 60;
  const windowMinutes = Math.ceil((now - lastRunAt) / 60_000) + 1;
  const maxIter = Math.min(windowMinutes, FOURTEEN_DAYS_MINUTES);

  const candidate = new Date(now);
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);

  for (let i = 0; i < maxIter; i++) {
    if (candidate.getTime() <= lastRunAt) return null;
    if (matches(parsed, candidate)) return candidate.getTime();
    candidate.setMinutes(candidate.getMinutes() - 1);
  }
  return null;
}
