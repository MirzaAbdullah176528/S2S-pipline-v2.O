import { Suspense } from "react";
import { getHealth, getSessions, getRun, formatElapsed, sessionTypeLabel } from "@/lib/cf";
import type { SessionRow, RunStageRow } from "@/lib/cf";
import TriggerButton from "@/components/TriggerButton";
import React from "react";

const RUN_ID = process.env.DEFAULT_RUN_ID ?? "run_default";

function StatusDot({ alive }: { alive: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: alive ? "var(--green)" : "var(--red)",
      boxShadow: alive ? "0 0 6px var(--green)" : undefined,
      marginRight: 7, flexShrink: 0,
    }} />
  );
}
function add(){
  
}
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 7px", borderRadius: 3,
      fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.04em",
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 24px",
    }}>
      <h2 style={{
        fontFamily: "var(--mono)", fontSize: "0.7rem", fontWeight: 600,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: "var(--text-dim)", marginBottom: 16,
      }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

async function HealthCard() {
  "use cache";
  let health;
  try { health = await getHealth(); } catch { return <p style={{ color: "var(--red)" }}>Worker unreachable</p>; }

  const queueTotal = Object.values(health.queue ?? {}).reduce((a, b) => a + b, 0);

  return (
    <Card title="System Health">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        {[
          { label: "Worker",        value: health.ok  ? "OK"     : "DOWN",   ok: health.ok  },
          { label: "D1 Database",   value: health.db  ? "READY"  : "ERROR",  ok: health.db  },
          { label: "Active Sessions", value: String(health.active_sessions), ok: health.active_sessions > 0 },
          { label: "D1 Writes Today", value: `${health.d1_writes_today.toLocaleString()} / 100K`, ok: health.d1_writes_today < 90000 },
          { label: "Queue Items",   value: String(queueTotal), ok: true },
        ].map(({ label, value, ok }) => (
          <div key={label} style={{ background: "var(--bg)", borderRadius: 4, padding: "10px 14px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatusDot alive={ok} />
              <span style={{ fontWeight: 600, color: ok ? "var(--text-hi)" : "var(--red)" }}>{value}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Object.entries(health.queue ?? {}).map(([status, count]) => (
          <div key={status} style={{ fontSize: "0.78rem" }}>
            <span style={{ color: "var(--text-dim)" }}>{status}:</span>{" "}
            <span style={{ color: status === "failed" ? "var(--red)" : status === "done" ? "var(--green)" : "var(--accent)" }}>
              {Number(count).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

async function FleetCard() {
  "use cache";
  let sessions: SessionRow[] = [];
  try { sessions = await getSessions(); } catch { /* show empty */ }

  const typeOrder = ["cpu_collect","cpu_label","gpu_clean","gpu_encode","tpu_finetune","tpu_synth"];
  const grouped = typeOrder.reduce<Record<string, SessionRow[]>>((acc, t) => {
    acc[t] = sessions.filter(s => s.session_type === t);
    return acc;
  }, {});

  return (
    <Card title="Session Fleet">
      {sessions.length === 0 ? (
        <p style={{ color: "var(--text-dim)", fontSize: "0.82rem" }}>No sessions registered yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {typeOrder.map(type => {
            const rows = grouped[type] ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={type}>
                <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", letterSpacing: "0.08em", marginBottom: 4 }}>
                  {sessionTypeLabel(type)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {rows.map(s => (
                    <div key={s.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: "var(--bg)", borderRadius: 4, padding: "7px 12px",
                      border: `1px solid ${s.alive ? "var(--border-hi)" : "var(--border)"}`,
                      fontSize: "0.8rem",
                    }}>
                      <StatusDot alive={s.alive} />
                      <span style={{ flex: 1, color: "var(--text-hi)", fontWeight: 500 }}>{s.id}</span>
                      {s.gpu_type && <Badge label={s.gpu_type} color="var(--accent)" />}
                      <span style={{ color: "var(--text-dim)", fontSize: "0.72rem" }}>
                        {formatElapsed(s.seconds_since_heartbeat)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

async function StagesCard() {
  "use cache";
  let data;
  try { data = await getRun(RUN_ID); } catch { return null; }

  const stageOrder = ["p1a","p1b","p1c","p1d","p1e","p2a","p2b","p2c","p3a","p3b","p4a","p4b","p5_finetune","p5a","p5b","p5c"];
  const byStage: Record<string, RunStageRow[]> = {};
  for (const row of data.stages) {
    (byStage[row.stage_name] ??= []).push(row);
  }

  const queueByStage: Record<string, { pending: number; leased: number; done: number }> = {};
  for (const row of data.queue) {
    const s = queueByStage[row.stage] ??= { pending: 0, leased: 0, done: 0 };
    if (row.status === "pending") s.pending += row.cnt;
    else if (row.status === "leased") s.leased += row.cnt;
    else if (row.status === "done") s.done += row.cnt;
  }

  return (
    <Card title={`Run: ${RUN_ID}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {stageOrder.map(stage => {
          const rows = byStage[stage] ?? [];
          const latest = rows.sort((a, b) => b.last_started - a.last_started)[0];
          const q = queueByStage[stage];
          const statusColor = !latest ? "var(--text-dim)"
            : latest.status === "completed" ? "var(--green)"
            : latest.status === "started"   ? "var(--accent)"
            : latest.status === "failed"     ? "var(--red)"
            : "var(--amber)";

          return (
            <div key={stage} style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 4, padding: "10px 14px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: "var(--text-hi)", fontSize: "0.85rem" }}>{stage}</span>
                {latest && <Badge label={latest.status} color={statusColor} />}
              </div>
              {q && (
                <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", display: "flex", gap: 8 }}>
                  {q.pending > 0 && <span><span style={{ color: "var(--amber)" }}>{q.pending}</span> pending</span>}
                  {q.leased  > 0 && <span><span style={{ color: "var(--accent)" }}>{q.leased}</span> active</span>}
                  {q.done    > 0 && <span><span style={{ color: "var(--green)" }}>{q.done}</span> done</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div style={{
      maxWidth: 1200, margin: "0 auto", padding: "32px 24px",
      display: "flex", flexDirection: "column", gap: 20,
    }}>
      <header style={{ marginBottom: 8 }}>
        <div style={{ fontSize: "0.68rem", letterSpacing: "0.15em", color: "var(--text-dim)", marginBottom: 4 }}>
          URDU S2S
        </div>
        <h1 style={{
          fontFamily: "var(--mono)", fontSize: "1.4rem", fontWeight: 600,
          color: "var(--text-hi)", letterSpacing: "-0.01em",
        }}>
          Pipeline Monitor
        </h1>
        <p style={{ color: "var(--text-dim)", fontSize: "0.8rem", marginTop: 4 }}>
          Live status — refreshes every 10s via Next.js cache revalidation
        </p>
      </header>

      <TriggerButton />

      <Suspense fallback={<p style={{ color: "var(--text-dim)" }}>Loading health…</p>}>
        <HealthCard />
      </Suspense>

      <Suspense fallback={<p style={{ color: "var(--text-dim)" }}>Loading fleet…</p>}>
        <FleetCard />
      </Suspense>

      <Suspense fallback={<p style={{ color: "var(--text-dim)" }}>Loading stages…</p>}>
        <StagesCard />
      </Suspense>
    </div>
  );
}