export interface Env {
  DB: D1Database;
  WORKER_SECRET: string;
  TASK_QUEUE: Queue;
  // wrangler.jsonc vars — always strings at runtime
  ENVIRONMENT: string;
  P1B_MAX_GLOBAL: string;
  LEASE_TTL_SECONDS: string;
  MAX_CB_WRITES_PER_MIN: string;
}

const CB_CONFIGS: Record<string, { openThreshold: number; windowSec: number; initBackoffSec: number; maxBackoffSec: number }> = {
  youtube:      { openThreshold: 5, windowSec: 60,  initBackoffSec: 120,  maxBackoffSec: 1800 },
  gemini:       { openThreshold: 3, windowSec: 30,  initBackoffSec: 65,   maxBackoffSec: 600  },
  hf_upload:    { openThreshold: 6, windowSec: 120, initBackoffSec: 30,   maxBackoffSec: 900  },
  hf_download:  { openThreshold: 6, windowSec: 120, initBackoffSec: 30,   maxBackoffSec: 900  },
};

const VALID_SHARD_KEYS = new Set(["cpu", "t4", "p100", "tpu"]);
const VALID_STAGES     = new Set(["p1a","p1b","p1c","p1d","p1e","p2a","p2b","p2c","p3a","p3b","p4a","p4b","p5_finetune","p5a","p5b","p5c"]);
const SESSION_TIMEOUT_SEC = 120;

