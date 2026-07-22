import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('leaves plain values unquoted', () => {
    expect(csvCell('Maria Santos')).toBe('Maria Santos');
    expect(csvCell(800)).toBe('800');
  });

  it('quotes a value containing a comma, so later columns do not shift', () => {
    expect(csvCell('Santos, Maria')).toBe('"Santos, Maria"');
  });

  it('doubles inner quotes', () => {
    expect(csvCell('12" gauze')).toBe('"12"" gauze"');
  });

  it('quotes values containing newlines', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('writes null and undefined as empty, not as the words', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('joins headers and rows with CRLF, which is what Excel expects', () => {
    const csv = toCsv(['Number', 'Patient', 'Balance'], [
      ['INV-000001', 'Santos, Maria', 800],
      ['INV-000002', 'Cruz', 0],
    ]);
    expect(csv).toBe(
      'Number,Patient,Balance\r\n' +
      'INV-000001,"Santos, Maria",800\r\n' +
      'INV-000002,Cruz,0',
    );
  });

  it('handles an empty row set without a trailing newline', () => {
    expect(toCsv(['A', 'B'], [])).toBe('A,B');
  });
});
