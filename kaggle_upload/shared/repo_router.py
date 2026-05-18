import threading


OVERFLOW_THRESHOLD_BYTES = 250 * 1024 ** 3


class RepoRouter:
    def __init__(self, stage0_repo: str, overflow_repo: str):
        self._stage0_repo    = stage0_repo
        self._overflow_repo  = overflow_repo
        self._committed_bytes = 0
        self._using_overflow  = False
        self._lock            = threading.Lock()

    def record_commit(self, size_bytes: int) -> None:
        with self._lock:
            self._committed_bytes += size_bytes
            if self._committed_bytes > OVERFLOW_THRESHOLD_BYTES:
                if not self._using_overflow:
                    print(f"[repo_router] threshold {OVERFLOW_THRESHOLD_BYTES/1024**3:.0f}GB exceeded "
                          f"({self._committed_bytes/1024**3:.1f}GB) — switching to overflow repo")
                self._using_overflow = True

    @property
    def target_repo(self) -> str:
        with self._lock:
            return self._overflow_repo if self._using_overflow else self._stage0_repo

    @property
    def using_overflow(self) -> bool:
        with self._lock:
            return self._using_overflow

    @property
    def committed_gb(self) -> float:
        with self._lock:
            return self._committed_bytes / 1024 ** 3
