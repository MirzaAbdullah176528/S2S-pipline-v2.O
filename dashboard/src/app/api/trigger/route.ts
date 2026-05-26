import { NextResponse } from "next/server";
import {
  SESSIONS,
  RUNTIME_DEVICES,
  KAGGLE_ACCOUNTS,
  HF_REPOS,
  getSessionById,
  getDeviceById,
  getAccountById,
  getHfRepoById,
} from "@/lib/sessionConfig";

// ── Environment ───────────────────────────────────────────────────────────────

const CF_WORKER_URL    = process.env.CF_WORKER_URL!;
const CF_WORKER_SECRET = process.env.CF_WORKER_SECRET!;

// Kaggle credentials per account
const KAGGLE_CREDENTIALS: Record<string, { username: string; key: string }> = {
  primary: {
    username: process.env.KAGGLE_USERNAME ?? "",
    key:      process.env.KAGGLE_KEY ?? "",
  },
  secondary: {
    username: process.env.KAGGLE_USERNAME_ALT ?? process.env.KAGGLE_USERNAME ?? "",
    key:      process.env.KAGGLE_KEY_ALT ?? process.env.KAGGLE_KEY ?? "",
  },
};

const DATASET_SLUG = "mirza176528/s2s-pipline-v2-0-2";

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `run_${date}_${time}`;
}

function basicAuth(username: string, key: string): string {
  return "Basic " + Buffer.from(`${username}:${key}`).toString("base64");
}

// ── CF Worker ─────────────────────────────────────────────────────────────────

async function createCfRun(runId: string, sessionType: string): Promise<void> {
  const res = await fetch(`${CF_WORKER_URL}/api/run`, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-Worker-Secret": CF_WORKER_SECRET,
    },
    body: JSON.stringify({ run_id: runId, session_type: sessionType }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF Worker /api/run failed ${res.status}: ${text}`);
  }
}

// ── Notebook Builder ──────────────────────────────────────────────────────────

async function getNotebookText(
  runId: string,
  session: NonNullable<ReturnType<typeof getSessionById>>,
  device: NonNullable<ReturnType<typeof getDeviceById>>,
  hfRepo: ReturnType<typeof getHfRepoById>,
): Promise<string> {
  const notebookFile = session.notebookFile;

  // Try fetching the notebook from the Kaggle dataset
  try {
    const primaryCreds = KAGGLE_CREDENTIALS["primary"];
    if (!primaryCreds) throw new Error("Primary Kaggle credentials not configured");
    const listRes = await fetch(
      `https://www.kaggle.com/api/v1/datasets/${DATASET_SLUG}/files`,
      { headers: { Authorization: basicAuth(primaryCreds.username, primaryCreds.key) } }
    );

    if (listRes.ok) {
      const listData = await listRes.json() as { files?: { name: string; url: string }[] };
      const file = listData.files?.find((f) => f.name === notebookFile);
      if (file?.url) {
        const dlRes = await fetch(file.url, {
          headers: { Authorization: basicAuth(primaryCreds.username, primaryCreds.key) },
        });
        if (dlRes.ok) {
          const nb = await dlRes.json() as { cells?: unknown[] };
          const injectCell = {
            cell_type: "code",
            source: [
              "import os, sys\n",
              `os.environ['RUN_ID_OVERRIDE'] = '${runId}'\n`,
              `os.environ['SESSION_TYPE'] = '${session.id}'\n`,
              `os.environ['HF_OUTPUT_REPO'] = '${hfRepo?.repoId ?? ""}'\n`,
              "import glob\n",
              "print('\\n'.join(glob.glob('/kaggle/input/**/*.ipynb', recursive=True)))\n",
              "mount = [d for d in os.listdir('/kaggle/input') if 's2s' in d.lower() or 'pipline' in d.lower()]\n",
              "print('mount dirs:', mount)\n",
            ],
            metadata: {},
            outputs: [],
            execution_count: null,
          };
          nb.cells = [injectCell, ...(nb.cells ?? [])];
          return JSON.stringify(nb);
        }
      }
    }
  } catch {
    // fall through to fallback
  }

  // Fallback: build a minimal notebook that loads and executes the session notebook
  const secretsList = buildSecretsList(session);

  return JSON.stringify({
    cells: [
      {
        cell_type: "code",
        source: [
          "import os, sys, json\n",
          `os.environ['RUN_ID_OVERRIDE'] = '${runId}'\n`,
          `os.environ['SESSION_TYPE'] = '${session.id}'\n`,
          `os.environ['HF_OUTPUT_REPO'] = '${hfRepo?.repoId ?? ""}'\n`,
          `os.environ['CF_WORKER_URL'] = '${process.env.CF_WORKER_URL ?? ""}'\n`,
          `os.environ['CF_WORKER_SECRET'] = '${process.env.CF_WORKER_SECRET ?? ""}'\n`,
          ...secretsList.map((s) => `os.environ['${s.key}'] = '${s.value}'\n`),
          "sys.path.insert(0, '/kaggle/input/datasets/mirza176528/s2s-pipline-v2-0-2')\n",
          `nb = json.load(open('/kaggle/input/datasets/mirza176528/s2s-pipline-v2-0-2/${notebookFile}'))\n`,
          "src = '\\n'.join(''.join(c['source']) for c in nb['cells'] if c['cell_type']=='code')\n",
          "exec(src, {'__name__': '__main__'})\n",
        ],
        metadata: {},
        outputs: [],
        execution_count: null,
      },
    ],
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.10.0" },
    },
    nbformat: 4,
    nbformat_minor: 4,
  });
}

