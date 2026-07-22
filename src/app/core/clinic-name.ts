/**
 * Clinic name bounds, mirroring the `clinics_name_length` constraint and
 * `supabase/functions/_shared/clinic-name.ts`. The database is the boundary that
 * actually holds; these exist so the form can say why before a round trip.
 */
export const CLINIC_NAME_MIN = 2;
export const CLINIC_NAME_MAX = 100;

/** A human-readable reason the name is unacceptable, or null when it is fine. */
export function clinicNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return $localize`:@@clinicName.required:A clinic name is required.`;
  if (trimmed.length < CLINIC_NAME_MIN) {
    return $localize`:@@clinicName.tooShort:Use at least ${CLINIC_NAME_MIN}:MIN: characters.`;
  }
  if (trimmed.length > CLINIC_NAME_MAX) {
    return $localize`:@@clinicName.tooLong:Use at most ${CLINIC_NAME_MAX}:MAX: characters.`;
  }
  return null;
}
