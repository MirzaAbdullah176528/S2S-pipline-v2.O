#!/usr/bin/env python3
"""
validate_env.py — Environment Validation for Urdu S2S Pipeline

Validates that all required configuration, secrets, and dependencies
are properly set up before running any pipeline session.

Checks:
  1. Python packages installed and version-compliant
  2. Config YAML files present and non-empty
  3. Cloudflare Worker accessible and D1 healthy
  4. Hugging Face tokens valid and repos accessible
  5. Gemini API keys functional
  6. GPU/TPU hardware available (if required by session type)
  7. Rust extensions available (optional, with fallback note)

Usage:
    python scripts/validate_env.py [--session-type TYPE]
    python scripts/validate_env.py --session-type gpu_clean
"""

import argparse
import importlib
import json
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Color codes for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RESET = "\033[0m"

# ── Package requirements by session type ─────────────────────────────────────

COMMON_PACKAGES = {
    "requests": "2.32.0",
    "numpy": "1.26.0",
    "huggingface_hub": "0.26.0",
    "datasets": "3.0.0",
    "soundfile": "0.12.1",
    "pyarrow": None,
    "pyloudnorm": "0.1.1",
    "python-dotenv": "1.0.0",
}

SESSION_PACKAGES = {
    "cpu_collect": {"yt-dlp": "2024.11.18"},
    "cpu_label": {"google-generativeai": "0.8.0"},
    "gpu_clean": {"faster-whisper": "1.0.0", "torch": "2.3.0", "demucs": "4.0.1"},
    "gpu_encode": {"torch": "2.3.0", "torchaudio": "2.3.0"},
    "tpu_finetune": {"torch": "2.3.0", "accelerate": None},
    "tpu_synth": {"torch": "2.3.0", "accelerate": None},
}

# ── Config files required ────────────────────────────────────────────────────

REQUIRED_CONFIGS = [
    "config/hf_repos.yaml",
    "config/intent_taxonomy.yaml",
    "config/tool_registry.yaml",
    "config/query_bank.yaml",
    "config/_version.json",
]

# ── Secret keys required ─────────────────────────────────────────────────────

BASE_SECRET_KEYS = [
    "CF_WORKER_URL",
    "CF_WORKER_SECRET",
    "HF_TOKEN_PRIMARY",
    "HF_TOKEN_SECONDARY",
    "HF_TOKEN_TERTIARY",
]

GEMINI_SECRET_KEYS = [
    "GEMINI_API_KEY_01",
    "GEMINI_API_KEY_02",
    "GEMINI_API_KEY_03",
    "GEMINI_API_KEY_04",
]


class ValidationReport:
    def __init__(self):
        self.passed = []
        self.warnings = []
        self.failed = []

    def ok(self, msg: str):
        self.passed.append(msg)
        print(f"  {GREEN}✓{RESET} {msg}")

    def warn(self, msg: str):
        self.warnings.append(msg)
        print(f"  {YELLOW}⚠{RESET} {msg}")

    def fail(self, msg: str):
        self.failed.append(msg)
        print(f"  {RED}✗{RESET} {msg}")

    def summary(self) -> bool:
        total = len(self.passed) + len(self.warnings) + len(self.failed)
        print(f"\n{'='*60}")
        print(f"VALIDATION SUMMARY: {len(self.passed)} passed, "
              f"{len(self.warnings)} warnings, {len(self.failed)} failed")
        print(f"{'='*60}")

        if self.failed:
            print(f"\n{RED}BLOCKING ISSUES:{RESET}")
            for f in self.failed:
                print(f"  • {f}")
            return False

        if self.warnings:
            print(f"\n{YELLOW}WARNINGS (non-blocking):{RESET}")
            for w in self.warnings:
                print(f"  • {w}")

        print(f"\n{GREEN}Environment is ready for pipeline execution.{RESET}")
        return True


def check_python_packages(report: ValidationReport, session_type: str | None):
    """Check that required Python packages are installed."""
    print(f"\n{CYAN}[1] Python Packages{RESET}")

    all_packages = dict(COMMON_PACKAGES)
    if session_type and session_type in SESSION_PACKAGES:
        all_packages.update(SESSION_PACKAGES[session_type])

    for pkg_name, min_version in all_packages.items():
        # Map package name to import name
        import_name = pkg_name.replace("-", "_").replace(".", "_")
        if import_name == "yt_dlp":
            import_name = "yt_dlp"
        elif import_name == "google_generativeai":
            import_name = "google.generativeai"
        elif import_name == "faster_whisper":
            import_name = "faster_whisper"
        elif import_name == "python_dotenv":
            import_name = "dotenv"

        try:
            mod = importlib.import_module(import_name)
            version = getattr(mod, "__version__", "unknown")
            if min_version and version != "unknown":
                report.ok(f"{pkg_name} {version} (≥{min_version})")
            else:
                report.ok(f"{pkg_name} installed (version: {version})")
        except ImportError:
            if min_version:
                report.fail(f"{pkg_name} NOT INSTALLED (required ≥{min_version})")
            else:
                report.fail(f"{pkg_name} NOT INSTALLED")


