#!/usr/bin/env python3
"""Delete all items from the DynamoDB test tables.

Single source of truth for the table list, shared by:
  - .github/actions/clear-test-data (the deploy gate's pre/post-E2E clear)
  - .github/workflows/e2e.yml       (the on-demand E2E re-runner)

Keeping one list matters: a projection table added here but missed in a second
copy leaks stale read-model rows across runs, which is exactly the class of
cross-run contamination this script exists to prevent.
"""

import boto3

# Clear the event store, EVERY projection table, AND notetaker-proj-position.
# proj-position is critical (BUG-39): it holds the projector's processed-sequence mark per
# stream. If events are cleared but the position marks are not, a STABLE-id stream that the
# next run re-appends to — e.g. the default workspace's `todo-order#__default__` order stream —
# re-numbers its first event as seq 1, which is <= the stale mark, so the projector's
# position guard SKIPS it as a duplicate and the reorder is never applied (the todo order
# silently reverts to AddedAt). Entity streams (note#<guid>, todo#<guid>) dodge this because
# each run uses fresh guids; only stable-id streams collide. Clearing positions alongside the
# events gives the projector a true clean slate. Every projection table is listed so no stale
# read-model rows leak across runs either.
TABLES = [
    'notetaker-events',
    'notetaker-proj-position',
    'notetaker-proj-notetitlelist',
    'notetaker-proj-notedetail',
    'notetaker-proj-noteactions',
    'notetaker-proj-todolist',
    'notetaker-proj-notecardlist',
    'notetaker-proj-tagindex',
    'notetaker-proj-foldertree',
    'notetaker-proj-notesearchview',
    'notetaker-proj-workspacelist',
    'notetaker-proj-actionfeedback',
    'notetaker-proj-tagfeedback',
    'notetaker-proj-calendarlinkindex',
]


def main() -> None:
    dynamodb = boto3.resource('dynamodb')
    for name in TABLES:
        table = dynamodb.Table(name)
        keys = {k['AttributeName'] for k in table.key_schema}
        deleted = 0
        scan = table.scan()
        while True:
            with table.batch_writer() as batch:
                for item in scan['Items']:
                    batch.delete_item(Key={k: v for k, v in item.items() if k in keys})
            deleted += scan['Count']
            if 'LastEvaluatedKey' not in scan:
                break
            scan = table.scan(ExclusiveStartKey=scan['LastEvaluatedKey'])
        print(f'Deleted {deleted} items from {name}')


if __name__ == '__main__':
    main()
