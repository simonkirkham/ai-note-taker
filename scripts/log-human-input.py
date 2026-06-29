#!/usr/bin/env python3
"""Capture every point the pipeline stops for the human, for later analysis.

Two modes:

  append  (default; stdin = Claude Code Notification hook JSON)
          Records a permission-prompt interruption to the per-worktree pending
          file. Wired as a Notification hook in .claude/settings.json. Only
          permission requests are kept; idle/other notifications are ignored.
          Always exits 0 — a hook must never block the session.

  drain   Prints the pending JSONL to stdout and truncates the file.
          Scribe runs this at slice end, classifies the rows, and folds them
          into docs/human-input-log.md. Pass a branch to drain only the rows
          whose cwd is on that branch (parallel-slice safe):
              python3 scripts/log-human-input.py drain [branch]

The pending file lives at <repo-root>/.claude/human-input-pending.jsonl and is
gitignored. Each worktree keeps its own, so entries scope to one slice.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone


def repo_root() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:
        pass
    # Fallback: parent of scripts/
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pending_path(root: str) -> str:
    return os.path.join(root, ".claude", "human-input-pending.jsonl")


def branch_of(cwd: str) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            return out.stdout.strip()
    except Exception:
        pass
    return ""


def append() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # Never block the hook on bad input.

    message = (payload.get("message") or "")
    # Keep only permission requests; drop idle/other notifications.
    if "permission" not in message.lower() and "needs your" not in message.lower():
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "type": "permission",
        "message": message,
        "cwd": cwd,
        "branch": branch_of(cwd),
        "session": payload.get("session_id", ""),
    }

    path = pending_path(repo_root())
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass  # Capture is best-effort; never fail the session.
    return 0


def drain(branch_filter: str | None) -> int:
    path = pending_path(repo_root())
    if not os.path.exists(path):
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = [ln for ln in f.read().splitlines() if ln.strip()]
    except Exception:
        return 0

    kept, drained = [], []
    for ln in lines:
        try:
            row = json.loads(ln)
        except Exception:
            continue
        if branch_filter and row.get("branch") != branch_filter:
            kept.append(ln)
        else:
            drained.append(ln)

    for ln in drained:
        print(ln)

    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(kept) + ("\n" if kept else ""))
    except Exception:
        pass
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "drain":
        branch = sys.argv[2] if len(sys.argv) > 2 else None
        return drain(branch)
    return append()


if __name__ == "__main__":
    sys.exit(main())
