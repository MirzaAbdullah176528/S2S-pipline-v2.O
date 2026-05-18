# Urdu S2S Orchestration Framework

A zero-cost, fully automated data pipeline that collects, cleans, encodes, labels, generates, and synthesizes a 10,000+ hour Urdu conversational corpus. Runs entirely on free infrastructure.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE BACKBONE                          │
│  ┌──────────────┐   ┌──────────────────────────────────────┐  │
│  │  CF Worker   │   │        Cloudflare D1 (SQLite)        │  │
│  │  TypeScript  │◄──►  sessions │ circuit_breakers         │  │
│  │  REST API    │   │  stage_log │ work_queue │ runs       │  │
│  └──────┬───────┘   └──────────────────────────────────────┘  │
│         │ Cron: */5 reclaim expired leases                     │
└─────────┼──────────────────────────────────────────────────────┘
          │  HTTPS (X-Worker-Secret auth)
┌─────────┴──────────────────────────────────────────────────────┐
│                    KAGGLE SESSION FLEET                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ cpu_collect  │  │  cpu_label   │  │     gpu_clean        │ │
│  │  p1a p1b p1e│  │p2a p3a-p4b   │  │     T4: p1c p1d      │ │
│  │  (2 sessions)│  │ (4 sessions) │  │     (2-3 sessions)   │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐│
│  │ gpu_encode   │  │           tpu_synth / tpu_finetune       ││
│  │P100: p2b p2c │  │      TPU v3-8: p5_finetune, p5a-p5c     ││
│  │ (1-2 sessions│  │              (1 session each)            ││
│  └──────────────┘  └──────────────────────────────────────────┘│
└────────────────────────────────┬───────────────────────────────┘
                                 │  HF Hub API (3 tokens)
┌────────────────────────────────▼───────────────────────────────┐
│              HUGGING FACE DATASETS STORAGE                     │
│  stage0_codec │ stage1_ce │ stage2_moe │ stage3_agent          │
│  stage45_e2e  │ overflow (TERTIARY)    │ domain shards         │
└────────────────────────────────────────────────────────────────┘
```

## Pipeline Stages

| Stage | Session | Input | Output | Key Constraint |
|-------|---------|-------|--------|----------------|
| p1a | cpu_collect | query_bank.yaml | video metadata JSONL | YouTube 10 req/min |
| p1b | cpu_collect | video metadata | WAV 24kHz/16-bit | Max 6 global concurrent downloads |
| p1c | gpu_clean (T4) | WAV files | Filtered segments | Silero VAD + SNR filter |
| p1d | gpu_clean (T4) | Filtered segments | Transcript JSONL | Whisper large-v3, batch=8, VRAM guard |
| p1e | cpu_collect | Transcripts + audio | stage0 HF repo | 250GB overflow threshold |
| p2a | cpu_label | 300K sample | Intent labels Parquet | 4 Gemini keys, 14 RPM each |
| p2b | gpu_encode (P100) | All audio (12M segments) | Mimi codec tokens | P100 HBM2 bandwidth advantage |
| p2c | gpu_encode | Mimi tokens | stage1_ce HF repo | WaveUploader 500MB batches |
| p3a | cpu_label | Intent labels | 2,000 seed dialogues | Gemini 2.5 Flash |
| p3b | cpu_label | Seed dialogues | 18K augmented variants | TF-IDF dedup (threshold 0.92) |
| p4a | cpu_label | — | Agent policy JSON | 1000 profiles/domain |
| p4b | cpu_label | Agent policy | 10K agent episodes | Gemini 2.5 Flash |
| p5_finetune | tpu_finetune | 190h sample | MMS-TTS checkpoint | ~5h on TPU v3-8 |
| p5a | tpu_synth | Agent episodes | WAV files | XLA 5-bucket shape guard |
| p5b | tpu_synth | WAV + transcripts | Aligned audio-text pairs | No codec encode step |
| p5c | tpu_synth | Aligned pairs | stage45_e2e HF repo | ~50GB total |

## Technology Stack

| Component | Technology | Cost |
|-----------|-----------|------|
| Orchestration API | CF Worker (TypeScript) | Free |
| State Database | Cloudflare D1 (SQLite) | Free |
| Work Queue | D1 work_queue + CF Cron | Free |
| Dashboard | Next.js on Vercel | Free |
| Compute (CPU) | Kaggle CPU sessions | Free |
| Compute (T4) | Kaggle GPU (30h/wk/account) | Free |
| Compute (P100) | Kaggle GPU | Free |
| Compute (TPU v3-8) | Kaggle TPU | Free |
| AI Labeling | Gemini 2.5 Flash (4 keys) | Free |
| Corpus Storage | Hugging Face Datasets (3 tokens) | Free |
| Rust Extensions | PyO3 + rayon (GH Actions CI) | Free |

## Quick Start

### Prerequisites

```bash
# Local machine (run once)
node >= 18, npm, wrangler >= 3.x
Cloudflare account (free)
Vercel account (free, for dashboard)
4+ verified Kaggle accounts
3 Hugging Face accounts with write tokens
4 Google AI Studio API keys (GEMINI_API_KEY_01-04)
```

### Phase 0: Pre-Flight Deployment

```bash
# 1. Deploy Cloudflare Worker
cd cloudflare
npx wrangler login
npx wrangler d1 create urdu-s2s-state
# Copy database_id to wrangler.jsonc
npx wrangler d1 migrations apply urdu-s2s-state
npx wrangler secret put WORKER_SECRET
npx wrangler deploy

# 2. Deploy Dashboard
cd dashboard && npx vercel --prod

# 3. Add secrets to Kaggle accounts
# CF_WORKER_URL, CF_WORKER_SECRET, GEMINI_API_KEY_0X, HF tokens
```

### Phase 1: Run Pipeline Sessions

Launch Kaggle notebooks with the session templates:
1. `session_cpu_collect.ipynb` — 2 instances (p1a, p1b, p1e)
2. `session_cpu_label.ipynb` — 4 instances (p2a, p3a-p4b)
3. `session_gpu_clean.ipynb` — 2-3 instances on T4 (p1c, p1d)
4. `session_gpu_encode.ipynb` — 1-2 instances on P100 (p2b, p2c)
5. `session_tpu_finetune.ipynb` — 1 instance on TPU (p5_finetune)
6. `session_tpu_synth.ipynb` — 1 instance on TPU (p5a-p5c)

## Project Structure

```
├── cloudflare/                  # CF Worker orchestration backend
│   ├── src/worker.ts           # REST API: heartbeat, queue, CB, stage-log
│   ├── migrations/             # D1 schema (001_base, 002_work_queue)
│   ├── test/                   # Vitest unit tests
│   └── wrangler.jsonc          # Deployment config
│
├── shared/                      # Python shared modules
│   ├── workflow_kernel.py      # Session lifecycle, heartbeat, watchdog
│   ├── cf_client.py            # HTTP client for CF Worker
│   ├── audio_utils.py          # SNR, VAD, Whisper, Demucs
│   ├── checkpoint.py           # Persistent checkpoint manager
│   ├── hf_upload.py            # Wave-based batched HF uploader
│   ├── gemini_rate_limiter.py  # Thread-safe 14 RPM limiter
│   ├── repo_router.py          # 250GB overflow router
│   ├── schema.py               # PyArrow schemas + sampling config
│   └── secrets.py              # Unified secret loader
│
├── config/                      # Pipeline configuration
│   ├── hf_repos.yaml           # HF dataset repo IDs
│   ├── intent_taxonomy.yaml    # Intent classification taxonomy
│   ├── tool_registry.yaml      # Tool schemas for agent episodes
│   ├── query_bank.yaml         # YouTube search queries (~200)
│   └── _version.json           # Config version + hash
│
├── pipeline_1_collect/          # p1a-p1e notebooks
├── pipeline_2_intent/           # p2a-p2c notebooks
├── pipeline_3_dialogue/         # p3a-p3c notebooks
├── pipeline_4_episodes/         # p4a-p4c notebooks
├── pipeline_5_codec_tts/        # p5a-p5c notebooks
│
├── session_*.ipynb              # 6 session entry-point notebooks
├── rust_extensions/             # PyO3 Rust extensions (snr_filter, audio_chunker)
├── .github/workflows/           # CI for building Rust wheels
├── scripts/                     # stats_report.py, validate_env.py
├── dashboard/                   # Next.js monitoring dashboard
└── requirements.txt             # Python dependencies
```

## Key Design Patterns

- **Temporal-Equivalent Pattern**: D1 as durable event log, heartbeat as activity pulsing, CircuitBreakerRegistry as retry/backoff, checkpoint.py as saga journal
- **Work Queue FSM**: PENDING → LEASED → DONE (with retry/nack, lease expiry via CF Cron)
- **Circuit Breakers**: Per-API (youtube, gemini, hf_upload, hf_download) with exponential backoff, shared state via D1
- **Memory Management**: GC Gate (92% GPU), Watchdog Auto-Escalation, Segment-Level VRAM Guard (85%), Subprocess Guard
- **Overflow Routing**: Session-local byte counter (250GB), switches from PRIMARY to TERTIARY HF repo
- **XLA Shape Bucketing**: 5 buckets (64-1024), reduces TPU compilations from 10K to 5

## License

This project is for research purposes. Note: `facebook/mms-tts-urd-script_arabic` is CC-BY-NC 4.0 — obtain Meta's commercial license for commercial deployment, or switch to Kokoro-82M (Apache 2.0).
