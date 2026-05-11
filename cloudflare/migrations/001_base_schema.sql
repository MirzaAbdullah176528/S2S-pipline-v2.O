CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT DEFAULT 'run_default',
  session_type TEXT DEFAULT 'gpu',
  last_heartbeat INTEGER,
  gpu_type TEXT,
  vram_limit_gb REAL,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS circuit_breakers (
  api_name TEXT PRIMARY KEY,
  state TEXT DEFAULT 'closed',
  failure_count INTEGER DEFAULT 0,
  last_failure_at INTEGER,
  opened_at INTEGER,
  cooldown_until INTEGER
);

CREATE TABLE IF NOT EXISTS stage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  session_id TEXT,
  stage_name TEXT,
  status TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  error_message TEXT
);
