# TI-67 — the prescribed fix that would not have worked

When something broke in a user's browser — a dead note link, a failed pinned-tab restore, a 404'd editor chunk, a blocked sign-in — nobody found out. Ten event types across sixteen call sites had never emitted once, across six slices, for as long as the feature had existed. Nothing looked wrong: telemetry that never emits is indistinguishable from telemetry with no traffic.

The write-up that eventually fixed it was authored by someone who had diagnosed the problem correctly and was still only **half** right. That half is the lesson.

## The row was right about a cause, and wrong that it was *the* cause

[TI-67] said: CloudWatch RUM drops custom events unless they are enabled on the app monitor, AWS defaults that to `DISABLED`, and `CustomEvents` appears nowhere in the CDK. All true. Add `CustomEvents.Status = ENABLED` and the row closes.

There was a second gate, independent of the first, and either one alone kept every event inert. `recordRumEvent` called `cwr("recordEvent", type, data)` — three positional arguments — but the deployed 3.x client installs the global as `(c, p) => push({c, p})`, **arity two**. The third argument was dropped on the floor, `recordEvent` received the bare `type` string, its own parameter guard threw `IncorrectParametersException`, and a `try/catch` added by an earlier bug swallowed it.

## Why shipping the prescribed fix would have been worse than the bug

Ship only the CDK half and every observable signal says success:

| What you would check | What it would say |
| --- | --- |
| `get-app-monitor` | `"CustomEvents": {"Status": "ENABLED"}` |
| The tracking row | Closed, with a PR and a deploy number against it |
| The RUM log group | Still no custom events, ever |

The third line is the only true one, and it is the only one nobody re-reads after a row is closed. A defect that has been "fixed" is far more expensive than one still open, because the closing is what removes the reason to look again. **A fix that closes a row without changing the world is not a partial win; it is a net loss.**

The client half surfaced only because the PR was reviewed against the **shipped artefact** — the deployed client's actual signature — rather than against the write-up. The write-up was the thing everyone agreed on, and the write-up was wrong.

## A partially-working channel is worse than a dead one

`recordError` was never affected: it genuinely takes one payload, so arity two was enough. JS errors landed in RUM throughout.

That is precisely why the gap survived six slices. A channel that is completely dead invites the question "is this thing on?". A channel delivering *something* answers that question before it is asked — you open RUM, you see errors arriving, you conclude telemetry works. The working half is what made the broken half invisible, and it will do the same in any system with more than one kind of signal on one transport.

## What to do differently

1. **Treat a tracking row's prescribed fix as a hypothesis, not a spec.** The row records what someone knew when they wrote it. Check it against the artefact before implementing it, and expect the check to be cheap relative to shipping a fix that changes nothing. This is the second time in a week the prescribed fix in a row was wrong in a way that reviews cleanly — [TI-68]'s cap was written against a Vitest option that had been removed and accepts as a silent no-op.
2. **Prove the mechanism by observation, and know which observations are proxies.** Three checks were run here, in order: the 90-day baseline (5 285 records, only built-in `com.amazon.rum.*` types, zero custom types ever), the deployed monitor reporting `ENABLED`, and finally the shipped bundle driven headlessly until an event was **read back** from the log group (`authStorageBlocked`, `event_id 3d732878-…`, 08:26:28Z — the first custom event in the log group's history). Steps 1 and 2 both passed while the property was still false. Only step 3 could fail for the real reason.
3. **When one signal on a shared transport works, verify the others individually.** Do not let a live channel stand as evidence for its neighbours.
4. **Write the test against the dependency's real guard.** `web/src/__tests__/recordRumEvent.test.ts` replays the deployed client's own parameter check, so a wrong-arity call fails a test instead of vanishing into a `catch`. Mutation-tested across nine variants with zero false greens — a test for a swallowed error is worthless unless you have watched it go red.

## Related

- [`a-mechanism-nobody-has-watched-work-is-not-working.md`](a-mechanism-nobody-has-watched-work-is-not-working.md) — the general form. TI-67 is its sharpest instance: four mechanisms were found never to have executed on the same day, and all four had passed review.
- [TI-78] — the follow-up found while verifying this one: the injected snippet never sets `sessionEventLimit`, so the client default of 200 applies and custom events are dropped silently late in a long session. Same self-concealing shape, one layer along.
- Full evidence trail: the `## TI-67` entry in [`technical-improvements-archive.md`](../technical-improvements-archive.md).
