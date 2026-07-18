import { vi } from 'vitest';

export interface RecordedQuery {
  table: string;
  select?: string;
  filters: { method: string; args: unknown[] }[];
}

/** A select builder that resolves to {data,count,error} and records filter calls. */
export function fakeSupabaseSelect(rows: unknown[], count = rows.length, error: unknown = null) {
  const recorded: RecordedQuery = { table: '', filters: [] };
  const result = { data: rows, count, error };

  const builder: any = {
    // thenable so `await query` resolves to the result
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  for (const m of ['or', 'eq', 'ilike', 'order', 'range', 'gte', 'in']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      recorded.filters.push({ method: m, args });
      return builder;
    });
  }

  const client = {
    from: vi.fn((table: string) => {
      recorded.table = table;
      return {
        select: vi.fn((sel: string) => {
          recorded.select = sel;
          return builder;
        }),
      };
    }),
    recorded,
  };
  return client;
}
