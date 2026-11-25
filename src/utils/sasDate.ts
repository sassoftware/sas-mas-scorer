// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SAS date and datetime values, as MAS takes and returns them.
 *
 * MAS accepts a date or datetime input only as a JSON number (tested against
 * a published decision: any text, even "24434", is rejected with "Cannot
 * assign the value ... of type decimal"):
 * - a SAS date is the number of days since 1 January 1960;
 * - a SAS datetime is the number of seconds since 1 January 1960 00:00:00.
 * Neither carries a time zone, so the calendar date and clock time are
 * converted exactly as entered, with UTC arithmetic, never shifted by the
 * computer's time zone.
 */

const EPOCH_MS = Date.UTC(1960, 0, 1);
const DAY_MS = 86_400_000;
// Values outside years 1000 to 9999 are not shown as dates (a SAS number
// that is not really a date, such as a missing-value code or an amount).
const RANGE = { min: Date.UTC(1000, 0, 1), max: Date.UTC(9999, 11, 31, 23, 59, 59) };

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** "2026-11-24" -> 24434. Null for anything that is not a full date. */
export function sasDateFromIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - EPOCH_MS) / DAY_MS);
}

/** "2026-11-24T14:30" or "…:05" -> seconds since 1960-01-01T00:00:00. */
export function sasDatetimeFromIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - EPOCH_MS) / 1000);
}

function utcFromSas(value: unknown, kind: 'date' | 'datetime'): Date | null {
  const n = toNumber(value);
  if (n === null) return null;
  const ms = EPOCH_MS + (kind === 'date' ? Math.floor(n) * DAY_MS : Math.floor(n) * 1000);
  if (ms < RANGE.min || ms > RANGE.max) return null;
  return new Date(ms);
}

/** 24434 -> "2026-11-24" (the value of an <input type="date">); "" when not a date. */
export function isoFromSasDate(value: unknown): string {
  const d = utcFromSas(value, 'date');
  return d ? `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : '';
}

/** Seconds -> "2026-11-24T14:30:00" (the value of an <input type="datetime-local">). */
export function isoFromSasDatetime(value: unknown): string {
  const d = utcFromSas(value, 'datetime');
  return d
    ? `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    : '';
}

/** A readable date or date and time in the user's language; null when the value is not one. */
export function formatSasValue(value: unknown, kind: 'date' | 'datetime'): string | null {
  const d = utcFromSas(value, kind);
  if (!d) return null;
  return new Intl.DateTimeFormat(undefined, kind === 'date'
    ? { dateStyle: 'medium', timeZone: 'UTC' }
    : { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }
  ).format(d);
}
