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
| 10-M | Stamp modelId / promptVersion on the suggestion events | Not Started | 10-G, 10-I, 10-K |
| 10-N | Migrate analysis to the Converse API (model-agnostic) | Not Started | — |

Phase 10 has two parts. The **core flow** (10-A → 10-H) makes recording → transcription → analysis work end to end. The **quality track** (10-E, 10-F, then 10-G → 10-M) makes that analysis *good* and *keeps it good*: better input, smoother UX, measurement, and a durable correction signal that feeds prompt/model refinement. Slices 10-I → 10-M were moved here from the former Phase 13 ("Feedback capture for AI suggestions") so that analysis quality — building it, measuring it, refining it — lives in one phase.

CDK wiring for transcription is bundled into 10-B (where it is first needed); Bedrock IAM into 10-D. *(10-H was delivered ahead of 10-E.)*

**Dependencies:** 10-J depends on 10-I; 10-L depends on 10-K; the tag track (10-I/J) and the action track (10-K/L) are independent and either may land first. 10-M depends on the versioned prompts from 10-G and on the suggestion events (10-I, 10-K). 10-E, 10-F, and 10-G are independent of everything else and of each other.

**Learning surface:** AWS Transcribe Streaming from the browser (first real-time streaming service); STS AssumeRole — Lambda issues scoped temporary credentials after verifying the Google JWT; first outbound AWS service call from Lambda beyond DynamoDB (Bedrock); IAM scoping: Transcribe permissions restricted to the browser-held role, Bedrock permission on the Lambda role; mixing mic + system audio via the Web Audio API; prompt engineering for structured extraction (content gap-fill, tag inference, action item extraction); configurable model via env var as a deployment pattern; **offline LLM evaluation** (LLM-as-judge scoring, prompt/model matrices, versioned prompts); **purely additive provenance events** and projections that *classify by combining* events rather than copying them; **event versioning** to stamp `modelId`/`promptVersion` so the correction signal ties to a specific prompt version; async event chain — `TranscriptionCompleted` triggers existing event types, keeping the domain unaware of AI.

---

## Prototype status

**Approved.** Prototype branch: `prototype/10-transcription`. Reference: `web/src/prototype/REFERENCE.md`.

### Confirmed layout decisions

- `<TranscriptionPanel>` lives in the **right column** below `<ActionsSection>` — not full-width.
- Right column is a flex column with a fixed viewport height. Tags and Actions have `flexShrink: 0`; TranscriptionPanel has `flex: 1` + `minHeight: 200px` to fill remaining space.
- **Tags** grow freely (pill wrap, no scroll, no max-height).
- **Actions** size naturally when ≤ 5 items; cap at `maxHeight: 230px` + scroll beyond that.
- **Action Items panel shows only the current user's tasks.** The current user's name is sourced from the Google JWT (`ICurrentUser`). Other people's tasks from the transcript go into the note content only.

### Confirmed TranscriptionPanel states

| State | Behaviour |
|---|---|
| Idle | Dashed placeholder "Press Record to start transcribing". Record button. |
| Recording | Red pulsing dot + MM:SS elapsed timer. Live transcript grows and auto-scrolls. Stop button. |
| Stopped (switch ON) | Analysis fires automatically — transitions immediately to Analysing. |
| Stopped (switch OFF) | "Save & Analyse" button appears; no auto-analysis. |
| Analysing | Spinner + "Analysing transcript…". Transcript area remains visible. |
| Done | Green banner "Note updated — content, tags, and actions added." |
| Error | Red box "Cannot connect to transcription service." |

### Confirmed auto-analyse switch

- Checkbox: "Auto-analyse on stop". Default ON. Ephemeral (resets to ON on page load).
- Visible in: idle, stopped, done, error. Hidden during recording and analysing.
- Switch OFF → "Save & Analyse" button replaces auto-trigger.

---

## What is already in place

- `ICurrentUser` is injectable; `Api.Integration` tests use `FakeCurrentUser`. JWT Bearer verification is active (Phase 8). The STS credential endpoint can verify the caller's identity without additional auth plumbing.
- `NoteCommandHandler` already follows load-stream → rebuild → handle → persist → dispatch. `CompleteTranscription` fits this pattern exactly.
- `ContentEditedV2`, `TagAdded`, `ActionItemAdded` events already exist on the `Note` aggregate. The analysis output uses these — no new events for AI-generated content.
- All test layers are in place. `IStsCredentialService` and `IBedrockAnalysisService` must be injectable interfaces from day one so `Api.Integration` tests run without real AWS credentials.
- `NoteView.tsx` renders a two-column layout with content left and an Actions panel right. Adding `<TranscriptionPanel>` below Actions is an additive change.

What is **not** yet in place:

- No STS credential issuance anywhere in the stack.
- No AWS Transcribe Streaming integration.
- No `TranscriptionCompleted` event or `CompleteTranscription` command.
- No Bedrock invocation; no `BEDROCK_MODEL_ID` env var.
- No `TranscriptionPanel` component or `useTranscription` hook.
- No `TRANSCRIBE_ROLE_ARN` or `BEDROCK_MODEL_ID` env vars in the CDK stack.

**CDK manages the IAM role:** `TranscribeBrowserRole` is created by CDK (`NoteTakerStack`) with a trust policy scoped to the Lambda execution role and a single-action inline policy (`transcribe:StartStreamTranscription`). No out-of-band IAM work is required; the ARN is injected as `TRANSCRIBE_ROLE_ARN` automatically.

---

## New events

