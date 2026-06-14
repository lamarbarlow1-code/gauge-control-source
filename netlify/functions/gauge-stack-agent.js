function ticketNumber() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GSA-${stamp}-${rand}`;
}

function text(value) {
  return String(value || '').trim().slice(0, 4000);
}

function laneFor(input) {
  const all = JSON.stringify(input || {}).toLowerCase();
  if (/truck|vehicle|ford|chevy|dodge|engine|transmission|fleet|unit|tahoe|explorer/.test(all)) return 'vehicle/fleet';
  if (/tractor|gator|equipment|machine|skid|excavator|loader|hydraulic/.test(all)) return 'equipment';
  if (/website|app|netlify|router|form|email|message|gmail|cloud/.test(all)) return 'router/business-system';
  if (/proof|record|document|timeline|evidence/.test(all)) return 'proof-record';
  return 'general-intake';
}

function output(input) {
  const now = new Date().toISOString();
  const id = ticketNumber();
  const facts = [];
  const missing = [];
  const fields = {
    name: input.name,
    email: input.email || input.reply_email,
    phone: input.phone,
    company: input.company || input.business,
    asset: input.asset || input.unit || input.system,
    problem: input.problem || input.message || input.issue || input.need,
    proof: input.proof || input.proof_links,
    payment: input.payment
  };
  for (const [key, value] of Object.entries(fields)) {
    if (text(value)) facts.push(`${key}: ${text(value)}`);
    else missing.push(key);
  }
  const lane = laneFor(input);
  const paidReady = /paid|yes|ready|review/i.test(text(fields.payment));
  return {
    ok: true,
    system: 'Gauge Stack Agent',
    route: 'live-stack-router',
    endpoint: '/api/gauge-stack-agent',
    ticket_number: id,
    created_at: now,
    lane,
    paid_ready: paidReady,
    facts_received: facts,
    missing_info: missing,
    boundary: 'Capture facts, preserve proof, classify lane, and route next action before paid review.',
    next_action: paidReady ? 'Route to paid GS&D review and proof capture.' : 'Collect missing intake fields and payment confirmation before paid review.',
    customer_reply: 'Your request reached Gauge. The next step is proof/payment review or missing-fact capture.',
    raw_input: input
  };
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      system: 'Gauge Stack Agent',
      status: 'online',
      endpoint: '/api/gauge-stack-agent',
      accepts: 'POST JSON intake'
    }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Use GET or POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  const input = await req.json().catch(() => ({}));
  return new Response(JSON.stringify(output(input), null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export const config = {
  path: '/api/gauge-stack-agent'
};
