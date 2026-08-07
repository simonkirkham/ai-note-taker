# BUG-56 / TI-58 — the live path that never ran, and the gate that would have caught it

**Slices:** BUG-56 (#426, deploy #729) · TI-58 (#430, deploy #728) · BUG-64 (filed + fixed inside #426).

**What shipped:** the resident `whisper-server` is finally spawned as `whisper-server`, not `whisper-cli`; its failures are actually rendered; `desktop/tests/` now runs in PR CI for the first time.

## The bug in one line

`WhisperServer` was constructed with `whisperBinPath()` — which returns **`whisper-cli.exe`**. `whisper-server` and `whisper-cli` are different binaries in the same whisper.cpp bundle, and only the server accepts `--host`/`--port`. The CLI exits on the unknown argument, so BUG-53's resident server **never started once** between shipping in July and this fix. `whisper-server.exe` was in the installer the whole time; nothing pointed at it.

## Non-obvious lessons

### 1. A test that reaches its dependency by a private route proves the dependency works — never that the app reaches it

`whisperServer.integration.spec.ts` exercised the **real** `whisper-server` binary and passed. It took that binary from a hand-supplied `WHISPER_SERVER_BIN`, while production resolved `whisperBinPath()`. The test and the app disagreed about which binary production uses, and **no test asserted the production wiring**.

This is the same class as the BUG-53 lesson ("a replaced component's half-wired contract is a lie until you re-check every consumer") but the unchecked consumer was the **binary path**, not the error channel. The cheap fix is the one that locks it: `whisperPaths.spec.ts` asserts the *resolver*, including a negative that `WHISPER_BIN` must not redirect the server. That spec is worth more here than a Windows runner would have been.

> Generalisation: when a test supplies a dependency by a route production doesn't use — env var, constructor arg, DI override — something else must assert that production reaches the same thing.

### 2. Fixing a "mechanism that looked wired but wasn't" is unusually prone to reproducing that exact shape

Three adversarial review rounds; **every** round found the fix committing the original sin again:

| Round | The fix's own dead mechanism |
|---|---|
| 1 | A spec deleted `WHISPER_SERVER_BIN` process-wide, silently turning the only real-binary spec into a permanently-skipped no-op that still reported green |
| 2 | The new 75 s ready deadline could never fire — `start()` kills the child at its own 60 s timeout, so the guard saw a dead process every time |
| 3 | A start failure was sent to a renderer that had already detached its listener, so a short recording still hid a permanently dead engine |

None were caught by tests; all three were caught by review. The pattern is worth naming because it recurs: **when the bug is "a path nobody verified", the patch tends to add another one.** Budget for more review rounds than usual on this bug class, and prefer fixes that are *observable* over fixes that are *defensive*.

### 3. A safety net whose threshold sits above the thing it guards is dead code — lock the invariant with a test

`READY_TIMEOUT_MS` (75 s) sat above `WhisperServer`'s 60 s start deadline, and `start()` nulls `proc` on give-up. So the deadline could only ever observe a dead process. It read as a live safety net in review and in the comments; it was unreachable by construction.

The fix is not just "change the number" — it is exporting `SERVER_START_TIMEOUT_MS` and asserting `READY_TIMEOUT_MS < SERVER_START_TIMEOUT_MS`, so the relationship cannot silently invert later. **Verify such a guard is non-vacuous by inverting the constant and watching it fail** (done here).

> Generalisation: any two timeouts in different modules that must be ordered are an invariant. Comments do not hold it; a test comparing the exported constants does.

### 4. An error channel is only as good as its last consumer — check what *renders*, not what *sends*

`local:error` fired correctly, `setError()` ran correctly, and the user saw nothing — because `RecordControl` gated the banner on `status === "error"` while the on-device handler deliberately leaves `status === "recording"` (audio is still captured, so it is a warning not a stop). Two correct halves, no visible result.

The same shape appeared again in round three: a message sent after the listener detached. **Trace a failure signal all the way to a pixel**, not to the send call.

### 5. Nothing ran `desktop/tests/` — an entire subsystem outside CI

`pr.yml` had no desktop job; `publish-desktop.yml` builds the installer and runs no tests. **BUG-52, BUG-53 and BUG-56 all reached a user's machine through that gap** — three user-reported bugs in one subsystem, which is what "no gate" costs.

TI-58 closed it in ~1 min of runner time on ubuntu (xvfb is present on the image by default; Electron needs no extra libs; `_electron` uses the binary from `node_modules`, so no `playwright install`). The non-obvious dependency: `web/` is **required**, because `npm --prefix desktop run build` stages the frontend into `desktop/web-dist`, which `server.spec.ts` and `shell.e2e.ts` serve and assert against — verified by watching `server.spec.ts` go 0/4 → 4/4 across that build step.

The remaining gap is named, not hand-waved: an ubuntu runner always takes the Linux arm of `process.platform`, so the Windows half is TI-59.

### 6. Diagnostic questions should discriminate between hypotheses, not just gather facts

Two observations from the user settled it: **`resources/whisper/` present** and **no whisper process in Task Manager while recording**. Together those separate *wrong binary* from *missing binary* — the binary ships but is never spawned. Either fact alone would not have.

The code diagnosis actually landed first, so the observations served as confirmation; the useful habit is picking the check whose two outcomes point at different causes.

### 7. Check the register before filing — this gap was already filed, and got filed again

TI-58 was raised on 2026-08-07 for "nothing runs `desktop/tests/`". **[TI-53] had been filed for exactly that gap on 2026-08-06**, one day earlier, by Hawk reviewing CHANGE-37 — and it was even referenced in that slice's own `_minor-log` entry. It was missed because the new item was written straight from the BUG-56 evidence without reading `technical-improvements.md` first.

Cost was low (Scribe caught it, TI-53 now carries the outcome and TI-58 the detail), but it is the exact failure the index-first convention exists to prevent, and it follows a recent commit that repaired numbering collisions across the docs tree. **Before adding a row to any standing register, grep it for the thing you are about to file.** The `work-status` skill and the register's own Summary table both answer this in one read.

## Process notes

- The desktop gate went red on its **first** PR — `shell.e2e.ts` asserting with `expect(...).toBeVisible()` (5 s expect timeout) while its sibling used `locator.waitFor()` (30 s default). Filed as [BUG-64], fixed in-slice because a red shared gate blocks everyone. Playwright's per-**test** `timeout` in the config does not raise the per-**assertion** expect timeout — an easy misread.
- The stop-time `small.en` pass (~2.3× realtime) was **correctly** diagnosed as expected cost, not a defect, and left alone. Worth noting that the user's report bundled it with the real fault; separating "slow but working" from "silently broken" early kept the slice small.
- Local transcription's live path has still **never been observed working on Windows**. Everything here is proven by headless tests and code reading. `MANUAL-VERIFICATION.md` §BUG-56 rows 2–3 are the first real evidence, and TI-59 exists because that gap cannot be closed from CI as it stands.
