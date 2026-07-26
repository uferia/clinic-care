# AI Booking Assistant — Design

**Date:** 2026-07-26
**Status:** Approved, ready for planning

## Goal

Let clinic staff fill the appointment form by typing a free-text description
("book Maria Santos with Dr. Cruz next Tuesday afternoon for a follow-up")
instead of manually working through each field. This is the first AI feature
in the app — staff-only, no patient self-service.

## Context (existing system)

- Angular 22 (standalone, signals, Material 22) + Supabase (`@supabase/supabase-js`).
- `appointment-form.component.ts` already loads the full `patients` and
  `doctors` tables client-side (plain `<mat-select>` lists — both are small
  per clinic).
- Edge functions follow a shared pattern: verify caller JWT, run privileged
  work server-side with secrets that never reach the browser (see
  `create-xendit-session`, `xendit-webhook`).
- No AI/LLM integration exists anywhere in the app today. No notification
  channel (SMS/email) exists either — ruled that out as a starting point in
  favor of this narrower, infra-free feature.

## Scope

Staff-facing only. The assistant fills the existing appointment form; it
never writes to the database directly. Same `save()` path as manual entry —
staff always reviews and submits.

## Architecture Decisions

### New edge function `parse-appointment-request`

- Verifies the caller JWT (same as other functions), then calls the Claude
  API (Opus 4.8) server-side. `ANTHROPIC_API_KEY` is a Supabase secret, set
  the same way as `XENDIT_SECRET_KEY` — never sent to the browser.
- Request body: `{ text: string, doctors: {id, name}[], today: string }`.
  `doctors` and `today` let the model resolve "Dr. Cruz" and "next Tuesday"
  without a second round trip.
- Response: structured JSON via `output_config.format` (json_schema, not a
  free-text completion) — `{ doctorId: string | null, patientNameGuess:
  string, date: string | null, time: string | null, reason: string }`.
- **Patient data is not sent to Claude.** The doctor list is small and
  non-sensitive (name only); the patient list is not — the model only
  returns a name guess, matched against the already-loaded `patients()`
  client-side. The free-text box itself may still contain a name or a
  medical reason (that's the point of the feature), so this is a
  minimization step, not a guarantee of zero PHI in the request — call this
  out in the UI copy near the box (e.g. "Used to fill the form below —
  not stored").

Rejected: sending the full patient list to the model so it returns a
`patientId` directly — same convenience as the doctor list, but sends
medical-adjacent data (patient names tied to appointment context) to a
third party unnecessarily when client-side fuzzy matching already works.

### Client-side fuzzy match for patient

- After the edge function responds, match `patientNameGuess` against the
  in-memory `patients()` list (already loaded for the `<mat-select>`).
- Exact or single strong match → auto-fill `patientId`.
- Multiple plausible matches or no match → leave `patientId` blank; staff
  picks manually from the existing dropdown. Never guess wrong silently.

### UI integration — autofill, not a new save path

- One text box + "Fill form" button above the existing fields in
  `appointment-form.component.ts`. Triggered explicitly, not on every
  keystroke.
- On response, sets the same `model` signal fields the manual form already
  binds to (`doctorId`, `date`, `time`, `reason`, and `patientId` when
  matched). Existing validation (`required`, the past-appointment
  `validateTree` rule) applies unchanged.
- Staff reviews all fields and clicks the existing **Save** button — no new
  write path, no auto-submit.

## Data Flow

1. Staff types free text, clicks "Fill form".
2. Client calls `parse-appointment-request` with `{ text, doctors, today }`.
3. Edge function calls Claude Opus 4.8, gets structured JSON back, returns it.
4. Client fills form fields; fuzzy-matches patient name locally.
5. Staff reviews (nothing pre-submitted) and hits **Save** — existing flow.

## Error Handling

- Edge function failure (network, Claude API error, malformed response) →
  inline error near the text box; form fields are left untouched. Manual
  entry is always available as a fallback — this feature never blocks
  booking.
- No retry loop. Staff can re-word the input or just fill the form by hand.
- If Claude returns a `doctorId` not in the clinic's own doctor list (should
  not happen given structured output, but treated as untrusted input
  regardless) — ignore it and leave `doctorId` blank.

## Testing

- Client-side fuzzy-match function: exact match, multiple candidates, no
  match, empty patient list.
- Edge function: request validation (auth, shape), response shape from a
  mocked Claude call, and that a Claude error surfaces as a clean error
  response rather than a 500 with internals leaked.
- No test coverage for the LLM's own parsing quality — that's prompt
  tuning, not correctness, and isn't something a unit test can pin down.
