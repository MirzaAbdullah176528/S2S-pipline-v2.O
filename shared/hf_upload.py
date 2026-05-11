import time
import threading
from pathlib import Path
from huggingface_hub import HfApi, CommitOperationAdd

WAVE_SIZE_BYTES = 500 * 1024 * 1024
BATCH_SIZE = 50
MAX_RETRIES = 12
COMMIT_DELAY = 3.0


class WaveUploader:
    def __init__(self, repo_id, hf_token, repo_subdir="", checkpoint_manager=None):
        self.repo_id = repo_id
        self.repo_subdir = repo_subdir.strip("/")
        self.cp = checkpoint_manager
        self.api = HfApi(token=hf_token)
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()
        self._files = []
        self._bytes = 0
        self._wave_num = 1

    def _repo_path(self, filename):
        if self.repo_subdir:
            return f"{self.repo_subdir}/{filename}"
        return filename

    def add(self, local_path, repo_filename=None):
        local_path = Path(local_path)
        if not local_path.exists():
            return False

        size = local_path.stat().st_size
        repo_filename = repo_filename or local_path.name
        should_flush = False

        with self._lock:
            self._files.append((local_path, self._repo_path(repo_filename)))
            self._bytes += size
            if self._bytes >= WAVE_SIZE_BYTES:
                should_flush = True

        if should_flush:
            self.flush(force=True)
        return True

    def flush(self, force=False):
        if not self._flush_lock.acquire(blocking=False):
            return

        try:
            with self._lock:
                if not self._files:
                    return
                if not force and self._bytes < WAVE_SIZE_BYTES:
                    return
                files_snap = list(self._files)
                wave_num = self._wave_num
                self._files.clear()
                self._bytes = 0
                self._wave_num += 1

            total_size_mb = sum(Path(lp).stat().st_size for lp, _ in files_snap if Path(lp).exists()) / 1024 / 1024
            print(f"\n[upload] wave {wave_num} — {len(files_snap)} files ({total_size_mb:.1f} MB)")

            batches = [files_snap[i:i + BATCH_SIZE] for i in range(0, len(files_snap), BATCH_SIZE)]
            committed = 0

            for idx, batch in enumerate(batches):
                ops = [
                    CommitOperationAdd(path_in_repo=repo_path, path_or_fileobj=str(local_path))
                    for local_path, repo_path in batch
                    if Path(local_path).exists()
                ]
                if not ops:
                    continue

                for attempt in range(MAX_RETRIES):
                    try:
                        self.api.create_commit(
                            repo_id=self.repo_id,
                            repo_type="dataset",
                            commit_message=f"wave {wave_num} batch {idx + 1}/{len(batches)}",
                            operations=ops,
                        )
                        time.sleep(COMMIT_DELAY)

                        if self.cp:
                            for local_path, _ in batch:
                                self.cp.mark_uploaded(Path(local_path).stem)

                        committed += len(ops)
                        print(f"[upload] wave {wave_num} batch {idx + 1}/{len(batches)} — {len(ops)} files OK")
                        break
                    except Exception as e:
                        if attempt == MAX_RETRIES - 1:
                            print(f"[upload] wave {wave_num} batch {idx + 1} FAILED: {e}")
                            if self.cp:
                                for local_path, _ in batch:
                                    self.cp.mark_failed(Path(local_path).stem)
                            break
                        wait = min(2 ** attempt, 120)
                        print(f"[upload] attempt {attempt + 1}/{MAX_RETRIES} failed: {e} — retry in {wait}s")
                        time.sleep(wait)

            for local_path, _ in files_snap:
                Path(local_path).unlink(missing_ok=True)

            print(f"[upload] wave {wave_num} complete — {committed}/{len(files_snap)} committed, buffer cleared\n")
        finally:
            self._flush_lock.release()

    def pending_count(self):
        with self._lock:
            return len(self._files)

    def pending_bytes(self):
        with self._lock:
            return self._bytes