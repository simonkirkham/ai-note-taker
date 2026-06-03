import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FinalNotesView from '../components/FinalNotesView'

const noop = async () => {}

describe('FinalNotesView', () => {
  it('renders summary, discussion, decisions and attribution when populated', () => {
    render(
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
    render(
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
    render(
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
    render(
      <FinalNotesView
        summary={null}
        discussionPoints={[]}
        decisions={[]}
        summaryModelId={null}
        onGenerate={noop}
      />,
    )
    expect(screen.getByTestId('final-notes-empty')).toBeInTheDocument()
    expect(screen.getByText(/no final notes yet/i)).toBeInTheDocument()
    const cta = screen.getByTestId('generate-final-notes-button')
    expect(cta.tagName).toBe('BUTTON')
    expect(screen.queryByTestId('final-notes-summary')).toBeNull()
  })

  it('treats an empty-string summary as the empty state', () => {
    render(
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

  it('invokes onGenerate when the CTA is clicked', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined)
    render(
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

  it('surfaces an inline error and re-enables the button when generation fails', async () => {
    const onGenerate = vi.fn().mockRejectedValue(new Error('analyse failed'))
    render(
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
    // The empty state is still distinct from the failure: the empty message remains,
    // and the button is re-enabled so the user can retry.
    expect(screen.getByTestId('final-notes-empty')).toBeInTheDocument()
    expect(screen.getByTestId('generate-final-notes-button')).toBeEnabled()
  })

  it('clears a prior error on a subsequent successful generate', async () => {
    const onGenerate = vi
      .fn()
      .mockRejectedValueOnce(new Error('analyse failed'))
      .mockResolvedValueOnce(undefined)
    render(
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
})
