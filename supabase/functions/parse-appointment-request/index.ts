import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0';
import { handleCors, json } from '../_shared/cors.ts';
import { requireClinicMember } from '../_shared/auth.ts';

/**
 * Parse a staff-typed free-text booking request ("book Maria Santos with Dr. Cruz
 * next Tuesday afternoon for a follow-up") into structured appointment fields.
 *
 * Never writes anything — the client fills the existing appointment form with the
 * result and staff reviews + saves through the normal path. The doctor roster is
 * fetched here (not trusted from the client) and passed to Claude as a closed
 * `enum` in the response schema, so a fabricated doctor id cannot come back. The
 * patient list is never sent to Claude at all: only a name guess comes back, which
 * the client fuzzy-matches against the patients it already has loaded.
 */
Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireClinicMember(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let text: string;
  try {
    const body = await req.json();
    text = typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return json({ error: 'invalid request body' }, 400);
  }
  if (!text) return json({ error: 'text is required' }, 400);

  const { data: doctors } = await gate.admin
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', gate.clinicId)
    .order('name');
  const roster = (doctors ?? []) as { id: string; name: string }[];

  const today = new Date().toISOString().slice(0, 10);

  const doctorIdSchema = roster.length
    ? { anyOf: [{ type: 'string', enum: roster.map((d) => d.id) }, { type: 'null' }] }
    : { type: 'null' };

  const schema = {
    type: 'object',
    properties: {
      doctorId: doctorIdSchema,
      patientNameGuess: { type: 'string' },
      date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
      time: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      reason: { type: 'string' },
    },
    required: ['doctorId', 'patientNameGuess', 'date', 'time', 'reason'],
    additionalProperties: false,
  };

  const doctorList = roster.length
    ? roster.map((d) => `${d.id}: ${d.name}`).join('\n')
    : '(no doctors registered for this clinic yet)';

  const prompt = `Today's date is ${today} (YYYY-MM-DD).

Clinic doctors (id: name):
${doctorList}

Staff request: "${text}"

Extract booking details from the request:
- doctorId: match the named doctor to one of the ids above by name (fuzzy match is fine,
  e.g. "Dr. Cruz" matches "Dr. Ana Cruz"). Use null if no doctor is mentioned or none match.
- patientNameGuess: the patient's name as written in the request. Empty string if none given.
- date: resolve any relative date ("next Tuesday", "tomorrow") against today's date into
  YYYY-MM-DD. Null if no date is stated.
- time: only set this if a specific clock time is stated or clearly implied (e.g. "3pm" ->
  "15:00", 24-hour HH:mm). Vague parts of day alone ("morning", "afternoon") are NOT a specific
  time — leave null so staff can pick one.
- reason: the stated purpose of the visit. Empty string if not stated.`;

  try {
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') {
      return json({ error: "couldn't parse that request" }, 422);
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('no text content in response');
    }
    const parsed = JSON.parse(textBlock.text);

    // Belt-and-suspenders: the schema already constrains doctorId to the roster (or null),
    // but never trust model output past a load-bearing boundary without a direct check.
    const doctorId =
      typeof parsed.doctorId === 'string' && roster.some((d) => d.id === parsed.doctorId)
        ? parsed.doctorId
        : null;
    const date =
      typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : null;
    const time =
      typeof parsed.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.time)
        ? parsed.time
        : null;

    return json({
      doctorId,
      patientNameGuess: typeof parsed.patientNameGuess === 'string' ? parsed.patientNameGuess : '',
      date,
      time,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('parse-appointment-request failed:', message);
    return json({ error: "couldn't parse that request" }, 502);
  }
});
