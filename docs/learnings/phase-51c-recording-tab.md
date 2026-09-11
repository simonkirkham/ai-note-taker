# Phase 51-C — A recording keeps running while I read another note

**What the user got:** switching notes, going to the notes list, a folder or Unfiled no longer asks and no longer ends a recording. The recording note carries a pulsing dot in the tab bar.

## The lesson: a consequence of an event belongs to the thing that owns the event, not the screen showing it

| Round | What the user hit | Patch |
| --- | --- | --- |
| 1 | Glance at another note mid-meeting, press Stop: never written up | Moved the "recorded this session" flag and one-shot latch into the session |
| 4 | Automatic write-up fails, press Analyse, glance away: written up a third time | Manual success re-takes the shared claim |
| 5 | Analyse ANY other note mid-meeting: the meeting is never written up | — the claim was the defect |
| 5 | On device, finish saving while reading another note: waits for you, erased if you record there first | — same |

- **Why it kept breaking:** the write-up was run by the record control, which unmounts whenever you look at another note. To survive that, "the one write-up this meeting is owed" became a single app-wide flag, and every note's control could touch it.
- **What fixed it:** the recording session runs the write-up itself when the meeting is ready. No flag is shared, so there is nothing to keep right. The control only displays progress and errors.
- **The tell, for next time:** a patch that adds a latch, a claim or a "have I already…" flag to keep a side effect exactly-once across remounts means the side effect lives in the wrong component. Move it up to whatever outlives the remount before writing the second patch, not the fifth.

## Also worth keeping

- **The render-churn spec needed the query client once the session refreshed notes.** Any provider that starts calling `useQueryClient` breaks isolated specs that mount it bare; `main.tsx` always provides one.
- **A test run on Windows with `node_modules` installed from WSL cannot load native bindings** (`@rollup/rollup-win32-*`, `unrs-resolver`). `npm ci` from the Windows side fixes it; the worktree's `.git` link also needs `git worktree repair` because it points at `/mnt/c/...`.
- **One unrelated flake surfaced** in a full run — filed as [BUG-83](../phases/phase-bugs.md) (fast-follow).
- **A spec that cannot express a pass in its environment accuses the code.** A sign-out assertion sat commented out as an "open defect" for a round; the harness lacked `VITE_GOOGLE_CLIENT_ID`, so the app ran in no-auth mode and could never reach the sign-in screen. Stubbing it made the assertion live — and deleting the real `proceed?.()` then reddened it and one sibling only.
- **The new E2E journey passed on its first real run.** `RecordingTabJourney` could only go green once the frontend shipped (`e2e.yml` runs branch tests against the already-deployed app). Deploy #776 attempt 1 ran 32 journeys to #775's 31 and failed only `OpenNoteTabsJourney` — a [BUG-81] recurrence — so the recording journey is the extra one that passed.
