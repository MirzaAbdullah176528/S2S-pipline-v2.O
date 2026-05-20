#!/usr/bin/env python3
"""
stats_report.py — Pipeline Statistics Report Generator

Reads state from the Cloudflare D1 backend and Hugging Face repos to produce
a comprehensive status report for the Urdu S2S pipeline run.

Usage:
    python scripts/stats_report.py [--run-id RUN_ID] [--output FILE]
    python scripts/stats_report.py --run-id run_20260507_001 --output report.json
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def load_secrets_for_report():
    """Load secrets for API access (Kaggle Secrets → .env → env vars)."""
    secrets = {}
    try:
        from kaggle_secrets import UserSecretsClient
        client = UserSecretsClient()
        for key in ["CF_WORKER_URL", "CF_WORKER_SECRET", "HF_TOKEN_PRIMARY",
                     "HF_TOKEN_SECONDARY", "HF_TOKEN_TERTIARY"]:
            try:
                val = client.get_secret(key)
                if val:
                    secrets[key] = val
            except Exception:
                pass
        if secrets:
            return secrets
    except ImportError:
        pass

    from dotenv import load_dotenv
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        load_dotenv(env_file)

    for key in ["CF_WORKER_URL", "CF_WORKER_SECRET", "HF_TOKEN_PRIMARY",
                 "HF_TOKEN_SECONDARY", "HF_TOKEN_TERTIARY"]:
        val = os.environ.get(key)
        if val:
            secrets[key] = val

    return secrets


def fetch_worker_stats(secrets: dict) -> dict:
    """Fetch stats from the CF Worker /health and /api/sessions endpoints."""
    url = secrets.get("CF_WORKER_URL", "").rstrip("/")
    secret = secrets.get("CF_WORKER_SECRET", "")

    if not url or not secret:
        print("[stats] CF_WORKER_URL or CF_WORKER_SECRET not configured — skipping worker stats")
        return {}

    import requests

    headers = {"X-Worker-Secret": secret, "Content-Type": "application/json"}
    stats = {}

    # Health endpoint
    try:
        r = requests.get(f"{url}/health", headers=headers, timeout=15)
        if r.status_code == 200:
            health = r.json()
            stats["health"] = health
            print(f"[stats] Worker health: ok={health.get('ok')} db={health.get('db')}")
            print(f"  D1 writes today: {health.get('d1_writes_today', 0)}")
            print(f"  Active sessions: {health.get('active_sessions', 0)}")
            print(f"  Queue: {health.get('queue', {})}")
        else:
            print(f"[stats] Health check failed: HTTP {r.status_code}")
    except Exception as e:
        print(f"[stats] Failed to reach worker: {e}")

    # Sessions endpoint
    try:
        r = requests.get(f"{url}/api/sessions", headers=headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            sessions = data.get("sessions", [])
            stats["sessions"] = sessions

            # Group by session_type
            by_type = {}
            for s in sessions:
                st = s.get("session_type", "unknown")
                alive = s.get("alive", False)
                if st not in by_type:
                    by_type[st] = {"total": 0, "alive": 0}
                by_type[st]["total"] += 1
                if alive:
                    by_type[st]["alive"] += 1

            stats["sessions_by_type"] = by_type
            print(f"[stats] Sessions: {len(sessions)} total")
            for st, counts in by_type.items():
                print(f"  {st}: {counts['alive']} alive / {counts['total']} total")
    except Exception as e:
        print(f"[stats] Failed to fetch sessions: {e}")

    return stats


def fetch_run_stats(secrets: dict, run_id: str) -> dict:
    """Fetch detailed stats for a specific run from the CF Worker."""
    url = secrets.get("CF_WORKER_URL", "").rstrip("/")
    secret = secrets.get("CF_WORKER_SECRET", "")

    if not url or not secret:
        return {}

    import requests

    headers = {"X-Worker-Secret": secret, "Content-Type": "application/json"}
    stats = {}

    try:
        r = requests.get(f"{url}/api/run", params={"run_id": run_id}, headers=headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            stats["run"] = data.get("run")
            stats["stages"] = data.get("stages", [])
            stats["queue"] = data.get("queue", [])

            print(f"\n[stats] Run: {run_id}")
            if data.get("run"):
                run = data["run"]
                print(f"  Status: {run.get('status')}")
                print(f"  Target: {run.get('target_corpus_hours')}h")
                print(f"  Started: {run.get('started_at')}")

            if stats.get("stages"):
                print(f"\n  Stage Summary:")
                for s in stats["stages"]:
                    stage = s.get("stage_name", "?")
                    status = s.get("status", "?")
                    attempts = s.get("attempts", 0)
                    print(f"    {stage}: {status} ({attempts} attempts)")

            if stats.get("queue"):
                print(f"\n  Queue Summary:")
                for q in stats["queue"]:
                    stage = q.get("stage", "?")
                    status = q.get("status", "?")
                    count = q.get("cnt", 0)
                    print(f"    {stage}/{status}: {count}")
    except Exception as e:
        print(f"[stats] Failed to fetch run stats: {e}")

    return stats


def fetch_hf_repo_stats(secrets: dict) -> dict:
    """Fetch storage stats from Hugging Face repos."""
    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("[stats] huggingface_hub not installed — skipping HF stats")
        return {}

    import yaml

    config_path = PROJECT_ROOT / "config" / "hf_repos.yaml"
    if not config_path.exists():
        print("[stats] hf_repos.yaml not found — skipping HF stats")
        return {}

    with open(config_path) as f:
        repos_config = yaml.safe_load(f) or {}

    token_map = {
        "PRIMARY": secrets.get("HF_TOKEN_PRIMARY"),
        "SECONDARY": secrets.get("HF_TOKEN_SECONDARY"),
        "TERTIARY": secrets.get("HF_TOKEN_TERTIARY"),
    }

    stats = {}
    for stage_key, info in repos_config.get('repos', {}).items():
        repo_id = info.get("repo_id")
        token_key = info.get("token", "PRIMARY")
        token = token_map.get(token_key)

        if not repo_id or not token:
            continue

        try:
            api = HfApi(token=token)
            repo_info = api.repo_info(repo_id=repo_id, repo_type="dataset")
            size_bytes = getattr(repo_info, "size_on_disk", None) or 0
            size_gb = size_bytes / (1024 ** 3) if size_bytes else 0
            stats[stage_key] = {
                "repo_id": repo_id,
                "size_gb": round(size_gb, 2),
                "private": getattr(repo_info, "private", True),
            }
            print(f"[stats] HF {stage_key}: {repo_id} — {size_gb:.2f} GB")
        except Exception as e:
            stats[stage_key] = {"repo_id": repo_id, "error": str(e)}
            print(f"[stats] HF {stage_key}: error — {e}")

    return stats


def generate_report(secrets: dict, run_id: str | None) -> dict:
    """Generate the full stats report."""
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "run_id": run_id,
    }

    print("=" * 60)
    print("URDU S2S PIPELINE — STATUS REPORT")
    print("=" * 60)

    # Worker stats
    print("\n--- Cloudflare Worker ---")
    worker_stats = fetch_worker_stats(secrets)
    report["worker"] = worker_stats

    # Run-specific stats
    if run_id:
        print(f"\n--- Run: {run_id} ---")
        run_stats = fetch_run_stats(secrets, run_id)
        report["run_stats"] = run_stats

    # HF repo stats
    print("\n--- Hugging Face Repos ---")
    hf_stats = fetch_hf_repo_stats(secrets)
    report["hf_repos"] = hf_stats

    # Local checkpoint scan
    print("\n--- Local Checkpoints ---")
    checkpoints = {}
    for cp_file in PROJECT_ROOT.rglob("checkpoint*.json"):
        try:
            with open(cp_file) as f:
                cp_data = json.load(f)
            pid = cp_data.get("pipeline_id", cp_file.stem)
            checkpoints[pid] = {
                "processed": len(cp_data.get("processed_ids", [])),
                "uploaded": len(cp_data.get("uploaded_ids", [])),
                "failed": len(cp_data.get("failed_ids", [])),
                "wave_number": cp_data.get("wave_number", 0),
            }
            print(f"  {pid}: processed={checkpoints[pid]['processed']} "
                  f"uploaded={checkpoints[pid]['uploaded']} "
                  f"failed={checkpoints[pid]['failed']}")
        except Exception as e:
            print(f"  {cp_file.name}: error — {e}")
    report["checkpoints"] = checkpoints

    print("\n" + "=" * 60)
    print("END OF REPORT")
    print("=" * 60)

    return report


def main():
    parser = argparse.ArgumentParser(description="Urdu S2S Pipeline Stats Report")
    parser.add_argument("--run-id", default=None, help="Run ID to query (default: latest)")
    parser.add_argument("--output", "-o", default=None, help="Output JSON file path")
    args = parser.parse_args()

    secrets = load_secrets_for_report()
    report = generate_report(secrets, args.run_id)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False, default=str)
        print(f"\n[stats] Report saved to {output_path}")
    else:
        # Save to download directory
        default_path = PROJECT_ROOT / "stats_report.json"
        with open(default_path, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False, default=str)
        print(f"\n[stats] Report saved to {default_path}")


if __name__ == "__main__":
    main()
