import { NextResponse } from "next/server";

const CF_WORKER_URL    = process.env.CF_WORKER_URL!;
const CF_WORKER_SECRET = process.env.CF_WORKER_SECRET!;
const KAGGLE_USERNAME  = process.env.KAGGLE_USERNAME!;
const KAGGLE_KEY       = process.env.KAGGLE_KEY!;

const DATASET_SLUG  = "mirza176528/s2s-pipline-v2-0-2";
const SESSION_TYPE  = "cpu_collect";
const NOTEBOOK_FILE = "session_cpu_collect.ipynb";

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `run_${date}_${time}`;
}

function basicAuth(): string {
  return "Basic " + Buffer.from(`${KAGGLE_USERNAME}:${KAGGLE_KEY}`).toString("base64");
}

async function createCfRun(runId: string): Promise<void> {
  const res = await fetch(`${CF_WORKER_URL}/api/run`, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-Worker-Secret": CF_WORKER_SECRET,
    },
    body: JSON.stringify({ run_id: runId, session_type: SESSION_TYPE }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF Worker /api/run failed ${res.status}: ${text}`);
  }
}

async function getNotebookText(runId: string): Promise<string> {
  try {
    const listRes = await fetch(
      `https://www.kaggle.com/api/v1/datasets/${DATASET_SLUG}/versions/1/files`,
      { headers: { Authorization: basicAuth() } }
    );
    if (listRes.ok) {
      const listData = await listRes.json() as { files?: { name: string; url: string }[] };
      const file = listData.files?.find(f => f.name === NOTEBOOK_FILE);
      if (file?.url) {
        const dlRes = await fetch(file.url, { headers: { Authorization: basicAuth() } });
        if (dlRes.ok) {
          const nb = await dlRes.json() as { cells?: unknown[] };
          const injectCell = {
            cell_type: "code",
            source: [
              "import os\n",
              `os.environ['RUN_ID_OVERRIDE'] = '${runId}'\n`,
              `print(f'[trigger] RUN_ID injected: ${runId}')\n`,
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
  }

  return JSON.stringify({
    cells: [
      {
        cell_type: "code",
        source: [
          "import os, sys\n",
          `os.environ['RUN_ID_OVERRIDE'] = '${runId}'\n`,
          "sys.path.insert(0, '/kaggle/input/s2s-pipline-v2-0-2')\n",
          "exec(open('/kaggle/input/s2s-pipline-v2-0-2/session_cpu_collect.ipynb').read())\n",
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

async function pushKaggleKernel(runId: string): Promise<{ kernelSlug: string }> {
  const notebookText = await getNotebookText(runId);
  const kernelTitle  = `cpu-collect-${runId.replace(/_/g, "-")}`;

  const payload = {
    newTitle:               kernelTitle,
    text:                   notebookText,
    language:               "python",
    kernelType:             "notebook",
    isPrivate:              true,
    enableGpu:              false,
    enableTpu:              false,
    enableInternet:         true,
    datasetDataSources:     [DATASET_SLUG],
    competitionDataSources: [],
    kernelDataSources:      [],
    categoryIds:            [],
  };

  const res = await fetch("https://www.kaggle.com/api/v1/kernels/push", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": basicAuth(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kaggle API failed ${res.status}: ${text}`);
  }

  const data = await res.json() as { ref?: string; error?: string };
  if (data.error) throw new Error(`Kaggle error: ${data.error}`);

  const raw  = data.ref ?? `${KAGGLE_USERNAME}/${kernelTitle}`;
  const slug = raw.replace(/^\/+/, "");

  return { kernelSlug: slug };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    kaggle_username:   process.env.KAGGLE_USERNAME ?? "NOT SET",
    kaggle_key_length: process.env.KAGGLE_KEY?.length ?? 0,
    kaggle_key_prefix: process.env.KAGGLE_KEY?.slice(0, 6) ?? "NOT SET",
    cf_worker_url:     process.env.CF_WORKER_URL ?? "NOT SET",
  });
}

export async function POST(): Promise<NextResponse> {
  if (!CF_WORKER_URL || !CF_WORKER_SECRET || !KAGGLE_USERNAME || !KAGGLE_KEY) {
    return NextResponse.json(
      { ok: false, error: "Missing required environment variables on server" },
      { status: 500 }
    );
  }

  const runId = generateRunId();

  try {
    await createCfRun(runId);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to create run on CF Worker: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  let kernelSlug: string;
  try {
    const result = await pushKaggleKernel(runId);
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
    session:     SESSION_TYPE,
    notebook:    NOTEBOOK_FILE,
    kernel_slug: kernelSlug,
    kaggle_url:  kaggleUrl,
  });
}