ALTER TABLE sessions ADD COLUMN run_id TEXT DEFAULT 'run_default';
ALTER TABLE sessions ADD COLUMN session_type TEXT DEFAULT 'gpu';

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  started_at INTEGER DEFAULT (unixepoch()),
  target_corpus_hours INTEGER,
  status TEXT DEFAULT 'running',
  config TEXT
);

CREATE TABLE IF NOT EXISTS work_queue (
  item_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  stage TEXT NOT NULL,
  shard_key TEXT DEFAULT 'cpu',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','leased','done','failed')),
  leased_by TEXT,
  lease_expires_at INTEGER,
  retry_count INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 5,
  global_cap_key TEXT,
  payload TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_wq_lease ON work_queue
  (pipeline, stage, status, shard_key, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_wq_expire ON work_queue(lease_expires_at)
  WHERE status = 'leased';

CREATE INDEX IF NOT EXISTS idx_wq_cap ON work_queue(global_cap_key, status)
  WHERE status = 'leased';
