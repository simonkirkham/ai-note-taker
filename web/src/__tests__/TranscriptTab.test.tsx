import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import TranscriptTab from '../components/TranscriptTab'

// 52-A: jsdom implements neither of the two scroll mechanisms this component uses.
// `scrollIntoView` is absent entirely; `scrollHeight` is hard-wired to 0, so the
// record-mode "follow the speech" effect would be unobservable. Both are stubbed per
// test rather than globally so no other suite inherits them.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

it('renders the transcript text', () => {
  render(<TranscriptTab transcript="These are the spoken words." />)
  expect(screen.getByTestId('transcription-text')).toHaveTextContent('These are the spoken words.')
})

// 52-A narrowed this from the whole container to the transcript body: the find box is an
// input, and it is deliberately outside the body. The property under test is unchanged —
// the transcript itself is not editable.
it('is read-only: the transcript body contains no editable controls', () => {
  render(<TranscriptTab transcript="Some words" />)
  const body = screen.getByTestId('transcription-body')
  expect(body.querySelector('textarea')).toBeNull()
  expect(body.querySelector('input')).toBeNull()
  expect(body.querySelector('[contenteditable="true"]')).toBeNull()
})

it('shows an empty placeholder when there is no transcript and not recording', () => {
  render(<TranscriptTab transcript={null} />)
  const empty = screen.getByTestId('transcript-empty')
  expect(empty).toBeInTheDocument()
  expect(empty).toHaveAttribute('role', 'status') // 19-F1
  expect(screen.queryByTestId('transcription-text')).toBeNull()
})

it('shows a listening placeholder when recording with no transcript yet', () => {
  render(<TranscriptTab transcript={null} isRecording />)
  const listening = screen.getByText('Listening…')
  expect(listening).toBeInTheDocument()
  expect(listening).toHaveAttribute('role', 'status') // 19-F1
})

// 33-A: the "Download recording" affordance.
it('shows no recording bar when there is no recording', () => {
  render(<TranscriptTab transcript="words" recordingStatus="none" />)
  expect(screen.queryByTestId('recording-bar')).toBeNull()
})

it('shows the download button and fires onDownloadRecording when available', async () => {
  const onDownload = vi.fn()
  render(<TranscriptTab transcript="words" recordingStatus="available" onDownloadRecording={onDownload} />)
  const button = screen.getByTestId('recording-download-button')
  await userEvent.click(button)
  expect(onDownload).toHaveBeenCalledOnce()
})

it('shows an optimistic saving hint while the recording uploads', () => {
  render(<TranscriptTab transcript="words" recordingStatus="uploading" />)
  expect(screen.getByTestId('recording-uploading')).toBeInTheDocument()
  expect(screen.queryByTestId('recording-download-button')).toBeNull()
})

it('shows an error when the recording upload failed', () => {
  render(<TranscriptTab transcript="words" recordingStatus="failed" />)
  expect(screen.getByTestId('recording-failed')).toHaveAttribute('role', 'alert')
})

// 33-B1: the speaker-labelling chip.
it('shows the refining chip while diarization is in progress', () => {
  render(<TranscriptTab transcript="words" diarizationStatus="refining" />)
  const chip = screen.getByTestId('diarization-refining')
  expect(chip).toHaveTextContent('Refining transcript with speaker labels…')
  expect(chip).toHaveAttribute('role', 'status')
})

it('shows a non-blocking notice (transcript intact) when diarization fails', () => {
  render(<TranscriptTab transcript="the live transcript" diarizationStatus="failed" />)
  expect(screen.getByTestId('diarization-failed')).toBeInTheDocument()
  // The streamed transcript still shows — diarization failure never blanks it.
  expect(screen.getByTestId('transcription-text')).toHaveTextContent('the live transcript')
})

it('shows no diarization chip when status is none', () => {
  render(<TranscriptTab transcript="words" diarizationStatus="none" />)
  expect(screen.queryByTestId('diarization-bar')).toBeNull()
})

// ─────────────────────────────────────────────────────────────────────────────
// 52-A: find in transcript.
// ─────────────────────────────────────────────────────────────────────────────

const THREE_HITS = 'We set the budget on Monday.\nSpeaker 2: the budget again, and Budget once more.'

const findBox = () => screen.getByLabelText('Find in transcript')
const marks = () => document.querySelectorAll('mark')
const currentMark = () => document.querySelector('mark[aria-current="true"]')

it('52-A: offers no search box when there is no transcript', () => {
  render(<TranscriptTab transcript={null} />)
  expect(screen.queryByLabelText('Find in transcript')).toBeNull()
})

it('52-A: offers no search box for a whitespace-only transcript', () => {
  render(<TranscriptTab transcript={'   \n  '} />)
  expect(screen.queryByLabelText('Find in transcript')).toBeNull()
})

it('52-A: offers a search box once there is a transcript', () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  expect(findBox()).toBeInTheDocument()
})

it('52-A: highlights every match and reports the position', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  expect(marks()).toHaveLength(3)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 3')
})

it('52-A: announces the match count to screen readers', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  expect(screen.getByTestId('transcript-find-count')).toHaveAttribute('role', 'status')
})

