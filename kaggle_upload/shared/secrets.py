import os
from pathlib import Path


REQUIRED_KEYS = [
    "HF_TOKEN_PRIMARY",
    "HF_TOKEN_SECONDARY",
    "HF_TOKEN_TERTIARY",
    "GEMINI_API_KEY_01",
    "CF_WORKER_URL",
    "CF_WORKER_SECRET",
]

OPTIONAL_KEYS = [
    "GEMINI_API_KEY_02",
    "GEMINI_API_KEY_03",
    "GEMINI_API_KEY_04",
    "PROXY_URL",
]


def load_secrets(require_gemini: bool = True) -> dict[str, str]:
    try:
        from kaggle_secrets import UserSecretsClient
        client = UserSecretsClient()
        secrets: dict[str, str] = {}

        all_keys = REQUIRED_KEYS + OPTIONAL_KEYS
        for key in all_keys:
            try:
                val = client.get_secret(key)
                if val:
                    secrets[key] = val
            except Exception:
                pass

        if secrets:
            print(f"[secrets] loaded {len(secrets)} keys from Kaggle Secrets")
            _validate(secrets, require_gemini)
            return secrets
    except ImportError:
        pass

    env_file = Path(".env")
    if env_file.exists():
        from dotenv import load_dotenv
        load_dotenv(env_file)
        print("[secrets] loaded from .env")

    secrets = {k: os.environ[k] for k in REQUIRED_KEYS + OPTIONAL_KEYS if os.environ.get(k)}
    _validate(secrets, require_gemini)
    return secrets


def _validate(secrets: dict[str, str], require_gemini: bool) -> None:
    base_required = ["HF_TOKEN_PRIMARY", "HF_TOKEN_SECONDARY", "HF_TOKEN_TERTIARY",
                     "CF_WORKER_URL", "CF_WORKER_SECRET"]
    missing = [k for k in base_required if not secrets.get(k)]

    if require_gemini:
        has_gemini = any(secrets.get(f"GEMINI_API_KEY_{s:02d}") for s in range(1, 5))
        if not has_gemini:
            missing.append("GEMINI_API_KEY_01 (or 02/03/04)")

    if missing:
        raise RuntimeError(f"[secrets] Missing required secrets: {missing}")
