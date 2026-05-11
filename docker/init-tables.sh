#!/bin/sh
# Creates all DynamoDB Local tables. Idempotent — errors from "already exists" are silenced.
set -e

ENDPOINT=http://dynamodb-local:8000

echo "Waiting for DynamoDB Local..."
until aws dynamodb list-tables --endpoint-url "$ENDPOINT" > /dev/null 2>&1; do
  sleep 1
done
echo "DynamoDB Local is ready."

create() {
  aws dynamodb create-table --endpoint-url "$ENDPOINT" "$@" 2>/dev/null \
    && echo "  created: $2" \
    || echo "  already exists: $2"
}

# Event store (composite key)
create \
  --table-name notetaker-events \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# Projections (simple PK)
for table in notetaker-proj-notetitlelist notetaker-proj-notedetail notetaker-proj-notecardlist; do
  create \
    --table-name "$table" \
    --attribute-definitions AttributeName=PK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
done

# Note actions (composite key)
create \
  --table-name notetaker-proj-noteactions \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# Todo list (simple PK + GSI on NoteId)
create \
  --table-name notetaker-proj-todolist \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=NoteId,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH \
  --global-secondary-indexes '[
    {
      "IndexName": "NoteId-index",
      "KeySchema": [{"AttributeName": "NoteId", "KeyType": "HASH"}],
      "Projection": {"ProjectionType": "ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST

echo "All tables ready."