it('52-A: leaves the transcript text itself untouched when highlighting', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  expect(screen.getByTestId('transcription-text').textContent).toBe(THREE_HITS)
})

it('52-A: matches regardless of capitals', async () => {
  render(<TranscriptTab transcript="Budget" />)
  await userEvent.type(findBox(), 'budget')
  expect(marks()).toHaveLength(1)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 1')
})

it('52-A: steps to the next match', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 3')
})

it('52-A: wraps around from the last match to the first', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  const next = screen.getByRole('button', { name: 'Next match' })
  await userEvent.click(next)
  await userEvent.click(next)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('3 of 3')
  await userEvent.click(next)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 3')
})

it('52-A: wraps backwards from the first match to the last', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.click(screen.getByRole('button', { name: 'Previous match' }))
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('3 of 3')
})

it('52-A: marks only the current match as current', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  expect(document.querySelectorAll('mark[aria-current="true"]')).toHaveLength(1)
  expect(currentMark()).toBe(marks()[0])
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(currentMark()).toBe(marks()[1])
})

it('52-A: scrolls the current match into view', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
})

it('52-A: steps with Enter and Shift+Enter from the search box', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.keyboard('{Enter}')
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 3')
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 3')
})

it('52-A: says so plainly when nothing matches, and disables stepping', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'pineapple')
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('No matches')
  expect(marks()).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled()
  expect(screen.getByTestId('transcription-text').textContent).toBe(THREE_HITS)
})

it('52-A: clearing the search removes every highlight', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  expect(marks()).toHaveLength(3)
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(marks()).toHaveLength(0)
  expect(findBox()).toHaveValue('')
  expect(screen.getByTestId('transcription-text').textContent).toBe(THREE_HITS)
})

it('52-A: Escape clears the search', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.keyboard('{Escape}')
  expect(findBox()).toHaveValue('')
  expect(marks()).toHaveLength(0)
})

it('52-A: offers exactly one way to clear the search', async () => {
  render(<TranscriptTab transcript={THREE_HITS} />)
  await userEvent.type(findBox(), 'budget')
  expect(screen.getAllByRole('button', { name: 'Clear search' })).toHaveLength(1)
  expect(findBox()).not.toHaveAttribute('type', 'search')
})

it('52-A: treats regex metacharacters as literal text', async () => {
  render(<TranscriptTab transcript="cost a.b and cost axb" />)
  await userEvent.type(findBox(), 'a.b')
  expect(marks()).toHaveLength(1)
  expect(marks()[0]).toHaveTextContent('a.b')
})

it('52-A: an unbalanced bracket does not throw', async () => {
  render(<TranscriptTab transcript="a (partial thought" />)
  await userEvent.type(findBox(), '(part')
  expect(marks()).toHaveLength(1)
})

it('52-A: while recording, the view follows the speech when not searching', () => {
  const { rerender } = render(<TranscriptTab transcript="first words" isRecording />)
  const body = screen.getByTestId('transcription-body')
  Object.defineProperty(body, 'scrollHeight', { value: 500, configurable: true })
  body.scrollTop = 0
  rerender(<TranscriptTab transcript="first words and more" isRecording />)
  expect(body.scrollTop).toBe(500)
})

it('52-A: while recording, an active search stops the view being pulled to the bottom', async () => {
  const { rerender } = render(<TranscriptTab transcript="the budget words" isRecording />)
  await userEvent.type(findBox(), 'budget')
  const body = screen.getByTestId('transcription-body')
  Object.defineProperty(body, 'scrollHeight', { value: 500, configurable: true })
  body.scrollTop = 0
  rerender(<TranscriptTab transcript="the budget words and more speech" isRecording />)
  expect(body.scrollTop).toBe(0)
})