| Event | Aggregate | Payload | Slice |
|---|---|---|---|
| `TranscriptionCompleted` | `Note` | `transcriptText: string`, `durationSeconds: int` | 10-C |
| `TagsSuggested` | `Note` | `tags: string[]` — provenance only; `Apply` is a no-op | 10-I |
| `ActionItemsSuggested` | `Note` | `actionItemIds: Guid[]` — provenance only; `Apply` is a no-op | 10-K |

Analysis output reuses **existing** event types: `ContentEditedV2`, `TagAdded`, `ActionItemAdded`. The domain does not know whether content originated from a human or an LLM. The `*Suggested` events above are the exception — they record AI provenance without changing aggregate state, so a later untag/delete can be classified as a rejected AI suggestion (10-J/10-L). 10-M versions these two events to add `modelId`/`promptVersion`.

---

## Slice 10-A — UX prototype

**Status:** Done (approved)

**Value:** Validate the `<TranscriptionPanel>` layout and interaction model on the note screen before writing any production code. The note screen already has a content editor and Actions panel; adding a live transcript panel and recording controls is a genuine UX uncertainty.

**This is a prototype slice.** Work happens on branch `prototype/10-transcription`. No real backend — fake transcript words appear on a timer, fake analysis fires on stop. Code is throwaway. On human approval the exit procedure updates this doc with confirmed GWT scenarios and UX patterns. Real implementation (10-B onward) starts from scratch.

**What the prototype must demonstrate:**

- Record button → "recording" state (red indicator, elapsed timer).
- `<TranscriptionPanel>` below the Actions panel; fake words appear every ~500ms; panel auto-scrolls as transcript grows.
- Stop button → "stopped" state.
- Auto-analyse switch visible (default ON); when ON, fake analysis fires automatically on stop.
- When switch OFF: "Save & Analyse" button appears; analysis only fires on click.
- Fake analysis result: note content gains a new paragraph, one new tag pill appears, one new action item appears in the Actions panel.
- "Cannot connect" error state (fake failure path — simulate a Transcribe credentials error).

**Prototype confirmed items:**

- TranscriptionPanel sits below ActionsSection in the right column; fills remaining height via `flex: 1`.
- Record/Stop button at the bottom of the panel. Elapsed timer in panel header during recording.
- Auto-analyse switch ("Auto-analyse on stop") above the controls; "Save & Analyse" replaces it when switch is OFF.
- Analysing state: spinner + label inside the panel; transcript area stays visible.
- Error state: red box inside the panel with message and Reset button.
- Action Items panel scoped to current user — label "for {name}" in header; others' tasks go to note content.

---

## Slice 10-B — Live transcript

**Status:** Done

**Value:** Open any note, press Record, speak, and see your words appear in real time in the transcript panel.

**Commands in scope:** none (transcript not yet persisted)
**Events in scope:** none

**CDK changes (bundled here — first slice that needs them):**

- New scoped IAM role: trust policy allows Lambda execution role to assume it; grants `transcribe:StartStreamTranscription` only. ARN exposed as `TRANSCRIBE_ROLE_ARN` env var on Lambda.
- `BEDROCK_MODEL_ID` env var added to Lambda (value: Haiku model ARN; used in 10-D but wired now so 10-D has no CDK changes).
- `Infrastructure.Assertions` tests updated for both env vars.

**New service interface:**

```csharp
// src/Api/Services/IStsCredentialService.cs
public interface IStsCredentialService
{
    Task<TemporaryCredentials> AssumeTranscribeRoleAsync();
}

public record TemporaryCredentials(
    string AccessKeyId,
    string SecretAccessKey,
    string SessionToken,
    DateTimeOffset Expiration
);
```

Production implementation calls `AmazonSecurityTokenServiceClient.AssumeRoleAsync` with the `TRANSCRIBE_ROLE_ARN` env var. Credentials expire after 15 minutes (sufficient for a single recording session).

**API endpoint:**

- `GET /transcription/credentials` — requires authentication (401 if no valid token). Calls `IStsCredentialService.AssumeTranscribeRoleAsync()`. Returns temporary credentials for the browser to use directly with the Transcribe Streaming SDK.

Wire shape:
```json
{
  "accessKeyId": "ASIA...",
  "secretAccessKey": "...",
  "sessionToken": "...",
  "expiration": "2026-05-19T10:15:00Z",
  "region": "eu-west-1"
}
```

**Frontend:**

- `web/src/hooks/useTranscription.ts` — state machine: `idle → requestingCredentials → recording → stopped`. Fetches credentials via `getTranscriptionCredentials()`, creates `TranscribeStreamingClient`, starts `StartStreamTranscriptionCommand` with `MediaEncoding: 'pcm'`, `SampleRate: 16000`, `LanguageCode: 'en-GB'`. Accumulates partial and final transcript results.
- `web/src/components/TranscriptionPanel.tsx` — Record/Stop button, elapsed timer, scrolling transcript text area. Renders nothing if `useTranscription` is in `idle` state (panel appears only when recording starts).
- `web/src/components/NoteView.tsx` — renders `<TranscriptionPanel>` below the Actions panel.

**Scenarios (filled in after prototype approval):**

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

**Value:** Stop recording and reopen the note — the transcript is still there.

**Commands in scope:** `CompleteTranscription`
**Events in scope:** `TranscriptionCompleted`

**Domain:**

```csharp
// src/Domain/Notes/Commands/CompleteTranscription.cs
public record CompleteTranscription(
    NoteId NoteId,
    string TranscriptText,
    int DurationSeconds
);

// TranscriptionCompleted event raised on Note aggregate
public record TranscriptionCompleted(
    string TranscriptText,
    int DurationSeconds
) : IDomainEvent;
```

The `Note` aggregate accumulates `TranscriptText` from `TranscriptionCompleted` (last write wins — a note may be re-recorded).

