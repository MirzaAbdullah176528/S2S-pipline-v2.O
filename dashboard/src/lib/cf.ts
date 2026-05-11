const CF_WORKER_URL    = process.env.CF_WORKER_URL    ?? "";
const CF_WORKER_SECRET = process.env.CF_WORKER_SECRET ?? "";

export interface SessionRow {
  id: string;
  run_id: string;
  session_type: string;
  last_heartbeat: number;
  gpu_type: string | null;
  vram_limit_gb: number;
  status: string;
  seconds_since_heartbeat: number;
  alive: boolean;
}

export interface QueueDepth {
  pending: number;
  leased: number;
  done: number;
  failed: number;
}

export interface HealthData {
  ok: boolean;
  db: boolean;
  d1_writes_today: number;
  active_sessions: number;
  queue: QueueDepth;
  ts: number;
}

export interface RunStageRow {
  stage_name: string;
  status: string;
  last_started: number;
  last_ended: number | null;
  attempts: number;
}

export interface RunData {
  run: { run_id: string; started_at: number; target_corpus_hours: number; status: string } | null;
  stages: RunStageRow[];
  queue: { stage: string; status: string; cnt: number }[];
}

async function cfFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${CF_WORKER_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Worker-Secret": CF_WORKER_SECRET,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    next: { revalidate: 10 },
  });
  if (!res.ok) throw new Error(`CF Worker ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getHealth(): Promise<HealthData> {
  const res = await fetch(`${CF_WORKER_URL}/health`, { next: { revalidate: 10 } });
  return res.json();
}

export async function getSessions(): Promise<SessionRow[]> {
  const data = await cfFetch<{ sessions: SessionRow[] }>("/api/sessions");
  return data.sessions;
}

export async function getRun(runId: string): Promise<RunData> {
  return cfFetch<RunData>(`/api/run?run_id=${encodeURIComponent(runId)}`);
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
}

export function sessionTypeLabel(type: string): string {
  const map: Record<string, string> = {
    cpu_collect:  "CPU Collect",
    cpu_label:    "CPU Label",
    gpu_clean:    "GPU Clean (T4)",
    gpu_encode:   "GPU Encode (P100)",
    tpu_finetune: "TPU Finetune",
    tpu_synth:    "TPU Synth",
  };
  return map[type] ?? type;
}