it('52-A: a growing transcript does not reset which match the user is on', async () => {
  const { rerender } = render(<TranscriptTab transcript="budget one budget two" isRecording />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 2')
  rerender(<TranscriptTab transcript="budget one budget two budget three budget four" isRecording />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 4')
})

// Review findings, 52-A.
it('52-A: a dotted capital I earlier in the transcript does not shift later highlights', async () => {
  render(<TranscriptTab transcript="İstanbul hello world" />)
  await userEvent.type(findBox(), 'world')
  expect(marks()).toHaveLength(1)
  expect(marks()[0]).toHaveTextContent('world')
  expect(screen.getByTestId('transcription-text').textContent).toBe('İstanbul hello world')
})

it('52-A: caps how many matches are highlighted, and says stepping is confined to them', async () => {
  render(<TranscriptTab transcript={'budget '.repeat(800)} />)
  await userEvent.type(findBox(), 'budget')
  expect(marks()).toHaveLength(500)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of first 500')
})

it('52-A: a transcript with exactly the cap many matches is not reported as capped', async () => {
  render(<TranscriptTab transcript={'budget '.repeat(500)} />)
  await userEvent.type(findBox(), 'budget')
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 500')
  expect(screen.getByTestId('transcript-find-count')).not.toHaveTextContent('first')
})

// The live transcript replaces its last line as a phrase finalises, so it is not a plain append.
// These use that real shape; a hand-written clean append does not discriminate.
it('52-A: a phrase finalising mid-recording does not throw the user back to the first match', async () => {
  // Settled turns, holding two matches; the user is reading the second of them.
  const settled = 'Speaker 0: the budget and the budget again\n'
  const { rerender } = render(
    <TranscriptTab transcript={`${settled}we discussed the bud`} isRecording />,
  )
  await userEvent.type(findBox(), 'budget')
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 2')
  // The provisional last line is REPLACED by the finalised, speaker-labelled turn — it is not
  // extended, so the transcript as a whole is not a continuation of what came before.
  rerender(
    <TranscriptTab transcript={`${settled}Speaker 1: we discussed the budget.`} isRecording />,
  )
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 3')
})

it('52-A: a word revised after the read match does not move the user', async () => {
  const { rerender } = render(<TranscriptTab transcript="the budget the plan recognise" isRecording />)
  await userEvent.type(findBox(), 'the')
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 2')
  rerender(<TranscriptTab transcript="the budget the plan recognize" isRecording />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 2')
})

// Pins the comparison to the END of the match being read, not its start: a revision landing inside
// that span can create or destroy a match within it, so the position stops being trustworthy.
// Comparing only up to the start would silently keep a position whose own text had changed.
it('52-A: a word revised inside the read match starts the search again', async () => {
  const { rerender } = render(<TranscriptTab transcript="a budget b budget c" isRecording />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 2')
  rerender(<TranscriptTab transcript="a budget b budjet c budget d" isRecording />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 2')
})

it('52-A: text rewritten before the read match starts the search again', async () => {
  const { rerender } = render(<TranscriptTab transcript="the budget recognise the plan" isRecording />)
  await userEvent.type(findBox(), 'the')
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('2 of 2')
  // The change lands ahead of the match being read, so the position no longer means anything.
  rerender(<TranscriptTab transcript="the budget recognize the plan" isRecording />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 2')
})

it('52-A: clearing the search during a recording resumes following the speech', async () => {
  const { rerender } = render(<TranscriptTab transcript="the budget words" isRecording />)
  await userEvent.type(findBox(), 'budget')
  await userEvent.keyboard('{Escape}')
  const body = screen.getByTestId('transcription-body')
  Object.defineProperty(body, 'scrollHeight', { value: 500, configurable: true })
  body.scrollTop = 0
  rerender(<TranscriptTab transcript="the budget words and more speech" isRecording />)
  expect(body.scrollTop).toBe(500)
})

it('52-A: incoming speech does not drag the view back to the current match', async () => {
  const { rerender } = render(<TranscriptTab transcript="budget one budget two" isRecording />)
  await userEvent.type(findBox(), 'budget')
  vi.mocked(Element.prototype.scrollIntoView).mockClear()
  rerender(<TranscriptTab transcript="budget one budget two and more speech" isRecording />)
  rerender(<TranscriptTab transcript="budget one budget two and more speech still" isRecording />)
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
})

it('52-A: stepping still re-centres the view after speech has arrived', async () => {
  const { rerender } = render(<TranscriptTab transcript="budget one budget two" isRecording />)
  await userEvent.type(findBox(), 'budget')
  rerender(<TranscriptTab transcript="budget one budget two and more" isRecording />)
  vi.mocked(Element.prototype.scrollIntoView).mockClear()
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
})

it('52-A: a transcript rewritten from scratch starts the search again at the first match', async () => {
  const { rerender } = render(<TranscriptTab transcript="budget a budget b budget c" />)
  await userEvent.type(findBox(), 'budget')
  const next = screen.getByRole('button', { name: 'Next match' })
  await userEvent.click(next)
  await userEvent.click(next)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('3 of 3')
  // The speaker-labelled transcript replaces the streamed one: same words, every position moved.
  rerender(<TranscriptTab transcript="Speaker 1: budget a budget b budget c" />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 3')
  expect(currentMark()).toBe(marks()[0])
})

it('52-A: a rewrite does not strand the user on a match number that no longer exists', async () => {
  const { rerender } = render(<TranscriptTab transcript="budget a budget b budget c" />)
  await userEvent.type(findBox(), 'budget')
  const next = screen.getByRole('button', { name: 'Next match' })
  await userEvent.click(next)
  await userEvent.click(next)
  rerender(<TranscriptTab transcript="budget only" />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 1')
  // Restoring a longer transcript must not silently teleport them back to the third match.
  rerender(<TranscriptTab transcript="budget a budget b budget c" />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 3')
})

it('52-A: a replaced, shorter transcript clamps to the last remaining match', async () => {
  const { rerender } = render(<TranscriptTab transcript="budget one budget two budget three" />)
  await userEvent.type(findBox(), 'budget')
  const next = screen.getByRole('button', { name: 'Next match' })
  await userEvent.click(next)
  await userEvent.click(next)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('3 of 3')
  rerender(<TranscriptTab transcript="budget only" />)
  expect(screen.getByTestId('transcript-find-count')).toHaveTextContent('1 of 1')
})
