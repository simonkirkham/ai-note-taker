import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShortcutsPanel from '../components/ShortcutsPanel'

describe('ShortcutsPanel', () => {
  it('renders the toggle button', () => {
    render(<ShortcutsPanel />)
    expect(screen.getByRole('button', { name: /toggle keyboard shortcuts/i })).toBeInTheDocument()
  })

  it('shortcuts table is hidden by default', () => {
    render(<ShortcutsPanel />)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('clicking the toggle shows the shortcuts table', async () => {
    render(<ShortcutsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /toggle keyboard shortcuts/i }))
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('clicking the toggle again hides the table', async () => {
    render(<ShortcutsPanel />)
    const toggle = screen.getByRole('button', { name: /toggle keyboard shortcuts/i })
    await userEvent.click(toggle)
    await userEvent.click(toggle)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shortcuts table lists expected shortcuts', async () => {
    render(<ShortcutsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /toggle keyboard shortcuts/i }))
    const table = screen.getByRole('table')
    expect(table).toHaveTextContent('## + Space')
    expect(table).toHaveTextContent('Ctrl+B')
    expect(table).toHaveTextContent('✓ button')
  })

  it('documents the /ai instruction shortcut (29-B)', async () => {
    render(<ShortcutsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /toggle keyboard shortcuts/i }))
    const table = screen.getByRole('table')
    expect(table).toHaveTextContent('/ai')
    expect(table).toHaveTextContent(/carries out the instruction/i)
  })

  it('pressing Escape hides the table', async () => {
    render(<ShortcutsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /toggle keyboard shortcuts/i }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('clicking outside the panel hides the table', async () => {
    render(
      <div>
        <ShortcutsPanel />
        <button data-testid="outside">outside</button>
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: /toggle keyboard shortcuts/i }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: /outside/i }))
    expect(screen.queryByRole('table')).toBeNull()
  })
})
