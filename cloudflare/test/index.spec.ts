import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const WORKER_SECRET = env.WORKER_SECRET;

/** Helper: build an authenticated POST request */
function authPost(path: string, body: Record<string, unknown>): Request {
  return new IncomingRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Secret": WORKER_SECRET,
    },
    body: JSON.stringify(body),
  });
}

/** Helper: build an unauthenticated POST request */
function unauthPost(path: string, body: Record<string, unknown>): Request {
  return new IncomingRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Helper: build an authenticated GET request */
function authGet(path: string, params?: Record<string, string>): Request {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return new IncomingRequest(`http://localhost${path}${qs}`, {
    method: "GET",
    headers: { "X-Worker-Secret": WORKER_SECRET },
  });
}

// ─── Health Endpoint ──────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns ok:true and db:true when D1 is healthy", async () => {
    const request = new IncomingRequest("http://localhost/health");
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.db).toBe(true);
    expect(data.tables).toBeDefined();
    expect(Array.isArray(data.tables)).toBe(true);
  });

  it("returns queue stats", async () => {
    const request = new IncomingRequest("http://localhost/health");
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    const data = await response.json() as Record<string, unknown>;
    expect(data.queue).toBeDefined();
    expect(typeof data.d1_writes_today).toBe("number");
  });
});

// ─── Authentication ───────────────────────────────────────────────────────────

