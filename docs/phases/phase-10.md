# Phase 10 — Transcription

**Goal:** Add live meeting transcription to the note screen. The user records audio during a meeting; AWS Transcribe Streaming produces a live rolling transcript; when recording stops, Amazon Bedrock (Claude Haiku) analyses the transcript against the existing note content and auto-applies gap-filling content, tags, and action items.

**Learning surface:** AWS Transcribe Streaming from the browser (first real-time streaming service); STS AssumeRole — Lambda issues scoped temporary credentials after verifying the Google JWT; first outbound AWS service call from Lambda beyond DynamoDB (Bedrock); IAM scoping: Transcribe permissions restricted to the browser-held role, Bedrock permission on the Lambda role; prompt engineering for structured extraction (content gap-fill, tag inference, action item extraction); configurable model via env var as a deployment pattern; async event chain — `TranscriptionCompleted` triggers existing event types, keeping the domain unaware of AI.

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

| Event | Aggregate | Payload |
|---|---|---|
| `TranscriptionCompleted` | `Note` | `transcriptText: string`, `durationSeconds: int` |

Analysis output reuses **existing** event types: `ContentEditedV2`, `TagAdded`, `ActionItemAdded`. The domain does not know whether content originated from a human or an LLM.

---

## Slice order and dependencies

Each slice from 10-B onward is independently demoable. CDK wiring is bundled into 10-B (where it is first needed) rather than a standalone infrastructure-only slice.

```
10-A  UX Prototype ── human approval required ──────────────────────────────────────────┐
      Demo: record button, live fake transcript scrolling, auto-analyse switch,        │
      "Save & Analyse" button, fake analysis output                                    │
                                                                                       ▼
10-B  Live transcript ──────────────────────────────────────────────────────────────────┤
      Demo: open a note → press Record → speak → see words appear in real time        │
         │                                                                             │
         ▼                                                                             │
10-C  Persist transcript ───────────────────────────────────────────────────────────────┤
      Demo: stop recording → close note → reopen → transcript still visible           │
         │                                                                             │
         ▼                                                                             │
10-D  Manual analysis ──────────────────────────────────────────────────────────────────┤
      Demo: click "Save & Analyse" → content fills gaps, tags appear, actions added   │
         │                                                                             │
         ▼                                                                             │
10-E  Auto-analysis on stop ────────────────────────────────────────────────────────────┘
      Demo: record → stop → note enriches automatically (frontend only)
```

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

**Status:** Not Started

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

**Status:** Not Started

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

**Status:** Not Started

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

**Status:** Not Started

**Value:** Capture the full conversation — not just the local microphone — so that remote participants dialled in via video call (Zoom, Teams, Meet) are also transcribed.

**Frontend only — no backend changes.**

**Problem:** `getUserMedia({ audio: true })` captures only the local microphone. Remote participants' speech arrives through the speakers and is not captured.

**Approach:** `getDisplayMedia({ audio: true })` can capture system audio on supported browsers (Chrome/Edge). The user shares their screen and ticks "share audio" (or selects the tab/window audio). The resulting audio track is then streamed to Transcribe alongside (or instead of) the microphone track.

**Audio strategy:** Mix mic + system audio into a single PCM stream using the Web Audio API:
1. `getUserMedia` → local mic track
2. `getDisplayMedia({ audio: true, video: false })` → system audio track (requires browser permission; falls back gracefully if denied or unsupported)
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
  Then getDisplayMedia is called with { audio: true, video: false }
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
