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

# Named presets so you don't have to paste a long EVAL_MODEL_IDS string (pasting
# long lines into a terminal can inject newlines mid-id and break them).
#   EVAL_PRESET=keep      → the live "keep" set read straight from docs/eval-runs/test-matrix.md.
#                           This is the DRIVER: edit the matrix's keep rows and the sweep follows —
#                           the documented decision and the actual run can't drift apart.
#   EVAL_PRESET=core      → reliable cross-vendor set (Amazon + Meta + Mistral), no access grants needed.
#   EVAL_PRESET=frontier  → strong model per vendor, INCLUDING Anthropic (needs Claude access granted).
MATRIX_FILE="${EVAL_MATRIX_FILE:-docs/eval-runs/test-matrix.md}"
case "${EVAL_PRESET:-}" in
  keep)
    if [ ! -f "${MATRIX_FILE}" ]; then
      echo "Preset 'keep': test matrix not found at ${MATRIX_FILE}" >&2
      exit 1
    fi
    # Pull the model id from every row whose status cell is '**keep**'. Model ids are the
    # only provider.model-shaped token on those rows (note text like '0.80' starts with a
    # digit and is excluded), so we avoid matching backticks — a literal backtick inside
    # this $(...) would otherwise start a nested command substitution.
    EVAL_MODEL_IDS=$(grep -F '**keep**' "${MATRIX_FILE}" | grep -oE '[a-z][a-z0-9-]*\.[a-z0-9.:-]+' | paste -sd, -)
    if [ -z "${EVAL_MODEL_IDS}" ]; then
      echo "Preset 'keep': no '**keep**' model rows found in ${MATRIX_FILE}" >&2
      exit 1
    fi
    echo "Preset 'keep' (from ${MATRIX_FILE}): ${EVAL_MODEL_IDS}"
    ;;
  core)
    EVAL_MODEL_IDS="amazon.nova-micro-v1:0,amazon.nova-lite-v1:0,amazon.nova-pro-v1:0,meta.llama3-70b-instruct-v1:0,meta.llama3-8b-instruct-v1:0,mistral.mistral-large-2402-v1:0,mistral.mixtral-8x7b-instruct-v0:1"
    echo "Preset 'core': ${EVAL_MODEL_IDS}"
    ;;
  frontier)
    # Strong model per vendor, including Anthropic. The default Quality judge is Claude 3.7
    # Sonnet and is deliberately NOT in this list, so no model judges itself (the two
    # Anthropic candidates may still get a mild same-vendor bump — see the guide).
    EVAL_MODEL_IDS="amazon.nova-pro-v1:0,amazon.nova-lite-v1:0,anthropic.claude-opus-4-6-v1,anthropic.claude-3-sonnet-20240229-v1:0,meta.llama3-70b-instruct-v1:0,mistral.mistral-large-2402-v1:0"
    echo "Preset 'frontier': ${EVAL_MODEL_IDS}"
    ;;
  "") ;;  # no preset
  *) echo "Unknown EVAL_PRESET='${EVAL_PRESET}' (known: keep, core, frontier) — ignoring" ;;
esac

# 1. Discover models unless the caller pinned EVAL_MODEL_IDS.
#    EVAL_PROVIDER scopes discovery: a Bedrock provider name (e.g. "amazon", "anthropic",
#    "meta") filters to that vendor's on-demand text models; "all" lists every vendor's.
#    Default "amazon" (no access grant needed). Now that analysis speaks Converse (10-N),
#    non-Amazon models work too — but they must be access-granted, and inference-profile-
#    only models (newer Claude/Llama) won't appear here (they aren't ON_DEMAND by raw id).
PROVIDER="${EVAL_PROVIDER:-amazon}"
PROVIDER_FILTER=""
if [ "${PROVIDER}" != "all" ] && [ -n "${PROVIDER}" ]; then
  PROVIDER_FILTER="--by-provider ${PROVIDER}"
fi
if [ -z "${EVAL_MODEL_IDS:-}" ]; then
  echo "Discovering accessible on-demand text models in ${REGION} (provider: ${PROVIDER})..."
  # PROVIDER_FILTER is intentionally unquoted so it word-splits into two args (or none).
  EVAL_MODEL_IDS=$(aws bedrock list-foundation-models \
    --region "${REGION}" \
    ${PROVIDER_FILTER} \
    --by-output-modality TEXT \
    --by-inference-type ON_DEMAND \
    --query "modelSummaries[].modelId" \
    --output text 2>/dev/null | tr '[:space:]' ',' | sed 's/,\{2,\}/,/g; s/^,//; s/,$//') || true
  # `aws ... --output text` prints the literal "None" (not an empty string) when the
  # query matches zero models — e.g. creds present but no access grant in-region.
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

# 3. PREFLIGHT: run the fast offline tests FIRST (builds once, ~seconds). A trivial
#    failure here — e.g. a stale PromptCatalog assertion — aborts now, BEFORE the long,
#    paid live sweep, instead of 30+ minutes after it. Excludes the live Score matrix and
#    the report renderer (both in BedrockEvalTheory). set -e aborts the run if this fails.
echo "Preflight: offline tests (no Bedrock)..."
dotnet test "${PROJ}" --filter "FullyQualifiedName!~BedrockEvalTheory"

# 4. Matrix: the live sweep (only the Score theory). `|| true` so a hard failure or
#    skipped case can't abort the script and lose the report — partial results still count.
echo "Live matrix..."
RUN_BEDROCK_EVAL=1 EVAL_MODEL_IDS="${EVAL_MODEL_IDS}" AWS_REGION="${REGION}" \
  dotnet test "${PROJ}" --no-build --filter "FullyQualifiedName~BedrockEvalTheory.Score" || true

# 5. Report: always render whatever rows were written (even if the matrix hiccuped).
RUN_BEDROCK_EVAL=1 AWS_REGION="${REGION}" \
  dotnet test "${PROJ}" --no-build --filter "Category=Report" || true

# 6. Print the report.
echo
echo "================= Analysis eval report ================="
if [ -f "${RESULTS_DIR}/report.md" ]; then
  cat "${RESULTS_DIR}/report.md"
else
  echo "(no report.md produced — did any model run? check the skip reasons above)"
fi
echo "========================================================"
echo "Full results: ${RESULTS_DIR}"
