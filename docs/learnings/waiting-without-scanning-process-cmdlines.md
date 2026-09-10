# Waiting without scanning process command lines

**A session goes quiet mid-task and stays quiet.** It is waiting for a build or a test run that
already finished, it never reaches another tool round, and **queued messages cannot reach it** —
so a peer or the human asking "are you alive?" gets nothing back. Recovery is killing a process
by hand. Reported twice — on 2026-08-11, and again a day later to a session that was deliberately
checking for it. Both are recalled from those sessions' reports, not measured here; the
self-matching that causes it *is* measured here, and is what the probes below show.

## The tell, first — because it fires on the evidence in front of you

**A process-list match whose `etime` is 0-2 seconds, when the job should have been running for
minutes, is your own command.** Not the job. Check the age before you believe the match:

```
ps -eo pid,etimes,args | grep -F '<fragment>' | grep -vF 'grep -F'
```

Two seconds old means you are looking at the wrapper that just ran this very line. That single
reading separates "the job is still going" from "I am matching myself", and it needs no rule
remembered in advance.

**`ps -eo … -p <pid>` does not filter to that pid.** `-e` selects every process and overrides
`-p`, so the output looks pid-scoped and is not. Drop the `-e` when you mean one process.

## Why it happens

Each Bash tool call runs as `/bin/bash -c … && eval '<the entire command text>'`. The wrapper's
own command line therefore contains **whatever pattern you typed**, and any scan over command
lines finds it.

| Probe | Result on a completely idle box |
| --- | --- |
| `pgrep -fc 'qqq-isolated-nonsense-qqq'` | **1** |
| The same literal, confined to a script run by bare path | **0** |

So `until ! pgrep -f "bin/eslint"; do sleep 15; done` never exits, whatever eslint does.

**It is the invocation that is broken, not `pgrep`.** The identical line inside a committed
script invoked by bare path returns 0 correctly, because nothing wrapping it carries the pattern.
A one-shot scan is fine. A *loop whose exit depends on one* is not.

## It is not a `pgrep` problem, so avoiding `pgrep` does not fix it

Any scan over `ps` output or `/proc/*/cmdline` self-matches on any literal typed in the same tool
call. Confirmed by a session walking into it **while checking for it** — a loop written
specifically to avoid `pgrep -f`:

```bash
for p in $(pgrep -P "$session"); do
  c=$(tr '\0' ' ' </proc/"$p"/cmdline)
  case "$c" in *"while true"*460*461*) alive=1 ;; esac
done
```

Two matches: the real watcher, plus the wrapper running the `case` statement, because the pattern
literals sat in its own command line.

## The count cannot be corrected, so never wait on one

The inflation is **not a constant** — it is one match per concurrent agent wrapper carrying the
literal. Reported from a three-session box: a real count of 31 seen as 34 — that figure is
recalled from the session that hit it, not measured here. "Subtract one" is
wrong and gets more wrong the busier the machine is. **Never trust a count, only a pid.**

The `[b]racket` trick (`grep -cE '[v]itest'`) stops the scan matching the wrapper that *typed*
the pattern, because the wrapper's cmdline carries `[v]itest` and the regex matches `vitest`. It
does **not** stop a *peer session's* wrapper that typed the plain word from matching. So it
narrows the artefact without removing it, and it is not a basis for a wait.

**You cannot A/B the bracket form against the naive form on one command line** — both literals
then sit in the wrapper's cmdline and both match. Same confounder as leaving a control `pgrep` in
the same call. The pattern must appear **nowhere in the invoking command**, not merely nowhere in
the script. Run the two measurements as separate calls or the result is meaningless.

## Wait on something whose value actually changes

| Form | Use when |
| --- | --- |
| `wait <pid>` | the job is a child of this shell |
| `tail --pid=<pid> -f /dev/null` | it is not |
| `until grep -q SENTINEL <file>; do sleep 20; done` | the job writes a completion marker |
| `until [ "$(git rev-parse HEAD)" != "<old-sha>" ]; do sleep 20; done` | waiting on a merge or a push |
| an exit status, or a load ratio | everything else |

## Two traps in the substitutes themselves

**1. `timeout N tail -f FILE | grep -m1 SENTINEL` does not return when the file stops growing.**
`grep -m1` exits on the match, but `tail -f` only learns its reader is gone **on its next write** —
and a finished job writes nothing more. Poll the file instead: `until grep -q SENTINEL <file>`.

**2. A sentinel poll outlives its own condition, and that is sharper than "it does not return".**
From outside, a wait that is late is indistinguishable from a wait that is stuck. Reported by the
session it happened to (not measured here): an agent slept out three full 570-second rounds on a
deploy that had already finished. Bound the
loop with a deadline **and** re-read the underlying state on exit rather than trusting the loop's
own verdict.

## When it has already happened

Kill the **wrapper** pid, not the job's — the job is usually fine; the shell waiting on it is the
one that is stuck.

```
ps -eo pid,ppid,etimes,args | grep -F '<distinctive fragment>' | grep -vF 'grep -F'
```

## What is guarded, and what is not

`scripts/check-cmdline-waits.sh` runs in `.github/workflows/docs-check.yml` and refuses this shape
in any **committed** shell script. It targets the shape — a loop that waits and whose exit turns
on a cmdline scan — not the tool, so a one-shot scan and a bare-path hook use stay green. A
deliberate exception takes `# cmdline-wait-ok: <reason>`; the reason is required.

**It cannot cover an agent typing the loop straight into a Bash call — and that is exactly where
it happened, both times.** No check over committed files reaches that, and `.githooks/` was
deleted from `main` on 2026-08-11, so there is no local hook either. For the ad-hoc case this
page is the fix, and the `etime` reading at the top is the part that works without anyone having
read it.

**Related:** [TI-79](../technical-improvements.md#ti-79-a-wait-loop-that-scans-process-cmdlines-can-never-exit) ·
[a-mechanism-nobody-has-watched-work-is-not-working.md](a-mechanism-nobody-has-watched-work-is-not-working.md)
carries this as instance 2.
