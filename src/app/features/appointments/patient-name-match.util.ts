import { Patient } from '../patients/patient.model';

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Matches a free-text name guess (from the AI booking assistant) against the
 * clinic's already-loaded patient list. Returns the matched patient's id only
 * when exactly one candidate is plausible — an empty or ambiguous result means
 * "let staff pick manually" rather than risk booking the wrong patient.
 */
export function matchPatientByName(guess: string, patients: Patient[]): string | null {
  const g = normalize(guess);
  if (!g) return null;

  const candidates = patients.filter((p) => {
    const forward = normalize(`${p.firstName} ${p.lastName}`);
    const reversed = normalize(`${p.lastName} ${p.firstName}`);
    return (
      forward === g || reversed === g || forward.includes(g) || reversed.includes(g) || g.includes(forward)
    );
  });

  return candidates.length === 1 ? candidates[0].id : null;
}