function buildSecretsList(session: NonNullable<ReturnType<typeof getSessionById>>): { key: string; value: string }[] {
  // Build the list of secrets to inject based on what the session requires
  const allEnvVars: Record<string, string> = {
    HF_TOKEN_PRIMARY:   process.env.HF_TOKEN_PRIMARY ?? "",
    HF_TOKEN_SECONDARY: process.env.HF_TOKEN_SECONDARY ?? "",
    HF_TOKEN_TERTIARY:  process.env.HF_TOKEN_TERTIARY ?? "",
    GEMINI_API_KEY_01:  process.env.GEMINI_API_KEY_01 ?? "",
    GEMINI_API_KEY_02:  process.env.GEMINI_API_KEY_02 ?? "",
    GEMINI_API_KEY_03:  process.env.GEMINI_API_KEY_03 ?? "",
    GEMINI_API_KEY_04:  process.env.GEMINI_API_KEY_04 ?? "",
    GEMINI_API_KEY:     process.env.GEMINI_API_KEY_01 ?? "",
  };

  // Only include env vars that are mentioned in the session requirements
  const requiredKeys = session.requirements
    .filter((r) => r.category === "env")
    .map((r) => r.label.split(" ")[0])
    .filter((rk): rk is string => typeof rk === "string" && rk.length > 0);

  const secretsToInclude = Object.entries(allEnvVars).filter(
    ([key]) => requiredKeys.some((rk) => key.startsWith(rk)) || key.startsWith("HF_TOKEN") || key.startsWith("GEMINI_API_KEY")
  );

  return secretsToInclude.map(([key, value]) => ({ key, value }));
}

// ── Kaggle Kernel Push ────────────────────────────────────────────────────────

async function pushKaggleKernel(
  runId: string,
  session: NonNullable<ReturnType<typeof getSessionById>>,
  device: NonNullable<ReturnType<typeof getDeviceById>>,
  account: NonNullable<ReturnType<typeof getAccountById>>,
  hfRepo: ReturnType<typeof getHfRepoById>,
): Promise<{ kernelSlug: string }> {
  const notebookText = await getNotebookText(runId, session, device, hfRepo);
  const sessionPrefix = session.id.replace(/_/g, "-");
  const kernelTitle   = `${sessionPrefix}-${runId.replace(/_/g, "-")}`;

  const kaggleCreds = KAGGLE_CREDENTIALS[account.id] ?? KAGGLE_CREDENTIALS["primary"]!;
  if (!kaggleCreds) throw new Error(`No Kaggle credentials for account: ${account.id}`);

  const secretsForKernel = [
    { key: "CF_WORKER_URL",      value: process.env.CF_WORKER_URL      ?? "" },
    { key: "CF_WORKER_SECRET",   value: process.env.CF_WORKER_SECRET   ?? "" },
    { key: "HF_TOKEN_PRIMARY",   value: process.env.HF_TOKEN_PRIMARY   ?? "" },
    { key: "HF_TOKEN_SECONDARY", value: process.env.HF_TOKEN_SECONDARY ?? "" },
    { key: "HF_TOKEN_TERTIARY",  value: process.env.HF_TOKEN_TERTIARY  ?? "" },
  ];

  // Add Gemini keys if the session requires them
  const needsGemini = session.requirements.some(
    (r) => r.label.includes("Gemini") && r.required
  );
  if (needsGemini) {
    for (let i = 1; i <= 4; i++) {
      const keyStr = `GEMINI_API_KEY_${String(i).padStart(2, "0")}`;
      const val = process.env[keyStr] ?? "";
      if (val) secretsForKernel.push({ key: keyStr, value: val });
    }
  }

  // Build the kernel push payload using the accelerator field for precise device selection
  const payload = {
    newTitle:               kernelTitle,
    text:                   notebookText,
    language:               "python",
    kernelType:             "notebook",
    isPrivate:              true,
    enableGpu:              device.enableGpu,
    enableTpu:              device.enableTpu,
    enableInternet:         session.enableInternet,
    datasetDataSources:     [DATASET_SLUG],
    competitionDataSources: [],
    kernelDataSources:      [],
    categoryIds:            [],
    enableCustomSecret:     true,
    secrets:                secretsForKernel,
  };

  const res = await fetch("https://www.kaggle.com/api/v1/kernels/push", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": basicAuth(kaggleCreds.username, kaggleCreds.key),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kaggle API failed ${res.status}: ${text}`);
  }

  const data = await res.json() as { ref?: string; error?: string };
  if (data.error) throw new Error(`Kaggle error: ${data.error}`);

  const raw  = data.ref ?? `${kaggleCreds.username}/${kernelTitle}`;
  const slug = raw.replace(/^\/+/, "");

  return { kernelSlug: slug };
}

