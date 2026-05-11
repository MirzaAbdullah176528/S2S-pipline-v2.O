import json
import os
import time
import threading
from pathlib import Path
from huggingface_hub import HfApi


class CheckpointManager:
    def __init__(self, pipeline_id, local_path, hf_repo_id, hf_token, hf_filename="checkpoint.json"):
        self.pipeline_id = pipeline_id
        self.local_path = Path(local_path)
        self.hf_repo_id = hf_repo_id
        self.hf_token = hf_token
        self.hf_filename = hf_filename
        self.api = HfApi(token=hf_token)
        self._lock = threading.Lock()
        self.state = self._load()

    def _empty_state(self):
        return {
            "pipeline_id": self.pipeline_id,
            "processed_ids": [],
            "uploaded_ids": [],
            "failed_ids": [],
            "wave_number": 1,
            "next_seq": 1,
            "stats": {},
            "last_updated": None,
        }

    def _load(self):
        if self.local_path.exists():
            try:
                with open(self.local_path) as f:
                    state = json.load(f)
                print(f"[checkpoint] local — processed={len(state.get('processed_ids', []))} uploaded={len(state.get('uploaded_ids', []))}")
                return state
            except Exception:
                pass

        try:
            import requests
            url = f"https://huggingface.co/datasets/{self.hf_repo_id}/resolve/main/{self.hf_filename}"
            r = requests.get(url, headers={"Authorization": f"Bearer {self.hf_token}"}, timeout=30)
            if r.status_code == 200:
                state = r.json()
                with open(self.local_path, "w") as f:
                    json.dump(state, f)
                print(f"[checkpoint] HF fallback — processed={len(state.get('processed_ids', []))} uploaded={len(state.get('uploaded_ids', []))}")
                return state
        except Exception:
            pass

        print("[checkpoint] fresh start")
        return self._empty_state()

    def save(self, upload_to_hf=True):
        with self._lock:
            self.state["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            tmp = str(self.local_path) + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.state, f)
            os.replace(tmp, str(self.local_path))

        if not upload_to_hf:
            return

        for attempt in range(8):
            try:
                payload = json.dumps(self.state).encode()
                self.api.upload_file(
                    path_or_fileobj=payload,
                    path_in_repo=self.hf_filename,
                    repo_id=self.hf_repo_id,
                    repo_type="dataset",
                    commit_message="checkpoint update",
                )
                return
            except Exception as e:
                wait = min(2 ** attempt, 60)
                print(f"[checkpoint] save attempt {attempt + 1}/8 failed: {e} — retry in {wait}s")
                time.sleep(wait)

    def is_done(self, id_):
        with self._lock:
            return id_ in self.state["processed_ids"]

    def is_uploaded(self, id_):
        with self._lock:
            return id_ in self.state["uploaded_ids"]

    def mark_done(self, id_):
        with self._lock:
            if id_ not in self.state["processed_ids"]:
                self.state["processed_ids"].append(id_)

    def mark_uploaded(self, id_):
        with self._lock:
            if id_ not in self.state["uploaded_ids"]:
                self.state["uploaded_ids"].append(id_)

    def mark_failed(self, id_):
        with self._lock:
            if id_ not in self.state["failed_ids"]:
                self.state["failed_ids"].append(id_)

    def next_seq(self):
        with self._lock:
            n = self.state["next_seq"]
            self.state["next_seq"] += 1
            return n

    def increment_stat(self, key, by=1):
        with self._lock:
            self.state["stats"][key] = self.state["stats"].get(key, 0) + by

    def get_stat(self, key):
        with self._lock:
            return self.state["stats"].get(key, 0)

    def print_stats(self):
        with self._lock:
            print(f"\n[checkpoint] pipeline={self.pipeline_id}")
            print(f"  processed : {len(self.state['processed_ids'])}")
            print(f"  uploaded  : {len(self.state['uploaded_ids'])}")
            print(f"  failed    : {len(self.state['failed_ids'])}")
            print(f"  next_seq  : {self.state['next_seq']}")
            for k, v in self.state["stats"].items():
                print(f"  {k:<20}: {v}")
            print()