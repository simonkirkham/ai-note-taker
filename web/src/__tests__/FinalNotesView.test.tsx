import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import FinalNotesView from '../components/FinalNotesView'
import { ToastProvider } from '../components/ToastProvider'

const noop = async () => {}

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

describe('FinalNotesView', () => {
  it('renders summary, discussion, decisions and attribution when populated', () => {
    renderWithToast(
      <FinalNotesView
        summary="We agreed to ship Friday."
        discussionPoints={['Scope risk', 'Staffing']}
        decisions={['Ship Friday', 'Freeze scope']}
        summaryModelId="amazon.nova-lite-v1"
        onGenerate={noop}
      />,
    )

    expect(screen.getByTestId('final-notes-summary')).toHaveTextContent('We agreed to ship Friday.')

    const discussion = screen.getByTestId('final-notes-discussion')
    expect(discussion.tagName).toBe('UL')
    expect(discussion).toHaveTextContent('Scope risk')
    expect(discussion).toHaveTextContent('Staffing')

    const decisions = screen.getByTestId('final-notes-decisions')
    expect(decisions).toHaveTextContent('Ship Friday')
    expect(decisions).toHaveTextContent('Freeze scope')

    expect(screen.getByTestId('final-notes-attribution')).toHaveTextContent('Written by amazon.nova-lite-v1')

    expect(screen.queryByTestId('final-notes-empty')).toBeNull()
    expect(screen.queryByTestId('generate-final-notes-button')).toBeNull()
  })

  it('omits the attribution line when no model id is given', () => {
    renderWithToast(
      <FinalNotesView
        summary="A summary."
        discussionPoints={[]}
        decisions={[]}
        summaryModelId={null}
        onGenerate={noop}
      />,
    )
    expect(screen.queryByTestId('final-notes-attribution')).toBeNull()
    expect(screen.queryByTestId('final-notes-discussion')).toBeNull()
    expect(screen.queryByTestId('final-notes-decisions')).toBeNull()
  })

  it('does not render action items', () => {
    renderWithToast(
      <FinalNotesView
        summary="A summary."
        discussionPoints={['point']}
        decisions={['decision']}
        summaryModelId="model-x"
        onGenerate={noop}
      />,
    )
    expect(screen.queryByText(/action items?/i)).toBeNull()
    expect(screen.queryByTestId('actions-section')).toBeNull()
  })

  it('shows the empty state with a Generate CTA when summary is null', () => {
    renderWithToast(
      <FinalNotesView
        summary={null}
        discussionPoints={[]}
        decisions={[]}
        summaryModelId={null}
        onGenerate={noop}
      />,
    )
    expect(screen.getByTestId('final-notes-empty')).toBeInTheDocument()
    expect(screen.getByText(/no final notes yet/i)).toHaveAttribute('role', 'status') // 19-F1
    const cta = screen.getByTestId('generate-final-notes-button')
    expect(cta.tagName).toBe('BUTTON')
    expect(screen.queryByTestId('final-notes-summary')).toBeNull()
    expect(screen.queryByTestId('reprocess-final-notes-button')).toBeNull()
  })

  it('treats an empty-string summary as the empty state', () => {
    renderWithToast(
      <FinalNotesView
        summary="   "
        discussionPoints={[]}
        decisions={[]}
        summaryModelId={null}
        onGenerate={noop}
      />,
    )
    expect(screen.getByTestId('final-notes-empty')).toBeInTheDocument()
  })

  it('invokes onGenerate when the empty-state CTA is clicked', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined)
    renderWithToast(
      <FinalNotesView
        summary={null}
        discussionPoints={[]}
        decisions={[]}
        summaryModelId={null}
        onGenerate={onGenerate}
      />,
    )
    await userEvent.click(screen.getByTestId('generate-final-notes-button'))
    expect(onGenerate).toHaveBeenCalledOnce()
  })

  it('surfaces an inline error and re-enables the button when empty-state generation fails', async () => {
    const onGenerate = vi.fn().mockRejectedValue(new Error('analyse failed'))
    renderWithToast(
      <FinalNotesView
        summary={null}
        discussionPoints={[]}
        decisions={[]}
        summaryModelId={null}
        onGenerate={onGenerate}
      />,
    )

    await userEvent.click(screen.getByTestId('generate-final-notes-button'))

    const error = await screen.findByTestId('final-notes-generate-error')
    expect(error).toHaveTextContent(/couldn't generate/i)
    expect(error).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('final-notes-empty')).toBeInTheDocument()
    expect(screen.getByTestId('generate-final-notes-button')).toBeEnabled()
  })

  it('clears a prior error on a subsequent successful generate', async () => {
    const onGenerate = vi
      .fn()
      .mockRejectedValueOnce(new Error('analyse failed'))
      .mockResolvedValueOnce(undefined)
    renderWithToast(
      <FinalNotesView
        summary={null}
        discussionPoints={[]}
        decisions={[]}
        summaryModelId={null}
        onGenerate={onGenerate}
      />,
    )

    await userEvent.click(screen.getByTestId('generate-final-notes-button'))
    expect(await screen.findByTestId('final-notes-generate-error')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('generate-final-notes-button'))
    await waitFor(() =>
      expect(screen.queryByTestId('final-notes-generate-error')).toBeNull(),
    )
  })

  describe('re-process control (populated state)', () => {
    it('renders a Re-process button that calls onGenerate', async () => {
      const onGenerate = vi.fn().mockResolvedValue(undefined)
      renderWithToast(
        <FinalNotesView
          summary="We agreed to ship Friday."
          discussionPoints={['Scope risk']}
          decisions={['Ship Friday']}
          summaryModelId="amazon.nova-lite-v1"
          onGenerate={onGenerate}
        />,
      )

      const button = screen.getByTestId('reprocess-final-notes-button')
      expect(button.tagName).toBe('BUTTON')
      await userEvent.click(button)
      expect(onGenerate).toHaveBeenCalledOnce()
    })

    it('shows a pending label and keeps the existing summary visible during re-processing', async () => {
      let resolve!: () => void
      const onGenerate = vi.fn(
        () =>
          new Promise<void>((r) => {
            resolve = r
          }),
      )
      renderWithToast(
        <FinalNotesView
          summary="We agreed to ship Friday."
          discussionPoints={['Scope risk']}
          decisions={['Ship Friday']}
          summaryModelId="amazon.nova-lite-v1"
          onGenerate={onGenerate}
        />,
      )

      await userEvent.click(screen.getByTestId('reprocess-final-notes-button'))

      const button = screen.getByTestId('reprocess-final-notes-button')
      expect(button).toBeDisabled()
      expect(button).toHaveTextContent(/re-processing/i)
      expect(screen.getByTestId('final-notes-summary')).toHaveTextContent('We agreed to ship Friday.')
      expect(screen.getByTestId('final-notes-discussion')).toHaveTextContent('Scope risk')

      resolve()
      await waitFor(() => expect(screen.getByTestId('reprocess-final-notes-button')).toBeEnabled())
    })

    it('surfaces an error toast and keeps the prior summary when re-processing fails', async () => {
      const onGenerate = vi.fn().mockRejectedValue(new Error('analyse failed'))
      renderWithToast(
        <FinalNotesView
          summary="We agreed to ship Friday."
          discussionPoints={['Scope risk']}
          decisions={['Ship Friday']}
          summaryModelId="amazon.nova-lite-v1"
          onGenerate={onGenerate}
        />,
      )

      await userEvent.click(screen.getByTestId('reprocess-final-notes-button'))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/couldn't re-process final notes/i)
      expect(screen.getByTestId('final-notes-summary')).toHaveTextContent('We agreed to ship Friday.')
      expect(screen.getByTestId('reprocess-final-notes-button')).toBeEnabled()
    })
  })
})
