#!/usr/bin/env bash
#
# Run the analysis evaluation harness end to end and print the report.
#
# By default it sweeps every accessible on-demand Amazon Nova *text* model in the
# region (micro / lite / pro / premier, whatever the account can invoke). Models
# the account has not been granted access to are skipped gracefully at invoke
# time by the test harness, so the report only shows models that actually ran.
#
# Requires AWS credentials with bedrock:ListFoundationModels + bedrock:InvokeModel
# (e.g. AWS_PROFILE=prod). Override the sweep with EVAL_MODEL_IDS="id1,id2".
#
# Usage:
#   make eval
#   AWS_PROFILE=prod make eval
#   EVAL_MODEL_IDS="amazon.nova-lite-v1:0,amazon.nova-pro-v1:0" make eval
#
set -euo pipefail

PROJ="tests/Analysis.Eval/Analysis.Eval.csproj"
# Assumes the default (Debug) build configuration — `dotnet test` below uses Debug.
RESULTS_DIR="tests/Analysis.Eval/bin/Debug/net10.0/Results"
REGION="${AWS_REGION:-eu-west-2}"
# Pace requests between sweep cases so a rate-limited account recovers between calls.
# Override (e.g. EVAL_REQUEST_DELAY_MS=0 for a high-quota account) to run faster.
export EVAL_REQUEST_DELAY_MS="${EVAL_REQUEST_DELAY_MS:-1500}"

# 1. Discover models unless the caller pinned EVAL_MODEL_IDS.
if [ -z "${EVAL_MODEL_IDS:-}" ]; then
  echo "Discovering accessible on-demand Amazon Nova text models in ${REGION}..."
  EVAL_MODEL_IDS=$(aws bedrock list-foundation-models \
    --region "${REGION}" \
    --by-provider amazon \
    --by-output-modality TEXT \
    --by-inference-type ON_DEMAND \
    --query "modelSummaries[?contains(modelId, 'nova')].modelId" \
    --output text 2>/dev/null | tr '[:space:]' ',' | sed 's/,\{2,\}/,/g; s/^,//; s/,$//') || true
  # `aws ... --output text` prints the literal "None" (not an empty string) when the
  # query matches zero models — e.g. creds present but no Nova access grant in-region.
  # Normalise it to empty so the fallback below actually fires.
  [ "${EVAL_MODEL_IDS}" = "None" ] && EVAL_MODEL_IDS=""
  if [ -z "${EVAL_MODEL_IDS}" ]; then
    echo "  discovery returned nothing (no creds / no access?) — falling back to amazon.nova-lite-v1:0"
    EVAL_MODEL_IDS="amazon.nova-lite-v1:0"
  fi
fi
echo "Sweeping models: ${EVAL_MODEL_IDS}"

# 2. Clean prior results so the report reflects only this run.
#    `:?` aborts rather than deleting cwd if the literal ever becomes empty/unset.
rm -rf "${RESULTS_DIR:?}"

# 3. Matrix phase (writes Results/*.jsonl), then report phase (writes report.md).
#    Two phases because the report renders whatever rows exist, and test order
#    is not guaranteed — let the matrix finish writing first.
RUN_BEDROCK_EVAL=1 EVAL_MODEL_IDS="${EVAL_MODEL_IDS}" AWS_REGION="${REGION}" \
  dotnet test "${PROJ}" --filter "Category!=Report"
RUN_BEDROCK_EVAL=1 AWS_REGION="${REGION}" \
  dotnet test "${PROJ}" --filter "Category=Report"

# 4. Print the report.
echo
echo "================= Analysis eval report ================="
if [ -f "${RESULTS_DIR}/report.md" ]; then
  cat "${RESULTS_DIR}/report.md"
else
  echo "(no report.md produced — did any model run? check the skip reasons above)"
fi
echo "========================================================"
echo "Full results: ${RESULTS_DIR}"
