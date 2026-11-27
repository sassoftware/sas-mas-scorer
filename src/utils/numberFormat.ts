// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { UIField } from '../types/uiBuilder';

/** Common currencies offered in the builder; any ISO 4217 code works. */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CNY', 'INR', 'SEK', 'NOK', 'DKK', 'PLN', 'CAD', 'AUD'];

/** The currency a Currency field uses (ISO 4217, upper case). */
export function currencyOf(field: UIField): string {
  const code = field.validation?.currency?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : 'EUR';
}

/** True when a Percent field sends 12.5 for 12.5 % (percentage points) rather than 0.125. */
export function percentAsPoints(field: UIField): boolean {
  return field.validation?.percentScale === 'points';
}

/** Removes float noise from a scaled number (0.07 * 100 = 7.000000000000001). */
export const tidy = (n: number): number => Number(n.toPrecision(12));

/** The currency's symbol in the user's language ("€", "$", "CHF"). */
export function currencySymbol(code: string): string {
  try {
    const part = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
      .formatToParts(0)
      .find(p => p.type === 'currency');
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** A number as a percentage or an amount, in the user's language; null when not a number. */
export function formatPercentOrCurrency(field: UIField, value: unknown): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const decimals = field.validation?.decimals;
  const digits = decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {};
  try {
    if (field.widget === 'percent') {
      return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 4, ...digits })
        .format(percentAsPoints(field) ? n / 100 : n);
    }
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyOf(field), ...digits }).format(n);
  } catch {
    return String(n);
  }
}
