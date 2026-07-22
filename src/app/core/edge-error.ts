/**
 * functions.invoke() reports every failure as "Edge Function returned a non-2xx
 * status code" and hides the function's own `{ error }` body in `context`.
 * Unwrap it so the UI can show the real reason.
 */
export async function edgeError(error: unknown): Promise<Error> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      const message = (body as { error?: string }).error;
      if (message) return new Error(message);
    } catch {
      // Body was not JSON — fall back to the original error.
    }
  }
  return error instanceof Error ? error : new Error('Request failed.');
}
