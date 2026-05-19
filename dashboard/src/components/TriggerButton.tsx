"use client";

import { useState } from "react";

type TriggerState =
  | { phase: "idle" }
  | { phase: "confirming" }
  | { phase: "loading" }
  | { phase: "success"; run_id: string; kaggle_url: string; session: string }
  | { phase: "error"; message: string };

const SESSION_LABEL = "cpu_collect — p1a, p1b, p1e";
const DATASET_SLUG  = "mirza176528/s2s-pipline-v2-0-2";

export default function TriggerButton() {
  const [state, setState] = useState<TriggerState>({ phase: "idle" });

  function openModal() {
    setState({ phase: "confirming" });
  }

  function closeModal() {
    setState({ phase: "idle" });
  }

  async function confirmLaunch() {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/trigger", { method: "POST" });
      const data = await res.json() as {
        ok: boolean;
        run_id?: string;
        kaggle_url?: string;
        session?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }

      setState({
        phase:      "success",
        run_id:     data.run_id!,
        kaggle_url: data.kaggle_url!,
        session:    data.session!,
      });
    } catch (err) {
      setState({ phase: "error", message: (err as Error).message });
    }
  }

  const isModalOpen = state.phase === "confirming" || state.phase === "loading";

  return (
    <>
      <div style={{
        background:    "var(--surface)",
        border:        "1px solid var(--border)",
        borderRadius:  6,
        padding:       "20px 24px",
        display:       "flex",
        alignItems:    "center",
        justifyContent: "space-between",
        gap:           16,
        flexWrap:      "wrap",
      }}>
        <div>
          <div style={{
            fontFamily:    "var(--mono)",
            fontSize:      "0.7rem",
            fontWeight:    600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color:         "var(--text-dim)",
            marginBottom:  4,
          }}>
            Pipeline Trigger
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--text-hi)" }}>
            Launch a new <code style={{
              fontFamily:      "var(--mono)",
              background:      "var(--bg)",
              padding:         "1px 5px",
              borderRadius:    3,
              border:          "1px solid var(--border)",
              fontSize:        "0.78rem",
            }}>cpu_collect</code> session on Kaggle
          </div>
          <div style={{ fontSize: "0.73rem", color: "var(--text-dim)", marginTop: 4 }}>
            Stages: p1a → p1b → p1e &nbsp;·&nbsp; Accelerator: CPU
          </div>

          {state.phase === "success" && (
            <div style={{
              marginTop:    10,
              padding:      "8px 12px",
              background:   "var(--green)11",
              border:       "1px solid var(--green)44",
              borderRadius: 4,
              fontSize:     "0.78rem",
            }}>
              <div style={{ color: "var(--green)", fontWeight: 600, marginBottom: 3 }}>
                ✓ Session launched
              </div>
              <div style={{ color: "var(--text-dim)" }}>
                Run ID: <span style={{ color: "var(--text-hi)", fontFamily: "var(--mono)" }}>
                  {state.run_id}
                </span>
              </div>
              <div style={{ marginTop: 4 }}>
                <a
                  href={state.kaggle_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: "0.75rem" }}
                >
                  View kernel on Kaggle →
                </a>
              </div>
            </div>
          )}

          {state.phase === "error" && (
            <div style={{
              marginTop:    10,
              padding:      "8px 12px",
              background:   "var(--red)11",
              border:       "1px solid var(--red)44",
              borderRadius: 4,
              fontSize:     "0.78rem",
              color:        "var(--red)",
            }}>
              <span style={{ fontWeight: 600 }}>Error: </span>{state.message}
              <button
                onClick={() => setState({ phase: "idle" })}
                style={{
                  marginLeft:      12,
                  background:      "transparent",
                  border:          "none",
                  color:           "var(--text-dim)",
                  cursor:          "pointer",
                  fontSize:        "0.75rem",
                  textDecoration:  "underline",
                }}
              >
                dismiss
              </button>
            </div>
          )}
        </div>

        <button
          onClick={openModal}
          disabled={state.phase === "loading"}
          style={{
            padding:       "9px 20px",
            borderRadius:  5,
            border:        "1px solid var(--accent)",
            background:    state.phase === "success" ? "var(--green)22" : "var(--accent)22",
            color:         state.phase === "success" ? "var(--green)"   : "var(--accent)",
            fontFamily:    "var(--mono)",
            fontSize:      "0.78rem",
            fontWeight:    600,
            letterSpacing: "0.06em",
            cursor:        state.phase === "loading" ? "not-allowed" : "pointer",
            opacity:       state.phase === "loading" ? 0.5 : 1,
            transition:    "opacity 0.15s",
            whiteSpace:    "nowrap",
          }}
        >
          {state.phase === "success" ? "↺ Launch Again" : "▶ Launch Session"}
        </button>
      </div>

      {isModalOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          style={{
            position:       "fixed",
            inset:          0,
            background:     "rgba(0,0,0,0.6)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            zIndex:         100,
          }}
        >
          <div style={{
            background:   "var(--surface)",
            border:       "1px solid var(--border-hi, var(--border))",
            borderRadius: 8,
            padding:      "28px 32px",
            width:        "min(460px, 92vw)",
            boxShadow:    "0 20px 60px rgba(0,0,0,0.5)",
          }}>
            <h2 style={{
              fontFamily:    "var(--mono)",
              fontSize:      "0.95rem",
              fontWeight:    600,
              color:         "var(--text-hi)",
              marginBottom:  20,
            }}>
              Confirm Session Launch
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {[
                { label: "Session Type",  value: SESSION_LABEL },
                { label: "Accelerator",   value: "CPU (No GPU)" },
                { label: "Dataset",       value: DATASET_SLUG },
                { label: "Notebook",      value: "session_cpu_collect.ipynb" },
                { label: "Run ID",        value: "auto-generated on confirm" },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  display:        "flex",
                  justifyContent: "space-between",
                  alignItems:     "flex-start",
                  gap:            12,
                  fontSize:       "0.8rem",
                  paddingBottom:  10,
                  borderBottom:   "1px solid var(--border)",
                }}>
                  <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{label}</span>
                  <span style={{
                    color:      "var(--text-hi)",
                    fontFamily: "var(--mono)",
                    fontSize:   "0.75rem",
                    textAlign:  "right",
                  }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={closeModal}
                disabled={state.phase === "loading"}
                style={{
                  padding:    "8px 18px",
                  borderRadius: 5,
                  border:     "1px solid var(--border)",
                  background: "transparent",
                  color:      "var(--text-dim)",
                  fontSize:   "0.8rem",
                  cursor:     "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmLaunch}
                disabled={state.phase === "loading"}
                style={{
                  padding:      "8px 20px",
                  borderRadius: 5,
                  border:       "1px solid var(--accent)",
                  background:   "var(--accent)",
                  color:        "#000",
                  fontSize:     "0.8rem",
                  fontWeight:   600,
                  cursor:       state.phase === "loading" ? "not-allowed" : "pointer",
                  opacity:      state.phase === "loading" ? 0.6 : 1,
                  display:      "flex",
                  alignItems:   "center",
                  gap:          6,
                }}
              >
                {state.phase === "loading" ? (
                  <>
                    <span style={{
                      display:      "inline-block",
                      width:        12,
                      height:       12,
                      border:       "2px solid #00000044",
                      borderTop:    "2px solid #000",
                      borderRadius: "50%",
                      animation:    "spin 0.7s linear infinite",
                    }} />
                    Launching…
                  </>
                ) : "Confirm Launch"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}