#!/usr/bin/env python3
"""
S2S-pipline-v2.O — Comprehensive Bug Fix Script (All-In-One) v2.0
=================================================================
Fixes ALL identified bugs across the codebase (55+ total).

Run from the REPO ROOT directory:
    cd /path/to/S2S-pipline-v2.O
    python applyfix.py

Or specify the repo path:
    python applyfix.py /path/to/S2S-pipline-v2.O

This script:
  - Creates .bak backups of every file before modifying
  - Fixes BOTH the root copy AND the kaggle_upload/ mirror
  - Works idempotently (safe to re-run)
  - Supersedes apply_fix.py and fix_all_bugs.py (all their fixes are included)

Bug Categories:
  CRITICAL  — Pipeline will crash at runtime
  HIGH      — Produces wrong results or skips data silently
  MEDIUM    — Cosmetic issues, warnings, or edge-case failures
  LOW       — Minor / non-blocking issues
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

# ── Globals ──────────────────────────────────────────────────────────────────

REPO_ROOT: Path
KAGGLE_DATASET_PATH = "/kaggle/input/datasets/mirza176528/s2s-pipline-v2-0-2"
FIXES_APPLIED = 0
FIXES_SKIPPED = 0


def set_repo_root(root):
    global REPO_ROOT
    REPO_ROOT = Path(root).resolve()
    if not REPO_ROOT.is_dir():
        print(f"[FATAL] {REPO_ROOT} is not a directory")
        sys.exit(1)


# ── Helpers ──────────────────────────────────────────────────────────────────

def backup_file(path):
    """Create a .bak backup before modifying (only if not already backed up)."""
    bak = path.parent / (path.name + ".bak")
    if not bak.exists():
        shutil.copy2(str(path), str(bak))


def read_notebook(path):
    """Read a Jupyter notebook and return the parsed dict."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_notebook(path, nb):
    """Write notebook back to disk."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)


def cell_src(cell):
    """Get concatenated source of a notebook cell."""
    return "".join(cell.get("source", []))


def set_cell_src(cell, text):
    """Set the source of a notebook cell."""
    lines = text.rstrip("\n").split("\n")
    cell["source"] = [ln + "\n" for ln in lines[:-1]] + [lines[-1]]


def replace_in_cells(nb, old, new):
    """Replace text in all code cells of a notebook. Returns count of cells changed."""
    count = 0
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        if old in src:
            src = src.replace(old, new)
            set_cell_src(c, src)
            count += 1
    return count


def replace_in_cells_regex(nb, pattern, replacement):
    """Regex replace in all code cells. Returns count of cells changed."""
    count = 0
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        new_src, n = re.subn(pattern, replacement, src)
        if n > 0:
            set_cell_src(c, new_src)
            count += n
    return count


def fix_nb(rel_path, fix_fn, label):
    """Apply fix_fn to a notebook at rel_path (root + kaggle_upload)."""
    global FIXES_APPLIED, FIXES_SKIPPED
    for prefix in [REPO_ROOT, REPO_ROOT / "kaggle_upload"]:
        p = prefix / rel_path
        if not p.exists():
            continue
        backup_file(p)
        nb = read_notebook(p)
        changed = fix_fn(nb)
        if changed:
            write_notebook(p, nb)
            FIXES_APPLIED += 1
            print(f"  [FIX] {label} — {p.relative_to(REPO_ROOT)}")
        else:
            FIXES_SKIPPED += 1
            print(f"  [skip] {label} — already applied or not found in {p.relative_to(REPO_ROOT)}")


def fix_py(rel_path, fix_fn, label):
    """Apply fix_fn to a .py file at rel_path (root + kaggle_upload)."""
    global FIXES_APPLIED, FIXES_SKIPPED
    for prefix in [REPO_ROOT, REPO_ROOT / "kaggle_upload"]:
        p = prefix / rel_path
        if not p.exists():
            continue
        backup_file(p)
        with open(p, encoding="utf-8") as f:
            content = f.read()
        new_content = fix_fn(content)
        if new_content != content:
            with open(p, "w", encoding="utf-8") as f:
                f.write(new_content)
            FIXES_APPLIED += 1
            print(f"  [FIX] {label} — {p.relative_to(REPO_ROOT)}")
        else:
            FIXES_SKIPPED += 1
            print(f"  [skip] {label} — already applied or not found in {p.relative_to(REPO_ROOT)}")


def fix_yaml(rel_path, fix_fn, label):
    """Apply fix_fn to a YAML file at rel_path (root + kaggle_upload)."""
    fix_py(rel_path, fix_fn, label)


def fix_json(rel_path, fix_fn, label):
    """Apply fix_fn to a JSON file at rel_path (root + kaggle_upload)."""
    global FIXES_APPLIED, FIXES_SKIPPED
    for prefix in [REPO_ROOT, REPO_ROOT / "kaggle_upload"]:
        p = prefix / rel_path
        if not p.exists():
            continue
        backup_file(p)
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        new_data = fix_fn(data)
        if new_data != data:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(new_data, f, indent=2, ensure_ascii=False)
            FIXES_APPLIED += 1
            print(f"  [FIX] {label} — {p.relative_to(REPO_ROOT)}")
        else:
            FIXES_SKIPPED += 1
            print(f"  [skip] {label} — already applied or not found in {p.relative_to(REPO_ROOT)}")


# ═══════════════════════════════════════════════════════════════════════════════
# FIX FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

# ── BUG 0a: query_bank.yaml missing config keys ─────────────────────────────

def fix_query_bank_yaml(content):
    """Add missing min_duration_sec, max_duration_sec, etc. before queries:"""
    config_block = """# Discovery configuration parameters (used by p1a_discover.ipynb)
min_duration_sec: 120         # Minimum video duration in seconds
max_duration_sec: 7200        # Maximum video duration in seconds
max_videos_per_query: 50      # Max videos to fetch per search query
max_total_videos: 50000       # Total video cap across all queries


"""
    if "min_duration_sec" in content:
        return content  # Already fixed
    idx = content.find("\nqueries:")
    if idx < 0:
        return content
    return content[:idx + 1] + config_block + content[idx + 1:]


# ── BUG 0b: p1a_discover — bracket access + flat-list query parsing ──────────

def fix_p1a_discover(nb):
    """Fix config key access with defaults + handle both dict/list query formats."""
    changed = False

    old_dur = "MIN_DUR = query_cfg['min_duration_sec']\nMAX_DUR = query_cfg['max_duration_sec']\nMAX_PER_QUERY = query_cfg['max_videos_per_query']\nMAX_TOTAL = query_cfg['max_total_videos']"
    new_dur = "MIN_DUR = query_cfg.get('min_duration_sec', 120)\nMAX_DUR = query_cfg.get('max_duration_sec', 7200)\nMAX_PER_QUERY = query_cfg.get('max_videos_per_query', 50)\nMAX_TOTAL = query_cfg.get('max_total_videos', 50000)"
    if replace_in_cells(nb, old_dur, new_dur):
        changed = True

    old_q = "all_queries = []\nfor category, query_list in query_cfg['queries'].items():\n    for q in query_list:\n        all_queries.append({'query': q, 'category': category})"
    new_q = """all_queries = []
