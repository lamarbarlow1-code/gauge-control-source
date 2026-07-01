import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

type Intake = {
  source?: string;
  name?: string;
  email?: string;
  phone?: string;
  service?: string;
  requestType?: string;
  urgency?: string;
  asset?: string;
  vehicle?: string;
  mileage?: string;
  issue?: string;
  symptoms?: string;
  history?: string;
  proof?: string;
  outcome?: string;
};

type SourceCheck = "known_owner" | "unknown_source" | "duplicate" | "hostile" | "incomplete";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getProofStore() {
  const deploymentContext = process.env.CONTEXT || process.env.DEPLOY_PRIME_URL || "";
  if (deploymentContext === "production") {
    return getStore("gauge-proof", { consistency: "strong" });
  }
  return getDeployStore("gauge-proof");
}

function classifyIntent(input: Intake) {
  const words = [input.service, input.requestType, input.outcome, input.issue].map(clean).join(" ").toLowerCase();
  if (words.includes("proof")) return "proof_record";
  if (words.includes("fleet") || words.includes("work-order")) return "work_order_review";
  if (words.includes("website") || words.includes("app") || words.includes("route")) return "route_cleanup";
  if (words.includes("safety")) return "safety_review";
  if (words.includes("maintenance")) return "maintenance_request";
  if (words.includes("repair")) return "repair_request";
  return "diagnostic_request";
}

function destructiveCommand(input: Intake) {
  const text = [input.issue, input.outcome, input.proof].map(clean).join(" ").toLowerCase();
  return /\b(delete all|erase all|purge all|wipe (the )?(record|database|system)|wire money|send payment|change bank|change cash app)\b/.test(text);
}

function makeSummary(input: Intake, proofId: string, route: string) {
  return [
    "GS&D GAUGE INTAKE",
    `Proof ID: ${proofId}`,
    `Route: ${route}`,
    `Service: ${clean(input.service) || "Not stated"}`,
    `Name / Entity: ${clean(input.name) || "Not stated"}`,
    `Email: ${clean(input.email) || "Not stated"}`,
    `Phone: ${clean(input.phone) || "Not stated"}`,
    `Asset / System: ${clean(input.asset) || "Not stated"}`,
    `Year / Make / Model: ${clean(input.vehicle) || "Not stated"}`,
    `Mileage / Hours: ${clean(input.mileage) || "Not stated"}`,
    `Request Type: ${clean(input.requestType) || "Not stated"}`,
    `Urgency: ${clean(input.urgency) || "Not stated"}`,
    `Requested Outcome: ${clean(input.outcome) || "Not stated"}`,
    "",
    "Issue / Question:", clean(input.issue) || "Not stated",
    "", "Symptoms / Codes / Warning Lights:", clean(input.symptoms) || "Not stated",
    "", "History:", clean(input.history) || "Not stated",
    "", "Proof / Links:", clean(input.proof) || "Not stated",
  ].join("\n");
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405);

  let rawInput = "";
  let input: Intake;
  try {
    rawInput = await req.text();
    input = JSON.parse(rawInput) as Intake;
  } catch {
    return json({ ok: false, error: "Malformed intake. Nothing was routed or written.", fallback: "Correct the form and submit again." }, 400);
  }

  const name = clean(input.name);
  const email = clean(input.email);
  const phone = clean(input.phone);
  const issue = clean(input.issue);
  const source = clean(input.source) || "web-form";
  const contact = email || phone;
  const intent = classifyIntent(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawInput));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const proofId = `G-${hash.slice(0, 12).toUpperCase()}`;
  const ownerEmails = (process.env.GAUGE_OWNER_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const sourceCheck: SourceCheck = !name || !contact || !issue
    ? "incomplete"
    : ownerEmails.includes(email.toLowerCase())
      ? "known_owner"
      : destructiveCommand(input)
        ? "hostile"
        : "unknown_source";

  const store = getProofStore();
  let duplicate: unknown;
  try {
    duplicate = await store.get(`records/${hash}`, { type: "json" });
  } catch {
    return json({ ok: false, proofId, hash, error: "Proof storage is unavailable. Intake was not routed.", fallback: "Hold this request and retry after storage is available." }, 503);
  }

  if (duplicate) {
    return json({
      ok: true, proofId, hash, sourceCheck: "duplicate", parsedCommand: { source, intent }, chosenRoute: "hold_duplicate",
      result: "Duplicate blocked. No second route was created.", fallback: "Use the original proof record for follow-up."
    });
  }

  const chosenRoute = sourceCheck === "known_owner"
    ? "owner_queue"
    : sourceCheck === "unknown_source"
      ? "hold_unknown_source"
      : sourceCheck === "hostile"
        ? "hold_hostile_command"
        : "hold_incomplete";
  const result = sourceCheck === "known_owner"
    ? "Validated owner intake recorded and queued for owner action."
    : sourceCheck === "unknown_source"
      ? "Intake recorded in hold for owner review before action."
      : sourceCheck === "hostile"
        ? "Command recorded and held. No destructive action was executed."
        : "Intake held because required source or contact proof is missing.";
  const fallback = sourceCheck === "incomplete"
    ? "Add name, contact, and issue details, then submit a new intake."
    : "Owner review is required before any external action.";
  const parsedCommand = {
    source,
    intent,
    requestedOutcome: clean(input.outcome) || "not_stated",
    urgency: clean(input.urgency) || "not_stated",
  };
  const record = {
    version: "Gauge Proof Chain v1",
    createdAt: new Date().toISOString(),
    rawInput,
    hash,
    sourceCheck,
    parsedCommand,
    chosenRoute,
    result,
    fallback,
    contact,
    proofId,
  };

  try {
    await store.setJSON(`records/${hash}`, record);
  } catch {
    return json({ ok: false, proofId, hash, error: "Proof storage failed. No route was completed.", fallback: "Hold this request and retry; do not treat it as accepted." }, 503);
  }

  const summary = makeSummary(input, proofId, chosenRoute);
  const ownerEmail = process.env.GAUGE_OWNER_EMAIL || "gaugesystems515@gmail.com";
  const mailto = `mailto:${encodeURIComponent(ownerEmail)}?subject=${encodeURIComponent(`GS&D Gauge Intake ${proofId}`)}&body=${encodeURIComponent(summary)}`;

  return json({ ok: true, proofId, hash, sourceCheck, parsedCommand, chosenRoute, result, fallback, summary, mailto });
};

export const config: Config = {
  path: "/gauge/intake",
};
