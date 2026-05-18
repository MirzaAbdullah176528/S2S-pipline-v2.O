import gc
import os
import threading
import time
from typing import Callable

from shared.cf_client import CFClient


class MemoryPressureError(RuntimeError):
    pass


class SessionExpiredError(RuntimeError):
    pass


class WorkflowKernel:
    HEARTBEAT_INTERVAL_SEC   = 30
    WATCHDOG_INTERVAL_SEC    = 60
    GC_GPU_THRESHOLD         = 0.92
    VRAM_WARN_THRESHOLD      = 0.85
    WATCHDOG_ESCALATION_CNT  = 3

    def __init__(
        self,
        run_id: str,
        session_id: str,
        session_type: str,
        shard_key: str,
        cf_worker_url: str,
        cf_worker_secret: str,
        gpu_type: str | None = None,
        vram_limit_gb: float = 0.0,
        session_max_hours: float = 8.5,
    ):
        self.run_id           = run_id
        self.session_id       = session_id
        self.session_type     = session_type
        self.shard_key        = shard_key
        self.gpu_type         = gpu_type
        self.vram_limit_gb    = vram_limit_gb
        self.session_max_sec  = session_max_hours * 3600

        self._cf = CFClient(cf_worker_url, cf_worker_secret, session_id)

        self._started_at      = time.monotonic()
        self._gc_requested    = False
        self._session_expiring = False
        self._watchdog_high_cnt = 0

        self._subprocesses: list = []
        self._subprocess_lock = threading.Lock()

        self._heartbeat_thread: threading.Thread | None = None
        self._watchdog_thread: threading.Thread | None  = None
        self._running = False

    def start(self) -> None:
        self._running = True
        self._cf.create_run(self.run_id)

        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, daemon=True, name=f"hb-{self.session_id}"
        )
        self._heartbeat_thread.start()

        if self.gpu_type:
            self._watchdog_thread = threading.Thread(
                target=self._watchdog_loop, daemon=True, name=f"wd-{self.session_id}"
            )
            self._watchdog_thread.start()

        print(f"[kernel] started session={self.session_id} run={self.run_id} type={self.session_type}")

    def stop(self) -> None:
        self._running = False
        self._cf.heartbeat(
            run_id=self.run_id,
            session_type=self.session_type,
            status="stopped",
            gpu_type=self.gpu_type,
            vram_limit_gb=self.vram_limit_gb,
        )
        print(f"[kernel] stopped session={self.session_id}")

    @property
    def session_expiring(self) -> bool:
        return self._session_expiring

    @property
    def elapsed_hours(self) -> float:
        return (time.monotonic() - self._started_at) / 3600.0

    def check_session_time(self) -> None:
        elapsed = time.monotonic() - self._started_at
        early_warn = self.session_max_sec * (7.5 / 8.5)
        if elapsed > self.session_max_sec:
            raise SessionExpiredError(f"Session exceeded {self.session_max_sec/3600:.1f}h limit")
        if elapsed > early_warn:
            self._session_expiring = True

    def register_subprocess(self, proc) -> None:
        with self._subprocess_lock:
            self._subprocesses.append(proc)

    def unregister_subprocess(self, proc) -> None:
        with self._subprocess_lock:
            try:
                self._subprocesses.remove(proc)
            except ValueError:
                pass

    def flush_memory(self) -> None:
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
        except ImportError:
            pass
        self._gc_requested = False

    def safe_transcribe_batch(self, model, paths: list, batch_size: int = 8) -> list:
        try:
            import torch
            props = torch.cuda.get_device_properties(0)
            util  = torch.cuda.memory_allocated(0) / props.total_memory
            if util > self.VRAM_WARN_THRESHOLD:
                torch.cuda.empty_cache()
                time.sleep(3)
                util = torch.cuda.memory_allocated(0) / props.total_memory
            if util > self.VRAM_WARN_THRESHOLD:
                batch_size = 1
        except (ImportError, Exception):
            pass

        results = []
        for i in range(0, len(paths), batch_size):
            batch = paths[i:i + batch_size]
            segs, info = model.transcribe(str(batch[0]) if len(batch) == 1 else batch[0])
            results.append((list(segs), info))
        return results

    def log_stage_start(self, stage_name: str) -> int:
        ts = int(time.time())
        self._cf.stage_log(self.run_id, stage_name, "started", started_at=ts)
        return ts

    def log_stage_end(self, stage_name: str, started_at: int, error: str | None = None) -> None:
        ts     = int(time.time())
        status = "failed" if error else "completed"
        self._cf.stage_log(self.run_id, stage_name, status,
                           started_at=started_at, ended_at=ts, error_message=error)

    def queue_lease(self, pipeline: str, stage: str, n: int = 1) -> list[dict]:
        return self._cf.queue_lease(self.run_id, pipeline, stage, self.shard_key, n)

    def queue_ack(self, item_ids: list[str]) -> None:
        self._cf.queue_ack(item_ids)

    def queue_nack(self, item_ids: list[str], error: str = "") -> None:
        self._cf.queue_nack(item_ids, error)

    def cb_failure(self, api_name: str) -> dict:
        return self._cf.cb_record_failure(api_name)

    def cb_success(self, api_name: str) -> dict:
        return self._cf.cb_record_success(api_name)

    def get_gemini_key(self, secrets: dict) -> str:
        slot   = self._cf.get_key_slot()
        envvar = f"GEMINI_API_KEY_{slot}"
        key    = secrets.get(envvar) or os.environ.get(envvar, "")
        if not key:
            for fallback in ["01","02","03","04"]:
                k = secrets.get(f"GEMINI_API_KEY_{fallback}") or os.environ.get(f"GEMINI_API_KEY_{fallback}", "")
                if k:
                    return k
        return key

    def _heartbeat_loop(self) -> None:
        while self._running:
            try:
                resp = self._cf.heartbeat(
                    run_id=self.run_id,
                    session_type=self.session_type,
                    status="active",
                    gpu_type=self.gpu_type,
                    vram_limit_gb=self.vram_limit_gb,
                )
                open_breakers = resp.get("open_breakers", {})
                if open_breakers:
                    print(f"[kernel] open circuit breakers: {list(open_breakers.keys())}")
            except Exception as e:
                print(f"[kernel] heartbeat failed: {e}")

            elapsed = time.monotonic() - self._started_at
            if elapsed > self.session_max_sec * (7.5 / 8.5):
                self._session_expiring = True

            time.sleep(self.HEARTBEAT_INTERVAL_SEC)

    def _watchdog_loop(self) -> None:
        while self._running:
            try:
                import torch
                if torch.cuda.is_available():
                    props  = torch.cuda.get_device_properties(0)
                    util   = torch.cuda.memory_allocated(0) / props.total_memory
                    if util > self.GC_GPU_THRESHOLD:
                        self._gc_requested = True
                        self._watchdog_high_cnt += 1
                        if self._watchdog_high_cnt >= self.WATCHDOG_ESCALATION_CNT:
                            print(f"[watchdog] GPU util {util:.1%} for {self._watchdog_high_cnt} samples — escalating")
                            raise MemoryPressureError(f"GPU util {util:.1%} sustained — memory pressure")
                    else:
                        self._watchdog_high_cnt = 0
            except MemoryPressureError:
                raise
            except Exception as e:
                print(f"[watchdog] error: {e}")

            with self._subprocess_lock:
                dead = [p for p in self._subprocesses if p.poll() is not None]
                for p in dead:
                    self._subprocesses.remove(p)

            time.sleep(self.WATCHDOG_INTERVAL_SEC)
