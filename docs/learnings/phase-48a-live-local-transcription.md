# Phase 48-A — live local (on-device) transcription

Slice shipped local whisper transcription in the desktop shell behind a Local/Cloud setting. Frontend live in prod (#400, deploy #703); installer with the bundled whisper binary published to `desktop-latest`.

## Non-obvious learnings

### `publish-desktop` silently skips the installer rebuild when the triggering Deploy completion was a failure — even if the Deploy later goes green via a re-run

- **What happened:** deploy #703 (the 48-A merge) failed twice at the E2E gate on unrelated cold-projector flakes ([BUG-49]), then passed on the 2nd re-run. The frontend deployed to prod, but the desktop installer was **not** rebuilt with 48-A.
- **Why:** `publish-desktop.yml` triggers on `workflow_run: [completed]` of Deploy, with `if: workflow_run.conclusion == 'success'`. The `workflow_run` event that fires carries the conclusion of *that* completion. The failed completions fired events with `conclusion == failure` → the `publish` job's `if` was false → the whole job **skipped**. Re-running the failed *jobs* of the Deploy updated its conclusion to success but did not reliably re-fire a `workflow_run: completed` event that `publish-desktop` acted on; the later auto-runs only saw the subsequent docs commit's diff (no `web/`/`desktop/` change → gate `build=false`).
- **Net:** a frontend/desktop slice can ship its **frontend to prod** while leaving a **stale desktop installer** — invisible unless you check.
- **Fix / rule:** after a desktop or frontend slice whose Deploy **flaked then greened via re-run**, verify `publish-desktop` actually built (check `desktop-latest` was republished with the new `build-sha.txt`). If it skipped, `gh workflow run publish-desktop.yml --ref main` — `workflow_dispatch` always builds (the 31-D design intends exactly this). This is a **mandatory Scribe check for any desktop-touching slice**, alongside the existing "infra slice: verify it's actually live" guardrail.

### Gating a stop-time flush on the stop flag discards exactly what you're flushing

- The live local transcript accumulates via an `onSegments` callback guarded by `if (stoppedRef.current) return`. `stopRecording` sets `stoppedRef = true` **then** awaits `finish()`, which is what produces the flushed tail window — so the guard discarded the tail (deterministic data loss). Caught by Hawk pre-merge.
- **Rule:** a flush that runs *after* a stop signal must be gated on a **later** signal than the stop flag — here `committedRef` (set only after `finish()` resolves), so tail segments still apply before the commit. When you set a "done" flag before an async drain, any consumer gated on that flag stops consuming the drain's output.

## Reinforced (already in guardrails)
- **Bundle the small native binary, download the large weights at runtime** kept the installer at ~88 MB (not ~1.7 GB) while shipping a fully-offline-capable engine after one background fetch. The +5.7 MB over the old 82 MB installer is the whisper binary + DLLs — a good visible confirmation the provisioning worked.
- **Desktop real-capture/latency ACs are manual-on-Windows** (Phase 31 pattern) — the testable logic (parser, windowing, engine-selection, model manifest, IPC contract) is factored into pure modules + a real-binary integration spec; only the physical capture/latency needs the machine.
