import json
import os
import threading
import time
from typing import Any

import requests


class CFClient:
    def __init__(self, worker_url: str, worker_secret: str, session_id: str):
        self._url    = worker_url.rstrip("/")
        self._secret = worker_secret
        self._sid    = session_id
        self._sess   = requests.Session()
        self._sess.headers.update({
            "X-Worker-Secret": self._secret,
            "Content-Type": "application/json",
        })

    def _post(self, path: str, body: dict, retries: int = 5) -> dict:
        for attempt in range(retries):
            try:
                r = self._sess.post(f"{self._url}{path}", json=body, timeout=15)
                if r.status_code == 429:
                    time.sleep(min(2 ** attempt, 30))
                    continue
                r.raise_for_status()
                return r.json()
            except Exception as e:
                if attempt == retries - 1:
                    raise
                time.sleep(min(2 ** attempt, 15))
        return {}

    def _get(self, path: str, params: dict | None = None, retries: int = 5) -> dict:
        for attempt in range(retries):
            try:
                r = self._sess.get(f"{self._url}{path}", params=params, timeout=15)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                if attempt == retries - 1:
                    raise
                time.sleep(min(2 ** attempt, 15))
        return {}

    def heartbeat(self, run_id: str, session_type: str, status: str = "active",
                  gpu_type: str | None = None, vram_limit_gb: float = 0.0) -> dict:
        return self._post("/heartbeat", {
            "session_id":   self._sid,
            "run_id":       run_id,
            "session_type": session_type,
            "status":       status,
            "gpu_type":     gpu_type,
            "vram_limit_gb": vram_limit_gb,
        })

    def health(self) -> dict:
        r = self._sess.get(f"{self._url}/health", timeout=10)
        r.raise_for_status()
        return r.json()

    def queue_push(self, run_id: str, items: list[dict]) -> dict:
        return self._post("/queue/push", {"run_id": run_id, "items": items})

    def queue_lease(self, run_id: str, pipeline: str, stage: str,
                    shard_key: str = "cpu", n: int = 1) -> list[dict]:
        resp = self._post("/queue/lease", {
            "session_id": self._sid,
            "run_id":     run_id,
            "pipeline":   pipeline,
            "stage":      stage,
            "shard_key":  shard_key,
            "n":          n,
        })
        return resp.get("items", [])

    def queue_ack(self, item_ids: list[str]) -> dict:
        return self._post("/queue/ack", {"session_id": self._sid, "item_ids": item_ids})

    def queue_nack(self, item_ids: list[str], error: str = "") -> dict:
        return self._post("/queue/nack", {
            "session_id": self._sid,
            "item_ids":   item_ids,
            "error":      error,
        })

    def cb_record_failure(self, api_name: str) -> dict:
        return self._post("/circuit-breaker", {
            "api_name":   api_name,
            "action":     "record_failure",
            "session_id": self._sid,
        })

    def cb_record_success(self, api_name: str) -> dict:
        return self._post("/circuit-breaker", {
            "api_name":   api_name,
            "action":     "record_success",
            "session_id": self._sid,
        })

    def cb_get_state(self, api_name: str) -> dict:
        return self._post("/circuit-breaker", {
            "api_name":   api_name,
            "action":     "get_state",
            "session_id": self._sid,
        })

    def stage_log(self, run_id: str, stage_name: str, status: str,
                  started_at: int | None = None, ended_at: int | None = None,
                  error_message: str | None = None) -> dict:
        ts = int(time.time())
        return self._post("/stage-log", {
            "run_id":       run_id,
            "session_id":   self._sid,
            "stage_name":   stage_name,
            "status":       status,
            "started_at":   started_at or ts,
            "ended_at":     ended_at,
            "error_message": error_message,
        })

    def get_key_slot(self) -> str:
        resp = self._get("/api/key-slot", params={"session_id": self._sid})
        return resp.get("key_slot", "01")

    def create_run(self, run_id: str, target_corpus_hours: int = 10000,
                   config: dict | None = None) -> dict:
        return self._post("/api/run", {
            "run_id":               run_id,
            "target_corpus_hours":  target_corpus_hours,
            "config":               config or {},
        })

    def get_run(self, run_id: str) -> dict:
        return self._get("/api/run", params={"run_id": run_id})

    def get_sessions(self) -> list[dict]:
        resp = self._get("/api/sessions")
        return resp.get("sessions", [])
