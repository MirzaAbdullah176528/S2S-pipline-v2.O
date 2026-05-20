PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'001_base_schema.sql','2026-05-11 18:13:21');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'002_work_queue.sql','2026-05-11 18:15:15');
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT DEFAULT 'run_default',
  session_type TEXT DEFAULT 'gpu',
  last_heartbeat INTEGER,
  gpu_type TEXT,
  vram_limit_gb REAL,
  status TEXT DEFAULT 'active'
);
INSERT INTO "sessions" ("id","run_id","session_type","last_heartbeat","gpu_type","vram_limit_gb","status") VALUES('cpu_collect_01','run_20260507_001','cpu_collect',1779268497,NULL,0,'active');
CREATE TABLE circuit_breakers (
  api_name TEXT PRIMARY KEY,
  state TEXT DEFAULT 'closed',
  failure_count INTEGER DEFAULT 0,
  last_failure_at INTEGER,
  opened_at INTEGER,
  cooldown_until INTEGER
);
CREATE TABLE stage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  session_id TEXT,
  stage_name TEXT,
  status TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  error_message TEXT
);
INSERT INTO "stage_log" ("id","run_id","session_id","stage_name","status","started_at","ended_at","error_message") VALUES(1,'run_20260507_001','cpu_collect_01','p1a','started',1779181829,NULL,NULL);
INSERT INTO "stage_log" ("id","run_id","session_id","stage_name","status","started_at","ended_at","error_message") VALUES(2,'run_20260507_001','cpu_collect_01','p1a','failed',1779181829,1779181829,'name ''null'' is not defined');
INSERT INTO "stage_log" ("id","run_id","session_id","stage_name","status","started_at","ended_at","error_message") VALUES(3,'run_20260507_001','cpu_collect_01','p1a','started',1779208694,NULL,NULL);
INSERT INTO "stage_log" ("id","run_id","session_id","stage_name","status","started_at","ended_at","error_message") VALUES(4,'run_20260507_001','cpu_collect_01','p1a','failed',1779208694,1779208695,'name ''null'' is not defined');
INSERT INTO "stage_log" ("id","run_id","session_id","stage_name","status","started_at","ended_at","error_message") VALUES(5,'run_20260507_001','cpu_collect_01','p1a','started',1779268497,NULL,NULL);
INSERT INTO "stage_log" ("id","run_id","session_id","stage_name","status","started_at","ended_at","error_message") VALUES(6,'run_20260507_001','cpu_collect_01','p1a','failed',1779268497,1779268502,'Missing secrets: [''GEMINI_API_KEY'']');
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  started_at INTEGER DEFAULT (unixepoch()),
  target_corpus_hours INTEGER,
  status TEXT DEFAULT 'running',
  config TEXT
);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260517_1713',1779037992,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260517_1806',1779041203,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260517_1812',1779041566,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260517_1819',1779041959,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260517_1827',1779042433,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260518_1719',1779124784,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260518_1721',1779124893,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260518_1722',1779124938,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260518_1725',1779125108,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260518_1727',1779125267,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260518_1732',1779125545,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260518_1736',1779125795,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_0657',1779173871,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_0710',1779174616,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_0733',1779176026,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_0840',1779180023,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_0847',1779180426,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_0901',1779181294,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_0909',1779181792,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260519_1637',1779208654,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260520_0914',1779268467,10000,'running',NULL);
INSERT INTO "runs" ("run_id","started_at","target_corpus_hours","status","config") VALUES('run_20260507_001',1779268497,10000,'running','{}');
CREATE TABLE work_queue (
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
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',2);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('stage_log',6);
CREATE INDEX idx_wq_lease ON work_queue
  (pipeline, stage, status, shard_key, priority, created_at);
CREATE INDEX idx_wq_expire ON work_queue(lease_expires_at)
  WHERE status = 'leased';
CREATE INDEX idx_wq_cap ON work_queue(global_cap_key, status)
  WHERE status = 'leased';
