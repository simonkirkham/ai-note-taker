# Phase 10 — Transcription & high-quality analysis

**Goal:** Produce a *high-quality* AI analysis of a meeting note — and build the means to keep it high quality. The user records audio (local mic plus, optionally, remote-call audio); AWS Transcribe Streaming produces a live rolling transcript; Amazon Bedrock analyses the transcript against the existing note content and applies gap-filling content, tags, and action items. Analysis quality is then made **measurable** — an offline evaluation harness scores prompt/model variants over fixed transcripts — and **improvable** — durable capture of which AI suggestions users keep, reject, or complete provides the correction signal that feeds prompt/model refinement, tied to a specific prompt version.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 10-A | UX prototype | Done | — |
| 10-B | Live transcript | Done | 10-A |
| 10-C | Persist transcript | Done | 10-B |
| 10-D | Manual analysis | Done | 10-C |
| 10-E | Auto-analysis on stop | Done | — |
| 10-F | Capture remote participants (system audio mix) | Done | — |
| 10-G | Analysis evaluation harness | Done | — |
| 10-H | Analyse note content (transcript optional) | Done | — |
| 10-I | Record AI tag suggestions (`TagsSuggested`) | Done | — |
| 10-J | Tag feedback projection | Done | 10-I |
| 10-K | Record AI action-item suggestions (`ActionItemsSuggested`) | Done | — |
| 10-L | Action-item feedback projection | Done | 10-K |
| 10-M | Stamp modelId / promptVersion on the suggestion events | Done | 10-G, 10-I, 10-K |
| 10-N | Migrate analysis to the Converse API (model-agnostic) | Done | — |
| 10-O | Ship `analysis@v3` as the production prompt | Done | 10-G |

Phase 10 has two parts. The **core flow** (10-A → 10-H) makes recording → transcription → analysis work end to end. The **quality track** (10-E, 10-F, then 10-G → 10-M) makes that analysis *good* and *keeps it good*: better input, smoother UX, measurement, and a durable correction signal that feeds prompt/model refinement. Slices 10-I → 10-M were moved here from the former Phase 13 ("Feedback capture for AI suggestions") so that analysis quality — building it, measuring it, refining it — lives in one phase.

CDK wiring for transcription is bundled into 10-B (where it is first needed); Bedrock IAM into 10-D. *(10-H was delivered ahead of 10-E.)*

**Dependencies:** 10-J depends on 10-I; 10-L depends on 10-K; the tag track (10-I/J) and the action track (10-K/L) are independent and either may land first. 10-M depends on the versioned prompts from 10-G and on the suggestion events (10-I, 10-K). 10-E, 10-F, and 10-G are independent of everything else and of each other.

---

## Slice 10-A — UX prototype

**Status:** Done (approved)

---

## Slice 10-B — Live transcript

**Status:** Done

### Scenarios

```
Scenario: Record button starts transcription
  Given I am on the note screen
  When I press the Record button
  Then the TranscriptionPanel shows a recording indicator and elapsed timer
  And the GET /transcription/credentials endpoint is called

Scenario: Spoken words appear in real time
  Given I am recording
  When Transcribe Streaming returns a transcript result
  Then the text appears in the panel
  And the panel scrolls to show the latest text

Scenario: Credentials endpoint requires authentication
  Given no valid JWT is present
  When GET /transcription/credentials is called
  Then the response is 401 Unauthorized
```

---

## Slice 10-C — Persist transcript

**Status:** Done

### Scenarios

```
Scenario: Transcript is persisted when recording stops
  Given a Note exists
  When CompleteTranscription is handled with "Action items: fix the login bug"
  Then TranscriptionCompleted is raised
  And the note's TranscriptText is "Action items: fix the login bug"

Scenario: Transcript survives a page reload
  Given a note has a TranscriptionCompleted event
  When the note screen is opened
  Then the transcript text is visible in the TranscriptionPanel

Scenario: Re-recording overwrites the previous transcript
  Given a Note has an existing TranscriptionCompleted event
  When CompleteTranscription is handled again with new text
  Then TranscriptionCompleted is raised with the new text
  And the note's TranscriptText is updated to the new text
```

---

## Slice 10-D — Manual analysis

**Status:** Done

### Scenarios

