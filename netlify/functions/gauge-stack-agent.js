import { createHash, randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function clean(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

function sourceClass(input) {
  const raw = JSON.stringify(input || {}).toLowerCase();
  if (!clean(input?.name || input?.customer_name || input?.sender_name) || !clean(input?.message || input?.need || input?.problem || input?.issue)) return 'incomplete';
  if (/threat|spam|attack|exploit/.test(raw)) return 'hostile';
  return 'known_owner';
}

function normalize(input) {
  const rawMessage = clean(input.raw_message || input.message || input.need || input.problem || input.issue || JSON.stringify(input));
  const senderName = clean(input.sender_name || input.name || input.customer_name, 300) || null;
  const contact = clean(input.contact_method || input.email || input.customer_email || input.phone, 500) || null;
  const requestedHelp = clean(input.requested_help || input.service || input.asset || input.vehicle_equipment_project, 2000) || null;
  return { rawMessage, senderName, contact, requestedHelp, classification: sourceClass(input) };
}

async function insert(table, row) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('missing_supabase_environment');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${table}:${response.status}:${body}`);
  return body ? JSON.parse(body) : [];
}

async function buildProofChain(input) {
  const now = new Date().toISOString();
  const n = normalize(input);
  const intakeId = randomUUID();
  const proofId = randomUUID();
  const routeId = randomUUID();
  const reviewId = randomUUID();
  const hash = createHash('sha256').update(n.rawMessage, 'utf8').digest('hex');

  await insert('intakes', {
    id: intakeId,
    source_channel: 'gsd-netlify',
    sender_name: n.senderName,
    contact_method: n.contact,
    signal_timestamp: now,
    raw_message: n.rawMessage,
    requested_help: n.requestedHelp,
    urgency: 'normal',
    money_or_service_signal: true,
    proof_attached: Boolean(input.proof || input.proof_links),
    notes: JSON.stringify({ source_class: n.classification, raw_input: input }),
    classification: 'owner_review',
    created_at: now,
    updated_at: now
  });

  await insert('proofs', {
    id: proofId,
    proof_title: 'GS&D intake proof',
    proof_type: 'sha256',
    related_intake_id: intakeId,
    source: 'gsd-netlify',
    proof_timestamp: now,
    description: n.rawMessage,
    file_or_url_reference: hash,
    custody_note: 'Raw customer wording preserved exactly; SHA-256 recorded before routing.',
    verification_status: 'unchecked',
    created_at: now,
    updated_at: now
  });

  await insert('routes', {
    id: routeId,
    subject_kind: 'intake',
    subject_id: intakeId,
    route_option: 'owner_review',
    next_action: 'Owner review required before any external action.',
    created_at: now
  });

  await insert('owner_review_queue', {
    id: reviewId,
    subject_kind: 'intake',
    subject_id: intakeId,
    title: `${n.senderName || 'Unknown sender'} — new GS&D intake`,
    route_recommendation: 'owner_review',
    risk: n.classification,
    proof_needed: 'Review raw wording and any supplied evidence.',
    status: 'pending',
    notes: JSON.stringify({ sha256: hash, source_class: n.classification }),
    created_at: now,
    updated_at: now
  });

  return {
    ok: true,
    system: 'Gauge Stack Agent',
    status: 'recorded',
    intake_id: intakeId,
    proof_id: proofId,
    route_id: routeId,
    review_id: reviewId,
    sha256: hash,
    source_class: n.classification,
    chosen_route: 'owner_review',
    result: 'Inserted into Gauge Console owner review queue.',
    fallback: null,
    created_at: now
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method === 'GET') return json({ ok: true, system: 'Gauge Stack Agent', status: 'online', endpoint: '/api/gauge-stack-agent' });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const input = await req.json().catch(() => null);
  if (!input || typeof input !== 'object') return json({ ok: false, error: 'invalid_json', fallback: 'hold' }, 400);

  try {
    return json(await buildProofChain(input));
  } catch (error) {
    return json({ ok: false, error: 'proof_chain_failed', detail: clean(error?.message, 2000), fallback: 'netlify_form_storage' }, 500);
  }
}

export const config = { path: '/api/gauge-stack-agent' };