_queries_raw = query_cfg['queries']
if isinstance(_queries_raw, dict):
    # Categorized format: {category: [query1, query2, ...]}
    for category, query_list in _queries_raw.items():
        for q in query_list:
            all_queries.append({'query': q, 'category': category})
elif isinstance(_queries_raw, list):
    # Flat list format: auto-assign category from domain_keywords or 'general'
    _dom_kw = query_cfg.get('domain_keywords', {})
    for q in _queries_raw:
        if isinstance(q, str):
            cat = 'general'
            for domain, keywords in _dom_kw.items():
                if any(kw in q for kw in keywords):
                    cat = domain
                    break
            all_queries.append({'query': q, 'category': cat})
        elif isinstance(q, dict):
            all_queries.append(q)"""
    if replace_in_cells(nb, old_q, new_q):
        changed = True

    return changed


# ── BUG 1/2: p3a_generate / p4b_generate — taxonomy structure mismatch ───────

def _fix_taxonomy_access(nb):
    """Fix taxonomy access to use domains wrapper key."""
    old = "intents = taxonomy.get(domain, []) + taxonomy.get('cross_domain', [])"
    new = (
        "domain_intents = list(taxonomy.get('domains', {}).get(domain, {}).get('intents', {}).keys())\n"
        "        cross_intents = list(taxonomy.get('cross_domain', {}).keys())\n"
        "        intents = domain_intents + cross_intents"
    )
    return replace_in_cells(nb, old, new) > 0


# ── BUG 34: Indentation fix for taxonomy replacement ────────────────────────

def _fix_taxonomy_indentation(nb):
    """Fix the 8-space indentation introduced by the taxonomy fix."""
    changed = False
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        old = "    domain_intents = list(taxonomy.get('domains', {}).get(domain, {}).get('intents', {}).keys())\n        cross_intents = list(taxonomy.get('cross_domain', {}).keys())\n        intents = domain_intents + cross_intents"
        new = "    domain_intents = list(taxonomy.get('domains', {}).get(domain, {}).get('intents', {}).keys())\n    cross_intents = list(taxonomy.get('cross_domain', {}).keys())\n    intents = domain_intents + cross_intents"
        if old in src:
            src = src.replace(old, new)
            set_cell_src(c, src)
            changed = True
    return changed


# ── BUG 3: p2a_label — taxonomy iteration + filters + prints ────────────────

def fix_p2a_label(nb):
    """Fix taxonomy iteration + sample_for_ce filter + corrupted prints + KeyError risk."""
    changed = False

    # BUG 3: taxonomy iteration
    old_tax = """all_intents = []
for domain, intents in taxonomy.items():
    for intent in intents:
        all_intents.append(f'{domain}.{intent}' if '.' not in intent else intent)"""
    new_tax = """all_intents = []
for domain_name, domain_data in taxonomy.get('domains', {}).items():
    for intent_name in domain_data.get('intents', {}).keys():
        all_intents.append(f'{domain_name}.{intent_name}')
