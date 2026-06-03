import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import ActionsSection from '../components/ActionsSection'
import { server } from '../test/setup'

const NOTE_ID = 'note-1'
const action1 = { actionId: 'a-1', description: 'Book meeting', completed: false, addedAt: '2026-01-01T00:00:00Z', completedAt: null }
const action1done = { ...action1, completed: true, completedAt: '2026-01-02T00:00:00Z' }

function renderActions() {
  return render(<ActionsSection noteId={NOTE_ID} />)
}

describe('ActionsSection', () => {
  it('shows empty state when no actions exist', async () => {
    renderActions()
    expect(await screen.findByTestId('actions-empty')).toBeInTheDocument()
  })

  it('does not render an add-action button', async () => {
    renderActions()
    await screen.findByTestId('actions-empty')
    expect(screen.queryByTestId('add-action-button')).toBeNull()
  })

  it('Enter key adds item and clears the input', async () => {
    let postCalled = false
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, async () => {
        postCalled = true
        return HttpResponse.json({ actionId: 'new-1' }, { status: 201 })
      }),
    )
    renderActions()
    await screen.findByTestId('actions-empty')
    const input = screen.getByTestId('action-input')
    await userEvent.type(input, 'Book meeting{Enter}')
    await waitFor(() => expect(postCalled).toBe(true))
    await waitFor(() => expect(screen.getByText('Book meeting')).toBeInTheDocument())
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('blur on non-empty input adds the item', async () => {
    let postCalled = false
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, async () => {
        postCalled = true
        return HttpResponse.json({ actionId: 'new-2' }, { status: 201 })
      }),
    )
    renderActions()
    await screen.findByTestId('actions-empty')
    const input = screen.getByTestId('action-input')
    await userEvent.type(input, 'Book the room')
    await userEvent.tab()
    await waitFor(() => expect(postCalled).toBe(true))
    await waitFor(() => expect(screen.getByText('Book the room')).toBeInTheDocument())
  })

  it('blur on empty input does not call POST', async () => {
    let postCalled = false
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, () => {
        postCalled = true
        return HttpResponse.json({ actionId: 'x' }, { status: 201 })
      }),
    )
    renderActions()
    await screen.findByTestId('actions-empty')
    const input = screen.getByTestId('action-input')
    await userEvent.click(input)
    await userEvent.tab()
    expect(postCalled).toBe(false)
    expect(screen.getByTestId('actions-empty')).toBeInTheDocument()
  })

  it('completing an action calls POST /complete and marks checkbox checked', async () => {
    let completeCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.post(`/api/notes/${NOTE_ID}/actions/:actionId/complete`, () => {
        completeCalled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    renderActions()
    const checkbox = await screen.findByRole('checkbox', { name: /Book meeting/i })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    await waitFor(() => expect(completeCalled).toBe(true))
    await waitFor(() => expect(checkbox).toBeChecked())
  })

  it('reopening a completed action calls POST /reopen and unchecks the checkbox', async () => {
    let reopenCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1done] })),
      http.post(`/api/notes/${NOTE_ID}/actions/:actionId/reopen`, () => {
        reopenCalled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    renderActions()
    const checkbox = await screen.findByRole('checkbox', { name: /Book meeting/i })
    expect(checkbox).toBeChecked()
    await userEvent.click(checkbox)
    await waitFor(() => expect(reopenCalled).toBe(true))
    await waitFor(() => expect(checkbox).not.toBeChecked())
  })

  it('deleting an action calls DELETE and removes it from the list', async () => {
    let deleteCalled = false
    server.use(
      http.get(`/api/notes/${NOTE_ID}/actions`, () => HttpResponse.json({ actions: [action1] })),
      http.delete(`/api/notes/${NOTE_ID}/actions/:actionId`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderActions()
    const deleteBtn = await screen.findByTestId('delete-action-a-1')
    await userEvent.click(deleteBtn)
    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.queryByText('Book meeting')).not.toBeInTheDocument())
    expect(screen.getByTestId('actions-empty')).toBeInTheDocument()
  })
})