```
Scenario: Analysis fills gaps in the note content
  Given a Note with content "Discussed login bug." and a transcript "We agreed to fix login by Friday. Owner: Alice."
  When POST /notes/{id}/analyse is called
  Then ContentEditedV2 is raised with updated content that includes the owner and deadline
  And no duplicate content is introduced

Scenario: Analysis extracts action items from the transcript
  Given a Note with no action items and a transcript mentioning "Alice will fix the login bug by Friday"
  When POST /notes/{id}/analyse is called
  Then ActionItemAdded is raised for "Alice will fix the login bug by Friday"

Scenario: Analysis extracts tags from the transcript
  Given a Note with no tags and a transcript about "login" and "authentication"
  When POST /notes/{id}/analyse is called
  Then TagAdded is raised for each inferred tag

Scenario: Analysis requires a transcript to exist
  Given a Note with no TranscriptionCompleted event
  When POST /notes/{id}/analyse is called
  Then the response is 422 Unprocessable Entity

Scenario: Analysis requires authentication
  Given no valid JWT is present
  When POST /notes/{id}/analyse is called
  Then the response is 401 Unauthorized
```

---

## Slice 10-E — Auto-analysis on stop

**Status:** Done

### Scenarios

```
Scenario: Auto-analysis fires when switch is on and recording stops
  Given the auto-analyse switch is ON (default)
  When I stop the recording
  Then analyseNote() is called automatically
  And a loading state is shown in the panel

Scenario: Auto-analysis is suppressed when switch is off
  Given the auto-analyse switch is OFF
  When I stop the recording
  Then analyseNote() is not called
  And the "Save & Analyse" button is visible

Scenario: Switch resets to ON on page reload
  Given I turned the auto-analyse switch OFF
  When I reload the note screen
  Then the switch is ON again
```

---

## Slice 10-F — Capture remote participants (system audio mix)

**Status:** Done

### Scenarios

```
Scenario: System audio is mixed with mic when toggle is on
  Given the "Include call audio" toggle is ON
  When I press Record and grant screen-share permission
  Then getDisplayMedia is called with { audio: true, video: true }
  And the resulting audio track is mixed with the microphone track

Scenario: Falls back to mic-only if screen-share is cancelled
  Given the "Include call audio" toggle is ON
  When I press Record and cancel the screen-share prompt
  Then recording continues with microphone audio only
  And no error is shown

Scenario: Mic-only when toggle is off
  Given the "Include call audio" toggle is OFF
  When I press Record
  Then getDisplayMedia is not called
  And recording uses the microphone only
```

---

## Slice 10-G — Analysis evaluation harness

