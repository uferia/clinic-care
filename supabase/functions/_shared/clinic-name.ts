/**
 * Clinic name bounds. Mirrors the `clinics_name_length` constraint and the checks inside
 * register_clinic() / update_clinic_profile() — the database is the real boundary; this
 * exists so the caller gets a clear 400 instead of a raw constraint violation.
 */
export const CLINIC_NAME_MIN = 2;
export const CLINIC_NAME_MAX = 100;

/** Returns an error message, or null when the trimmed name is acceptable. */
export function validateClinicName(name: unknown): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return 'name is required';
  if (trimmed.length < CLINIC_NAME_MIN) return 'name too short';
  if (trimmed.length > CLINIC_NAME_MAX) return 'name too long';
  return null;
}
