# Urdu S2S Pipeline — Shared Modules
"""
Shared Python modules for the Urdu S2S Orchestration Framework.

Modules:
  - workflow_kernel: Session lifecycle, heartbeat, GPU watchdog, stage orchestration
  - cf_client: HTTP client for Cloudflare Worker REST API
  - audio_utils: SNR computation, VAD, Whisper, Demucs, audio standardization
  - checkpoint: Persistent checkpoint manager with local+HF persistence
  - hf_upload: Wave-based batched uploader for Hugging Face Datasets
  - gemini_rate_limiter: Thread-safe RPM limiter for Gemini API (14 RPM)
  - repo_router: Overflow router with 250GB threshold
  - schema: PyArrow schemas for metadata and intent labels
  - secrets: Unified secret loader (Kaggle Secrets → .env → os.environ)
"""
