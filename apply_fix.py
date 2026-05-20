#!/usr/bin/env python3
"""
Comprehensive fix script for S2S-pipline-v2.O
Run from the repo root:  python apply_fix.py

Fixes three bugs:
  #1  NameError: name 'null' is not defined
      (exec(open('.ipynb').read()) reads raw JSON with JS null values)
  #2  RuntimeError: Missing secrets: ['ANTHROPIC_API_KEY']
      (pipeline notebooks require a key that is actually optional)
  #3  RUN_ID_OVERRIDE env var is set but never read
      (session notebooks hardcode RUN_ID instead of reading the env var)
"""

import json, glob, re, os, sys

# ── helpers ──────────────────────────────────────────────────────────────────

def load_nb(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_nb(path, nb):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(nb, f, indent=1, ensure_ascii=False)

def cell_src(cell):
    return "".join(cell.get("source", []))

def set_cell_src(cell, text):
    lines = text.rstrip("\n").split("\n")
    cell["source"] = [ln + "\n" for ln in lines[:-1]] + [lines[-1]]


# ── Bug #1: exec(open(...ipynb).read()) → exec_notebook() ──────────────────

HELPER = (
    "import json as _json\n"
    "\n"
    "def exec_notebook(path):\n"
    '    """Load a .ipynb file and execute only its code cells."""\n'
    "    with open(path) as _f:\n"
    "        _nb = _json.load(_f)\n"
    "    for _cell in _nb.get('cells', []):\n"
    "        if _cell.get('cell_type') == 'code':\n"
    "            _src = ''.join(_cell.get('source', []))\n"
    "            exec(_src, globals())\n"
)

def fix_exec_notebook(root):
    notebooks = sorted(glob.glob(os.path.join(root, "**", "session_*.ipynb"), recursive=True))
    count = 0
    for p in notebooks:
        nb = load_nb(p)
        dirty = False
        for cell in nb["cells"]:
            if cell.get("cell_type") != "code":
                continue
            src = cell_src(cell)
            if "exec(open(" not in src or ".ipynb" not in src:
                continue
            new = re.sub(
                r"""exec\(open\((['"][^'"]+\.ipynb['"]+)\)\.read\(\)\)""",
                r"exec_notebook(\1)",
                src,
            )
            if new == src:
                continue
            new = HELPER + new
            set_cell_src(cell, new)
            dirty = True
            count += 1
        if dirty:
            save_nb(p, nb)
            print(f"  [Bug#1] {p}")
    return count


# ── Bug #2: ANTHROPIC_API_KEY required → optional ───────────────────────────

def fix_anthropic_optional(root):
    notebooks = sorted(glob.glob(os.path.join(root, "**", "pipeline_*", "p*.ipynb"), recursive=True))
    count = 0
    for p in notebooks:
        nb = load_nb(p)
        dirty = False
        for cell in nb["cells"]:
            if cell.get("cell_type") != "code":
                continue
            src = cell_src(cell)
            if "ANTHROPIC_API_KEY" not in src or "load_secrets" not in src:
                continue
            new = src

            # ── dict-style: remove from dict, add as optional try ──
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

            # ── comprehension-style: remove from key list, add optional try ──
            if "'HF_TOKEN_TERTIARY','ANTHROPIC_API_KEY']" in new:
                new = new.replace(
                    "'HF_TOKEN_TERTIARY','ANTHROPIC_API_KEY']",
                    "'HF_TOKEN_TERTIARY']",
                )
                new = new.replace(
                    "print('[secrets] Kaggle'); return s",
                    "try:\n"
                    "            s['ANTHROPIC_API_KEY'] = c.get_secret('ANTHROPIC_API_KEY')\n"
                    "        except Exception: pass\n"
                    "        print('[secrets] Kaggle'); return s",
                )

            # ── remove from required list (spaced format) ──
            new = re.sub(
                r"required\s*=\s*\[([^\]]*'HF_TOKEN_TERTIARY'),\s*'ANTHROPIC_API_KEY'\s*\]",
                r"required = [\1]",
                new,
            )
            # ── remove from required list (compact format) ──
            new = new.replace(
                "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY','ANTHROPIC_API_KEY']",
                "required = ['HF_TOKEN_PRIMARY','HF_TOKEN_SECONDARY','HF_TOKEN_TERTIARY']",
            )

            # ── add optional ANTHROPIC in env fallback ──
            if "return {k: os.environ[k] for k in required}" in new:
                new = new.replace(
                    "    return {k: os.environ[k] for k in required}",
                    "    secrets = {k: os.environ[k] for k in required}\n"
                    "    if os.environ.get('ANTHROPIC_API_KEY'):\n"
                    "        secrets['ANTHROPIC_API_KEY'] = os.environ['ANTHROPIC_API_KEY']\n"
                    "    return secrets",
                )

            if new != src:
                set_cell_src(cell, new)
                dirty = True
                count += 1
        if dirty:
            save_nb(p, nb)
            print(f"  [Bug#2] {p}")
    return count


# ── Bug #3: RUN_ID hardcode → read RUN_ID_OVERRIDE env var ─────────────────

def fix_run_id_override(root):
    notebooks = sorted(glob.glob(os.path.join(root, "**", "session_*.ipynb"), recursive=True))
    count = 0
    for p in notebooks:
        nb = load_nb(p)
        dirty = False
        for cell in nb["cells"]:
            if cell.get("cell_type") != "code":
                continue
            new_lines = []
            changed = False
            for line in cell.get("source", []):
                m = re.match(r"^(RUN_ID\s+=\s+)'(run_\d+_\d+)'\s*$", line.rstrip("\n"))
                if m and "os.environ" not in line:
                    prefix, default = m.group(1), m.group(2)
                    new_lines.append(
                        f"{prefix}os.environ.get('RUN_ID_OVERRIDE', '{default}')\n"
                    )
                    changed = True
                else:
                    new_lines.append(line)
            if changed:
                cell["source"] = new_lines
                dirty = True
                count += 1
        if dirty:
            save_nb(p, nb)
            print(f"  [Bug#3] {p}")
    return count


# ── main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    print("=== S2S Pipeline v2.0 — Bug Fix ===\n")

    print("Bug #1: exec(open('.ipynb').read()) -> exec_notebook()")
    n1 = fix_exec_notebook(root)
    print(f"  -> {n1} file(s) fixed\n")

    print("Bug #2: ANTHROPIC_API_KEY required -> optional")
    n2 = fix_anthropic_optional(root)
    print(f"  -> {n2} file(s) fixed\n")

    print("Bug #3: RUN_ID hardcode -> read RUN_ID_OVERRIDE env var")
    n3 = fix_run_id_override(root)
    print(f"  -> {n3} file(s) fixed\n")

    print(f"=== Done! Total: {n1 + n2 + n3} file(s) modified ===")