**API endpoint:**

- `POST /notes/{id}/transcription` — body: `{ transcriptText, durationSeconds }`. Requires authentication. Appends `TranscriptionCompleted` event via `NoteCommandHandler`.

**Projection update:**

`NoteDetail` projection gains a `transcriptText: string | null` field. Updated by a `TranscriptionCompletedHandler` that writes the transcript text to the existing `NoteDetail` DynamoDB item.

**Frontend:**

- On recording stop: `useTranscription` calls `completeTranscription(noteId, fullText, durationSeconds)`.
- `NoteView` reads `transcriptText` from the `NoteDetail` projection on load and passes it to `<TranscriptionPanel>` as initial state.

**Scenarios:**

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

**Value:** Click "Save & Analyse" and watch the note content fill in, tags appear, and action items populate — all from the transcript.

**Commands in scope:** none (analysis fires existing commands internally)
**Events in scope:** `ContentEditedV2`, `TagAdded`, `ActionItemAdded` (existing)

**CDK changes:**

- Lambda execution role gains `bedrock:InvokeModel` on the Haiku model ARN (derived from `BEDROCK_MODEL_ID`).
- `Infrastructure.Assertions` updated for Bedrock IAM grant.

**New service interface:**

```csharp
// src/Api/Services/IBedrockAnalysisService.cs
public interface IBedrockAnalysisService
{
    Task<NoteAnalysisResult> AnalyseAsync(string transcriptText, string existingContent, string currentUserName);
}

public record NoteAnalysisResult(
    string UpdatedContent,
    IReadOnlyList<string> NewTags,
    IReadOnlyList<string> NewActionItems  // only tasks assigned to currentUserName
);
```

Production implementation:
- Reads `BEDROCK_MODEL_ID` env var.
- Builds a structured prompt that includes `currentUserName` so the model can distinguish the user's tasks from others'. Instructs the model to: put ALL team actions in `updatedContent`; put only `currentUserName`'s tasks in `newActionItems`.
- Returns JSON only: `{ "updatedContent": "...", "newTags": [...], "newActionItems": [...] }`.
- Calls `AmazonBedrockRuntimeClient.InvokeModelAsync`.
- Parses response JSON; on parse failure logs and returns the original content unchanged with empty tags/actions.

**API endpoint:**

- `POST /notes/{id}/analyse` — requires authentication. Reads the Note aggregate to get `TranscriptText` and existing content. Calls `IBedrockAnalysisService.AnalyseAsync`. Appends `ContentEditedV2` (if content changed), `TagAdded` × N (for each new tag not already on the note), `ActionItemAdded` × N (for each new action item). Returns 204 No Content.

**Frontend:**

- "Save & Analyse" button always visible in `<TranscriptionPanel>` (auto-analyse switch arrives in 10-E).
- Button disabled if no transcript text is present.
- On click: calls `analyseNote(noteId)`; shows loading spinner on button; on completion refreshes `NoteDetail` projection (content, tags, action items update in place).

**Scenarios:**

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

**Value:** Record a meeting, stop — the note enriches itself. No button click required.

**Frontend only — no backend changes.**

- Add auto-analyse switch to `<TranscriptionPanel>` (default ON, ephemeral — resets to ON on every page load).
- When switch is ON: `useTranscription` calls `analyseNote(noteId)` automatically when recording stops.
- When switch is OFF: "Save & Analyse" button appears; auto-analysis is suppressed.
- Loading state shown in panel while analysis is in progress (spinner, "Analysing…" label).

**Scenarios:**

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

**Value:** Capture the full conversation — not just the local microphone — so that remote participants dialled in via video call (Zoom, Teams, Meet) are also transcribed.

**Frontend only — no backend changes.**

**Problem:** `getUserMedia({ audio: true })` captures only the local microphone. Remote participants' speech arrives through the speakers and is not captured.

**Approach:** `getDisplayMedia({ audio: true })` can capture system audio on supported browsers (Chrome/Edge). The user shares their screen and ticks "share audio" (or selects the tab/window audio). The resulting audio track is then streamed to Transcribe alongside (or instead of) the microphone track.

**Audio strategy:** Mix mic + system audio into a single PCM stream using the Web Audio API:
1. `getUserMedia` → local mic track
2. `getDisplayMedia({ audio: true, video: true })` → system audio track (`video: true` is mandatory — Chromium rejects an audio-only display capture with `NotSupportedError`; the video track is requested only to obtain the audio one and is otherwise unused). Requires browser permission; falls back gracefully if denied or unsupported.
3. Both tracks fed into the same `AudioContext` via `createMediaStreamSource`; a `ChannelMergerNode` (or `GainNode` sum) produces a single mono mix at 16 kHz
4. Existing `PcmProcessor` worklet sends the mix to Transcribe unchanged

**UX:**
- Add a "Include call audio" toggle in `<TranscriptionPanel>` (default ON, ephemeral).
- When ON: prompt for screen-share on Record press; if the user cancels the screen-share prompt, fall back to mic-only silently.
- When OFF: mic-only (current behaviour).
- Browser compatibility note shown below the toggle: "Requires Chrome or Edge; shares audio from your screen or tab."

**Scenarios:**

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

