#!/usr/bin/env bash
#
# Per-model progress for the most recent analysis-eval run. Reads the run's own
# artifacts (no Bedrock calls), so it is safe to run — or `watch` — while a sweep
# is live:
#
#   scripts/eval-status.sh
#   watch -n 5 scripts/eval-status.sh
#
# "To Run" per model = (#fixtures x #prompts). "Complete" = rows written to the
# run jsonl. "Failed" = SKIP lines in progress.log (only present for runs from the
# streaming-progress harness; older runs show 0 since skips aren't recorded there).
set -euo pipefail

RESULTS_DIR="${1:-tests/Analysis.Eval/bin/Debug/net10.0/Results}"
FIXTURES_DIR="tests/Analysis.Eval/Fixtures"

python3 - "$RESULTS_DIR" "$FIXTURES_DIR" <<'PY'
import json, glob, os, sys, collections

results_dir, fixtures_dir = sys.argv[1], sys.argv[2]
jsonls = sorted(glob.glob(os.path.join(results_dir, "run-*.jsonl")), key=os.path.getmtime)
if not jsonls:
    print(f"(no run-*.jsonl in {results_dir} yet — sweep not started)")
    sys.exit(0)

jsonl = jsonls[-1]
run_id = os.path.basename(jsonl)[:-6]
progress = os.path.join(results_dir, "progress.log")

done = collections.Counter()        # completed rows per model
prompts = set()
for line in open(jsonl):
    try:
        r = json.loads(line)
    except ValueError:
        continue                    # tolerate a half-written final line
    done[r["modelId"]] += 1
    prompts.add(r["promptVersion"])

failed = collections.Counter()      # SKIP per model (streaming-progress runs only)
models = set(done)
if os.path.exists(progress):
    for line in open(progress):
        parts = line.split()
        if len(parts) >= 5 and parts[2] in ("running", "SKIP", "done"):
            m = parts[3]
            models.add(m)
            if parts[2] == "SKIP":
                failed[m] += 1

n_fixtures = len(glob.glob(os.path.join(fixtures_dir, "*.json")))
n_prompts = len(prompts) or 1
per_model = n_fixtures * n_prompts  # "To Run" for each model

w = max([len(m) for m in models], default=20)
print(f"Run {run_id}   prompts: {', '.join(sorted(prompts)) or '?'}   fixtures: {n_fixtures}")
print()
print(f"{'Model'.ljust(w)}  To Run  Complete  Failed  Pending")
print(f"{'-'*w}  ------  --------  ------  -------")
tR = tC = tF = 0
for m in sorted(models):
    c, f = done[m], failed[m]
    pend = max(per_model - c - f, 0)
    tR += per_model; tC += c; tF += f
    print(f"{m.ljust(w)}  {per_model:>6}  {c:>8}  {f:>6}  {pend:>7}")
print(f"{'-'*w}  ------  --------  ------  -------")
print(f"{'TOTAL'.ljust(w)}  {tR:>6}  {tC:>8}  {tF:>6}  {max(tR-tC-tF,0):>7}")
PY
