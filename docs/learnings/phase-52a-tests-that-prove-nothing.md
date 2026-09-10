# 52-A — three tests that proved nothing, and the check written to catch the last one

**What the user would have got if this had shipped when it first went green:** a search box that highlights nothing. The count says "3 of 7", stepping works, and not one mention is marked. Every gate the project has — 41 component specs, `eslint`, both typechecks, and the production build — passed over it.

The feature is ~170 lines of frontend with no backend. Almost none of the cost was building it.

## The defect that got closest to shipping

A comment in `TranscriptTab.module.css` acquired a second closing `*/`. The prose between the two markers fell outside the comment, and the CSS parser swallowed it plus the selector that followed into one invalid rule. `.match` ceased to exist.

Nothing caught it:

| Gate | Why it passed |
|---|---|
| 41 component specs | The test environment stubs `styles.match` to a string whether or not the rule exists |
| `eslint` | Does not read stylesheets |
| Both typechecks | Same |
| `npm run build` | postcss is lenient; a malformed rule compiles without complaint |

It reached the branch tip and was found by review, by parsing the committed stylesheet with the build toolchain's own parser.

## The part worth keeping: the check written to catch it did not catch it

The obvious guard is "every class the component references must exist as a selector in its stylesheet". That was written, and it passed on the broken file.

The swallowed selector still contains the literal text `.match` — it is sitting inside the prose that became the selector. A check that looks for class *names* therefore finds it and reports the class present, in exactly the state it was written to detect. It was only exposed by reintroducing the defect and watching the check stay green.

What works instead is an invariant the defect cannot satisfy: strip every well-formed `/*…*/` and assert no marker survives. That was watched failing on the reintroduced defect and passing on removal, and is now globbed across all 47 stylesheets rather than the two this slice touched.

**The generalisable point:** a check aimed at a defect is itself a mechanism nobody has watched work. The project already knows this about product code (`a-mechanism-nobody-has-watched-work-is-not-working.md`); this is the same failure one level up, in the guard.

## Three tests of mine that asserted nothing

Each was written *after* the code, to prove a fix. Each passed with the defect present. All three were found by injecting the defect, never by reading them.

| The test | What it was meant to prove | Why it proved nothing |
|---|---|---|
| "the chosen match is kept by position" | That an offset anchor beat an ordinal index | Both designs produce the same result on the case it exercised. Tracing it also showed the anchor did not fix the reported bug — it relocated it. The fix was replaced, not just the test |
| "a phrase finalising does not throw the user back" | That a live transcript keeps the user's position | It fed a clean append. A live transcript never produces one — it replaces its last line as each phrase settles. The test could not distinguish the fix from the bug |
| "a word revised after the read match" + its converse | That the comparison runs to the *end* of the match being read | Both cases put the change wholly before or wholly after the match. The discriminating case — a revision landing *inside* the span — was missing, so `.start` and `.end` were indistinguishable |

The convention already says a spec added after the code must be seen red. The lesson from three instances in one slice is narrower and more useful:

**Injecting the defect is not a formality — it is the only thing that distinguishes a test from a comment.** Two of these tests were written by someone who had just been shown the exact bug, and still failed to encode it. Reading a test cannot tell you this; only running it against the broken code can.

And the corollary that cost the most here: **when the injection reddens nothing, the test is wrong — but so, possibly, is the fix.** The first of the three led to discovering the fix itself was misconceived. A green injection is a signal to re-examine the design, not just to rewrite the assertion.

## Where the design actually landed

The user's position in a transcript survives a change to it if the text *up to and including the match being read* is untouched. Not "did the transcript grow" — a live transcript does not grow by appending; the in-flight line is replaced by the finalised, speaker-labelled turn, and words are revised mid-phrase. Whole-string comparison reset the user once per spoken phrase, which is more disruptive than the bug it replaced.

Two further notes worth carrying:

- **A ref cannot be read during render** to carry the previous value — it is a lint error and unsound, since React may discard the render. Recomputing from the previous transcript costs one bounded scan per change and is correct.
- **A tint alone cannot signal state.** The highlight measures 1.47:1 against its background in the weakest theme, under the 3:1 bar for a non-text indicator. Matches are underlined as well, so the signal never rests on colour.

## Two process defects, both with a one-line fix

1. **Running one test file instead of the suite.** A duplicate assertion in `NoteView.test.tsx` broke; CI found it in ~4 minutes where the full local suite would have found it in 90 seconds. Cost a red build and a round trip.
2. **Skipping `npm run build`.** Lint, typechecks and tests do not compile stylesheets. This is how the invisible-highlight defect reached the branch tip.

The gate for a frontend slice is four commands, and running three of them is not running the gate:

```bash
npm --prefix web run build      # the only one that compiles CSS
npm --prefix web run lint
npm --prefix web exec -- tsc -b .
npm --prefix web test           # the whole suite, not one file
```

Note also that `npx vitest --root web` is **not** equivalent to `npm --prefix web test`: it leaves the working directory at the repo root, so any spec reading a file relative to the working directory fails spuriously. That produced two false alarms this slice.

## Related

- [`a-mechanism-nobody-has-watched-work-is-not-working.md`](a-mechanism-nobody-has-watched-work-is-not-working.md) — the same failure in product code; this slice is the guard-level instance.
- [TI-95](../technical-improvements.md#ti-95-a-failed-deploy-can-go-unnoticed-for-weeks-because-nothing-re-runs-it) — filed during this slice: main's last deploy had been red for 25 days and nothing said so.
