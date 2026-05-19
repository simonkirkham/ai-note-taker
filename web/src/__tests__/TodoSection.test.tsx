import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import TodoSection from '../components/TodoSection'

const item1 = {
  actionId: 'a-1',
  noteId: 'n-1',
  noteTitle: 'Meeting Notes',
  description: 'Chase invoice',
  addedAt: '2026-01-01T00:00:00Z',
}
const item2 = {
  actionId: 'a-2',
  noteId: 'n-1',
  noteTitle: 'Meeting Notes',
  description: 'Send recap',
  addedAt: '2026-01-01T00:00:00Z',
}

describe('TodoSection', () => {
  it('renders open todo items from the API', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ items: [item1, item2] })))
    render(<TodoSection />)
    expect(await screen.findByText('Chase invoice')).toBeInTheDocument()
    expect(screen.getByText('Send recap')).toBeInTheDocument()
  })

  it('completing a todo POSTs to the API and removes it from the list', async () => {
    let completeCalled = false
    server.use(
      http.get('/api/todos', () => HttpResponse.json({ items: [item1] })),
      http.post('/api/notes/:noteId/actions/:actionId/complete', () => {
        completeCalled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    render(<TodoSection />)
    const checkbox = await screen.findByRole('checkbox', { name: /Chase invoice/i })
    await userEvent.click(checkbox)
    await waitFor(() => expect(completeCalled).toBe(true))
    await waitFor(() => expect(screen.queryByText('Chase invoice')).not.toBeInTheDocument())
  })
})
