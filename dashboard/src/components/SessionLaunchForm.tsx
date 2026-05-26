"use client";

import { useState, useMemo, useCallback } from "react";
import {
  SESSIONS,
  RUNTIME_DEVICES,
  KAGGLE_ACCOUNTS,
  HF_REPOS,
  getSessionById,
  getDeviceById,
  getAccountById,
  getCompatibleDevices,
  getRecommendedHfRepos,
  getOutputHfRepos,
  getInputHfRepos,
  REQUIREMENT_CATEGORY_LABELS,
  REQUIREMENT_CATEGORY_ORDER,
  type SessionConfig,
  type RuntimeDevice,
  type KaggleAccount,
  type HfRepo,
  type SessionRequirement,
} from "@/lib/sessionConfig";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormData {
  sessionId: string;
  deviceId: string;
  accountId: string;
  hfRepoId: string;
}

type LaunchPhase =
  | "idle"
  | "form"
  | "confirming"
  | "loading"
  | "success"
  | "error";

interface LaunchResult {
  run_id: string;
  kaggle_url: string;
  session: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ alive, color }: { alive: boolean; color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: alive ? color ?? "var(--green)" : "var(--red)",
        boxShadow: alive ? `0 0 5px ${color ?? "var(--green)"}` : undefined,
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function RequirementItem({ req }: { req: SessionRequirement }) {
  const categoryColors: Record<string, string> = {
    api: "var(--accent)",
    env: "var(--amber)",
    data: "var(--green)",
    resource: "#c084fc",
    config: "#f472b6",
  };
  const color = categoryColors[req.category] ?? "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        background: "var(--bg)",
        borderRadius: 4,
        border: `1px solid ${req.required ? `${color}33` : "var(--border)"}`,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          borderRadius: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.65rem",
          fontWeight: 700,
          background: `${color}22`,
          color,
          border: `1px solid ${color}44`,
          marginTop: 1,
        }}
      >
        {req.required ? "!" : "?"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 2,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: "0.78rem",
              color: "var(--text-hi)",
            }}
          >
            {req.label}
          </span>
          <span
            style={{
              fontSize: "0.6rem",
              padding: "1px 5px",
              borderRadius: 2,
              background: `${color}18`,
              color,
              border: `1px solid ${color}33`,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {REQUIREMENT_CATEGORY_LABELS[req.category]}
          </span>
          {!req.required && (
            <span
              style={{
                fontSize: "0.6rem",
                padding: "1px 5px",
                borderRadius: 2,
                background: "var(--border)",
                color: "var(--text-dim)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              optional
            </span>
          )}
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", lineHeight: 1.5 }}>
          {req.description}
        </div>
        {req.detail && (
          <div
            style={{
              fontSize: "0.68rem",
              color: "var(--text-dim)",
              marginTop: 3,
              padding: "4px 8px",
              background: "var(--surface)",
              borderRadius: 3,
              borderLeft: `2px solid ${color}66`,
              lineHeight: 1.5,
            }}
          >
            {req.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  id,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; sublabel?: string; badge?: string }[];
  placeholder: string;
  id: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontSize: "0.7rem",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: 5,
          border: `1px solid ${value ? "var(--border-hi)" : "var(--border)"}`,
          background: "var(--bg)",
          color: value ? "var(--text-hi)" : "var(--text-dim)",
          fontFamily: "var(--mono)",
          fontSize: "0.78rem",
          cursor: disabled ? "not-allowed" : "pointer",
          outline: "none",
          appearance: "none",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
            {opt.badge ? ` ${opt.badge}` : ""}
            {opt.sublabel ? ` — ${opt.sublabel}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Device Badge helper ───────────────────────────────────────────────────────

function DeviceBadge({ device, isRecommended }: { device: RuntimeDevice; isRecommended: boolean }) {
  const bgColor = device.enableTpu
    ? "var(--accent)"
    : device.enableGpu
      ? "#c084fc"
      : "var(--text-dim)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 4,
        background: `${bgColor}15`,
        border: `1px solid ${isRecommended ? bgColor : "var(--border)"}`,
        fontSize: "0.72rem",
        fontWeight: isRecommended ? 600 : 400,
        color: isRecommended ? bgColor : "var(--text-dim)",
        cursor: "pointer",
        transition: "all 0.15s",
        position: "relative",
      }}
    >
      {device.enableTpu ? "TPU" : device.enableGpu ? "GPU" : "CPU"}
      {isRecommended && (
        <span
          style={{
            fontSize: "0.58rem",
            padding: "0px 4px",
            borderRadius: 2,
            background: `${bgColor}22`,
            color: bgColor,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          RECOMMENDED
        </span>
      )}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SessionLaunchForm() {
  const [phase, setPhase] = useState<LaunchPhase>("idle");
  const [formData, setFormData] = useState<FormData>({
    sessionId: "",
    deviceId: "",
    accountId: "",
    hfRepoId: "",
  });
  const [requirementsAcknowledged, setRequirementsAcknowledged] = useState(false);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Derived data ──────────────────────────────────────────────────────────

  const selectedSession = useMemo(
    () => getSessionById(formData.sessionId),
    [formData.sessionId]
  );

  const compatibleDevices = useMemo(
    () => getCompatibleDevices(formData.sessionId),
    [formData.sessionId]
  );

  const recommendedRepos = useMemo(
    () => getRecommendedHfRepos(formData.sessionId),
    [formData.sessionId]
  );

  const outputRepos = useMemo(
    () => getOutputHfRepos(formData.sessionId),
    [formData.sessionId]
  );

  const inputRepos = useMemo(
    () => getInputHfRepos(formData.sessionId),
    [formData.sessionId]
  );

  // All repos available for selection — output repos of the selected session
  const selectableRepos = useMemo(() => {
    if (!selectedSession) return [];
    return HF_REPOS.filter((r) => selectedSession.outputHfRepos.includes(r.id));
  }, [selectedSession]);

  // Reset dependent fields when session changes
  const handleSessionChange = useCallback((sessionId: string) => {
    const session = getSessionById(sessionId);
    const devices = getCompatibleDevices(sessionId);
    const recommendedDevice = session?.recommendedDevice ?? "";
    const deviceStillValid = devices.some((d) => d.id === recommendedDevice);

    setFormData((prev) => ({
      ...prev,
      sessionId,
      deviceId: deviceStillValid ? recommendedDevice : (devices[0]?.id ?? ""),
      hfRepoId: "", // reset — repos depend on session
    }));
    setRequirementsAcknowledged(false);
  }, []);

  // ── Validation ────────────────────────────────────────────────────────────

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!formData.sessionId) errors.push("Select a notebook to execute");
    if (formData.sessionId && !formData.deviceId)
      errors.push("Select a runtime device");
    if (formData.sessionId && !formData.accountId)
      errors.push("Select a Kaggle account");
    if (formData.sessionId && selectableRepos.length > 0 && !formData.hfRepoId)
      errors.push("Select a Hugging Face repository for data output");
    if (selectedSession && !requirementsAcknowledged)
      errors.push("Acknowledge the session requirements before launching");
    return errors;
  }, [formData, selectedSession, requirementsAcknowledged, selectableRepos]);

  const canLaunch = validationErrors.length === 0;

  // ── Launch handler ────────────────────────────────────────────────────────

  async function handleLaunch() {
    setPhase("loading");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_type: formData.sessionId,
          device: formData.deviceId,
          account: formData.accountId,
          hf_repo: formData.hfRepoId,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        run_id?: string;
        kaggle_url?: string;
        session?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setPhase("error");
        setErrorMessage(data.error ?? `HTTP ${res.status}`);
        return;
      }

      setLaunchResult({
        run_id: data.run_id!,
        kaggle_url: data.kaggle_url!,
        session: data.session!,
      });
      setPhase("success");
    } catch (err) {
      setPhase("error");
      setErrorMessage((err as Error).message);
    }
  }

  function resetForm() {
    setPhase("idle");
    setFormData({ sessionId: "", deviceId: "", accountId: "", hfRepoId: "" });
    setRequirementsAcknowledged(false);
    setLaunchResult(null);
    setErrorMessage(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isModalOpen = phase === "form" || phase === "confirming" || phase === "loading";

  return (
    <>
      {/* ── Trigger Card (always visible) ─────────────────────────────────── */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: "0.7rem",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              marginBottom: 4,
            }}
          >
            Pipeline Trigger
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--text-hi)" }}>
            {phase === "success" && launchResult ? (
              <>
                Session{" "}
                <code
                  style={{
                    fontFamily: "var(--mono)",
                    background: "var(--bg)",
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: "1px solid var(--border)",
                    fontSize: "0.78rem",
                  }}
                >
                  {launchResult.session}
                </code>{" "}
                launched successfully
              </>
            ) : phase === "error" ? (
              "Launch failed — check error details below"
            ) : (
              "Select a notebook and launch a pipeline session on Kaggle"
            )}
          </div>
          {phase === "idle" && (
            <div style={{ fontSize: "0.73rem", color: "var(--text-dim)", marginTop: 4 }}>
              {SESSIONS.length} notebooks available &middot;{" "}
              {RUNTIME_DEVICES.length} runtime devices &middot;{" "}
              {KAGGLE_ACCOUNTS.length} Kaggle accounts
            </div>
          )}

          {/* Success banner */}
          {phase === "success" && launchResult && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "var(--green)11",
                border: "1px solid var(--green)44",
                borderRadius: 4,
                fontSize: "0.78rem",
              }}
            >
              <div style={{ color: "var(--green)", fontWeight: 600, marginBottom: 3 }}>
                Session launched
              </div>
              <div style={{ color: "var(--text-dim)" }}>
                Run ID:{" "}
                <span style={{ color: "var(--text-hi)", fontFamily: "var(--mono)" }}>
                  {launchResult.run_id}
                </span>
              </div>
              <div style={{ marginTop: 4 }}>
                <a
                  href={launchResult.kaggle_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: "0.75rem" }}
                >
                  View kernel on Kaggle →
                </a>
              </div>
            </div>
          )}

          {/* Error banner */}
          {phase === "error" && errorMessage && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "var(--red)11",
                border: "1px solid var(--red)44",
                borderRadius: 4,
                fontSize: "0.78rem",
                color: "var(--red)",
              }}
            >
              <span style={{ fontWeight: 600 }}>Error: </span>
              {errorMessage}
              <button
                onClick={() => {
                  setPhase("form");
                  setErrorMessage(null);
                }}
                style={{
                  marginLeft: 12,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  textDecoration: "underline",
                }}
              >
                back to form
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            if (phase === "success" || phase === "error") {
              resetForm();
            } else {
              setPhase("form");
            }
          }}
          style={{
            padding: "9px 20px",
            borderRadius: 5,
            border: "1px solid var(--accent)",
            background:
              phase === "success"
                ? "var(--green)22"
                : phase === "error"
                  ? "var(--red)22"
                  : "var(--accent)22",
            color:
              phase === "success"
                ? "var(--green)"
                : phase === "error"
                  ? "var(--red)"
                  : "var(--accent)",
            fontFamily: "var(--mono)",
            fontSize: "0.78rem",
            fontWeight: 600,
            letterSpacing: "0.06em",
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "opacity 0.15s",
          }}
        >
          {phase === "success"
            ? "Launch Another"
            : phase === "error"
              ? "Try Again"
              : "Execute Notebook"}
        </button>
      </div>

      {/* ── Modal ─────────────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && phase !== "loading") {
              setPhase("idle");
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-hi, var(--border))",
              borderRadius: 8,
              padding: "28px 32px",
              width: "min(780px, 94vw)",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            {/* ── Form Phase ────────────────────────────────────────────── */}
            {(phase === "form" || phase === "confirming") && (
              <>
                <h2
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    color: "var(--text-hi)",
                    marginBottom: 4,
                  }}
                >
                  Execute Notebook
                </h2>
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-dim)",
                    marginBottom: 24,
                  }}
                >
                  Select a notebook to execute, choose the runtime device and Kaggle
                  account, then review requirements before launching.
                </p>

                {/* ── Notebook Selection (full width) ──────────────────────── */}
                <div style={{ marginBottom: 20 }}>
                  <SelectField
                    id="notebook-select"
                    label="Notebook"
                    value={formData.sessionId}
                    onChange={handleSessionChange}
                    placeholder="Choose a notebook to execute…"
                    options={SESSIONS.map((s) => ({
                      value: s.id,
                      label: s.notebookFile,
                      sublabel: `${s.label} (${s.stages.join(", ")})`,
                    }))}
                  />
                </div>

                {/* ── Device Selection with Recommended Label ──────────────── */}
                {selectedSession && (
                  <div style={{ marginBottom: 20 }}>
                    <div
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--text-dim)",
                        marginBottom: 8,
                      }}
                    >
                      Runtime Device
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {compatibleDevices.map((d) => {
                        const isRecommended = d.id === selectedSession.recommendedDevice;
                        const isSelected = d.id === formData.deviceId;
                        return (
                          <button
                            key={d.id}
                            onClick={() =>
                              setFormData((prev) => ({ ...prev, deviceId: d.id }))
                            }
                            style={{
                              padding: "8px 14px",
                              borderRadius: 5,
                              border: `1px solid ${
                                isSelected
                                  ? isRecommended
                                    ? "var(--accent)"
                                    : "var(--border-hi)"
                                  : isRecommended
                                    ? "var(--accent)55"
                                    : "var(--border)"
                              }`,
                              background: isSelected
                                ? isRecommended
                                  ? "var(--accent)22"
                                  : "var(--border)22"
                                : "var(--bg)",
                              color: isSelected
                                ? "var(--text-hi)"
                                : "var(--text-dim)",
                              fontFamily: "var(--mono)",
                              fontSize: "0.78rem",
                              cursor: "pointer",
                              transition: "all 0.15s",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 3,
                              position: "relative",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>{d.label}</span>
                              {isRecommended && (
                                <span
                                  style={{
                                    fontSize: "0.55rem",
                                    padding: "1px 5px",
                                    borderRadius: 2,
                                    background: "var(--accent)22",
                                    color: "var(--accent)",
                                    fontWeight: 700,
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Recommended
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: "0.68rem", color: "var(--text-dim)" }}>
                              {d.enableTpu ? "TPU" : d.enableGpu ? "GPU" : "CPU"}
                              {d.vramGB ? ` · ${d.vramGB}GB VRAM` : ""}
                              {" · "}{d.accelerator}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Account & HF Repo row ────────────────────────────────── */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 16,
                    marginBottom: 20,
                  }}
                >
                  <SelectField
                    id="account-select"
                    label="Kaggle Account"
                    value={formData.accountId}
                    onChange={(v) =>
                      setFormData((prev) => ({ ...prev, accountId: v }))
                    }
                    placeholder="Choose an account…"
                    options={KAGGLE_ACCOUNTS.map((a) => ({
                      value: a.id,
                      label: a.label,
                      sublabel: a.username,
                    }))}
                  />
                  <SelectField
                    id="hf-repo-select"
                    label="Hugging Face Output Repo"
                    value={formData.hfRepoId}
                    onChange={(v) =>
                      setFormData((prev) => ({ ...prev, hfRepoId: v }))
                    }
                    placeholder={
                      formData.sessionId
                        ? selectableRepos.length > 0
                          ? "Choose output repo…"
                          : "No output repos"
                        : "Select notebook first"
                    }
                    disabled={!formData.sessionId || selectableRepos.length === 0}
                    options={selectableRepos.map((r) => {
                      const isRecommended = recommendedRepos.some(
                        (rr) => rr.id === r.id
                      );
                      return {
                        value: r.id,
                        label: r.repoId,
                        sublabel: r.token,
                        badge: isRecommended ? "Recommended" : undefined,
                      };
                    })}
                  />
                </div>

                {/* ── Selected Session Summary ──────────────────────────── */}
                {selectedSession && (
                  <div
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      padding: "14px 16px",
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <StatusDot alive color="var(--accent)" />
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          color: "var(--text-hi)",
                        }}
                      >
                        {selectedSession.label}
                      </span>
                      <span
                        style={{
                          fontSize: "0.68rem",
                          padding: "2px 7px",
                          borderRadius: 3,
                          background: "var(--accent)18",
                          color: "var(--accent)",
                          border: "1px solid var(--accent)33",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        {selectedSession.stages.join(", ")}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-dim)",
                        lineHeight: 1.6,
                        marginBottom: 10,
                      }}
                    >
                      {selectedSession.description}
                    </p>

                    {/* Quick stats */}
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        flexWrap: "wrap",
                        fontSize: "0.7rem",
                      }}
                    >
                      <span style={{ color: "var(--text-dim)" }}>
                        Notebook:{" "}
                        <span style={{ color: "var(--text-hi)", fontFamily: "var(--mono)" }}>
                          {selectedSession.notebookFile}
                        </span>
                      </span>
                      <span style={{ color: "var(--text-dim)" }}>
                        Recommended:{" "}
                        <span style={{ color: "var(--accent)" }}>
                          {getDeviceById(selectedSession.recommendedDevice)?.label ?? "N/A"}
                        </span>
                      </span>
                      <span style={{ color: "var(--text-dim)" }}>
                        Max:{" "}
                        <span style={{ color: "var(--text-hi)" }}>
                          {selectedSession.sessionMaxHours}h
                        </span>
                      </span>
                      <span style={{ color: "var(--text-dim)" }}>
                        Disk:{" "}
                        <span style={{ color: "var(--text-hi)" }}>
                          ~{selectedSession.estimatedDiskGb} GB
                        </span>
                      </span>
                      <span style={{ color: "var(--text-dim)" }}>
                        RAM:{" "}
                        <span style={{ color: "var(--text-hi)" }}>
                          ~{selectedSession.estimatedRamGb} GB
                        </span>
                      </span>
                      <span style={{ color: "var(--text-dim)" }}>
                        Internet:{" "}
                        <span style={{ color: selectedSession.enableInternet ? "var(--green)" : "var(--red)" }}>
                          {selectedSession.enableInternet ? "Required" : "Not needed"}
                        </span>
                      </span>
                    </div>

                    {/* Output repos */}
                    {outputRepos.length > 0 && (
                      <div style={{ marginTop: 10, fontSize: "0.7rem" }}>
                        <span style={{ color: "var(--text-dim)" }}>Output repos: </span>
                        {outputRepos.map((r, i) => (
                          <span key={r.id}>
                            <span style={{ color: "var(--green)" }}>{r.repoId}</span>
                            <span style={{ color: "var(--text-dim)", fontSize: "0.65rem" }}>
                              {" "}({r.token})
                            </span>
                            {i < outputRepos.length - 1 && (
                              <span style={{ color: "var(--text-dim)" }}> · </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Input / prerequisite repos */}
                    {inputRepos.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: "0.7rem" }}>
                        <span style={{ color: "var(--text-dim)" }}>Reads from: </span>
                        {inputRepos.map((r, i) => (
                          <span key={r.id}>
                            <span style={{ color: "var(--amber)" }}>{r.repoId}</span>
                            {i < inputRepos.length - 1 && (
                              <span style={{ color: "var(--text-dim)" }}> · </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Requirements Display ───────────────────────────────── */}
                {selectedSession && (
                  <div style={{ marginBottom: 20 }}>
                    <h3
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--text-dim)",
                        marginBottom: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      Session Requirements
                      <span
                        style={{
                          fontSize: "0.62rem",
                          padding: "1px 6px",
                          borderRadius: 2,
                          background: "var(--amber)18",
                          color: "var(--amber)",
                          border: "1px solid var(--amber)33",
                        }}
                      >
                        {selectedSession.requirements.filter((r) => r.required).length} required
                      </span>
                    </h3>

                    {/* Group requirements by category */}
                    {REQUIREMENT_CATEGORY_ORDER.map((cat) => {
                      const reqs = selectedSession.requirements.filter(
                        (r) => r.category === cat
                      );
                      if (reqs.length === 0) return null;
                      return (
                        <div key={cat} style={{ marginBottom: 12 }}>
                          <div
                            style={{
                              fontSize: "0.65rem",
                              fontWeight: 600,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              color: "var(--text-dim)",
                              marginBottom: 6,
                              marginTop: 8,
                            }}
                          >
                            {REQUIREMENT_CATEGORY_LABELS[cat]}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                            }}
                          >
                            {reqs.map((req) => (
                              <RequirementItem key={req.label} req={req} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Acknowledgment Checkbox ────────────────────────────── */}
                {selectedSession && (
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "12px 14px",
                      background: requirementsAcknowledged
                        ? "var(--green)08"
                        : "var(--bg)",
                      border: `1px solid ${requirementsAcknowledged ? "var(--green)44" : "var(--border)"}`,
                      borderRadius: 5,
                      marginBottom: 20,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={requirementsAcknowledged}
                      onChange={(e) =>
                        setRequirementsAcknowledged(e.target.checked)
                      }
                      style={{
                        marginTop: 2,
                        accentColor: "var(--green)",
                        cursor: "pointer",
                      }}
                    />
                    <span style={{ fontSize: "0.78rem", color: "var(--text)", lineHeight: 1.5 }}>
                      I have reviewed the session requirements and confirm that
                      all required APIs, environment variables, and data
                      prerequisites are properly configured before launching.
                    </span>
                  </label>
                )}

                {/* ── Validation Errors ──────────────────────────────────── */}
                {validationErrors.length > 0 && selectedSession && (
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "var(--red)08",
                      border: "1px solid var(--red)33",
                      borderRadius: 5,
                      marginBottom: 20,
                      fontSize: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        color: "var(--red)",
                        marginBottom: 4,
                        fontSize: "0.7rem",
                        letterSpacing: "0.06em",
                      }}
                    >
                      BEFORE LAUNCHING
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 16,
                        color: "var(--text-dim)",
                        lineHeight: 1.8,
                      }}
                    >
                      {validationErrors.map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ── Action Buttons ─────────────────────────────────────── */}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    onClick={() => setPhase("idle")}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 5,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-dim)",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleLaunch}
                    disabled={!canLaunch}
                    style={{
                      padding: "8px 22px",
                      borderRadius: 5,
                      border: `1px solid ${canLaunch ? "var(--accent)" : "var(--border)"}`,
                      background: canLaunch ? "var(--accent)" : "transparent",
                      color: canLaunch ? "#000" : "var(--text-dim)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      cursor: canLaunch ? "pointer" : "not-allowed",
                      opacity: canLaunch ? 1 : 0.5,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      transition: "all 0.15s",
                    }}
                  >
                    Launch Session
                  </button>
                </div>
              </>
            )}

            {/* ── Loading Phase ──────────────────────────────────────────── */}
            {phase === "loading" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                  padding: "40px 0",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 28,
                    height: 28,
                    border: "3px solid var(--border)",
                    borderTop: "3px solid var(--accent)",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      color: "var(--text-hi)",
                      marginBottom: 4,
                    }}
                  >
                    Launching session…
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>
                    Creating run on Cloudflare Worker and pushing kernel to Kaggle.
                    This may take a few seconds.
                  </div>
                </div>
              </div>
            )}
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