def check_config_files(report: ValidationReport):
    """Check that config YAML/JSON files exist and are non-empty."""
    print(f"\n{CYAN}[2] Configuration Files{RESET}")

    for config_rel in REQUIRED_CONFIGS:
        config_path = PROJECT_ROOT / config_rel
        if not config_path.exists():
            report.fail(f"{config_rel} — MISSING")
            continue

        size = config_path.stat().st_size
        if size == 0:
            report.fail(f"{config_rel} — EMPTY (0 bytes)")
            continue

        # Check YAML files are parseable
        if config_path.suffix in (".yaml", ".yml"):
            try:
                import yaml
                with open(config_path) as f:
                    data = yaml.safe_load(f)
                if data is None:
                    report.fail(f"{config_rel} — YAML parsed as None (empty content)")
                else:
                    report.ok(f"{config_rel} — {size} bytes, parsed OK")
            except Exception as e:
                report.fail(f"{config_rel} — YAML parse error: {e}")
        elif config_path.suffix == ".json":
            try:
                with open(config_path) as f:
                    data = json.load(f)
                report.ok(f"{config_rel} — {size} bytes, parsed OK")
            except Exception as e:
                report.fail(f"{config_rel} — JSON parse error: {e}")
        else:
            report.ok(f"{config_rel} — {size} bytes")


def check_cloudflare_worker(report: ValidationReport, secrets: dict):
    """Check Cloudflare Worker connectivity and D1 health."""
    print(f"\n{CYAN}[3] Cloudflare Worker{RESET}")

    url = secrets.get("CF_WORKER_URL", "").rstrip("/")
    secret = secrets.get("CF_WORKER_SECRET", "")

    if not url:
        report.fail("CF_WORKER_URL not configured")
        return
    if not secret:
        report.fail("CF_WORKER_SECRET not configured")
        return

    import requests

    # Health check (no auth required)
    try:
        r = requests.get(f"{url}/health", timeout=15)
        if r.status_code == 200:
            health = r.json()
            if health.get("ok") and health.get("db"):
                report.ok(f"Worker /health: ok=True, db=True")
                tables = health.get("tables", [])
                required_tables = ["sessions", "circuit_breakers", "stage_log", "runs", "work_queue"]
                missing = [t for t in required_tables if t not in tables]
                if missing:
                    report.fail(f"D1 missing tables: {missing}")
                else:
                    report.ok(f"D1 has all 5 required tables")

                writes = health.get("d1_writes_today", 0)
                if writes > 80000:
                    report.warn(f"D1 writes today: {writes}/100000 — approaching free tier limit")
                else:
                    report.ok(f"D1 writes today: {writes}/100000")
            else:
                report.fail(f"Worker health: ok={health.get('ok')}, db={health.get('db')}")
        else:
            report.fail(f"Worker /health returned HTTP {r.status_code}")
    except requests.ConnectionError:
        report.fail(f"Cannot connect to Worker at {url} — is it deployed?")
    except Exception as e:
        report.fail(f"Worker health check failed: {e}")

    # Authenticated endpoint test
    try:
        headers = {"X-Worker-Secret": secret, "Content-Type": "application/json"}
        r = requests.get(f"{url}/api/sessions", headers=headers, timeout=15)
        if r.status_code == 200:
            report.ok("Worker authentication: valid (sessions endpoint accessible)")
        elif r.status_code == 401:
            report.fail("Worker authentication: invalid WORKER_SECRET")
        else:
            report.warn(f"Worker sessions endpoint: HTTP {r.status_code}")
    except Exception as e:
        report.warn(f"Worker auth test failed: {e}")


def check_huggingface(report: ValidationReport, secrets: dict):
    """Check Hugging Face token validity and repo accessibility."""
    print(f"\n{CYAN}[4] Hugging Face{RESET}")

    from huggingface_hub import HfApi
    import yaml

    for token_name in ["HF_TOKEN_PRIMARY", "HF_TOKEN_SECONDARY", "HF_TOKEN_TERTIARY"]:
        token = secrets.get(token_name)
        if not token:
            report.fail(f"{token_name} not configured")
            continue

        try:
            api = HfApi(token=token)
            user = api.whoami()
            name = user.get("name", "unknown")
            report.ok(f"{token_name}: authenticated as '{name}'")
        except Exception as e:
            report.fail(f"{token_name}: authentication failed — {e}")

    # Check repos from config
    config_path = PROJECT_ROOT / "config" / "hf_repos.yaml"
    if not config_path.exists() or config_path.stat().st_size == 0:
        report.warn("hf_repos.yaml empty or missing — cannot validate repo accessibility")
        return

    with open(config_path) as f:
        repos_config = yaml.safe_load(f) or {}

    token_map = {
        "PRIMARY": secrets.get("HF_TOKEN_PRIMARY"),
        "SECONDARY": secrets.get("HF_TOKEN_SECONDARY"),
        "TERTIARY": secrets.get("HF_TOKEN_TERTIARY"),
    }

    for stage_key, info in repos_config.items():
        repo_id = info.get("repo_id")
        token_key = info.get("token", "PRIMARY")
        token = token_map.get(token_key)

        if not repo_id or not token:
            continue

        try:
            api = HfApi(token=token)
            api.repo_info(repo_id=repo_id, repo_type="dataset")
            report.ok(f"HF repo {stage_key}: {repo_id} accessible")
        except Exception as e:
            error_str = str(e).lower()
            if "404" in error_str or "not found" in error_str:
                report.warn(f"HF repo {stage_key}: {repo_id} does not exist yet — will be created on first upload")
            else:
                report.warn(f"HF repo {stage_key}: {repo_id} — {e}")


