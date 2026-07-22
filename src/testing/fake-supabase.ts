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
  for (const m of ['or', 'eq', 'ilike', 'order', 'range', 'gte', 'gt', 'lte', 'lt', 'in']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      recorded.filters.push({ method: m, args });
      return builder;
    });
  }
  const singleResult = (allowEmpty: boolean) => ({
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: rows[0] ?? (allowEmpty ? null : undefined), count, error }),
  });
  builder.maybeSingle = vi.fn(() => singleResult(true));
  builder.single = vi.fn(() => singleResult(false));

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

export interface RecordedMutation {
  table: string;
  operation: 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: { method: string; args: unknown[] }[];
  /** Set when the chain calls `.select(...)` after the mutation (e.g. `.insert(...).select('id').single()`). */
  select?: string;
}

/**
 * A client that serves both a `select` read chain (for a store's `resource()`
 * constructed on setup) and `insert` / `update` / `delete` mutation chains.
 *
 * `selectRows` seeds the read chain (defaults to empty). Every mutation call
 * (`insert`, `update`, `delete`) is captured into `recorded.mutations` in call
 * order, and each returns a thenable builder supporting `.eq(...)` filters
 * that resolves to `{ data: mutationResult.data, error: mutationResult.error }`.
 *
 * `perTableResults` (optional, additive) lets a single client return a
 * *different* mutation outcome for specific tables/operations instead of the
 * one global `mutationResult` — e.g. to simulate "invoice insert succeeds,
 * item insert fails". Keys are looked up as `"<table>:<operation>"` first,
 * then `"<table>"`, falling back to `mutationResult` when neither matches.
 * Omitting this parameter reproduces the exact prior behaviour (every
 * mutation call, on every table, resolves to `mutationResult`).
 */
export function fakeSupabaseMutate(
  selectRows: unknown[] = [],
  mutationResult: { data?: unknown; error?: unknown } = { data: null, error: null },
  perTableResults?: Record<string, { data?: unknown; error?: unknown }>,
) {
  const recorded: { table: string; select?: string; filters: { method: string; args: unknown[] }[]; mutations: RecordedMutation[] } = {
    table: '',
    filters: [],
    mutations: [],
  };
  const selectResult = { data: selectRows, count: selectRows.length, error: null };

  const selectBuilder: any = {
    then: (resolve: (v: unknown) => void) => resolve(selectResult),
  };
  for (const m of ['or', 'eq', 'ilike', 'order', 'range', 'gte', 'gt', 'lte', 'lt', 'in']) {
    selectBuilder[m] = vi.fn((...args: unknown[]) => {
      recorded.filters.push({ method: m, args });
      return selectBuilder;
    });
  }
  const selectSingleResult = (allowEmpty: boolean) => ({
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: selectRows[0] ?? (allowEmpty ? null : undefined), count: selectRows.length, error: null }),
  });
  selectBuilder.maybeSingle = vi.fn(() => selectSingleResult(true));
  selectBuilder.single = vi.fn(() => selectSingleResult(false));

  function resultFor(table: string, operation: string) {
    return (
      perTableResults?.[`${table}:${operation}`] ?? perTableResults?.[table] ?? mutationResult
    );
  }

  function makeMutationBuilder(mutation: RecordedMutation) {
    const result = resultFor(mutation.table, mutation.operation);
    const mutationBuilder: any = {
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: result.data ?? null, error: result.error ?? null }),
    };
    mutationBuilder.eq = vi.fn((...args: unknown[]) => {
      mutation.filters.push({ method: 'eq', args });
      return mutationBuilder;
    });
    // `.insert(...).select('id').single()` — used by stores that need the
    // inserted row back (e.g. a server-assigned id). Additive only: existing
    // mutation chains (`.eq(...)` then implicit `then`) are unchanged.
    mutationBuilder.select = vi.fn((sel: string) => {
      mutation.select = sel;
      return mutationBuilder;
    });
    mutationBuilder.single = vi.fn(() => ({
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: result.data ?? null, error: result.error ?? null }),
    }));
    return mutationBuilder;
  }

  const client = {
    from: vi.fn((table: string) => {
      recorded.table = table;
      return {
        select: vi.fn((sel: string) => {
          recorded.select = sel;
          return selectBuilder;
        }),
        insert: vi.fn((payload: unknown) => {
          const mutation: RecordedMutation = { table, operation: 'insert', payload, filters: [] };
          recorded.mutations.push(mutation);
          return makeMutationBuilder(mutation);
        }),
        update: vi.fn((payload: unknown) => {
          const mutation: RecordedMutation = { table, operation: 'update', payload, filters: [] };
          recorded.mutations.push(mutation);
          return makeMutationBuilder(mutation);
        }),
        delete: vi.fn(() => {
          const mutation: RecordedMutation = { table, operation: 'delete', filters: [] };
          recorded.mutations.push(mutation);
          return makeMutationBuilder(mutation);
        }),
      };
    }),
    recorded,
  };
  return client;
}