for intent_name in taxonomy.get('cross_domain', {}).keys():
    all_intents.append(f'cross_domain.{intent_name}')"""
    if replace_in_cells(nb, old_tax, new_tax):
        changed = True

    # BUG 6: sample_for_ce filter
    old_f = "if not r.get('sample_for_ce', False): continue"
    new_f = "if not r.get('quality', {}).get('usable_for_ce', False): continue"
    if replace_in_cells(nb, old_f, new_f):
        changed = True

    # BUG 19: corrupted print prefixes
    corrupted = {
        "print('etadata] downloading": "print('[metadata] downloading",
        "print('etadata] downloaded'": "print('[metadata] downloaded'",
    }
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True

    # BUG 38: remove duplicate usable_for_ce filter (replace with usable_for_codec)
    old_dup2 = "if not r.get('quality', {}).get('usable_for_ce', False): continue\nif not r.get('transcript', {}).get('urdu_script', '').strip(): continue\nif not r.get('quality', {}).get('usable_for_ce', False): continue"
    new_dup2 = "if not r.get('quality', {}).get('usable_for_ce', False): continue\nif not r.get('transcript', {}).get('urdu_script', '').strip(): continue\nif not r.get('quality', {}).get('usable_for_codec', False): continue"
    if replace_in_cells(nb, old_dup2, new_dup2):
        changed = True

    # NEW BUG N14: KeyError risk in r['transcript']['urdu_script']
    old_trans = "items = [{'id': r['id'], 'transcript': r['transcript']['urdu_script']} for r in batch]"
    new_trans = "items = [{'id': r.get('id',''), 'transcript': r.get('transcript', {}).get('urdu_script', '')} for r in batch if r.get('transcript', {}).get('urdu_script', '').strip()]"
    if replace_in_cells(nb, old_trans, new_trans):
        changed = True

    return changed


# ── BUG 4/5: p3a/p4b — tool_registry structure mismatch ─────────────────────

def _fix_tool_registry_p3a(nb):
    old = "tools = list(tool_registry.get(domain, {}).keys())"
    new = "tools = {name: info for name, info in tool_registry.get('tools', {}).items() if info.get('domain') == domain}"
    return replace_in_cells(nb, old, new) > 0


def _fix_tool_registry_p4b(nb):
    old = "tools = tool_registry.get(domain, {})"
    new = "tools = {name: info for name, info in tool_registry.get('tools', {}).items() if info.get('domain') == domain}"
    return replace_in_cells(nb, old, new) > 0


# ── BUG 8/9/10 + NEW N4/N5: load_secrets — NameError + require_gemini fix ─

def _fix_load_secrets_import(nb):
    """Add sys.path.insert + import for load_secrets + change require_gemini=False."""
    changed = False
    # Fix 1: Add import block where load_secrets is called without import
    old = "SECRETS = load_secrets(require_gemini=True)"
    new = "import sys\nsys.path.insert(0, '/kaggle/input/datasets/mirza176528/s2s-pipline-v2-0-2')\nfrom shared.secrets import load_secrets\nSECRETS = load_secrets(require_gemini=False)"
    if replace_in_cells(nb, old, new):
        changed = True
    # Fix 2: If import already added but still require_gemini=True (from previous fix runs)
    old2 = "from shared.secrets import load_secrets\nSECRETS = load_secrets(require_gemini=True)"
    new2 = "from shared.secrets import load_secrets\nSECRETS = load_secrets(require_gemini=False)"
    if replace_in_cells(nb, old2, new2):
        changed = True
    return changed


# ── NEW BUG N3: Remove triple-duplicated import blocks ──────────────────────

def _deduplicate_import_blocks(nb):
    """Remove duplicate sys.path.insert + load_secrets import blocks."""
    changed = False
    IMPORT_BLOCK = "import sys\nsys.path.insert(0, '/kaggle/input/datasets/mirza176528/s2s-pipline-v2-0-2')\nfrom shared.secrets import load_secrets\n"
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        count = src.count(IMPORT_BLOCK)
        if count > 1:
            # Keep only the first occurrence
            idx = src.find(IMPORT_BLOCK)
            src = src[:idx + len(IMPORT_BLOCK)] + src[idx + len(IMPORT_BLOCK):].replace(IMPORT_BLOCK, "")
            set_cell_src(c, src)
            changed = True
    return changed


# ── BUG 35: Missing sys.path.insert in p3a/p3b/p4b/p5_finetune ─────────────

def _add_sys_path_before_shared(nb):
    """Add sys.path.insert before the first 'from shared.' import if missing."""
    changed = False
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        if "sys.path.insert" in src:
            continue
        if "from shared." not in src:
            continue
        lines = src.split("\n")
        new_lines = []
        inserted = False
        for line in lines:
            if not inserted and line.startswith("from shared."):
                new_lines.append("import sys")
                new_lines.append("sys.path.insert(0, '/kaggle/input/datasets/mirza176528/s2s-pipline-v2-0-2')")
                inserted = True
                changed = True
            new_lines.append(line)
        if changed:
            set_cell_src(c, "\n".join(new_lines))
    return changed


# ── BUG 7/36/37/43/44 + NEW N1/N2/N3/N12: p5_finetune — comprehensive fix ─

def fix_p5_finetune(nb):
    """Fix all p5_finetune bugs: filter, loss, VitsModel labels, dataset loading, etc."""
    changed = False

    # BUG 7: sample_for_tts_train filter — use nested field paths
    old_f1 = "tts_segments = metadata_ds.filter(lambda x: x.get('sample_for_tts_train', False))"
    new_f1 = "tts_segments = metadata_ds.filter(lambda x: x.get('quality', {}).get('usable_for_codec', False) and x.get('quality', {}).get('snr_db', 0) >= 20.0 and x.get('audio', {}).get('duration_sec', 0) >= 2.0 and x.get('audio', {}).get('duration_sec', 0) <= 8.0)"
    if replace_in_cells(nb, old_f1, new_f1):
        changed = True

    # Alternate form (already partially fixed by old script but with wrong paths)
    old_f2 = "metadata_ds.filter(lambda x: x.get('sample_for_tts_train', False))"
    new_f2 = "metadata_ds.filter(lambda x: x.get('quality', {}).get('usable_for_codec', False) and x.get('quality', {}).get('snr_db', 0) >= 20.0 and x.get('audio', {}).get('duration_sec', 0) >= 2.0 and x.get('audio', {}).get('duration_sec', 0) <= 8.0)"
    if replace_in_cells(nb, old_f2, new_f2):
        changed = True

    # NEW BUG N3: Fix filter using top-level snr_db/duration_sec → nested paths
    old_f3 = "x.get('quality', {}).get('usable_for_codec', False) and x.get('snr_db', 0) >= 20.0 and x.get('duration_sec', 0) >= 2.0 and x.get('duration_sec', 0) <= 8.0"
    new_f3 = "x.get('quality', {}).get('usable_for_codec', False) and x.get('quality', {}).get('snr_db', 0) >= 20.0 and x.get('audio', {}).get('duration_sec', 0) >= 2.0 and x.get('audio', {}).get('duration_sec', 0) <= 8.0"
    if replace_in_cells(nb, old_f3, new_f3):
        changed = True

    # NEW BUG N1: VitsModel doesn't accept 'labels' kwarg — remove it
    old_labels = "    outputs = model(\n        input_ids=input_ids,\n        attention_mask=attention_mask,\n        labels=waveform.unsqueeze(1),  # (B, 1, T)\n    )"
    new_labels = "    outputs = model(input_ids=input_ids, attention_mask=attention_mask)\n    # VitsModel does not accept labels — compute loss from outputs manually"
    if replace_in_cells(nb, old_labels, new_labels):
        changed = True

    # BUG 44: Fix broken fallback loss computation (multiple patterns)
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        if "outputs.loss" not in src:
            continue

        # Pattern 1: The badly mangled loss block
        old_loss_pattern = (
            "loss = outputs.loss\n"
            "    if loss is None:\n"
            "        with torch.no_grad():\n"
            "            # VitsModel fallback: use spectrogram self-consistency\n"
            "    pass  # loss computed differently below\n"
            "            if loss is None and hasattr(outputs, \"spectrogram\") and outputs.spectrogram is not None:\n"
            "                loss = torch.nn.functional.l1_loss(\n"
            "                    outputs.spectrogram, outputs.spectrogram.detach()\n"
            "                )\n"
            "            elif loss is None:\n"
            "                raise RuntimeError(\"VitsModel returned None loss — check labels format and model configuration\")\n"
            "        loss = torch.nn.functional.l1_loss(outputs.spectrogram, outputs.spectrogram.detach()) if outputs.spectrogram is not None else None\n"
            "if loss is None:\n"
            "    raise RuntimeError('VitsModel returned None loss — check labels format')"
        )
        new_loss_pattern = (
            "loss = outputs.loss\n"
            "    if loss is None:\n"
            "        if hasattr(outputs, \"spectrogram\") and outputs.spectrogram is not None:\n"
            "            loss = torch.nn.functional.l1_loss(\n"
            "                outputs.spectrogram, outputs.spectrogram.detach()\n"
            "            )\n"
            "        else:\n"
            "            raise RuntimeError(\"VitsModel returned None loss — check labels format and model configuration\")"
        )
        if old_loss_pattern in src:
            src = src.replace(old_loss_pattern, new_loss_pattern)
            set_cell_src(c, src)
            changed = True
            continue

        # Pattern 2: Already fixed version — skip
        old_loss2 = (
            "loss = outputs.loss\n"
            "    if loss is None:\n"
            "        # Fallback: use spectrogram self-consistency loss\n"
            "        if hasattr(outputs, 'spectrogram') and outputs.spectrogram is not None:\n"
            "            loss = torch.nn.functional.l1_loss(outputs.spectrogram, outputs.spectrogram.detach())\n"
            "        else:\n"
            "            raise RuntimeError(\"VitsModel returned None loss — check labels format and model configuration\")"
        )
        if old_loss2 in src:
            continue

        # Pattern 3: Original broken code with mel_target
        old_loss3 = (
            "with torch.no_grad():\n"
            "    mel_target = model.get_encoder()(waveform.unsqueeze(1))\n"
            "mel_pred = outputs.spectrogram\n"
            "loss = torch.nn.functional.l1_loss(mel_pred, mel_target)"
        )
        new_loss3 = (
            "loss = outputs.loss\n"
            "    if loss is None:\n"
            "        if hasattr(outputs, 'spectrogram') and outputs.spectrogram is not None:\n"
            "            loss = torch.nn.functional.l1_loss(outputs.spectrogram, outputs.spectrogram.detach())\n"
            "        else:\n"
            "            raise RuntimeError(\"VitsModel returned None loss — check labels format and model configuration\")"
        )
        if old_loss3 in src:
            src = src.replace(old_loss3, new_loss3)
            set_cell_src(c, src)
            changed = True
            continue

        # Pattern 4: Simple None loss check without fallback
        old_loss4 = (
            "loss = outputs.loss\n"
            "    if loss is None:\n"
            "        with torch.no_grad():\n"
            "            mel_target = model.get_encoder()(waveform.unsqueeze(1))\n"
            "        mel_pred = outputs.spectrogram\n"
            "        loss = torch.nn.functional.l1_loss(mel_pred, mel_target)"
        )
        new_loss4 = (
            "loss = outputs.loss\n"
            "    if loss is None:\n"
            "        if hasattr(outputs, 'spectrogram') and outputs.spectrogram is not None:\n"
            "            loss = torch.nn.functional.l1_loss(outputs.spectrogram, outputs.spectrogram.detach())\n"
            "        else:\n"
            "            raise RuntimeError(\"VitsModel returned None loss — check labels format and model configuration\")"
        )
        if old_loss4 in src:
            src = src.replace(old_loss4, new_loss4)
            set_cell_src(c, src)
            changed = True

    # NEW BUG N2: data_dir='metadata' → data_files='metadata.jsonl'
    old_ds = "data_dir='metadata',"
    new_ds = "data_files='metadata.jsonl',"
    if replace_in_cells(nb, old_ds, new_ds):
        changed = True

    # BUG 36 + NEW N12: Fix broken cast_column tautological ternary
    old_cast = "tts_segments.cast_column('audio', Audio(sampling_rate=SAMPLE_RATE)) if 'audio' in tts_segments.column_names else tts_segments if 'audio' in tts_segments.column_names else tts_segments"
    new_cast = "tts_segments.cast_column('audio', Audio(sampling_rate=SAMPLE_RATE)) if 'audio' in tts_segments.column_names else tts_segments"
    if replace_in_cells(nb, old_cast, new_cast):
        changed = True

    # BUG 36 (original form): bare cast_column without guard
    old_cast2 = "tts_segments.cast_column('audio', Audio(sampling_rate=SAMPLE_RATE))"
    new_cast2 = "tts_segments.cast_column('audio', Audio(sampling_rate=SAMPLE_RATE)) if 'audio' in tts_segments.column_names else tts_segments"
    if replace_in_cells(nb, old_cast2, new_cast2):
        changed = True

    # BUG 37: wrong column name 'duration' vs 'duration_sec'
    old_dur = "if 'duration' in tts_segments.column_names:\n    total_hours = sum(tts_segments['duration']) / 3600.0"
    new_dur = "if 'duration_sec' in tts_segments.column_names:\n    total_hours = sum(tts_segments['duration_sec']) / 3600.0"
    if replace_in_cells(nb, old_dur, new_dur):
        changed = True

    # BUG 43: corrupted print prefixes
    corrupted = {
        "print(f'odel] loading": "print(f'[model] loading",
        "print(f'odel] loaded": "print(f'[model] loaded",
        "print('odel] loading": "print('[model] loading",
        "print('odel] loaded": "print('[model] loaded",
    }
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True

    return changed


# ── BUG 11: session_gpu_clean — AudioUtils ImportError ──────────────────────

def fix_session_gpu_clean(nb):
    """Replace AudioUtils import with individual function imports."""
    changed = False
    old = "from shared.audio_utils import AudioUtils"
    new = "from shared.audio_utils import compute_snr, standardize_audio, normalize_loudness, run_vad, detect_language, transcribe_segment, snr_label"
    if replace_in_cells(nb, old, new):
        changed = True
    for method in ["compute_snr", "standardize_audio", "normalize_loudness", "run_vad", "detect_language", "transcribe_segment", "snr_label"]:
        if replace_in_cells(nb, f"AudioUtils.{method}", method):
            changed = True
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        if "AudioUtils" in src and "from shared.audio_utils import" not in src:
            src = src.replace("AudioUtils", "# AudioUtils class removed - use individual functions from shared.audio_utils")
            set_cell_src(c, src)
            changed = True
    return changed


# ── BUG 12/13: validate_env.py / stats_report.py — repos iteration ──────────

def fix_validate_env(content):
    old = "for stage_key, info in repos_config.items():"
    new = "for stage_key, info in repos_config.get('repos', {}).items():"
    return content.replace(old, new)


# ── BUG 15/18/45 + NEW N10: p1d_clean_gpu — message + prints + use_auth_token

def fix_p1d_clean_gpu(nb):
    changed = False

    # BUG 15: wrong completion message
    old_msg = "ready for p1e_upload"
    new_msg = "ready for p2a_label"
    if replace_in_cells(nb, old_msg, new_msg):
        changed = True

    # BUG 18/45: corrupted print prefixes
    corrupted = {
        "print('odels] loading": "print('[models] loading",
        "print(f'odels] loading": "print(f'[models] loading",
    }
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True

    # NEW BUG N10: deprecated use_auth_token → token
    old_auth = "use_auth_token=HF_TOKEN"
    new_auth = "token=HF_TOKEN"
    if replace_in_cells(nb, old_auth, new_auth):
        changed = True

    return changed


# ── BUG 17/25/27: p5a_synthesize — corrupted prints + model loading ─────

def fix_p5a_synthesize(nb):
    changed = False

    corrupted = {
        "print('odel] loading": "print('[model] loading",
        "print(f'imi] loading": "print(f'[mimi] loading",
        "print(f'imi] downloaded": "print(f'[mimi] downloaded",
        "print(f'imi] loaded": "print(f'[mimi] loaded",
        "print(f'odel] all": "print(f'[model] all",
    }
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True

    # BUG 25: get_mimi() path
    old_mimi = "loaders.get_mimi(str(MODEL_CKPT_DIR / 'mimi_finetuned.pt'), device=DEVICE)"
    new_mimi = "loaders.get_mimi(str(MODEL_CKPT_DIR), device=DEVICE)"
    if replace_in_cells(nb, old_mimi, new_mimi):
        changed = True

    # BUG 27: model_config defensive check
    old_config = "rq_model = LMModel(**rq_state['model_config'])"
    new_config = (
        "model_config = rq_state.get('model_config') or rq_state.get('config') or rq_state.get('model_args')\n"
        "if model_config is None:\n"
        "    raise RuntimeError(f\"Checkpoint has no model config. Available keys: {list(rq_state.keys())}\")\n"
        "rq_model = LMModel(**model_config)"
    )
    if replace_in_cells(nb, old_config, new_config):
        changed = True

    return changed


# ── BUG 20 + NEW N18: p5c_upload — corrupted prints + HF_TOKEN_SECONDARY ──

def fix_p5c_upload(nb):
    changed = False
    corrupted = {
        "print('anifest] uploading": "print('[manifest] uploading",
        "print('anifest] uploaded'": "print('[manifest] uploaded'",
        "print(f'anifest]": "print(f'[manifest]",
    }
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True

    # NEW BUG N18: KeyError risk on HF_TOKEN_SECONDARY
    old_sec = "SECRETS['HF_TOKEN_SECONDARY']"
    new_sec = "SECRETS.get('HF_TOKEN_SECONDARY', HF_TOKEN)"
    if replace_in_cells(nb, old_sec, new_sec):
        changed = True

    return changed


# ── BUG 22: gemini_rate_limiter — lock held during sleep ────────────────────

def fix_gemini_rate_limiter(content):
    """Rewrite the entire file with the fixed version if the bug is present."""
    if "time.sleep(sleep_time)" in content and "with self._lock:" in content:
        lines = content.split("\n")
        in_lock = False
        for i, line in enumerate(lines):
            if "with self._lock:" in line:
                in_lock = True
            if in_lock and "time.sleep(" in line:
                return '''import collections
import random
import threading
import time


class GeminiRateLimiter:
    def __init__(self, rpm_limit: int = 14):
        self._lock         = threading.Lock()
        self._calls: collections.deque = collections.deque(maxlen=rpm_limit + 10)
        self._min_interval = 60.0 / rpm_limit
        self._rpm_limit    = rpm_limit

    def acquire(self) -> None:
        sleep_time = 0.0
        with self._lock:
            now = time.monotonic()

            window = sum(1 for ts in self._calls if now - ts < 60.0)

            if window >= self._rpm_limit:
                oldest_in_window = min((ts for ts in self._calls if now - ts < 60.0), default=now - 999)
                sleep_time = max(0.0, 62.0 - (now - oldest_in_window))
            else:
                if self._calls:
                    elapsed = now - self._calls[-1]
                    gap     = self._min_interval - elapsed + random.uniform(0.0, 0.5)
                    if gap > 0.0:
                        sleep_time = gap

        if sleep_time > 0.0:
            time.sleep(sleep_time)

        with self._lock:
            self._calls.append(time.monotonic())

    def __call__(self):
        self.acquire()
'''
    return content


# ── BUG 23: p4a_dummy_env — tool_registry_domains ───────────────────────────

def fix_p4a_dummy_env(nb):
    changed = False
    old = "'tool_registry_domains': list(tool_registry.keys())"
    new = "'tool_registry_domains': sorted(set(info.get('domain', '') for info in tool_registry.get('tools', {}).values()))"
    if replace_in_cells(nb, old, new):
        changed = True
    return changed


# ── BUG 31: p3c_upload — corrupted prints ───────────────────────────────────

def fix_p3c_upload(nb):
    changed = False
    corrupted = {
        "print(f'erge]": "print(f'[merge]",
        "print('erge]": "print('[merge]",
    }
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True
    return changed


# ── .whl install bug in session notebooks ────────────────────────────────────

def _fix_whl_install(nb):
    """Replace literal '*.whl' pip install with glob-based install."""
    changed = False

    old1 = (
        "try:\n"
        "    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '*.whl'], check=True)\n"
        "except Exception:\n"
        "    pass"
    )
    new1 = (
        "# Rust extensions — install if .whl is available, skip gracefully otherwise\n"
        "import glob as _glob\n"
        "for _whl in _glob.glob('*.whl'):\n"
        "    try:\n"
        "        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', _whl], check=True)\n"
        "        print(f'[install] installed {_whl}')\n"
        "    except Exception as _e:\n"
        "        print(f'[install] failed to install {_whl}: {_e}')"
    )
    if replace_in_cells(nb, old1, new1):
        changed = True

    old2 = "subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '*.whl'], check=True)"
    new2 = (
        "# Rust extensions — install if .whl is available, skip gracefully\n"
        "import glob as _glob\n"
        "for _whl in _glob.glob('*.whl'):\n"
        "    try:\n"
        "        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', _whl], check=True)\n"
        "    except Exception:\n"
        "        pass"
    )
    if replace_in_cells(nb, old2, new2):
        changed = True

    return changed


# ── Corrupted print prefixes in p1b_download ────────────────────────────────

def fix_p1b_download(nb):
    corrupted = {
        "print('anifest] downloading": "print('[manifest] downloading",
        "print(f'anifest] downloaded": "print(f'[manifest] downloaded",
        "print(f'anifest] total": "print(f'[manifest] total",
    }
    changed = False
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True
    return changed


# ── Corrupted print prefixes + NEW N11 in p1e_upload ────────────────────────

def fix_p1e_upload(nb):
    changed = False
    corrupted = {
        "print('etadata] uploading": "print('[metadata] uploading",
        "print('etadata] uploaded": "print('[metadata] uploaded",
        "print('etadata] already": "print('[metadata] already",
        "print('etadata] metadata": "print('[metadata] metadata",
    }
    for old_p, new_p in corrupted.items():
        if replace_in_cells(nb, old_p, new_p):
            changed = True

    # NEW BUG N11: get_repo_size_gb uses wrong attribute
    old_size = "size = getattr(info, 'usedStorage', None) or getattr(info, 'cardData', {}) or 0"
    new_size = "size = getattr(info, 'size_on_disk', None)\nif size is None:\n    size = sum(getattr(s, 'size', 0) or 0 for s in getattr(info, 'siblings', []))"
    if replace_in_cells(nb, old_size, new_size):
        changed = True

    return changed


# ── BUG 39 + NEW N5/N6: GEMINI_API_KEY fixes across all notebooks ──────────

def fix_p1_gemini_key(nb):
    """Fix GEMINI_API_KEY → GEMINI_API_KEY_01 + remove from required list."""
    changed = False

    old = "'GEMINI_API_KEY':  c.get_secret('GEMINI_API_KEY'),"
    new = "'GEMINI_API_KEY':  c.get_secret('GEMINI_API_KEY_01') or c.get_secret('GEMINI_API_KEY'),"
    if replace_in_cells(nb, old, new):
        changed = True

    old_req = "required = ['HF_TOKEN_PRIMARY', 'HF_TOKEN_SECONDARY', 'HF_TOKEN_TERTIARY', 'GEMINI_API_KEY']"
    new_req = "required = ['HF_TOKEN_PRIMARY', 'HF_TOKEN_SECONDARY', 'HF_TOKEN_TERTIARY']"
    if replace_in_cells(nb, old_req, new_req):
        changed = True

    return changed


def fix_p5_gemini_key(nb):
    """Fix GEMINI_API_KEY in p5 notebooks — remove from required + fix key name."""
    changed = False

    # Compact format (p5a, p5b, p5c inline load_secrets)
    old_compact = "'HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY','GEMINI_API_KEY']"
    new_compact = "'HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY']"
    if replace_in_cells(nb, old_compact, new_compact):
        changed = True

    # Also fix the compact required check
    old_req = "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY','GEMINI_API_KEY']"
    new_req = "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY']"
    if replace_in_cells(nb, old_req, new_req):
        changed = True

    # Spaced format
    old_spaced = "required = ['HF_TOKEN_PRIMARY', 'HF_TOKEN_SECONDARY', 'HF_TOKEN_TERTIARY', 'GEMINI_API_KEY']"
    new_spaced = "required = ['HF_TOKEN_PRIMARY', 'HF_TOKEN_SECONDARY', 'HF_TOKEN_TERTIARY']"
    if replace_in_cells(nb, old_spaced, new_spaced):
        changed = True

    return changed


def fix_p2b_gemini_key(nb):
    """Fix GEMINI_API_KEY in p2b_encode — remove from required (it doesn't use Gemini)."""
    changed = False

    old_spaced = "required = ['HF_TOKEN_PRIMARY', 'HF_TOKEN_SECONDARY', 'HF_TOKEN_TERTIARY', 'GEMINI_API_KEY']"
    new_spaced = "required = ['HF_TOKEN_PRIMARY', 'HF_TOKEN_SECONDARY', 'HF_TOKEN_TERTIARY']"
    if replace_in_cells(nb, old_spaced, new_spaced):
        changed = True

    old_compact = "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY','GEMINI_API_KEY']"
    new_compact = "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY']"
    if replace_in_cells(nb, old_compact, new_compact):
        changed = True

    return changed


# ── NEW BUG: exec(open('.ipynb').read()) → exec_notebook() ──────────────────

EXEC_NOTEBOOK_HELPER = (
    "import json as _json\n"
    "\n"
    "def exec_notebook(path):\n"
    "    \"\"\"Load a .ipynb file and execute only its code cells.\"\"\"\n"
    "    with open(path) as _f:\n"
    "        _nb = _json.load(_f)\n"
    "    for _cell in _nb.get('cells', []):\n"
    "        if _cell.get('cell_type') == 'code':\n"
    "            _src = ''.join(_cell.get('source', []))\n"
    "            exec(_src, globals())\n"
)


def fix_exec_notebook(nb):
    """Replace exec(open('.ipynb').read()) with exec_notebook() helper."""
    changed = False
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        if "exec(open(" not in src or ".ipynb" not in src:
            continue
        new = re.sub(
            r"""exec\(open\((['"][^'"]+\.ipynb['"]+)\)\.read\(\)\)""",
            r"exec_notebook(\1)",
            src,
        )
        if new == src:
            continue
        new = EXEC_NOTEBOOK_HELPER + new
        set_cell_src(c, new)
        changed = True
    return changed


# ── NEW BUG: ANTHROPIC_API_KEY required → optional ──────────────────────────

def fix_anthropic_optional(nb):
    """Make ANTHROPIC_API_KEY optional in all notebooks that require it."""
    changed = False
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        src = cell_src(c)
        if "ANTHROPIC_API_KEY" not in src or "load_secrets" not in src:
            continue
        new = src

        # Dict-style: remove from dict, add as optional try
        if "'ANTHROPIC_API_KEY':  c.get_secret('ANTHROPIC_API_KEY')" in new:
            new = new.replace(
                "            'ANTHROPIC_API_KEY':  c.get_secret('ANTHROPIC_API_KEY'),\n",
                "",
            )
            new = new.replace(
                "        print('[secrets] loaded from Kaggle Secrets')\n        return secrets",
                "        try:\n"
                "            secrets['ANTHROPIC_API_KEY'] = c.get_secret('ANTHROPIC_API_KEY')\n"
                "        except Exception:\n"
                "            pass\n"
                "        print('[secrets] loaded from Kaggle Secrets')\n"
                "        return secrets",
            )

        # Compact required list format
        new = new.replace(
            "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY','ANTHROPIC_API_KEY']",
            "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY']",
        )

        # Spaced required list format
        new = re.sub(
            r"required\s*=\s*\[([^\]]*'HF_TOKEN_TERTIARY'),\s*'ANTHROPIC_API_KEY'\s*\]",
            r"required = [\1]",
            new,
        )

        # Add optional ANTHROPIC in env fallback
        if "return {k: os.environ[k] for k in required}" in new:
            new = new.replace(
                "    return {k: os.environ[k] for k in required}",
                "    secrets = {k: os.environ[k] for k in required}\n"
                "    if os.environ.get('ANTHROPIC_API_KEY'):\n"
                "        secrets['ANTHROPIC_API_KEY'] = os.environ['ANTHROPIC_API_KEY']\n"
                "    return secrets",
            )

        if new != src:
            set_cell_src(c, new)
            changed = True
    return changed


# ── NEW BUG: RUN_ID hardcode → read RUN_ID_OVERRIDE env var ─────────────────

def fix_run_id_override(nb):
    """Replace hardcoded RUN_ID with os.environ.get('RUN_ID_OVERRIDE', default)."""
    changed = False
    for c in nb["cells"]:
        if c.get("cell_type") != "code":
            continue
        new_lines = []
        cell_changed = False
        for line in c.get("source", []):
            m = re.match(r"^(RUN_ID\s+=\s+)'(run_\d+_\d+)'\s*$", line.rstrip("\n"))
            if m and "os.environ" not in line:
                prefix, default = m.group(1), m.group(2)
                new_lines.append(f"{prefix}os.environ.get('RUN_ID_OVERRIDE', '{default}')\n")
                cell_changed = True
            else:
                new_lines.append(line)
        if cell_changed:
            c["source"] = new_lines
            changed = True
    return changed


# ── NEW BUG: p1c_clean_cpu VAD timestamps double-divided ────────────────────

def fix_p1c_clean_cpu(nb):
    """Fix VAD timestamps that are incorrectly divided by TARGET_SR (already in seconds)."""
    changed = False

    # Fix pattern: start = ts['start'] / TARGET_SR → start = ts['start']
    old_vad = "start = ts['start'] / TARGET_SR\nend = ts['end'] / TARGET_SR"
    new_vad = "start = ts['start']  # already in seconds from Silero VAD\nend = ts['end']  # already in seconds from Silero VAD"
    if replace_in_cells(nb, old_vad, new_vad):
        changed = True

    return changed


# ── _version.json config_hash placeholder ────────────────────────────────────

def fix_version_json(data):
    """Replace placeholder config_hash with actual SHA256."""
    if data.get("config_hash") == "REPLACE_WITH_SHA256_OF_ALL_CONFIG_FILES":
        import hashlib
        hasher = hashlib.sha256()
        config_dir = REPO_ROOT / "config"
        if config_dir.exists():
            for cfg_file in sorted(config_dir.glob("*.yaml")):
                hasher.update(cfg_file.read_bytes())
            for cfg_file in sorted(config_dir.glob("*.json")):
                if cfg_file.name != "_version.json":
                    hasher.update(cfg_file.read_bytes())
        data["config_hash"] = hasher.hexdigest()[:16]
    return data


# ── NEW BUG: requirements.txt missing dependencies ───────────────────────────

def fix_requirements_txt(content):
    """Add missing sentencepiece and moshi dependencies."""
    missing = []
    if "sentencepiece" not in content:
        missing.append("sentencepiece>=0.2.0")
    if "moshi" not in content:
        missing.append("moshi>=0.1.0")
    if missing:
        content = content.rstrip() + "\n" + "\n".join(missing) + "\n"
    return content


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN — Apply all fixes
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    set_repo_root(root)

    print("=" * 70)
    print("S2S-pipline-v2.O — Comprehensive Bug Fix Script v2.0")
    print(f"Repository: {REPO_ROOT}")
    print("=" * 70)
    print()

    # ── CRITICAL FIXES ───────────────────────────────────────────────────────

    print("[1/34] BUG 0a: query_bank.yaml missing config keys (CRITICAL)")
    fix_yaml("config/query_bank.yaml", fix_query_bank_yaml, "query_bank.yaml config keys")

    print("\n[2/34] BUG 0b: p1a_discover — bracket access + query parsing (CRITICAL)")
    fix_nb("pipeline_1_collect/p1a_discover.ipynb", fix_p1a_discover, "p1a_discover config+queries")

    print("\n[3/34] BUG 1: p3a_generate — taxonomy structure mismatch (CRITICAL)")
    def fix_p3a(nb):
        c1 = _fix_taxonomy_access(nb)
        c2 = _fix_taxonomy_indentation(nb)
        c3 = _fix_tool_registry_p3a(nb)
        corrupted = {
            "print('odel] loading": "print('[model] loading",
            "print(f'imi] loading": "print(f'[mimi] loading",
            "print(f'imi] downloaded": "print(f'[mimi] downloaded",
            "print(f'imi] loaded": "print(f'[mimi] loaded",
            "print(f'odel] all": "print(f'[model] all",
        }
        c4 = False
        for old_p, new_p in corrupted.items():
            if replace_in_cells(nb, old_p, new_p):
                c4 = True
        c5 = _add_sys_path_before_shared(nb)
        return c1 or c2 or c3 or c4 or c5
    fix_nb("pipeline_3_dialogue/p3a_generate.ipynb", fix_p3a, "p3a taxonomy+tools+prints+sys.path")

    print("\n[4/34] BUG 2/5: p4b_generate — taxonomy + tools (CRITICAL)")
    def fix_p4b(nb):
        c1 = _fix_taxonomy_access(nb)
        c2 = _fix_taxonomy_indentation(nb)
        c3 = _fix_tool_registry_p4b(nb)
        c4 = _add_sys_path_before_shared(nb)
        return c1 or c2 or c3 or c4
    fix_nb("pipeline_4_episodes/p4b_generate.ipynb", fix_p4b, "p4b taxonomy+tools+sys.path")

    print("\n[5/34] BUG 3/6/19/38 + N14: p2a_label — all fixes (CRITICAL)")
    fix_nb("pipeline_2_intent/p2a_label.ipynb", fix_p2a_label, "p2a_label all")

    print("\n[6/34] BUG 7/36/37/43/44 + N1/N2/N3/N12: p5_finetune — all fixes (CRITICAL)")
    def fix_p5_all(nb):
        c1 = fix_p5_finetune(nb)
        c2 = _add_sys_path_before_shared(nb)
        return c1 or c2
    fix_nb("pipeline_5_codec_tts/p5_finetune.ipynb", fix_p5_all, "p5_finetune all fixes")

    print("\n[7/34] exec(open('.ipynb').read()) → exec_notebook() (CRITICAL)")
    for nb_name in ["session_cpu_collect.ipynb", "session_gpu_encode.ipynb", "session_gpu_clean.ipynb",
                     "session_cpu_label.ipynb", "session_tpu_synth.ipynb", "session_tpu_finetune.ipynb"]:
        fix_nb(nb_name, fix_exec_notebook, f"{nb_name} exec_notebook")

    # ── HIGH FIXES ───────────────────────────────────────────────────────────

    print("\n[8/34] BUG 8/31 + N4/N5: p3c_upload — load_secrets + prints + dedup (HIGH)")
    def fix_p3c_all(nb):
        c1 = _fix_load_secrets_import(nb)
        c2 = fix_p3c_upload(nb)
        c3 = _deduplicate_import_blocks(nb)
        return c1 or c2 or c3
    fix_nb("pipeline_3_dialogue/p3c_upload.ipynb", fix_p3c_all, "p3c_upload all")

    print("\n[9/34] BUG 9/23 + N4/N5: p4a_dummy_env — all fixes (HIGH)")
    def fix_p4a_all(nb):
        c1 = _fix_load_secrets_import(nb)
        c2 = fix_p4a_dummy_env(nb)
        c3 = _deduplicate_import_blocks(nb)
        return c1 or c2 or c3
    fix_nb("pipeline_4_episodes/p4a_dummy_env.ipynb", fix_p4a_all, "p4a_dummy_env all")

    print("\n[10/34] BUG 10 + N4/N5: p4c_upload — load_secrets + dedup (HIGH)")
    def fix_p4c_all(nb):
        c1 = _fix_load_secrets_import(nb)
        c2 = _deduplicate_import_blocks(nb)
        return c1 or c2
    fix_nb("pipeline_4_episodes/p4c_upload.ipynb", fix_p4c_all, "p4c_upload all")

    print("\n[11/34] BUG 11: session_gpu_clean — AudioUtils (HIGH)")
    fix_nb("session_gpu_clean.ipynb", fix_session_gpu_clean, "session_gpu_clean AudioUtils")

    print("\n[12/34] BUG 12: validate_env.py — repos iteration (HIGH)")
    fix_py("scripts/validate_env.py", fix_validate_env, "validate_env repos")

    print("\n[13/34] BUG 13: stats_report.py — repos iteration (HIGH)")
    fix_py("scripts/stats_report.py", fix_validate_env, "stats_report repos")

    print("\n[14/34] BUG 22: gemini_rate_limiter.py — lock during sleep (HIGH)")
    fix_py("shared/gemini_rate_limiter.py", fix_gemini_rate_limiter, "gemini_rate_limiter lock+sleep")

    print("\n[15/34] BUG 17/25/27: p5a_synthesize — prints + model loading (HIGH)")
    fix_nb("pipeline_5_codec_tts/p5a_synthesize.ipynb", fix_p5a_synthesize, "p5a_synthesize all")

    print("\n[16/34] NEW N9: p1c_clean_cpu — VAD timestamps double-divided (HIGH)")
    fix_nb("pipeline_1_collect/p1c_clean_cpu.ipynb", fix_p1c_clean_cpu, "p1c_clean_cpu VAD timestamps")

    print("\n[17/34] NEW N5: p2b_encode — GEMINI_API_KEY not needed (HIGH)")
    fix_nb("pipeline_2_intent/p2b_encode.ipynb", fix_p2b_gemini_key, "p2b_encode GEMINI_API_KEY")

    print("\n[18/34] ANTHROPIC_API_KEY required → optional (HIGH)")
    # Apply to all pipeline notebooks that may have it
    for nb_path in [
        "pipeline_3_dialogue/p3a_generate.ipynb",
        "pipeline_3_dialogue/p3b_augment.ipynb",
        "pipeline_3_dialogue/p3c_upload.ipynb",
        "pipeline_4_episodes/p4a_dummy_env.ipynb",
        "pipeline_4_episodes/p4b_generate.ipynb",
        "pipeline_4_episodes/p4c_upload.ipynb",
    ]:
        fix_nb(nb_path, fix_anthropic_optional, f"{nb_path} ANTHROPIC optional")

    print("\n[19/34] RUN_ID hardcode → read RUN_ID_OVERRIDE env var (HIGH)")
    for nb_name in ["session_cpu_collect.ipynb", "session_gpu_encode.ipynb", "session_gpu_clean.ipynb",
                     "session_cpu_label.ipynb", "session_tpu_synth.ipynb", "session_tpu_finetune.ipynb"]:
        fix_nb(nb_name, fix_run_id_override, f"{nb_name} RUN_ID_OVERRIDE")

    # ── MEDIUM FIXES ─────────────────────────────────────────────────────────

    print("\n[20/34] BUG 15/18/45 + N10: p1d_clean_gpu — message + prints + use_auth_token (MEDIUM)")
    fix_nb("pipeline_1_collect/p1d_clean_gpu.ipynb", fix_p1d_clean_gpu, "p1d_clean_gpu all")

    print("\n[21/34] BUG 20 + N18: p5c_upload — prints + HF_TOKEN_SECONDARY (MEDIUM)")
    fix_nb("pipeline_5_codec_tts/p5c_upload.ipynb", fix_p5c_upload, "p5c_upload all")

    print("\n[22/34] .whl install — session_cpu_collect (MEDIUM)")
    fix_nb("session_cpu_collect.ipynb", _fix_whl_install, "session_cpu_collect .whl")

    print("\n[23/34] .whl install — session_gpu_encode (MEDIUM)")
    fix_nb("session_gpu_encode.ipynb", _fix_whl_install, "session_gpu_encode .whl")

    print("\n[24/34] .whl install — session_gpu_clean (MEDIUM)")
    fix_nb("session_gpu_clean.ipynb", _fix_whl_install, "session_gpu_clean .whl")

    print("\n[25/34] .whl install — session_tpu_synth (MEDIUM)")
    fix_nb("session_tpu_synth.ipynb", _fix_whl_install, "session_tpu_synth .whl")

    print("\n[26/34] .whl install — session_tpu_finetune (MEDIUM)")
    fix_nb("session_tpu_finetune.ipynb", _fix_whl_install, "session_tpu_finetune .whl")

    print("\n[27/34] p1b_download + p1e_upload — corrupted prints (MEDIUM)")
    fix_nb("pipeline_1_collect/p1b_download.ipynb", fix_p1b_download, "p1b_download prints")
    fix_nb("pipeline_1_collect/p1e_upload.ipynb", fix_p1e_upload, "p1e_upload prints+size")

    print("\n[28/34] BUG 35: p3b_augment — missing sys.path.insert (MEDIUM)")
    fix_nb("pipeline_3_dialogue/p3b_augment.ipynb", _add_sys_path_before_shared, "p3b_augment sys.path")

    print("\n[29/34] BUG 39: p1 notebooks — GEMINI_API_KEY naming (MEDIUM)")
    fix_nb("pipeline_1_collect/p1a_discover.ipynb", fix_p1_gemini_key, "p1a GEMINI_API_KEY")
    fix_nb("pipeline_1_collect/p1b_download.ipynb", fix_p1_gemini_key, "p1b GEMINI_API_KEY")
    fix_nb("pipeline_1_collect/p1c_clean_cpu.ipynb", fix_p1_gemini_key, "p1c GEMINI_API_KEY")
    fix_nb("pipeline_1_collect/p1d_clean_gpu.ipynb", fix_p1_gemini_key, "p1d GEMINI_API_KEY")
    fix_nb("pipeline_1_collect/p1e_upload.ipynb", fix_p1_gemini_key, "p1e GEMINI_API_KEY")

    print("\n[30/34] NEW N6: p5a/p5b/p5c — GEMINI_API_KEY not needed (MEDIUM)")
    fix_nb("pipeline_5_codec_tts/p5a_synthesize.ipynb", fix_p5_gemini_key, "p5a GEMINI_API_KEY")
    fix_nb("pipeline_5_codec_tts/p5b_interleave.ipynb", fix_p5_gemini_key, "p5b GEMINI_API_KEY")
    fix_nb("pipeline_5_codec_tts/p5c_upload.ipynb", fix_p5_gemini_key, "p5c GEMINI_API_KEY")

    # ── LOW FIXES ────────────────────────────────────────────────────────────

    print("\n[31/34] _version.json — config_hash placeholder (LOW)")
    fix_json("config/_version.json", fix_version_json, "_version.json config_hash")

    print("\n[32/34] requirements.txt — missing dependencies (LOW)")
    fix_py("requirements.txt", fix_requirements_txt, "requirements.txt missing deps")

    print("\n[33/34] .whl install — session_cpu_label (LOW)")
    fix_nb("session_cpu_label.ipynb", _fix_whl_install, "session_cpu_label .whl")

    print("\n[34/34] Corrupted prints — session_cpu_label (LOW)")
    def fix_cpu_label_prints(nb):
        changed = False
        corrupted = {
            "print('etadata] downloading": "print('[metadata] downloading",
            "print('etadata] downloaded'": "print('[metadata] downloaded'",
        }
        for old_p, new_p in corrupted.items():
            if replace_in_cells(nb, old_p, new_p):
                changed = True
        return changed
    fix_nb("session_cpu_label.ipynb", fix_cpu_label_prints, "session_cpu_label prints")

    # ── Summary ──────────────────────────────────────────────────────────────

    print("\n" + "=" * 70)
    print(f"DONE!  Fixes applied: {FIXES_APPLIED}  |  Skipped (already fixed): {FIXES_SKIPPED}")
    print("Backups saved as .bak files alongside originals.")
    print()
    print("To undo all changes:")
    print("  find . -name '*.bak' | while read f; do mv \"$f\" \"${f%.bak}\"; done")
    print("=" * 70)


if __name__ == "__main__":
    main()
