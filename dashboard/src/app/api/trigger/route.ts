import { NextResponse } from "next/server";

const CF_WORKER_URL    = process.env.CF_WORKER_URL!;
const CF_WORKER_SECRET = process.env.CF_WORKER_SECRET!;
const KAGGLE_USERNAME  = process.env.KAGGLE_USERNAME!;
const KAGGLE_KEY       = process.env.KAGGLE_KEY!;

const DATASET_SLUG     = "mirza176528/s2s-pipline-v2-0-2";
const NOTEBOOK_FILE    = "session_cpu_collect.ipynb";
const SESSION_TYPE     = "cpu_collect";

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `run_${date}_${time}`;
}

async function createCfRun(runId: string): Promise<void> {
  const res = await fetch(`${CF_WORKER_URL}/api/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Secret": CF_WORKER_SECRET,
    },
    body: JSON.stringify({ run_id: runId, session_type: SESSION_TYPE }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF Worker /api/run failed ${res.status}: ${text}`);
  }
}

async function pushKaggleKernel(runId: string): Promise<{ kernelSlug: string }> {
  const credentials = Buffer.from(`${KAGGLE_USERNAME}:${KAGGLE_KEY}`).toString("base64");

  const notebookSource = JSON.stringify({
    cells: [
      {
        cell_type: "code",
        source: [
          `import os\n`,
          `os.environ["RUN_ID_OVERRIDE"] = "${runId}"\n`,
          `print(f"[trigger] injected RUN_ID={runId}")\n`,
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

  const payload = {
    newTitle:               `${SESSION_TYPE}-${runId}`,
    text:                   notebookSource,
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
      "Authorization": `Basic ${credentials}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kaggle API failed ${res.status}: ${text}`);
  }

  const data = await res.json() as { ref?: string; error?: string };

  if (data.error) {
    throw new Error(`Kaggle error: ${data.error}`);
  }

  return { kernelSlug: data.ref ?? `${KAGGLE_USERNAME}/${SESSION_TYPE}-${runId}` };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    kaggle_username: process.env.KAGGLE_USERNAME ?? "NOT SET",
    kaggle_key_length: process.env.KAGGLE_KEY?.length ?? 0,
    kaggle_key_prefix: process.env.KAGGLE_KEY?.slice(0, 6) ?? "NOT SET",
    cf_worker_url: process.env.CF_WORKER_URL ?? "NOT SET",
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

  const kaggleUrl = `https://www.kaggle.com/${kernelSlug}`;

  return NextResponse.json({
    ok:          true,
    run_id:      runId,
    session:     SESSION_TYPE,
    notebook:    NOTEBOOK_FILE,
    kernel_slug: kernelSlug,
    kaggle_url:  kaggleUrl,
  });
}