function authenticate(request: Request, env: Env): boolean {
  const secret = request.headers.get("X-Worker-Secret");
  return secret === env.WORKER_SECRET;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "X-Worker-Version": "1.0.0" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function now(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT unixepoch() AS ts").first<{ ts: number }>();
  return row?.ts ?? Math.floor(Date.now() / 1000);
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all<{ name: string }>();
    const tableNames = tables.results.map((r) => r.name);
    const required = ["sessions","circuit_breakers","stage_log","runs","work_queue"];
    const allPresent = required.every((t) => tableNames.includes(t));

    const d1WritesRow = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM stage_log WHERE started_at > unixepoch()-86400"
    ).first<{ cnt: number }>();

    const activeSessions = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM sessions WHERE status='active' AND last_heartbeat > unixepoch()-${SESSION_TIMEOUT_SEC}`
    ).first<{ cnt: number }>();

    const queueDepth = await env.DB.prepare(
      "SELECT status, COUNT(*) AS cnt FROM work_queue GROUP BY status"
    ).all<{ status: string; cnt: number }>();

    const queueStats: Record<string, number> = {};
    for (const row of queueDepth.results) {
      queueStats[row.status] = row.cnt;
    }

    return jsonResponse({
      ok: true,
      db: allPresent,
      tables: tableNames,
      d1_writes_today: d1WritesRow?.cnt ?? 0,
      active_sessions: activeSessions?.cnt ?? 0,
      queue: queueStats,
      ts: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    return jsonResponse({ ok: false, db: false, error: String(err) }, 503);
  }
}

async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const sessionId    = String(body.session_id ?? "");
  const runId        = String(body.run_id ?? "run_default");
  const sessionType  = String(body.session_type ?? "gpu");
  const gpuType      = body.gpu_type ? String(body.gpu_type) : null;
  const vramLimitGb  = typeof body.vram_limit_gb === "number" ? body.vram_limit_gb : 0;
  const statusVal    = String(body.status ?? "active");

  if (!sessionId) return errorResponse("session_id required");

  const ts = await now(env);

  await env.DB.prepare(`
    INSERT INTO sessions (id, run_id, session_type, last_heartbeat, gpu_type, vram_limit_gb, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      run_id=excluded.run_id,
      session_type=excluded.session_type,
      last_heartbeat=excluded.last_heartbeat,
      gpu_type=excluded.gpu_type,
      vram_limit_gb=excluded.vram_limit_gb,
      status=excluded.status
  `).bind(sessionId, runId, sessionType, ts, gpuType, vramLimitGb, statusVal).run();

  const cbRows = await env.DB.prepare(
    "SELECT api_name, state, cooldown_until FROM circuit_breakers WHERE state != 'closed'"
  ).all<{ api_name: string; state: string; cooldown_until: number | null }>();

  const openBreakers: Record<string, { state: string; cooldown_until: number | null }> = {};
  for (const row of cbRows.results) {
    openBreakers[row.api_name] = { state: row.state, cooldown_until: row.cooldown_until };
  }

  return jsonResponse({
    ok: true,
    ts,
    session_id: sessionId,
    open_breakers: openBreakers,
  });
}

async function handleQueuePush(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [body];
  if (items.length === 0) return errorResponse("No items provided");
  if (items.length > 500) return errorResponse("Max 500 items per push");

  const runId = String(body.run_id ?? items[0]?.run_id ?? "run_default");
  const ts    = await now(env);
  const inserted: string[] = [];

  const stmt = env.DB.prepare(`
    INSERT OR IGNORE INTO work_queue
      (item_id, run_id, pipeline, stage, shard_key, payload, priority, global_cap_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = items.map((item) => {
    const itemId       = String(item.item_id ?? crypto.randomUUID());
    const pipeline     = String(item.pipeline ?? "");
    const stage        = String(item.stage ?? "");
    const shardKey     = String(item.shard_key ?? "cpu");
    const payload      = item.payload ? JSON.stringify(item.payload) : null;
    const priority     = typeof item.priority === "number" ? item.priority : 5;
    const globalCapKey = item.global_cap_key ? String(item.global_cap_key) : null;

    if (!VALID_STAGES.has(stage)) return null;
    if (!VALID_SHARD_KEYS.has(shardKey)) return null;

    inserted.push(itemId);
    return stmt.bind(itemId, runId, pipeline, stage, shardKey, payload, priority, globalCapKey, ts);
  }).filter(Boolean) as ReturnType<typeof stmt.bind>[];

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return jsonResponse({ ok: true, inserted: inserted.length, run_id: runId });
}

async function handleQueueLease(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const sessionId = String(body.session_id ?? "");
  const pipeline  = String(body.pipeline ?? "");
  const stage     = String(body.stage ?? "");
  const shardKey  = String(body.shard_key ?? "cpu");
  const n         = Math.min(Number(body.n ?? 1), 20);
  const leaseTtl  = Number(env.LEASE_TTL_SECONDS) || 600;

  if (!sessionId || !stage) return errorResponse("session_id and stage required");
  if (!VALID_SHARD_KEYS.has(shardKey)) return errorResponse("Invalid shard_key");

  const p1bMaxGlobal = Number(env.P1B_MAX_GLOBAL) || 6;
  if (stage === "p1b") {
    const activeP1b = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM work_queue WHERE stage='p1b' AND status='leased'"
    ).first<{ cnt: number }>();
    if ((activeP1b?.cnt ?? 0) >= p1bMaxGlobal) {
      return jsonResponse({ items: [], reason: "global_p1b_cap_reached" });
    }
  }

  const ts = await now(env);
  const leaseExpires = ts + leaseTtl;

  const claimed = await env.DB.prepare(`
    WITH claimed AS (
      SELECT item_id FROM work_queue
      WHERE pipeline=? AND stage=? AND status='pending' AND shard_key=?
        AND retry_count < 5
      ORDER BY priority ASC, created_at ASC
      LIMIT ?
    )
    UPDATE work_queue
    SET status='leased',
        leased_by=?,
        lease_expires_at=?
    WHERE item_id IN (SELECT item_id FROM claimed)
    RETURNING item_id, payload, retry_count, priority
  `).bind(pipeline, stage, shardKey, n, sessionId, leaseExpires).all<{
    item_id: string;
    payload: string | null;
    retry_count: number;
    priority: number;
  }>();

  const items = claimed.results.map((row) => ({
    item_id: row.item_id,
    payload: row.payload ? JSON.parse(row.payload) : null,
    retry_count: row.retry_count,
    priority: row.priority,
    lease_expires_at: leaseExpires,
  }));

  return jsonResponse({ ok: true, items });
}

async function handleQueueAck(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const sessionId = String(body.session_id ?? "");
  const itemIds   = Array.isArray(body.item_ids) ? (body.item_ids as string[]) : [];

  if (!sessionId || itemIds.length === 0) return errorResponse("session_id and item_ids required");

  const placeholders = itemIds.map(() => "?").join(",");
  const result = await env.DB.prepare(`
    UPDATE work_queue SET status='done', leased_by=NULL, lease_expires_at=NULL
    WHERE item_id IN (${placeholders}) AND leased_by=? AND status='leased'
  `).bind(...itemIds, sessionId).run();

  return jsonResponse({ ok: true, updated: result.meta.changes });
}

async function handleQueueNack(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const sessionId  = String(body.session_id ?? "");
  const itemIds    = Array.isArray(body.item_ids) ? (body.item_ids as string[]) : [];
  const errorMsg   = body.error ? String(body.error) : null;

  if (!sessionId || itemIds.length === 0) return errorResponse("session_id and item_ids required");

  const placeholders = itemIds.map(() => "?").join(",");

  await env.DB.prepare(`
    UPDATE work_queue
    SET status = CASE WHEN retry_count + 1 >= 5 THEN 'failed' ELSE 'pending' END,
        retry_count = retry_count + 1,
        leased_by = NULL,
        lease_expires_at = NULL
    WHERE item_id IN (${placeholders}) AND leased_by=? AND status='leased'
  `).bind(...itemIds, sessionId).run();

  if (errorMsg) {
    const ts = await now(env);
    for (const itemId of itemIds) {
      await env.DB.prepare(`
        INSERT INTO stage_log (run_id, session_id, stage_name, status, started_at, ended_at, error_message)
        SELECT run_id, ?, stage, 'nack', ?, ?, ?
        FROM work_queue WHERE item_id=?
      `).bind(sessionId, ts, ts, errorMsg, itemId).run();
    }
  }

  return jsonResponse({ ok: true });
}

async function handleCircuitBreaker(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const apiName   = String(body.api_name ?? "");
  const action    = String(body.action ?? "");
  const sessionId = String(body.session_id ?? "");

  if (!apiName || !action) return errorResponse("api_name and action required");
  if (!(apiName in CB_CONFIGS)) return errorResponse(`Unknown api_name: ${apiName}`);

  const cfg = CB_CONFIGS[apiName]!;
  const ts  = await now(env);

  if (action === "record_failure") {
    const current = await env.DB.prepare(
      "SELECT state, failure_count, last_failure_at FROM circuit_breakers WHERE api_name=?"
    ).first<{ state: string; failure_count: number; last_failure_at: number | null }>(apiName);

    const failureCount = (current?.failure_count ?? 0) + 1;
    const windowStart  = ts - cfg.windowSec;
    const recentFails  = current?.last_failure_at && current.last_failure_at > windowStart
      ? failureCount
      : 1;

    const shouldOpen = recentFails >= cfg.openThreshold;
    const backoffSec = shouldOpen
      ? Math.min(cfg.initBackoffSec * Math.pow(2, Math.max(0, failureCount - cfg.openThreshold)), cfg.maxBackoffSec)
      : 0;

    await env.DB.prepare(`
      INSERT INTO circuit_breakers (api_name, state, failure_count, last_failure_at, opened_at, cooldown_until)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(api_name) DO UPDATE SET
        state=excluded.state,
        failure_count=excluded.failure_count,
        last_failure_at=excluded.last_failure_at,
        opened_at=CASE WHEN excluded.state='open' AND circuit_breakers.state!='open' THEN excluded.opened_at ELSE circuit_breakers.opened_at END,
        cooldown_until=excluded.cooldown_until
    `).bind(
      apiName,
      shouldOpen ? "open" : "closed",
      recentFails,
      ts,
      shouldOpen ? ts : null,
      shouldOpen ? ts + backoffSec : null,
    ).run();

    await env.DB.prepare(
      "INSERT INTO stage_log (run_id, session_id, stage_name, status, started_at, error_message) VALUES ('cb_event', ?, ?, 'failure', ?, ?)"
    ).bind(sessionId, apiName, ts, `cb_failure count=${recentFails} open=${shouldOpen}`).run();

    return jsonResponse({ ok: true, opened: shouldOpen, cooldown_until: shouldOpen ? ts + backoffSec : null });
  }

  if (action === "record_success" || action === "reset") {
    await env.DB.prepare(`
      UPDATE circuit_breakers
      SET state='closed', failure_count=0, opened_at=NULL, cooldown_until=NULL
      WHERE api_name=?
    `).bind(apiName).run();
    return jsonResponse({ ok: true, state: "closed" });
  }

  if (action === "get_state") {
    const row = await env.DB.prepare(
      "SELECT * FROM circuit_breakers WHERE api_name=?"
    ).first(apiName);
    return jsonResponse({ ok: true, state: row ?? { api_name: apiName, state: "closed" } });
  }

  return errorResponse(`Unknown action: ${action}`);
}

async function handleStageLog(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const runId      = String(body.run_id ?? "run_default");
  const sessionId  = String(body.session_id ?? "");
  const stageName  = String(body.stage_name ?? "");
  const status     = String(body.status ?? "");
  const startedAt  = typeof body.started_at === "number" ? body.started_at : await now(env);
  const endedAt    = typeof body.ended_at   === "number" ? body.ended_at   : null;
  const errorMsg   = body.error_message ? String(body.error_message) : null;

  if (!sessionId || !stageName || !status) return errorResponse("session_id, stage_name, status required");

  await env.DB.prepare(`
    INSERT INTO stage_log (run_id, session_id, stage_name, status, started_at, ended_at, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(runId, sessionId, stageName, status, startedAt, endedAt, errorMsg).run();

  return jsonResponse({ ok: true });
}

async function handleGetKeySlot(request: Request, env: Env): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  const session = await env.DB.prepare(
    "SELECT id FROM sessions WHERE id=?"
  ).first<{ id: string }>(sessionId);

  if (!session) return errorResponse("Session not found", 404);

  const slots = ["01","02","03","04"];
  const hash  = sessionId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const slot  = slots[hash % slots.length]!;

  return jsonResponse({ ok: true, key_slot: slot, env_var: `GEMINI_API_KEY_${slot}` });
}

async function handleGetSessions(env: Env): Promise<Response> {
  const ts = await now(env);
  const sessions = await env.DB.prepare(`
    SELECT id, run_id, session_type, last_heartbeat, gpu_type, vram_limit_gb, status,
           (? - last_heartbeat) AS seconds_since_heartbeat
    FROM sessions
    ORDER BY last_heartbeat DESC
    LIMIT 50
  `).bind(ts).all<{
    id: string;
    run_id: string;
    session_type: string;
    last_heartbeat: number;
    gpu_type: string | null;
    vram_limit_gb: number;
    status: string;
    seconds_since_heartbeat: number;
  }>();

  const enriched = sessions.results.map((s) => ({
    ...s,
    alive: s.seconds_since_heartbeat < SESSION_TIMEOUT_SEC,
  }));

  return jsonResponse({ ok: true, sessions: enriched, ts });
}

async function handleGetRun(request: Request, env: Env): Promise<Response> {
  const runId = new URL(request.url).searchParams.get("run_id") ?? "run_default";

  const run = await env.DB.prepare("SELECT * FROM runs WHERE run_id=?").first(runId);
  const stages = await env.DB.prepare(`
    SELECT stage_name, status, MAX(started_at) AS last_started, MAX(ended_at) AS last_ended,
           COUNT(*) AS attempts
    FROM stage_log
    WHERE run_id=?
    GROUP BY stage_name, status
    ORDER BY last_started DESC
  `).bind(runId).all();

  const queueStats = await env.DB.prepare(`
    SELECT stage, status, COUNT(*) AS cnt
    FROM work_queue WHERE run_id=?
    GROUP BY stage, status
  `).bind(runId).all();

  return jsonResponse({ ok: true, run, stages: stages.results, queue: queueStats.results });
}

async function handleCreateRun(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const runId             = String(body.run_id ?? `run_${Date.now()}`);
  const targetHours       = typeof body.target_corpus_hours === "number" ? body.target_corpus_hours : 10000;
  const config            = body.config ? JSON.stringify(body.config) : null;
  const ts                = await now(env);

  await env.DB.prepare(`
    INSERT OR REPLACE INTO runs (run_id, started_at, target_corpus_hours, status, config)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(runId, ts, targetHours, config).run();

  return jsonResponse({ ok: true, run_id: runId, started_at: ts });
}

async function handleScheduled(env: Env): Promise<void> {
  await env.DB.prepare(`
    UPDATE work_queue
    SET status='pending', leased_by=NULL, lease_expires_at=NULL
    WHERE status='leased' AND lease_expires_at < unixepoch()
  `).run();

  await env.DB.prepare(`
    UPDATE circuit_breakers
    SET state='closed', failure_count=0
    WHERE state='open' AND cooldown_until < unixepoch()
  `).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (path === "/health" && method === "GET") {
      return handleHealth(env);
    }

    if (!authenticate(request, env)) {
      return errorResponse("Unauthorized", 401);
    }

    if (path === "/heartbeat" && method === "POST") return handleHeartbeat(request, env);
    if (path === "/queue/push" && method === "POST") return handleQueuePush(request, env);
    if (path === "/queue/lease" && method === "POST") return handleQueueLease(request, env);
    if (path === "/queue/ack" && method === "POST") return handleQueueAck(request, env);
    if (path === "/queue/nack" && method === "POST") return handleQueueNack(request, env);
    if (path === "/circuit-breaker" && method === "POST") return handleCircuitBreaker(request, env);
    if (path === "/stage-log" && method === "POST") return handleStageLog(request, env);
    if (path === "/api/sessions" && method === "GET") return handleGetSessions(env);
    if (path === "/api/key-slot" && method === "GET") return handleGetKeySlot(request, env);
    if (path === "/api/run" && method === "GET") return handleGetRun(request, env);
    if (path === "/api/run" && method === "POST") return handleCreateRun(request, env);

    return errorResponse("Not found", 404);
  },

  async scheduled(_ctrl: { scheduledTime: number; cron: string; noRetry(): void }, env: Env): Promise<void> {
    await handleScheduled(env);
  },
} satisfies ExportedHandler<Env>;
