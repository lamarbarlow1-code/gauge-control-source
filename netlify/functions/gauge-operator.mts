import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

type QueueItem = {
  proofId: string;
  hash: string;
  receivedAt: string;
  sourceCheck: string;
  intent: string;
  chosenRoute: string;
  result: string;
  contact: string;
  asset: string;
  issuePreview: string;
  lastOperatorEvent?: string;
  operatorNote?: string;
};

type IntakeRecord = Record<string, unknown> & {
  proofId: string;
  hash: string;
  chosenRoute: string;
  result: string;
  fallback: string;
  sourceCheck: string;
  parsedCommand: { source: string; intent: string };
  operatorHistory?: Array<Record<string, unknown>>;
};

const OWNER_KEY_HASH = "f4ca3b60e754f73ba396fa42c9e70a4d0f75146b4a3ef8f3ebbca7d0fcfe6519";
const ALLOWED_ROUTES = new Set([
  "owner_queue",
  "hold_unknown_source",
  "hold_incomplete",
  "hold_hostile_command",
  "closed",
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function productionStore(name: string) {
  const deploymentContext = process.env.CONTEXT || process.env.DEPLOY_PRIME_URL || "";
  if (deploymentContext === "production") return getStore(name, { consistency: "strong" });
  return getDeployStore(name);
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ownerAuth(req: Request) {
  const sent = req.headers.get("x-gauge-owner-key") || "";
  if (!sent || await hash(sent) !== OWNER_KEY_HASH) {
    return json({ ok: false, error: "Owner key required." }, 401);
  }
  return null;
}

function getQueueItem(queue: QueueItem[], proofId: string) {
  return queue.find((item) => item.proofId === proofId);
}

function routeResult(route: string) {
  if (route === "owner_queue") return "Owner routed this intake into the action queue.";
  if (route === "closed") return "Owner closed this intake. The proof record remains preserved.";
  return "Owner placed this intake in hold pending further proof or review.";
}

export default async (req: Request, _context: Context) => {
  const auth = await ownerAuth(req);
  if (auth) return auth;

  const proofStore = productionStore("gauge-proof");
  const stackStore = productionStore("gauge-stack-control");

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const proofId = url.searchParams.get("proofId") || "";
      const queue = (await proofStore.get("queue.json", { type: "json" }) as QueueItem[] | null) || [];

      if (proofId) {
        const item = getQueueItem(queue, proofId);
        if (!item) return json({ ok: false, error: "Proof record was not found in the queue index." }, 404);
        const record = await proofStore.get(`records/${item.hash}`, { type: "json" }) as IntakeRecord | null;
        if (!record) return json({ ok: false, error: "Proof record is missing. This intake remains paused." }, 409);
        return json({ ok: true, queueItem: item, record });
      }

      const [assets, actions, proofLog] = await Promise.all([
        stackStore.get("registry.json", { type: "json" }),
        stackStore.get("next-actions.json", { type: "json" }),
        stackStore.get("proof-log.json", { type: "json" }),
      ]);

      return json({
        ok: true,
        queue,
        stack: {
          assets: assets || [],
          actions: actions || [],
          proofLog: Array.isArray(proofLog) ? proofLog.slice(0, 25) : [],
        },
      });
    }

    if (req.method !== "POST") return json({ ok: false, error: "Use GET or POST." }, 405);

    const body = await req.json().catch(() => ({}));
    if (body.action !== "routeIntake") {
      return json({ ok: false, error: "Use action: routeIntake." }, 400);
    }

    const proofId = typeof body.proofId === "string" ? body.proofId : "";
    const newRoute = typeof body.route === "string" ? body.route : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    const confirmed = body.confirmed === true;

    if (!proofId || !ALLOWED_ROUTES.has(newRoute)) {
      return json({ ok: false, error: "A valid proof ID and route are required." }, 400);
    }
    if (newRoute === "closed" && !confirmed) {
      return json({ ok: false, error: "Closing requires explicit confirmation. No change was made." }, 409);
    }

    const queue = (await proofStore.get("queue.json", { type: "json" }) as QueueItem[] | null) || [];
    const queueItem = getQueueItem(queue, proofId);
    if (!queueItem) return json({ ok: false, error: "Proof record was not found in the queue index." }, 404);

    const record = await proofStore.get(`records/${queueItem.hash}`, { type: "json" }) as IntakeRecord | null;
    if (!record) return json({ ok: false, error: "Proof record is missing. This intake remains paused." }, 409);

    const now = new Date().toISOString();
    const event = {
      at: now,
      action: "routeIntake",
      from: record.chosenRoute,
      to: newRoute,
      note: note || "No note supplied.",
    };
    const updatedRecord: IntakeRecord = {
      ...record,
      chosenRoute: newRoute,
      result: routeResult(newRoute),
      fallback: newRoute === "owner_queue" ? "Proceed only with a separate, explicit owner action." : "Held until owner changes the route.",
      operatorHistory: [...(record.operatorHistory || []), event],
    };
    const updatedQueue = queue.map((item) => item.proofId === proofId ? {
      ...item,
      chosenRoute: newRoute,
      result: updatedRecord.result,
      lastOperatorEvent: now,
      operatorNote: note || "No note supplied.",
    } : item);

    await proofStore.setJSON(`records/${queueItem.hash}`, updatedRecord);
    await proofStore.setJSON("queue.json", updatedQueue);

    return json({ ok: true, proofId, chosenRoute: newRoute, result: updatedRecord.result, event });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Gauge operator failed without a complete result.",
      fallback: "Nothing should be treated as completed until a proof record confirms it.",
    }, 500);
  }
};

export const config: Config = {
  path: "/gauge/operator",
};