**Status:** Done — shipped 2026-06-03 (PR #132, deploy #418). See [learnings](../learnings/_archive.md) and the [testing guide](../guides/analysis-eval-harness.md).

### Scenarios

```
Scenario: TagScorer is case-insensitive and order-independent
  Given expected tags ["auth", "Backend"]
  And predicted tags ["backend", "AUTH"]
  When the tag scorer runs
  Then precision is 1.0, recall is 1.0, F1 is 1.0

Scenario: TagScorer penalises missing tags
  Given expected tags ["auth", "backend"]
  And predicted tags ["auth"]
  When the tag scorer runs
  Then recall is 0.5

Scenario: ActionItemScorer matches after normalisation
  Given expected actions ["Fix the login bug by Friday."]
  And predicted actions ["fix the login bug by friday"]
  When the action item scorer runs
  Then precision is 1.0 and recall is 1.0

Scenario: ContentJudge counts present facts
  Given content "Bob agreed to update the docs by Tuesday."
  And required facts ["Bob will update the docs", "Alice has no action items"]
  And a stub judge that returns YES, NO
  When the content judge runs
  Then the score is 0.5

Scenario: PromptCatalog.Current returns analysis@v1 by default
  When PromptCatalog.Current is read
  Then its Version is "analysis@v1"

Scenario: BedrockAnalysisService stamps the prompt version and model on the result
  Given the service is constructed with PromptCatalog.V1 and model "amazon.nova-lite-v1:0"
  When AnalyseAsync returns
  Then NoteAnalysisResult.ModelId is "amazon.nova-lite-v1:0"
  And NoteAnalysisResult.PromptVersion is "analysis@v1"

Scenario: Eval runner is skipped when RUN_BEDROCK_EVAL is unset
  Given the environment variable RUN_BEDROCK_EVAL is not set
  When the eval theory is invoked
  Then every test is reported as skipped

Scenario: Eval runner emits one results row per fixture per (model × prompt)
  Given 2 fixtures, 1 prompt, 1 model, and RUN_BEDROCK_EVAL=1
  And a stub Bedrock that returns a known analysis result
  When the eval theory runs
  Then 2 rows are appended to the run's results file
  And each row carries the fixture id, model id, prompt version, and three score values

Scenario: Report aggregates results into a markdown table
  Given a Results directory with one .jsonl run file containing 3 rows for analysis@v1 + nova-lite
  When Report runs
  Then a markdown table is printed with one row per (prompt, model) pair
  And mean tag F1, action F1, and content score are reported
```

---

## Slice 10-H — Analyse note content (transcript optional)

**Status:** Done

### Scenarios

```
Scenario: Analysis runs on note content when no transcript exists
  Given a Note with content "Met with Bob about the login bug." and no TranscriptionCompleted event
  When POST /notes/{id}/analyse is called with updateContent = false
  Then TagAdded is raised for each inferred tag
  And ActionItemAdded is raised for each extracted action item
  And the response is 204 (no 422)

Scenario: Analysis combines content and transcript when both exist
  Given a Note with content "Login bug." and a transcript "Alice will fix it by Friday."
  When POST /notes/{id}/analyse is called
  Then the analysis request includes both the existing content and the transcript text

Scenario: Content is rewritten when the switch is on
  Given a Note with rough content and updateContent = true
  When POST /notes/{id}/analyse is called
  And the model returns gap-filled content
  Then ContentEditedV2 is raised with the updated content

Scenario: Content is left untouched when the switch is off
  Given a Note with hand-written content "My private notes."
  When POST /notes/{id}/analyse is called with updateContent = false
  Then no ContentEditedV2 event is raised
  And the note content is unchanged
  And TagAdded / ActionItemAdded may still be raised

Scenario: Analysis requires something to analyse
  Given a Note with empty content and no TranscriptionCompleted event
  When POST /notes/{id}/analyse is called
  Then the response is 422 Unprocessable Entity

Scenario: Analysis requires authentication
  Given no valid JWT is present
  When POST /notes/{id}/analyse is called
  Then the response is 401 Unauthorized
```

---

## Slice 10-I — Record AI tag suggestions

**Status:** Done

### Scenarios

```
Scenario: Recording suggestions raises TagsSuggested
  Given a Note exists
  When RecordTagSuggestions is handled with ["auth", "backend"]
  Then TagsSuggested is raised with tags ["auth", "backend"]

Scenario: An empty suggestion list raises nothing
  Given a Note exists
  When RecordTagSuggestions is handled with []
  Then no event is raised

Scenario: Recording on a missing note is rejected
  Given no Note exists
  When RecordTagSuggestions is handled
  Then it throws InvalidOperationException

Scenario: Analysis records only the newly-applied AI tags
  Given a Note already tagged "auth" and a transcript about login and auth
  When POST /notes/{id}/analyse runs and the model returns ["auth", "login"]
  Then a TagsSuggested event is appended listing only ["login"]
  And NoteTagged is appended for "login"
```

### Acceptance criteria

- [x] `RecordTagSuggestions` command + `TagsSuggested` event added; `Note` handles and applies (no-op) them
- [x] Empty tag list raises no event; missing/deleted note throws
- [x] `AnalyseNote` records the post-dedup applied tag set as `TagsSuggested` before the `NoteTagged` events
- [x] Event registered for (de)serialisation; existing streams still rebuild
- [x] `docs/event-model.md` + `docs/event-schemas.md` updated
- [x] Domain.Specs + Api.Integration specs green; `cdk synth` succeeds

---

## Slice 10-J — Tag feedback projection

**Status:** Done

### Scenarios

```
Scenario: A suggested tag increments the suggested count
  Given an empty TagFeedback projection
  When TagsSuggested for user "alice" lists ["auth"] on note N
  Then feedback for (alice, "auth") has suggested=1, rejected=0

Scenario: Removing a suggested tag increments the rejected count
  Given user "alice" was suggested "auth" on note N
  When "auth" is untagged from note N
  Then feedback for (alice, "auth") has suggested=1, rejected=1

Scenario: Removing a manually-added tag is not a rejection
  Given "auth" was added to note N with no prior suggestion
  When "auth" is untagged from note N
  Then no rejected count is recorded for "auth"

Scenario: A rejection counts once per suggestion
  Given "auth" was suggested then untagged on note N (rejected=1)
  When "auth" is manually re-added to note N and removed again
  Then rejected for (alice, "auth") stays 1

Scenario: Deleting a note clears provenance but not counts
  Given user "alice" was suggested "auth" on note N (suggested=1)
  When note N is deleted
  Then suggested for (alice, "auth") remains 1
  And provenance for (N, "auth") is removed

Scenario: The projection rebuilds from the event stream
  Given a stream with TagsSuggested and NoteUntagged events
  When projections are rebuilt
  Then TagFeedback counts equal the live projection's
```

### Acceptance criteria

- [x] View, store (single table, two row types), and update added; `NoteTagged` ignored. **Wired inline in `NoteCommandHandler`, not as an `IDomainEventHandler`** — the dispatcher is dead code (`DispatchAsync` is never called); live updates use `currentUser.UserId` and the rebuild projection reads `envelope.Metadata.UserId`. Recorded in `docs/technical-improvements.md`.
- [x] Rejection consumes its provenance row; note deletion clears provenance without altering counts
- [x] Wired into `ProjectionRebuildHandler`; rebuild reproduces live counts (integration parity test)
- [x] Registered in `Builder.cs`; env var in `Program.cs` + CDK; table created with `RETAIN`
- [x] `Infrastructure.Assertions` asserts the table; `docs/view-schemas.md` updated
- [x] All specs green; `cdk synth` succeeds

---

## Slice 10-K — Record AI action-item suggestions

**Status:** Done

### Scenarios

```
Scenario: Recording action suggestions raises ActionItemsSuggested
  Given a Note exists
  When RecordActionItemSuggestions is handled with [id1, id2]
  Then ActionItemsSuggested is raised listing [id1, id2]

Scenario: An empty list raises nothing
  Given a Note exists
  When RecordActionItemSuggestions is handled with []
  Then no event is raised

Scenario: Analysis records the IDs of the action items it created
  Given a Note and a transcript with "Alice will fix the login bug"
  When POST /notes/{id}/analyse extracts one action item for the current user
  Then ActionItemAdded is appended for it
  And ActionItemsSuggested is appended listing that action item's ID
```

### Acceptance criteria

- [x] `RecordActionItemSuggestions` command + `ActionItemsSuggested` event added; `Note` handles and applies (no-op) them
- [x] Empty list raises nothing; missing/deleted note throws
- [x] `AnalyseNote` records the IDs of the action items it created, after creating them
- [x] Event registered for (de)serialisation; existing streams still rebuild
- [x] `docs/event-model.md` + `docs/event-schemas.md` updated
- [x] Domain.Specs + Api.Integration specs green; `cdk synth` succeeds

---

## Slice 10-L — Action-item feedback projection

**Status:** Done

### Scenarios

```
Scenario: A suggested action increments the suggested count
  Given an empty ActionItemFeedback projection
  When ActionItemsSuggested for user "alice" lists [id1]
  Then feedback for "alice" has suggested=1, deleted=0, completed=0

Scenario: Deleting an AI-suggested action increments the deleted count
  Given action id1 was AI-suggested for user "alice"
  When id1 is deleted
  Then feedback for "alice" has deleted=1

Scenario: Completing an AI-suggested action increments the completed count
  Given action id1 was AI-suggested for user "alice"
  When id1 is completed
  Then feedback for "alice" has completed=1

Scenario: Deleting a manually-added action is not counted
  Given action id2 was added by the user with no prior suggestion
  When id2 is deleted
  Then no deleted count is recorded for "alice"

Scenario: The projection rebuilds from the event stream
  Given a stream with ActionItemsSuggested, ActionItemDeleted, ActionItemCompleted events
  When projections are rebuilt
  Then ActionItemFeedback counts equal the live projection's
```

### Acceptance criteria

- [x] View (per-user), store (single table, two row types), and update added. **Wired inline across `NoteCommandHandler` (suggested) + `ActionItemCommandHandler` (deleted/completed), not as an `IDomainEventHandler`** (dispatcher is dead code; see `docs/technical-improvements.md`). Live uses `currentUser.UserId` / provenance; rebuild reads `envelope.Metadata.UserId`.
- [x] Deleted/completed counted only for AI-suggested action IDs; manual actions ignored
- [x] Wired into `ProjectionRebuildHandler`; rebuild reproduces live counts (order-independent — suggestion on Note stream, outcomes on ActionItem streams)
- [x] Registered in `Builder.cs`; env var in `Program.cs` + CDK; table created with `RETAIN`
- [x] `Infrastructure.Assertions` asserts the table; `docs/view-schemas.md` updated
- [x] All specs green; `cdk synth` succeeds

---

## Slice 10-M — Stamp modelId / promptVersion on the suggestion events

**Status:** Done — shipped 2026-06-04 (PR #163, deploy #457). See [learnings](../learnings/_archive.md).

### Scenarios

```
Scenario: Analysis stamps the prompt version on the suggestion events
  Given analysis runs with PromptCatalog.V1 and model "amazon.nova-lite-v1:0"
  When tags and action items are suggested
  Then TagsSuggestedV2 and ActionItemsSuggestedV2 are raised
  And each carries promptVersion "analysis@v1" and the model id

Scenario: v1 suggestion events still rebuild after the v2 upgrade
  Given a stream containing only v1 TagsSuggested events
  When projections are rebuilt
  Then the feedback counts are unchanged
  And those provenance rows carry promptVersion "unknown"

Scenario: Feedback can be sliced per prompt version
  Given suggestions recorded under promptVersion "analysis@v1" and "analysis@v2"
  When the tag feedback projection is queried
  Then suggested/rejected counts are available per (user, tag, promptVersion)
```

### Acceptance criteria

- [x] `TagsSuggestedV2` / `ActionItemsSuggestedV2` added; v1 events untouched; aggregate applies both (no-op)
- [x] Analyse handler raises the v2 events carrying `ModelId` + `PromptVersion` from `NoteAnalysisResult`
- [x] 10-J / 10-L projections consume v1 and v2; provenance carries `promptVersion` (`"unknown"` for v1)
- [x] Existing streams rebuild unchanged; both v2 events registered for (de)serialisation
- [x] `docs/event-model.md`, `docs/event-schemas.md`, `docs/view-schemas.md` updated
- [x] All specs green; `cdk synth` succeeds

---

## Slice 10-N — Migrate analysis to the Converse API (model-agnostic)

**Status:** Done — shipped 2026-06-03 (PR #152, deploy #436). See [learnings](../learnings/_archive.md).

### Scenarios

```
Scenario: Converse text with valid analysis JSON is parsed and stamped
  Given model text containing {"summary":"…","discussion":[…],"decisions":[…],"newTags":[…],"newActionItems":[…]}
  When AnalysisResponseParser.Parse runs with model "amazon.nova-lite-v1:0" and prompt "analysis@v1"
  Then the result carries those fields, and ModelId / PromptVersion are stamped

Scenario: Converse text with no JSON falls back to an empty summary
  Given model text with no JSON object
  When Parse runs
  Then the result is an empty summary with empty lists (the user's note is left untouched)

Scenario: ConverseResponseReader extracts the first content block's text
  Given a ConverseResponse whose Output.Message.Content = [ { Text = "hello" } ]
  Then ConverseResponseReader.Text returns "hello"; a null/empty response returns ""

Scenario: Judge verdicts parse from Converse text
  Given judge model text "[\"YES\",\"NO\"]" for 2 facts
  Then ParseVerdicts returns [true, false]

Scenario: Existing analyse-handler behaviour is unchanged
  Then tests/Api.Integration AnalyseNoteTests stay green (they use the fake service)
```

### Acceptance criteria

- [ ] Behaviour-identical for analysis@v1 + Nova Lite
- [ ] Converse parsing unit-tested offline
- [ ] All specs green; `cdk synth` succeeds

---

## Slice 10-O — Ship `analysis@v3` as the production prompt

**Status:** Done — shipped 2026-06-04 (deploy #458). `PromptCatalog.Current` now returns `analysis@v3`.

### Acceptance criteria

- [x] `PromptCatalog.Current.Version == "analysis@v3"`; `Current_is_v3` test green
- [x] Deploy green; the live analyse endpoint produces V3 output
