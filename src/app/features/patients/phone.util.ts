// Mobile-only metadata (~97 kB) — rejects landlines, matching clinic policy.
// The /max bundle would also accept FIXED_LINE at ~154 kB.
import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile';

const REGION = 'PH';

/** True when `value` is a valid PH mobile number in any accepted format. */
export function isValidMobile(value: string): boolean {
  if (!value?.trim()) return false;
  return parsePhoneNumberFromString(value, REGION)?.isValid() ?? false;
}

/** Canonical storage form, e.g. '0917-123-4567' -> '+639171234567'. */
export function toE164(value: string): string {
  const parsed = parsePhoneNumberFromString(value, REGION);
  return parsed?.isValid() ? parsed.format('E.164') : value;
}

/** Readable form for the UI, e.g. '+639171234567' -> '0917 123 4567'. */
export function toNationalFormat(value: string): string {
  const parsed = parsePhoneNumberFromString(value, REGION);
  return parsed?.isValid() ? parsed.formatNational() : value;
}

/**
 * Reduces a search term to digits that will substring-match a stored E.164
 * number. Stored numbers carry the '+63' country code, so a term typed as
 * '0917...' must drop its trunk '0' or it would never match.
 */
export function toPhoneSearchTerm(query: string): string {
  const digits = query.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('63')) return digits;
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}