**Status:** Done — shipped 2026-06-03 (PR #132, deploy #418). See [learnings](../learnings/phase-10g-analysis-eval-harness.md) and the [testing guide](../guides/analysis-eval-harness.md).

**Value:** Compare prompt and model variants for the transcript analysis on a fixed set of meeting transcripts, scored against expected tags, action items, and content gap-fill. Run on demand or nightly; produce a markdown report that diffs runs side by side. Makes prompt iteration measurable instead of vibes-based.

**Commands in scope:** none
**Events in scope:** none

**Out of scope (deferred to 10-M):** stamping `modelId` + `promptVersion` onto the production analysis events. Once the harness and versioned prompts exist here, 10-M is a tight follow-up that lets real meetings feed the fixture set.

---

### Refactor: versioned prompts

> **Contract note (reconciled after 10-H).** When this slice was first drafted, `IBedrockAnalysisService.AnalyseAsync` took three strings `(transcript, content, user)`. Slice 10-H replaced that with a `NoteAnalysisRequest` record carrying `ExistingContent`, `TranscriptText?`, `CurrentUserName`, and an `AllowContentRewrite` flag, and `BedrockAnalysisService` now builds its prompt inline via `BuildPrompt(NoteAnalysisRequest)`. This refactor is reconciled to that current contract: the prompt builder takes a `NoteAnalysisRequest`, not three strings.

Lift the analysis prompt into a small catalog so it can be swapped at construction time. The default prompt stays `analysis@v1` with the **exact current inline text** (including the `AllowContentRewrite` content-instruction branch), so there is no production behaviour change.

```csharp
// src/Api/Services/PromptCatalog.cs
public sealed record AnalysisPrompt(string Version, Func<NoteAnalysisRequest, string> Build);

public static class PromptCatalog
{
    public static readonly AnalysisPrompt V1 = new("analysis@v1", BuildV1);
    public static AnalysisPrompt Current => V1;
    static string BuildV1(NoteAnalysisRequest request) => /* the current BuildPrompt body, verbatim */;
}
```

`BedrockAnalysisService` keeps `AnalyseAsync(NoteAnalysisRequest, ct)` (no interface change) but its **constructor** gains an `AnalysisPrompt prompt` and an explicit `string modelId` (DI default: `PromptCatalog.Current` + `BEDROCK_MODEL_ID` env var; the env-var read moves out of the ctor body into the DI registration). The static `BuildPrompt` is deleted — the service calls `_prompt.Build(request)` instead. `NoteAnalysisResult` gains `ModelId` and `PromptVersion` so every analysis call self-describes.

```csharp
public record NoteAnalysisResult(
    string UpdatedContent,
    IReadOnlyList<string> NewTags,
    IReadOnlyList<string> NewActionItems,
    string ModelId,
    string PromptVersion);
```

**Shared-change checklist (per CLAUDE.md).** `AnalyseAsync`'s signature is unchanged, so its call sites (the `/analyse` endpoint, `NoteCommandHandler`) need no edit. `ModelId` / `PromptVersion` are added to `NoteAnalysisResult` **with empty-string defaults**, so the ~17 existing constructions in `Api.Integration` tests and the fakes (`FakeBedrockAnalysisService`, `ThrowingBedrockAnalysisService`) keep compiling untouched — they don't care about provenance. Only the production path stamps real values: both `BedrockAnalysisService.ParseResponse` return paths pass `_modelId` + `_prompt.Version`. The stamp is verified by a live, `RUN_BEDROCK_EVAL`-gated test (`BedrockAnalysisServiceStampTests`), since the project uses hand-written fakes rather than a mocking library and the full `IAmazonBedrockRuntime` is impractical to stub offline.

> `ModelId` / `PromptVersion` on `NoteAnalysisResult` are **provenance for the eval harness only** — the analyse handler still consumes just `UpdatedContent` / `NewTags` / `NewActionItems`. They are *not* yet written into any event; persisting them onto the suggestion events is slice **10-M** (`TagsSuggestedV2` / `ActionItemsSuggestedV2`).

---

### New test project: `tests/Analysis.Eval/`

xUnit, **opt-in** — every test gated on `RUN_BEDROCK_EVAL=1`. Skipped by default so PR CI does not burn Bedrock credit; runs locally or nightly via a separate GitHub Action.

```
tests/Analysis.Eval/
  Analysis.Eval.csproj
  Fixtures/
    01-standup-clear-owners.json
    02-one-on-one-mixed-actions.json
    ...
  Scoring/
    TagScorer.cs
    ActionItemScorer.cs
    ContentJudge.cs
  Fixture.cs            # POCO + loader
  EvalRunner.cs         # the [SkippableTheory] that drives it
  Report.cs             # reads Results/*.jsonl → markdown table
  Results/              # .gitignored
```

**Fixture shape:**

```json
{
  "id": "01-standup-clear-owners",
  "transcriptText": "...",
  "existingContent": "Standup notes",
  "currentUserName": "Alice",
  "expected": {
    "tags": ["standup", "login"],
    "actionItems": ["Fix the login bug by Friday"],
    "contentMustMention": ["Bob will update the docs"]
  }
}
```

**Scorers:**

- `TagScorer` — pure C#, set-based P/R/F1 with case-insensitive normalisation.
- `ActionItemScorer` — v1: lowercased exact match after punctuation strip. Leaves an embedding-cosine hook for v2 once v1 produces false negatives.
- `ContentJudge` — LLM-as-judge using Nova Pro (deliberately stronger than the system-under-test). Atomic rubric: for each listed fact, return YES/NO whether it is clearly present. Score = `yes_count / total`. Injectable judge client so unit tests can stub it.

**Runner:**

```csharp
public static IEnumerable<object[]> Matrix =>
    from fixture in LoadFixtures()
    from prompt in new[] { PromptCatalog.V1 }
    from model in new[] { "amazon.nova-lite-v1:0" }
    select new object[] { fixture, prompt, model };

[SkippableTheory, MemberData(nameof(Matrix))]
public async Task Score(Fixture f, AnalysisPrompt prompt, string modelId) { ... }
```

Default matrix: 1 prompt × 1 model. Expanding to more prompts or models is a one-line config change.

The runner maps each fixture to a `NoteAnalysisRequest` — `ExistingContent = fixture.ExistingContent`, `TranscriptText = fixture.TranscriptText`, `CurrentUserName = fixture.CurrentUserName`, `AllowContentRewrite = true` (gap-fill is what the content score measures) — constructs `BedrockAnalysisService` with the matrix's `(prompt, modelId)`, and calls `AnalyseAsync(request)`. The stub Bedrock in unit tests implements the same `AnalyseAsync(NoteAnalysisRequest, ct)` interface and returns a canned `NoteAnalysisResult`.

**Output:** `tests/Analysis.Eval/Results/<runId>.jsonl` — one row per fixture × prompt × model with all three scores. Gitignored.

**Report:** `dotnet test --filter Category=Report` runs a single test that reads `Results/*.jsonl` and writes a markdown table grouped by (prompt, model) with mean F1 per metric. Slots into existing tooling without a new entry point.

---

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

**Value:** Run analysis on *any* note to infer tags and extract action items from what is already written — no recording required. When a transcript is present it is analysed alongside the content. A switch controls whether analysis may also rewrite the note content, so hand-written notes can be left untouched.

**Builds on 10-D.** This slice relaxes and extends the existing `/notes/{id}/analyse` path rather than adding a parallel one. Note content becomes a first-class analysis input; the transcript becomes optional supplementary input.

**Commands in scope:** none (analysis fires existing commands internally, as 10-D)
**Events in scope:** `TagAdded`, `ActionItemAdded` (existing); `ContentEditedV2` (existing — only when the "Update note content" switch is on)

**CDK changes:** none. `bedrock:InvokeModel` was granted in 10-D; no new env vars.

### Changes to the 10-D analysis path

1. **Drop the transcript requirement.** `POST /notes/{id}/analyse` no longer returns 422 when there is no `TranscriptionCompleted` event. It analyses the note content; a transcript, if present, is included as supplementary input. 422 is returned only when there is *nothing* to analyse — empty content **and** no transcript.
   - This supersedes 10-D's "Analysis requires a transcript to exist → 422" scenario.

2. **`IBedrockAnalysisService` takes a request object.** The transcript becomes optional and a content-rewrite flag is added:

```csharp
public record NoteAnalysisRequest(
    string ExistingContent,
    string? TranscriptText,      // null/empty when the note was never recorded
    string CurrentUserName,
    bool AllowContentRewrite);

Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request);
```

   This is a shared-signature change — per CLAUDE.md, grep every call site (production impl, the `/analyse` endpoint, `Api.Integration` fakes, and the 10-G eval harness) and update them in one commit. `NoteAnalysisResult` is unchanged.

3. **Prompt changes.** The prompt builder treats content as the primary source and the transcript as supplementary (possibly empty). When `AllowContentRewrite` is false it instructs the model to return the existing content unchanged and to focus on tags + actions only.

4. **Handler gates content rewrite (belt-and-braces).** Even if the model returns changed content, the handler appends `ContentEditedV2` only when `AllowContentRewrite` is true *and* the content actually changed. `TagAdded`/`ActionItemAdded` behave exactly as in 10-D (dedup against existing tags/actions; action items scoped to the current user).

### API

- `POST /notes/{id}/analyse` — body gains `{ "updateContent": bool }` (the switch state). Requires authentication. Reads the Note aggregate for content + transcript; returns 422 if both are empty; otherwise calls `AnalyseAsync` with `AllowContentRewrite = updateContent`, appends events as above, and returns 204.

### Frontend

- **Entry point without recording.** The "Analyse note" trigger must be reachable when not recording (today `<TranscriptionPanel>` renders nothing in `idle`). Add an "Analyse note" button on the note screen, enabled whenever the note has content or a transcript.
- **"Update note content" switch** beside the button — ephemeral (resets on page load), consistent with the 10-E/10-F switch convention. When on, the analyse request sets `updateContent: true`.
  - **Default — confirm at spec time:** default ON keeps 10-D's gap-fill behaviour and matches the phase's other switches; default OFF better protects hand-written notes. Pick one in the BDD spec.
- **Optimistic UI:** on click, immediately show the in-flight state (disable button + spinner); on completion refresh the `NoteDetail` projection so new tags/actions (and content, if rewritten) appear in place; on error show an error and re-enable. The discovered tags/actions cannot be predicted, so the optimistic surface is the loading/disabled state.

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

## Feedback capture (10-I → 10-M) — overview

*Moved from the former Phase 13 ("Feedback capture for AI suggestions"). The implementation blueprints are the `event-modelling`, `aggregate-command`, and `projection` skills.*

The analyse path (`src/Api/Handlers/TranscriptionHandlers.cs`) makes the AI contribute two kinds of content to a note, and both go through the **same commands a human uses**, so AI-origin is invisible:

| AI contribution | Command → event | Why the correction signal is lost |
|---|---|---|
| Tags | `TagNote` → `NoteTagged` | A later `NoteUntagged` can't be told apart from a human tidying up their own tag. |
| Action items | `AddActionItem` → `ActionItemAdded` | A later `ActionItemDeleted` can't be told apart from a human deleting their own task. |

The user's *correction* — deleting an AI suggestion — is signal for improving the prompt, and it is currently thrown away. These slices record provenance so the signal becomes durable, queryable, rebuildable data. **Two signals, different shapes:**

- **Tags are repeating categorical values** → the tag projection (10-J) is keyed *per tag value*, so analysis can learn "stop suggesting `q3-planning` for this user." Signal = suggested vs removed.
- **Action items are unique free text** → you cannot blocklist a value. The action projection (10-L) is a *per-user quality rate*: of the actions the AI extracted, how many were **deleted** (rejected) vs **completed** (confirmed a real task).

Using the signal (negative-example prompting, suppression) stays out of scope here; 10-M ties the signal to a prompt version so it can be acted on later.

---

## Slice 10-I — Record AI tag suggestions

**Status:** Done

**Value:** Each analysis run records, as a first-class event, exactly which tags the AI contributed — so a later deletion of one is unambiguously a rejected AI tag.

**Commands in scope:** `RecordTagSuggestions` (new)
**Events in scope:** `TagsSuggested` (new)
**CDK changes:** none.

### Design

- `src/Domain/Notes/RecordTagSuggestions.cs` — `record RecordTagSuggestions(NoteId NoteId, IReadOnlyList<string> Tags) : NoteCommand;` (mirror `TagNote.cs`).
- `src/Domain/Notes/TagsSuggested.cs` — `record TagsSuggested(NoteId NoteId, IReadOnlyList<string> Tags) : NoteEvent;` (mirror `NoteTagged.cs`).
- `src/Domain/Notes/Note.cs` — add the `RecordTagSuggestions` case to the `Handle` switch; a `HandleRecordTagSuggestions` method (guard exists + not deleted; return `[]` if `Tags` empty, else one `TagsSuggested`); a no-op `Apply(TagsSuggested)` case so rebuild accepts it.
- `src/Api/Handlers/TranscriptionHandlers.cs` (`AnalyseNote`) — compute the post-dedup applied tag set (the existing `Where(t => !existingTags.Contains(t, …))` list); if non-empty, call `RecordTagSuggestions(noteId, appliedTags)` **before** the per-tag `TagNote` calls, so `TagsSuggested` precedes the `NoteTagged` events in stream order.
- Register the event in `EventDeserializer` / the event-type map.

> **Stamping `modelId` / `promptVersion` is slice 10-M** — a deliberate event-versioning exercise. Kept out of 10-I v1 to avoid speculative fields.

### Key implementation files

- `src/Domain/Notes/{RecordTagSuggestions,TagsSuggested,Note}.cs`
- `src/Api/Handlers/TranscriptionHandlers.cs`
- event-type registration (`EventDeserializer`)
- `docs/event-model.md` + `docs/event-schemas.md`
- `tests/Domain.Specs/` + `tests/Api.Integration/`

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

**Value:** Per user, per tag: how many times AI-suggested and how many later removed. Queryable ad hoc (the intended analysis path); rebuildable from history.

**Commands in scope:** none
**Events consumed:** `TagsSuggested`, `NoteUntagged`, `NoteDeleted`
**CDK changes:** one new projection table.

### Design (mirror the TagIndex trio)

- **View:** `TagFeedbackView(string UserId, string Tag, int SuggestedCount, int RejectedCount)` — `Accepted` = `Suggested − Rejected`, derived at read time, not stored.
- **Store:** `ITagFeedbackStore` + `DynamoDbTagFeedbackStore` (`src/EventStore/Projections/`). Single table `notetaker-proj-tagfeedback` holding two row types:
  - *Aggregate* — `PK=USER#{userId}`, `SK=TAG#{tag}` → `SuggestedCount`, `RejectedCount`.
  - *Provenance* — `PK=NOTE#{noteId}`, `SK=TAG#{tag}` (carries `UserId`) → marks a tag AI-suggested on that note; the state needed to classify a later untag.
- **Event handler:** `src/Api/Projections/TagFeedbackEventHandler.cs` (`IDomainEventHandler`), reading `UserId` from `envelope.Metadata.UserId` (exactly as `TagIndexEventHandler.cs`):
  - `TagsSuggested` → per tag: `SuggestedCount++`; write the provenance row.
  - `NoteUntagged` → if provenance `(noteId, tag)` present: `RejectedCount++` and **delete** the provenance row (only a fresh `TagsSuggested` re-arms it — prevents a manual re-add/remove from double-counting).
  - `NoteDeleted` → delete that note's provenance rows; **counts untouched** (deletion is not tag rejection).
  - `NoteTagged` → ignored (acceptance is derived).
- **Rebuild:** `TagFeedbackProjection` (same `Handle`/`GetAll` shape as `TagIndexProjection.cs`); add an instance to `ProjectionRebuildHandler` and upsert its rows.
- **Wiring:** register store + handler in `src/Api/Builder.cs`; read `PROJ_TAGFEEDBACK_TABLE_NAME` in `Program.cs`; create the table in `NoteTakerStack.cs` (mirror `ProjTagIndexTable`, `RemovalPolicy.RETAIN`) and pass the env var into the Lambda `Environment` dict.

**Accepted approximations (documented):** an accepted tag removed during unrelated cleanup months later still counts as rejected (no time-weighting in v1).

### Key implementation files

- `src/EventStore/Projections/{TagFeedbackView,ITagFeedbackStore,DynamoDbTagFeedbackStore,TagFeedbackProjection}.cs`
- `src/Api/Projections/TagFeedbackEventHandler.cs`
- `src/Api/{Builder,Program}.cs`; `src/Api/CommandHandlers/ProjectionRebuildHandler.cs`
- `src/Infrastructure/NoteTakerStack.cs`; `tests/Infrastructure.Assertions/`
- `docs/view-schemas.md`

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

**Value:** Each analysis run records which action items the AI extracted (by ID), so a later deletion or completion of one is attributable to the AI.

**Commands in scope:** `RecordActionItemSuggestions` (new, on `Note`)
**Events in scope:** `ActionItemsSuggested` (new)
**CDK changes:** none.

### Design

- `src/Domain/Notes/RecordActionItemSuggestions.cs` — `record RecordActionItemSuggestions(NoteId NoteId, IReadOnlyList<Guid> ActionItemIds) : NoteCommand;`.
- `src/Domain/Notes/ActionItemsSuggested.cs` — `record ActionItemsSuggested(NoteId NoteId, IReadOnlyList<Guid> ActionItemIds) : NoteEvent;`.
- `src/Domain/Notes/Note.cs` — `Handle` case + `HandleRecordActionItemSuggestions` (guard exists + not deleted; `[]` if empty) + no-op `Apply(ActionItemsSuggested)`.
- `src/Api/Handlers/TranscriptionHandlers.cs` (`AnalyseNote`) — the loop already generates an `ActionId` per new action. Collect those IDs; if any were created, after the `AddActionItem` calls issue `RecordActionItemSuggestions(noteId, createdIds)`.
- Register the event for (de)serialisation.

> **Why on `Note`, by ID:** symmetric with `TagsSuggested`, keeps the hot `ActionItemAdded` event unversioned, and the deletion/completion events on the `ActionItem` aggregate carry the `ActionId`, so the projection (10-L) matches by ID regardless of which stream the suggestion event sits in.

### Key implementation files

- `src/Domain/Notes/{RecordActionItemSuggestions,ActionItemsSuggested,Note}.cs`
- `src/Api/Handlers/TranscriptionHandlers.cs`
- event-type registration; `docs/event-model.md` + `docs/event-schemas.md`
- `tests/Domain.Specs/` + `tests/Api.Integration/`

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

**Value:** Per user: of the action items the AI extracted, how many were **deleted** (rejected extraction) and how many **completed** (confirmed a real task) — an extraction-precision picture. Queryable ad hoc; rebuildable.

**Commands in scope:** none
**Events consumed:** `ActionItemsSuggested`, `ActionItemDeleted`, `ActionItemCompleted`
**CDK changes:** one new projection table.

### Design

- **View:** `ActionItemFeedbackView(string UserId, int SuggestedCount, int DeletedCount, int CompletedCount)` — keyed **per user only** (free-text descriptions don't aggregate per-value, unlike tags).
- **Store:** `IActionItemFeedbackStore` + `DynamoDbActionItemFeedbackStore`. Single table `notetaker-proj-actionfeedback` holding two row types:
  - *Aggregate* — `PK=USER#{userId}` → `SuggestedCount`, `DeletedCount`, `CompletedCount`.
  - *Provenance* — `PK=ACTION#{actionItemId}` (carries `UserId`) → marks an action item AI-extracted.
- **Event handler:** `src/Api/Projections/ActionItemFeedbackEventHandler.cs` (`IDomainEventHandler`), reading `UserId` from `envelope.Metadata.UserId`:
  - `ActionItemsSuggested` → per ID: `SuggestedCount++`; write provenance `(actionItemId, userId)`.
  - `ActionItemDeleted` → if provenance for that `ActionId` present: `DeletedCount++`.
  - `ActionItemCompleted` → if provenance present: `CompletedCount++`.
  - Provenance is **not** consumed — `ActionId`s are unique and immutable, so there is no double-count risk (an item completed then deleted may increment both, which is acceptable for a quality signal).
- **Rebuild:** `ActionItemFeedbackProjection`; add an instance to `ProjectionRebuildHandler`.
- **Wiring:** register store + handler in `Builder.cs`; read `PROJ_ACTIONFEEDBACK_TABLE_NAME` in `Program.cs`; create the table in `NoteTakerStack.cs` (`RETAIN`) and pass the env var into the Lambda dict.

**Accepted approximations (documented):** completed-then-deleted increments both counts; reopen and edit are ignored in v1.

### Key implementation files

- `src/EventStore/Projections/{ActionItemFeedbackView,IActionItemFeedbackStore,DynamoDbActionItemFeedbackStore,ActionItemFeedbackProjection}.cs`
- `src/Api/Projections/ActionItemFeedbackEventHandler.cs`
- `src/Api/{Builder,Program}.cs`; `src/Api/CommandHandlers/ProjectionRebuildHandler.cs`
- `src/Infrastructure/NoteTakerStack.cs`; `tests/Infrastructure.Assertions/`
- `docs/view-schemas.md`

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

**Status:** Not started

**Value:** Tie every captured correction (10-J / 10-L) to the exact prompt and model that produced the suggestion, so refinement can compare quality *across prompt versions* rather than only in aggregate. This closes the loop between the eval harness (10-G) and the live feedback signal — and lets real meetings feed the 10-G fixture set.

**Depends on:** 10-G (versioned prompts / `PromptCatalog`, and `NoteAnalysisResult.ModelId` + `PromptVersion`), plus the suggestion events from 10-I and 10-K.

**Commands in scope:** none new (existing `RecordTagSuggestions`, `RecordActionItemSuggestions`)
**Events in scope:** `TagsSuggestedV2`, `ActionItemsSuggestedV2` (versioned)
**CDK changes:** none.

### Design

- A deliberate **event-versioning** exercise — the v1 `*Suggested` events shipped in 10-I/10-K must not change shape (immutability guardrail). Introduce `TagsSuggestedV2(NoteId, Tags, ModelId, PromptVersion)` and `ActionItemsSuggestedV2(NoteId, ActionItemIds, ModelId, PromptVersion)`; the `Note` aggregate applies both v1 and v2 (both no-ops); the analyse handler now raises the **v2** events, carrying `result.ModelId` / `result.PromptVersion` from `NoteAnalysisResult`.
- The feedback projections (10-J/10-L) consume v1 and v2 alike for their existing counts, and additionally annotate provenance rows with `promptVersion`, so quality can be sliced per prompt version. Streams containing only v1 events rebuild unchanged (no stamp → `"unknown"`).
- Register both v2 events for (de)serialisation; update `docs/event-model.md`, `docs/event-schemas.md`, `docs/view-schemas.md`.

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

- [ ] `TagsSuggestedV2` / `ActionItemsSuggestedV2` added; v1 events untouched; aggregate applies both (no-op)
- [ ] Analyse handler raises the v2 events carrying `ModelId` + `PromptVersion` from `NoteAnalysisResult`
- [ ] 10-J / 10-L projections consume v1 and v2; provenance carries `promptVersion` (`"unknown"` for v1)
- [ ] Existing streams rebuild unchanged; both v2 events registered for (de)serialisation
- [ ] `docs/event-model.md`, `docs/event-schemas.md`, `docs/view-schemas.md` updated
- [ ] All specs green; `cdk synth` succeeds

---

## Slice 10-N — Migrate analysis to the Converse API (model-agnostic)

**Status:** Not Started

**Value:** `BedrockAnalysisService` calls Bedrock's `InvokeModel` with Amazon Nova's `messages-v1` body and parses the Nova envelope, so only Nova models work — the eval harness's `make eval` sweep is restricted to the Nova family. Switching to Bedrock's model-agnostic **Converse API** lets the same code drive *any* accessible Bedrock text model (Claude, Llama, Mistral, Titan, Cohere…), so the harness can compare them and the production model is swappable via `BEDROCK_MODEL_ID` alone. Graduated from `technical-improvements.md`.

**Commands in scope:** none · **Events in scope:** none

**Behaviour must be identical** for the default `analysis@v1` prompt + Nova Lite: same prompt text, same parsed `summary` / `discussion` / `decisions` / `newTags` / `newActionItems`, same empty-summary fallback. Converse is a transport change, not a behaviour change.

### Design

- Replace `InvokeModelAsync(messages-v1 body)` with `ConverseAsync(ConverseRequest { ModelId, Messages = [user: prompt], InferenceConfig = { MaxTokens = 2048 } })` in `BedrockAnalysisService`, and in the eval judge (`BedrockContentJudgeClient`) likewise.
- Extract two pure, testable helpers in `src/Api/Services/`:
  - `ConverseResponseReader.Text(ConverseResponse)` → the model's text output (`Output.Message.Content[0].Text`), null-safe; shared by the service and the judge (removes the duplicated envelope-unwrap).
  - `AnalysisResponseParser.Parse(modelText, modelId, promptVersion)` → `NoteAnalysisResult` — the existing JSON-from-text extraction, minus the Nova envelope unwrap. The service keeps the empty-summary log based on the parsed result.
- The judge's `ParseVerdicts(modelText, count)` becomes `internal static` and parses the Converse text directly.

### IAM / infra

- **No change.** `Converse` / `ConverseStream` authorize against the same `bedrock:InvokeModel` action already granted to the Lambda role for Nova in `eu-west-2`; `Infrastructure.Assertions` IAM tests stay green.
- **Out of scope:** cross-region **inference-profile** models (Claude 3.5/3.7, newer Llama) need the profile id + member-model permissions across regions — a config/IAM follow-on once a specific non-Nova model is chosen. This slice keeps the default model Nova Lite and only changes the transport.

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

### Verification

- `dotnet test tests/Analysis.Eval` — new parser + reader + judge-verdict unit tests (offline).
- `dotnet test tests/Api.Integration` — `AnalyseNoteTests` green (handler unchanged).
- `dotnet build -p:TreatWarningsAsErrors=true` + `cdk synth`.
- **Live (human gate):** run `make eval` against Nova Lite and confirm `analysis@v1` still produces a non-empty, well-formed result (Converse parity); optionally sweep a non-Nova model via `EVAL_MODEL_IDS` to confirm cross-vendor works. Post-deploy: analyse one real note and confirm summary / tags / actions still populate.

- [ ] Behaviour-identical for analysis@v1 + Nova Lite
- [ ] Converse parsing unit-tested offline
- [ ] All specs green; `cdk synth` succeeds

---

## Feedback capture — explicitly out of scope (deferred)

- **Using the signals** — negative-example prompting (tags) and tuning the action-extraction prompt for precision. This belongs with the prompt/model-optimisation work, run manually once enough data has accrued (10-G is the harness for it). The data is captured and rebuildable, so it can happen any time later.
- **Hard suppression** of strongly-rejected tags before they are applied.
- **Read endpoint / UI** for either feedback model — query DynamoDB directly when analysing.
- **Time-weighting** of rejections, action **edits**, and reopen handling.

### Verification (10-I → 10-M)

- `dotnet test tests/Domain.Specs` — `RecordTagSuggestions`, `RecordActionItemSuggestions`, the v2 stamping, and both projection-classification specs.
- `dotnet test tests/Api.Integration` — `POST /notes/{id}/analyse` appends `TagsSuggested(V2)` (applied tag set) and `ActionItemsSuggested(V2)` (created action IDs).
- `dotnet test tests/Infrastructure.Assertions` — both new projection tables exist.
- `cdk synth` / `cdk diff` before deploy.
- Post-deploy ad-hoc check (the intended analysis path): analyse a note, delete one suggested tag and one suggested action, complete another action, then query the feedback tables and confirm the counts:
  - `aws dynamodb query --table-name notetaker-proj-tagfeedback --key-condition-expression "PK = :u" … --profile prod --region eu-west-2`
  - `aws dynamodb get-item --table-name notetaker-proj-actionfeedback --key '{"PK":{"S":"USER#<id>"}}' --profile prod --region eu-west-2`