// ── API Handlers ──────────────────────────────────────────────────────────────

interface TriggerRequestBody {
  session_type?: string;
  device?: string;
  account?: string;
  hf_repo?: string;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    kaggle_username:   process.env.KAGGLE_USERNAME ?? "NOT SET",
    kaggle_key_length: process.env.KAGGLE_KEY?.length ?? 0,
    kaggle_key_prefix: process.env.KAGGLE_KEY?.slice(0, 6) ?? "NOT SET",
    cf_worker_url:     process.env.CF_WORKER_URL ?? "NOT SET",
    available_sessions: SESSIONS.map((s) => s.id),
    available_devices: RUNTIME_DEVICES.map((d) => ({ id: d.id, label: d.label, accelerator: d.accelerator })),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  // ── Parse body ──────────────────────────────────────────────────────────
  let body: TriggerRequestBody;
  try {
    body = await request.json() as TriggerRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body. Send { session_type, device, account, hf_repo }." },
      { status: 400 }
    );
  }

  const sessionType = body.session_type ?? "";
  const deviceId    = body.device ?? "";
  const accountId   = body.account ?? "";
  const hfRepoId   = body.hf_repo ?? "";

  // ── Validate session ────────────────────────────────────────────────────
  const session = getSessionById(sessionType);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: `Unknown session type: "${sessionType}". Available: ${SESSIONS.map((s) => s.id).join(", ")}` },
      { status: 400 }
    );
  }

  // ── Validate device ─────────────────────────────────────────────────────
  const device = getDeviceById(deviceId);
  if (!device) {
    return NextResponse.json(
      { ok: false, error: `Unknown device: "${deviceId}". Available: ${RUNTIME_DEVICES.map((d) => d.id).join(", ")}` },
      { status: 400 }
    );
  }
  if (!session.compatibleDevices.includes(deviceId)) {
    return NextResponse.json(
      { ok: false, error: `Device "${device.label}" is not compatible with session "${session.label}". Compatible devices: ${session.compatibleDevices.join(", ")}` },
      { status: 400 }
    );
  }

  // ── Validate account ────────────────────────────────────────────────────
  const account = getAccountById(accountId);
  if (!account) {
    return NextResponse.json(
      { ok: false, error: `Unknown account: "${accountId}". Available: ${KAGGLE_ACCOUNTS.map((a) => a.id).join(", ")}` },
      { status: 400 }
    );
  }
  const kaggleCreds = KAGGLE_CREDENTIALS[accountId] ?? KAGGLE_CREDENTIALS["primary"];
  if (!kaggleCreds?.username || !kaggleCreds?.key) {
    return NextResponse.json(
      { ok: false, error: `Kaggle credentials not configured for account "${account.label}". Check KAGGLE_USERNAME and KAGGLE_KEY environment variables.` },
      { status: 500 }
    );
  }

  // ── Validate HF repo ────────────────────────────────────────────────────
  const hfRepo = hfRepoId ? getHfRepoById(hfRepoId) : undefined;
  if (hfRepoId && !hfRepo) {
    return NextResponse.json(
      { ok: false, error: `Unknown HF repo: "${hfRepoId}". Available: ${HF_REPOS.map((r) => r.id).join(", ")}` },
      { status: 400 }
    );
  }
  if (hfRepoId && !session.outputHfRepos.includes(hfRepoId)) {
    return NextResponse.json(
      { ok: false, error: `HF repo "${hfRepo?.repoId}" is not an output repository for session "${session.label}". Valid output repos: ${session.outputHfRepos.join(", ")}` },
      { status: 400 }
    );
  }

  // ── Check core env vars ─────────────────────────────────────────────────
  if (!CF_WORKER_URL || !CF_WORKER_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Missing CF_WORKER_URL or CF_WORKER_SECRET environment variables on the server." },
      { status: 500 }
    );
  }

  // ── Create CF Run ───────────────────────────────────────────────────────
  const runId = generateRunId();

  try {
    await createCfRun(runId, sessionType);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to create run on CF Worker: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  // ── Push Kaggle Kernel ──────────────────────────────────────────────────
  let kernelSlug: string;
  try {
    const result = await pushKaggleKernel(runId, session, device, account, hfRepo);
    kernelSlug = result.kernelSlug;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `CF run created (${runId}) but Kaggle launch failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const kaggleUrl = kernelSlug.startsWith("code/")
    ? `https://www.kaggle.com/${kernelSlug}`
    : `https://www.kaggle.com/code/${kernelSlug}`;

  return NextResponse.json({
    ok:          true,
    run_id:      runId,
    session:     sessionType,
    notebook:    session.notebookFile,
    device:      device.label,
    accelerator: device.accelerator,
    account:     account.label,
    hf_repo:     hfRepo?.repoId ?? null,
    kernel_slug: kernelSlug,
    kaggle_url:  kaggleUrl,
  });
}
