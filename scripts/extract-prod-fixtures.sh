#!/usr/bin/env bash
#
# Extract real meeting notes (those that have a transcript) from the prod note-detail
# projection into eval fixtures, so the analysis harness can be run against real data.
#
#   ⚠️  THE OUTPUT IS REAL USER DATA. This repo is PUBLIC. The output directory is
#       git-ignored AND self-protects with its own `.gitignore` of `*`, so the data can
#       never be committed. Do not move it into the committed Fixtures/ directory.
#
# Fixtures are written with EMPTY expected values: real meetings have no hand-authored
# gold labels, so Tag/Action/Content F1 are meaningless on them — but **Faithfulness**
# (claims-vs-transcript) needs no labels and is the real signal here. Read the per-run
# `Results/<runId>-outputs.md` to eyeball each model's actual output too.
#
# Usage:
#   AWS_PROFILE=prod ./scripts/extract-prod-fixtures.sh
#   OUT_DIR=eval-fixtures-real EVAL_USER_NAME=Simon AWS_PROFILE=prod ./scripts/extract-prod-fixtures.sh
#
# Then sweep models against them:
#   EVAL_FIXTURES_DIR=eval-fixtures-real AWS_PROFILE=prod EVAL_MODEL_IDS="amazon.nova-lite-v1:0,amazon.nova-pro-v1:0" make eval
#
set -euo pipefail

PROFILE="${AWS_PROFILE:-prod}"
REGION="${AWS_REGION:-eu-west-2}"
TABLE="${NOTEDETAIL_TABLE:-notetaker-proj-notedetail}"
OUT_DIR="${OUT_DIR:-eval-fixtures-real}"
USER_NAME="${EVAL_USER_NAME:-Simon}"

command -v jq >/dev/null || { echo "jq is required (install jq)"; exit 1; }

mkdir -p "$OUT_DIR"
# Belt-and-braces: this directory must never be committed (real meeting data, public repo).
printf '*\n!.gitignore\n' > "$OUT_DIR/.gitignore"

echo "Scanning ${TABLE} in ${REGION} (profile ${PROFILE}) for notes with a transcript..."
scan=$(AWS_PROFILE="$PROFILE" aws dynamodb scan \
  --region "$REGION" \
  --table-name "$TABLE" \
  --filter-expression "attribute_exists(TranscriptText)" \
  --output json)

count=$(echo "$scan" | jq '.Items | length')
echo "Found ${count} meeting(s) with a transcript."

echo "$scan" | jq -c '.Items[]' | while IFS= read -r item; do
  id=$(echo "$item" | jq -r '.NoteId.S')
  echo "$item" | jq \
    --arg user "$USER_NAME" \
    '{
      id: .NoteId.S,
      transcriptText: (.TranscriptText.S // ""),
      existingContent: (.Content.S // ""),
      currentUserName: $user,
      expected: { tags: [], actionItems: [], contentMustMention: [] }
    }' > "$OUT_DIR/$id.json"
  echo "  wrote $OUT_DIR/$id.json"
done

echo
echo "Done — ${count} fixtures in ${OUT_DIR}/ (git-ignored, real data, do not commit)."
echo "Faithfulness is the meaningful metric on these; Tag/Action/Content F1 are not (no gold labels)."