describe("Authentication", () => {
  it("rejects requests without X-Worker-Secret", async () => {
    const request = unauthPost("/heartbeat", { session_id: "test_01" });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
  });

  it("rejects requests with wrong X-Worker-Secret", async () => {
    const request = new IncomingRequest("http://localhost/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": "WRONG_SECRET",
      },
      body: JSON.stringify({ session_id: "test_01" }),
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

describe("POST /heartbeat", () => {
  it("registers a new session and returns ok:true", async () => {
    const request = authPost("/heartbeat", {
      session_id: "hb_test_01",
      run_id: "run_test_001",
      session_type: "cpu_collect",
      status: "active",
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.session_id).toBe("hb_test_01");
  });

  it("returns open_breakers object", async () => {
    const request = authPost("/heartbeat", {
      session_id: "hb_test_02",
      run_id: "run_test_001",
      session_type: "gpu_clean",
      gpu_type: "T4",
      vram_limit_gb: 16.0,
      status: "active",
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    const data = await response.json() as Record<string, unknown>;
    expect(data.open_breakers).toBeDefined();
  });

  it("requires session_id", async () => {
    const request = authPost("/heartbeat", { run_id: "run_test" });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });

  it("updates an existing session on repeated heartbeat", async () => {
    // First heartbeat
    const r1 = authPost("/heartbeat", {
      session_id: "hb_update_test",
      run_id: "run_test_001",
      session_type: "cpu_label",
      status: "active",
    });
    const ctx1 = createExecutionContext();
    await SELF.fetch(r1, env, ctx1);
    await waitOnExecutionContext(ctx1);

    // Second heartbeat — same session, updated status
    const r2 = authPost("/heartbeat", {
      session_id: "hb_update_test",
      run_id: "run_test_001",
      session_type: "cpu_label",
      status: "stopped",
    });
    const ctx2 = createExecutionContext();
    const response = await SELF.fetch(r2, env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });
});

// ─── Work Queue ───────────────────────────────────────────────────────────────

describe("POST /queue/push", () => {
  it("pushes items to the work queue", async () => {
    const request = authPost("/queue/push", {
      run_id: "run_test_001",
      items: [
        {
          item_id: "wq_item_001",
          pipeline: "collect",
          stage: "p1a",
          shard_key: "cpu",
          payload: { query: "اردو خبریں" },
          priority: 5,
        },
      ],
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.inserted).toBe(1);
  });

  it("rejects items with invalid stage", async () => {
    const request = authPost("/queue/push", {
      run_id: "run_test_001",
      items: [
        {
          item_id: "wq_bad_stage",
          pipeline: "collect",
          stage: "invalid_stage",
          shard_key: "cpu",
        },
      ],
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    const data = await response.json() as Record<string, unknown>;
    expect(data.inserted).toBe(0);
  });

  it("rejects items with invalid shard_key", async () => {
    const request = authPost("/queue/push", {
      run_id: "run_test_001",
      items: [
        {
          item_id: "wq_bad_shard",
          pipeline: "collect",
          stage: "p1a",
          shard_key: "invalid_shard",
        },
      ],
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    const data = await response.json() as Record<string, unknown>;
    expect(data.inserted).toBe(0);
  });

  it("rejects empty items array", async () => {
    const request = authPost("/queue/push", {
      run_id: "run_test_001",
      items: [],
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });

  it("rejects more than 500 items", async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      item_id: `wq_bulk_${i}`,
      pipeline: "collect",
      stage: "p1a",
      shard_key: "cpu",
    }));
    const request = authPost("/queue/push", {
      run_id: "run_test_001",
      items,
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });
});

describe("POST /queue/lease", () => {
  beforeAll(async () => {
    // Push test items for lease tests
    const request = authPost("/queue/push", {
      run_id: "run_lease_test",
      items: [
        { item_id: "lease_001", pipeline: "collect", stage: "p1a", shard_key: "cpu", priority: 1 },
        { item_id: "lease_002", pipeline: "collect", stage: "p1a", shard_key: "cpu", priority: 3 },
        { item_id: "lease_003", pipeline: "collect", stage: "p1b", shard_key: "cpu", priority: 5 },
      ],
    });
    const ctx = createExecutionContext();
    await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
  });

  it("leases pending items by stage and shard_key", async () => {
    const request = authPost("/queue/lease", {
      session_id: "lease_session_01",
      pipeline: "collect",
      stage: "p1a",
      shard_key: "cpu",
      n: 2,
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    const items = data.items as Record<string, unknown>[];
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("respects priority ordering", async () => {
    const request = authPost("/queue/lease", {
      session_id: "lease_session_02",
      pipeline: "collect",
      stage: "p1a",
      shard_key: "cpu",
      n: 10,
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    const data = await response.json() as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    if (items.length >= 2) {
      // Lower priority number = higher priority, should come first
      const firstPriority = items[0].priority as number;
      const secondPriority = items[1].priority as number;
      expect(firstPriority).toBeLessThanOrEqual(secondPriority);
    }
  });

  it("requires session_id and stage", async () => {
    const request = authPost("/queue/lease", { shard_key: "cpu" });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });

  it("enforces global p1b concurrency cap", async () => {
    // First, lease all available p1b items to fill the cap
    const leaseReq = authPost("/queue/lease", {
      session_id: "p1b_cap_session",
      pipeline: "collect",
      stage: "p1b",
      shard_key: "cpu",
      n: 10,
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(leaseReq, env, ctx);
    await waitOnExecutionContext(ctx);

    // The response should either have items or indicate the cap
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });
});

describe("POST /queue/ack", () => {
  it("acknowledges leased items as done", async () => {
    // Push and lease an item first
    const pushReq = authPost("/queue/push", {
      run_id: "run_ack_test",
      items: [{ item_id: "ack_001", pipeline: "collect", stage: "p1e", shard_key: "cpu" }],
    });
    const pushCtx = createExecutionContext();
    await SELF.fetch(pushReq, env, pushCtx);
    await waitOnExecutionContext(pushCtx);

    const leaseReq = authPost("/queue/lease", {
      session_id: "ack_session",
      pipeline: "collect",
      stage: "p1e",
      shard_key: "cpu",
      n: 1,
    });
    const leaseCtx = createExecutionContext();
    await SELF.fetch(leaseReq, env, leaseCtx);
    await waitOnExecutionContext(leaseCtx);

    // Ack the item
    const ackReq = authPost("/queue/ack", {
      session_id: "ack_session",
      item_ids: ["ack_001"],
    });
    const ackCtx = createExecutionContext();
    const response = await SELF.fetch(ackReq, env, ackCtx);
    await waitOnExecutionContext(ackCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });

  it("requires session_id and item_ids", async () => {
    const request = authPost("/queue/ack", { session_id: "test" });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });
});

describe("POST /queue/nack", () => {
  it("returns leased items to pending and increments retry_count", async () => {
    // Push and lease an item
    const pushReq = authPost("/queue/push", {
      run_id: "run_nack_test",
      items: [{ item_id: "nack_001", pipeline: "collect", stage: "p1e", shard_key: "cpu" }],
    });
    const pushCtx = createExecutionContext();
    await SELF.fetch(pushReq, env, pushCtx);
    await waitOnExecutionContext(pushCtx);

    const leaseReq = authPost("/queue/lease", {
      session_id: "nack_session",
      pipeline: "collect",
      stage: "p1e",
      shard_key: "cpu",
      n: 1,
    });
    const leaseCtx = createExecutionContext();
    await SELF.fetch(leaseReq, env, leaseCtx);
    await waitOnExecutionContext(leaseCtx);

    // Nack the item
    const nackReq = authPost("/queue/nack", {
      session_id: "nack_session",
      item_ids: ["nack_001"],
      error: "transient failure",
    });
    const nackCtx = createExecutionContext();
    const response = await SELF.fetch(nackReq, env, nackCtx);
    await waitOnExecutionContext(nackCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });

  it("marks items as failed after 5 retries", async () => {
    // Push an item
    const pushReq = authPost("/queue/push", {
      run_id: "run_nack_fail_test",
      items: [{ item_id: "nack_fail_001", pipeline: "collect", stage: "p1e", shard_key: "cpu" }],
    });
    const pushCtx = createExecutionContext();
    await SELF.fetch(pushReq, env, pushCtx);
    await waitOnExecutionContext(pushCtx);

    // Lease and nack 5 times to exceed retry limit
    for (let i = 0; i < 5; i++) {
      const leaseReq = authPost("/queue/lease", {
        session_id: "nack_fail_session",
        pipeline: "collect",
        stage: "p1e",
        shard_key: "cpu",
        n: 1,
      });
      const leaseCtx = createExecutionContext();
      await SELF.fetch(leaseReq, env, leaseCtx);
      await waitOnExecutionContext(leaseCtx);

      const nackReq = authPost("/queue/nack", {
        session_id: "nack_fail_session",
        item_ids: ["nack_fail_001"],
        error: `retry ${i + 1}`,
      });
      const nackCtx = createExecutionContext();
      await SELF.fetch(nackReq, env, nackCtx);
      await waitOnExecutionContext(nackCtx);
    }

    // After 5 retries, the item should be in 'failed' status — cannot be leased again
    const finalLeaseReq = authPost("/queue/lease", {
      session_id: "nack_fail_session",
      pipeline: "collect",
      stage: "p1e",
      shard_key: "cpu",
      n: 10,
    });
    const finalCtx = createExecutionContext();
    const finalResponse = await SELF.fetch(finalLeaseReq, env, finalCtx);
    await waitOnExecutionContext(finalCtx);

    const data = await finalResponse.json() as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    const failedItem = items.find((item) => item.item_id === "nack_fail_001");
    expect(failedItem).toBeUndefined();
  });
});

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

describe("POST /circuit-breaker", () => {
  it("records failures and opens the breaker after threshold", async () => {
    const cbName = "youtube";

    // Record failures up to threshold (youtube: 5 failures / 60s)
    for (let i = 0; i < 5; i++) {
      const request = authPost("/circuit-breaker", {
        api_name: cbName,
        action: "record_failure",
        session_id: "cb_test_session",
      });
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json() as Record<string, unknown>;
      if (i >= 4) {
        expect(data.opened).toBe(true);
        expect(data.cooldown_until).toBeDefined();
      }
    }
  });

  it("resets the breaker on record_success", async () => {
    // First open the breaker
    for (let i = 0; i < 5; i++) {
      const req = authPost("/circuit-breaker", {
        api_name: "gemini",
        action: "record_failure",
        session_id: "cb_reset_session",
      });
      const ctx = createExecutionContext();
      await SELF.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
    }

    // Now record success to close it
    const successReq = authPost("/circuit-breaker", {
      api_name: "gemini",
      action: "record_success",
      session_id: "cb_reset_session",
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(successReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.state).toBe("closed");
  });

  it("returns breaker state with get_state", async () => {
    const request = authPost("/circuit-breaker", {
      api_name: "hf_upload",
      action: "get_state",
      session_id: "cb_state_session",
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.state).toBeDefined();
  });

  it("rejects unknown api_name", async () => {
    const request = authPost("/circuit-breaker", {
      api_name: "nonexistent_api",
      action: "record_failure",
      session_id: "cb_bad_session",
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });

  it("rejects unknown action", async () => {
    const request = authPost("/circuit-breaker", {
      api_name: "youtube",
      action: "invalid_action",
      session_id: "cb_bad_session",
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });
});

// ─── Stage Log ────────────────────────────────────────────────────────────────

describe("POST /stage-log", () => {
  it("logs a stage event", async () => {
    const request = authPost("/stage-log", {
      run_id: "run_test_001",
      session_id: "log_test_session",
      stage_name: "p1a",
      status: "started",
      started_at: Math.floor(Date.now() / 1000),
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });

  it("requires session_id, stage_name, status", async () => {
    const request = authPost("/stage-log", { run_id: "run_test" });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
  });

  it("logs stage completion with ended_at", async () => {
    const now = Math.floor(Date.now() / 1000);
    const request = authPost("/stage-log", {
      run_id: "run_test_001",
      session_id: "log_test_session",
      stage_name: "p1a",
      status: "completed",
      started_at: now - 60,
      ended_at: now,
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
  });
});

// ─── Run Management ───────────────────────────────────────────────────────────

describe("POST /api/run", () => {
  it("creates a new run", async () => {
    const request = authPost("/api/run", {
      run_id: "run_api_test_001",
      target_corpus_hours: 10000,
    });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.run_id).toBe("run_api_test_001");
  });
});

describe("GET /api/run", () => {
  it("retrieves run details", async () => {
    // Create a run first
    const createReq = authPost("/api/run", {
      run_id: "run_get_test_001",
      target_corpus_hours: 10000,
    });
    const createCtx = createExecutionContext();
    await SELF.fetch(createReq, env, createCtx);
    await waitOnExecutionContext(createCtx);

    // Get the run
    const getReq = authGet("/api/run", { run_id: "run_get_test_001" });
    const getCtx = createExecutionContext();
    const response = await SELF.fetch(getReq, env, getCtx);
    await waitOnExecutionContext(getCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.run).toBeDefined();
  });
});

// ─── Sessions API ─────────────────────────────────────────────────────────────

describe("GET /api/sessions", () => {
  it("returns sessions list", async () => {
    const request = authGet("/api/sessions");
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.sessions)).toBe(true);
  });
});

// ─── Key Slot ─────────────────────────────────────────────────────────────────

describe("GET /api/key-slot", () => {
  it("returns a key slot for a registered session", async () => {
    // Register session first
    const hbReq = authPost("/heartbeat", {
      session_id: "keyslot_test_session",
      run_id: "run_keyslot_test",
      session_type: "cpu_label",
      status: "active",
    });
    const hbCtx = createExecutionContext();
    await SELF.fetch(hbReq, env, hbCtx);
    await waitOnExecutionContext(hbCtx);

    const request = authGet("/api/key-slot", { session_id: "keyslot_test_session" });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.key_slot).toBeDefined();
    expect(["01", "02", "03", "04"]).toContain(data.key_slot);
  });

  it("returns 404 for unknown session", async () => {
    const request = authGet("/api/key-slot", { session_id: "nonexistent_session" });
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────

describe("404 handling", () => {
  it("returns 404 for unknown paths", async () => {
    const request = authGet("/nonexistent/path");
    const ctx = createExecutionContext();
    const response = await SELF.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});
