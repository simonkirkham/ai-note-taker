# TI-42 — the reload-tolerant E2E assert was secretly ungated

**PR #390, deploy #694 (green attempt 1). Test-only fix for the residual cards-list deploy-gate flake.**

## The flake
`AssertNoteVisibleInListAfterReloadAsync` (create a note → reload → assert its card in the home list) intermittently failed with `cards(0)=[]` — the whole list empty, `200`, correct `/w/__default__/` workspace, for the full 30s window. ~2/15 deploys needed a rerun.

## Two false trails (both wrong)
1. **"Workspace context on reload."** The standing hypothesis for a year. Wrong: every failed read correctly targeted `/w/__default__/`. The list was empty because the read raced the projector, not because it queried the wrong workspace.
2. **"Cold projector → keep it warm (TI-52)."** Tempting, but the deploy gate already warms the projector at suite start (`"caught up after 1 poll"`) and the suite writes continuously, so it's warm throughout. Keep-warm is a *prod* cold-read concern (BUG-31, a user at 8am), not this. Don't reach for infra when the test is the problem.

## The actual cause — a comment that lied
The helper's own comment said the post-reload `GET /notes/cards` *"carries the sessionStorage-persisted token, so the gate waits for the projector and the card appears deterministically."* It usually **doesn't**:

- The client RYW helper `gatedRead` **clears** the token after the first *fresh* read (`onFresh` → `clearLatestToken`). The pre-reload home fetch consumes it.
- So after the reload, `getLatestToken(noteCards)` is `null` → the cards read goes out with **no `If-Consistent-With`** → the server `ConsistencyGate` no-ops → returns `200`/current-projection **immediately**.
- The helper then polls that **ungated** read for 30s, *hoping* the projector catches up. It usually does; occasionally (bursty E2E projector) it doesn't within 30s → flake.

Compounding: the per-attempt `ToBeVisibleAsync(Timeout=2500)` was **below** the 8s server gate cap, so on the rare occasion the token *did* survive, the next reload aborted the gated read before it could converge. **A reload cadence shorter than the gate cap actively defeats the gate.**

## The fix (test-only)
- Capture the note-write `X-Consistency-Token` from the response header (sync read — never a body read; the 44-min-hang lesson).
- Re-inject it as `If-Consistent-With` on every post-reload cards read via a Playwright route, so the read **waits** for the projector instead of racing it.
- Raise the per-attempt timeout to 9s (above the 8s cap) so a reload can't abort a gated read mid-converge.
- Log `X-Consistency` (fresh/stale) + the injected token in the failure diagnostic, so a residual failure is **provable** (gated-stale = projector genuinely behind; fresh-empty = a real projection bug) rather than guessed.

## Reusable lessons
1. **A "reload-tolerant, re-gating" assert is only re-gating if the token actually survives the reload.** RYW tokens are consumed+cleared on first fresh read; a reload that re-fires the read has no token. Don't trust the comment — trace whether `If-Consistent-With` is on the wire (now logged).
2. **Never set a reload/retry cadence shorter than the server-side wait it's meant to ride out.** 2.5s reloads vs an 8s gate cap = the gate never gets to finish. Match the per-attempt timeout to the thing you're waiting on.
3. **An ungated read returning `200`/empty is indistinguishable from a caught-up-but-wrong-scope read** — which is why the workspace hypothesis survived a year. Capture the `X-Consistency` header to tell "raced" from "genuinely behind" from "wrong scope."
4. **Reach for the test fix before the infra fix.** Keep-warm (recurring infra) was the seductive answer; the real bug was a $0 test-determinism gap. Match the fix to where the defect actually is.
5. Same latent race lives in the sibling ungated-reload cards helpers (`WaitVisibleWithReloadAsync`, `AssertCardTagVisibleAfterReloadAsync`) — generalise the re-gate if they flake.

## Caveat
One green deploy (attempt 1) is a data point, not proof — the flake was intermittent. Watch the next several deploys; the enriched diagnostic is the safety net.