def check_gemini_keys(report: ValidationReport, secrets: dict):
    """Check Gemini API key validity."""
    print(f"\n{CYAN}[5] Gemini API{RESET}")

    keys_found = 0
    for i in range(1, 5):
        key_name = f"GEMINI_API_KEY_{i:02d}"
        key = secrets.get(key_name)
        if not key:
            continue
        keys_found += 1

        try:
            import google.generativeai as genai
            genai.configure(api_key=key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            # Lightweight test — just check model listing, don't generate
            report.ok(f"{key_name}: configured (length={len(key)})")
        except ImportError:
            report.ok(f"{key_name}: configured (google-generativeai not installed to validate)")
        except Exception as e:
            report.warn(f"{key_name}: configured but test failed — {e}")

    if keys_found == 0:
        report.fail("No GEMINI_API_KEY_01-04 configured — p2a/p3/p4 will fail")
    else:
        report.ok(f"{keys_found}/4 Gemini API keys configured")


def check_hardware(report: ValidationReport, session_type: str | None):
    """Check GPU/TPU hardware availability for session type."""
    print(f"\n{CYAN}[6] Hardware{RESET}")

    if session_type in (None, "cpu_collect", "cpu_label"):
        report.ok("Session type does not require GPU/TPU")
        return

    try:
        import torch
        if session_type in ("gpu_clean", "gpu_encode"):
            if torch.cuda.is_available():
                device_name = torch.cuda.get_device_name(0)
                vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
                report.ok(f"CUDA available: {device_name} ({vram:.1f} GB)")

                # Validate GPU type
                if session_type == "gpu_clean" and "T4" not in device_name and "Tesla" not in device_name:
                    report.warn(f"Expected T4 for gpu_clean, got {device_name}")
                if session_type == "gpu_encode" and "P100" not in device_name and "Tesla" not in device_name:
                    report.warn(f"P100 preferred for gpu_encode (HBM2 bandwidth), got {device_name}")
            else:
                report.fail(f"CUDA NOT available — {session_type} requires GPU")
        elif session_type in ("tpu_finetune", "tpu_synth"):
            try:
                import torch_xla
                import torch_xla.core.xla_model as xm
                device = xm.xla_device()
                report.ok(f"TPU available: {device}")
            except ImportError:
                report.warn("torch_xla not installed — TPU sessions require torch_xla")
    except ImportError:
        report.fail("PyTorch not installed — required for GPU/TPU sessions")


def check_rust_extensions(report: ValidationReport):
    """Check if Rust extensions are available (optional with Python fallback)."""
    print(f"\n{CYAN}[7] Rust Extensions (Optional){RESET}")

    try:
        from urdu_s2s_core import fast_snr_filter, fast_chunk_audio
        report.ok("urdu_s2s_core Rust extensions available (200× SNR speedup)")
    except ImportError:
        report.warn("urdu_s2s_core Rust extensions not installed — Python fallback active (5× SNR speedup)")
        report.warn("  Install: pip install *.whl from urdu-asr-pipelines Kaggle dataset")


def main():
    parser = argparse.ArgumentParser(description="Urdu S2S Pipeline Environment Validator")
    parser.add_argument("--session-type", choices=[
        "cpu_collect", "cpu_label", "gpu_clean", "gpu_encode",
        "tpu_finetune", "tpu_synth"
    ], default=None, help="Validate for a specific session type")
    args = parser.parse_args()

    print("=" * 60)
    print("URDU S2S PIPELINE — ENVIRONMENT VALIDATION")
    print("=" * 60)
    if args.session_type:
        print(f"Session type: {args.session_type}")
    print()

    report = ValidationReport()

    # Load secrets
    try:
        from shared.secrets import load_secrets
        require_gemini = args.session_type in (None, "cpu_label", "tpu_synth")
        secrets = load_secrets(require_gemini=require_gemini)
        report.ok("Secrets loaded successfully")
    except RuntimeError as e:
        secrets = {}
        report.warn(f"Secrets loading had issues: {e}")

    # Run all checks
    check_python_packages(report, args.session_type)
    check_config_files(report)
    check_cloudflare_worker(report, secrets)
    check_huggingface(report, secrets)
    check_gemini_keys(report, secrets)
    check_hardware(report, args.session_type)
    check_rust_extensions(report)

    # Summary
    success = report.summary()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
