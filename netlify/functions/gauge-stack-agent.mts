import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

type GaugeStatus =
  | "Live"
  | "Broken"
  | "Missing"
  | "Needs Login"
  | "Needs Payment"
  | "Needs Proof"
  | "Owner Review";

type GaugeAsset = {
  id: string;
  asset_name: string;
  asset_type:
    | "Apps"
    | "Files"
    | "GPTs"
    | "Projects"
    | "Payments"
    | "Intake"
    | "Contracts"
    | "Proof"
    | "Corrections"
    | "Owner Review";
  asset_url?: string | null;
  owner?: string;
  source?: string;
  status: GaugeStatus;
  proof_needed?: boolean;
  payment_needed?: boolean;
  login_needed?: boolean;
  notes?: string;
  last_checked_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ProofLog = {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_type: string;
  status: GaugeStatus;
  proof_event: string;
  proof_data: Record<string, unknown>;
  created_at: string;
};

type NextAction = {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_type: string;
  status: GaugeStatus;
  action_text: string;
  priority: number;
  done: boolean;
  created_at: string;
};

const STORE_NAME = "gauge-stack-control";
const REGISTRY_KEY = "registry.json";
const PROOF_KEY = "proof-log.json";
const ACTIONS_KEY = "next-actions.json";

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getBlobStore() {
  const deployContext = process.env.CONTEXT || process.env.DEPLOY_PRIME_URL || "";
  if (deployContext === "production") {
    return getStore(STORE_NAME, { consistency: "strong" });
  }
  return getDeployStore(STORE_NAME);
}

function requireOwnerKey(req: Request) {
  const configuredKey = process.env.GAUGE_OWNER_KEY;

  // If no key is configured yet, allow POST so Lamar can deploy/test the first version.
  // For production custody, set GAUGE_OWNER_KEY in Netlify environment variables.
  if (!configuredKey) return null;

  const sentKey = req.headers.get("x-gauge-owner-key") || "";
  if (sentKey !== configuredKey) {
    return json({ ok: false, error: "Owner key required." }, 401);
  }

  return null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const starterAssets: GaugeAsset[] = [
  {
    id: "asset-master-control",
    asset_name: "GS&D Gauge Master Control app",
    asset_type: "Apps",
    asset_url: "https://gsd-gauge-master-control.netlify.app/",
    owner: "GS&D",
    source: "Netlify",
    status: "Live",
    proof_needed: false,
    notes: "Main operating body. Do not scatter.",
    created_at: new Date().toISOString(),
  },
  {
    id: "asset-stack-controller",
    asset_name: "Gauge Stack Controller",
    asset_type: "Apps",
    asset_url: "/gauge-stack-controller.html",
    owner: "GS&D",
    source: "Master Control",
    status: "Owner Review",
    proof_needed: true,
    notes: "Control screen inside Master Control.",
    created_at: new Date().toISOString(),
  },
  {
    id: "asset-agent-backend",
    asset_name: "Gauge Agent backend",
    asset_type: "Projects",
    asset_url: "/api/gauge-stack-agent",
    owner: "GS&D",
    source: "Netlify Function",
    status: "Owner Review",
    proof_needed: true,
    notes: "Reads registry, writes proof, makes next actions.",
    created_at: new Date().toISOString(),
  },
  {
    id: "asset-payments",
    asset_name: "Gauge payment route",
    asset_type: "Payments",
    owner: "GS&D",
    source: "Owner Proof",
    status: "Needs Proof",
    proof_needed: true,
    payment_needed: true,
    notes: "Attach Cash App or payment proof before public routing.",
    created_at: new Date().toISOString(),
  },
  {
    id: "asset-intake",
    asset_name: "Gauge Intake route",
    asset_type: "Intake",
    owner: "GS&D",
    source: "Master Control",
    status: "Owner Review",
    proof_needed: true,
    notes: "Connect inquiry forms and routing.",
    created_at: new Date().toISOString(),
  },
  {
    id: "asset-contracts",
    asset_name: "GS&D Contract Proposal Package",
    asset_type: "Contracts",
    owner: "GS&D",
    source: "Files",
    status: "Needs Proof",
    proof_needed: true,
    notes: "Attach current contract files and proof copies.",
    created_at: new Date().toISOString(),
  },
  {
    id: "asset-proof-log",
    asset_name: "Proof log",
    asset_type: "Proof",
    owner: "GS&D",
    source: "Netlify Blobs",
    status: "Live",
    proof_needed: false,
    notes: "Stores sync runs and asset proof events.",
    created_at: new Date().toISOString(),
  },
  {
    id: "asset-corrections",
    asset_name: "Corrections log",
    asset_type: "Corrections",
    owner: "GS&D",
    source: "Master Control",
    status: "Owner Review",
    proof_needed: true,
    notes: "Tracks fixes, breaks, and owner corrections.",
    created_at: new Date().toISOString(),
  },
];

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const store = getBlobStore();
  const data = await store.get(key, { type: "json" });
  return data ?? fallback;
}

async function writeJSON(key: string, value: unknown) {
  const store = getBlobStore();
  await store.setJSON(key, value);
}

async function readAssets() {
  const assets = await readJSON<GaugeAsset[]>(REGISTRY_KEY, []);
  if (!assets.length) {
    await writeJSON(REGISTRY_KEY, starterAssets);
    return starterAssets;
  }
  return assets;
}

function classifyAsset(asset: GaugeAsset): GaugeStatus {
  const name = (asset.asset_name || "").trim();
  const type = (asset.asset_type || "").trim();
  const url = (asset.asset_url || "").trim();

  if (!name || !type) return "Missing";
  if (asset.login_needed) return "Needs Login";
  if (asset.payment_needed) return "Needs Payment";
  if (asset.proof_needed) return "Needs Proof";

  if (!url) {
    if (["Files", "GPTs", "Contracts", "Proof", "Corrections", "Owner Review"].includes(type)) {
      return "Owner Review";
    }
    return "Missing";
  }

  try {
    new URL(url, "https://gsd-gauge-master-control.netlify.app");
  } catch {
    return "Broken";
  }

  return "Live";
}

function actionFor(status: GaugeStatus, asset: GaugeAsset) {
  const label = `${asset.asset_type}: ${asset.asset_name}`;

  if (status === "Live") return `Keep ${label} in registry. Check proof on next sync.`;
  if (status === "Broken") return `Fix the bad link or broken route for ${label}.`;
  if (status === "Missing") return `Add the missing name, type, or link for ${label}.`;
  if (status === "Needs Login") return `Owner must log in and prove access for ${label}.`;
  if (status === "Needs Payment") return `Connect or prove the payment path for ${label}.`;
  if (status === "Needs Proof") return `Attach screenshot, link, file, receipt, or note proof for ${label}.`;
  return `Owner review needed for ${label}. Decide keep, fix, connect, or archive.`;
}

async function runSync() {
  const now = new Date().toISOString();
  const assets = await readAssets();
  const oldProof = await readJSON<ProofLog[]>(PROOF_KEY, []);
  const oldActions = await readJSON<NextAction[]>(ACTIONS_KEY, []);

  const proofItems: ProofLog[] = [];
  const nextActions: NextAction[] = [];

  const updatedAssets = assets.map((asset) => {
    const status = classifyAsset(asset);
    const action_text = actionFor(status, asset);

    proofItems.push({
      id: makeId("proof"),
      asset_id: asset.id,
      asset_name: asset.asset_name,
      asset_type: asset.asset_type,
      status,
      proof_event: "Gauge Stack Sync checked this asset.",
      proof_data: {
        checked_at: now,
        old_status: asset.status,
        new_status: status,
        asset_url: asset.asset_url || null,
      },
      created_at: now,
    });

    nextActions.push({
      id: makeId("action"),
      asset_id: asset.id,
      asset_name: asset.asset_name,
      asset_type: asset.asset_type,
      status,
      action_text,
      priority: status === "Broken" || status === "Missing" ? 1 : status === "Owner Review" ? 2 : 3,
      done: false,
      created_at: now,
    });

    return {
      ...asset,
      status,
      last_checked_at: now,
      updated_at: now,
    };
  });

  await writeJSON(REGISTRY_KEY, updatedAssets);
  await writeJSON(PROOF_KEY, [...proofItems, ...oldProof].slice(0, 500));
  await writeJSON(ACTIONS_KEY, [...nextActions, ...oldActions].slice(0, 200));

  return {
    ok: true,
    message: "Gauge Stack Sync complete.",
    checked_count: updatedAssets.length,
    results: nextActions,
  };
}

export default async (req: Request, context: Context) => {
  try {
    if (req.method === "GET") {
      const assets = await readAssets();
      const actions = await readJSON<NextAction[]>(ACTIONS_KEY, []);
      const proof_log = await readJSON<ProofLog[]>(PROOF_KEY, []);
      return json({ ok: true, assets, actions, proof_log: proof_log.slice(0, 25) });
    }

    if (req.method === "POST") {
      const authError = requireOwnerKey(req);
      if (authError) return authError;

      const body = await req.json().catch(() => ({}));

      if (body.action === "sync") {
        return json(await runSync());
      }

      if (body.action === "saveRegistry" && Array.isArray(body.assets)) {
        await writeJSON(REGISTRY_KEY, body.assets);
        return json({ ok: true, message: "Registry saved." });
      }

      return json({ ok: false, error: "Use action: sync or saveRegistry." }, 400);
    }

    return json({ ok: false, error: "Use GET or POST." }, 405);
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Gauge Agent error.",
      },
      500
    );
  }
};

export const config: Config = {
  path: "/api/gauge-stack-agent",
};
