/**
 * Material controls that implement `Validator` (datepicker, timepicker) push
 * their own errors into a Signal Forms field alongside the schema's — and those
 * carry a `kind` but no `message` (e.g. `matDatepickerMax`). They often sort
 * first, so reading `errors()[0].message` yields undefined and falls back.
 *
 * Show the first error a human wrote instead.
 */
export function firstMessage(
  errors: readonly { message?: string }[],
  fallback: string,
): string {
  return errors.find(e => e.message)?.message ?? fallback;
}
