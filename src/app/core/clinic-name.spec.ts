import { CLINIC_NAME_MAX, CLINIC_NAME_MIN, clinicNameError } from './clinic-name';

describe('clinicNameError', () => {
  it('accepts an ordinary clinic name', () => {
    expect(clinicNameError('Sunrise Family Clinic')).toBeNull();
  });

  it('accepts a legitimately short name at the minimum — clinics do trade under initials', () => {
    expect(clinicNameError('AB')).toBeNull();
    expect(CLINIC_NAME_MIN).toBe(2);
  });

  it('rejects a single stray keystroke', () => {
    expect(clinicNameError('X')).toContain('at least');
  });

  it('rejects empty and whitespace-only input', () => {
    expect(clinicNameError('')).toContain('required');
    expect(clinicNameError('   ')).toContain('required');
  });

  it('measures the trimmed value, so padding cannot buy length', () => {
    expect(clinicNameError('  X  ')).toContain('at least');
  });

  it('accepts exactly the maximum but not one more', () => {
    expect(clinicNameError('A'.repeat(CLINIC_NAME_MAX))).toBeNull();
    expect(clinicNameError('A'.repeat(CLINIC_NAME_MAX + 1))).toContain('at most');
  });
});
