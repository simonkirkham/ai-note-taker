#!/usr/bin/env python3
"""Print the space-separated names of tests that FAILED in a VSTest .trx file.

Used by .github/workflows/e2e.yml so an N-run E2E summary can answer "was every
attempt free of journey X" — the question scripts/flake-watch.sh answers for
deploys. A run-level PASS/FAIL cannot distinguish "my flake fix worked" from "a
different journey broke", which is exactly the miscount that recorded BUG-38 as
6 recurrences when the real number was 26.

Prints nothing when the file is missing or holds no failed test (e.g. the suite
died before writing results) — the caller reports that as an infra error.
"""
import pathlib
import re
import sys

if len(sys.argv) < 2:
    sys.exit(0)

try:
    xml = pathlib.Path(sys.argv[1]).read_text(errors="replace")
except OSError:
    sys.exit(0)

# UnitTestResult carries testName and outcome as attributes in either order.
failed = set()
for result in re.findall(r"<UnitTestResult\b[^>]*/?>", xml):
    if 'outcome="Failed"' not in result:
        continue
    name = re.search(r'testName="([^"]+)"', result)
    if not name:
        continue
    # Trim the namespace so the output matches flake-watch.sh's Journey.Test form.
    short = re.search(r"([A-Za-z0-9_]+\.[A-Za-z0-9_]+)$", name.group(1))
    failed.add(short.group(1) if short else name.group(1))

print(" ".join(sorted(failed)))
