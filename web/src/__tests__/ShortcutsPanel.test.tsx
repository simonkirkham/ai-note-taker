import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShortcutsPanel from '../components/ShortcutsPanel'

describe('ShortcutsPanel', () => {
  it('renders the toggle button', () => {
    render(<ShortcutsPanel />)
    expect(screen.getByTestId('shortcuts-toggle')).toBeInTheDocument()
  })

  it('shortcuts table is hidden by default', () => {
    render(<ShortcutsPanel />)
    expect(screen.queryByTestId('shortcuts-table')).toBeNull()
  })

  it('clicking the toggle shows the shortcuts table', async () => {
    render(<ShortcutsPanel />)
    await userEvent.click(screen.getByTestId('shortcuts-toggle'))
    expect(screen.getByTestId('shortcuts-table')).toBeInTheDocument()
  })

  it('clicking the toggle again hides the table', async () => {
    render(<ShortcutsPanel />)
    const toggle = screen.getByTestId('shortcuts-toggle')
    await userEvent.click(toggle)
    await userEvent.click(toggle)
    expect(screen.queryByTestId('shortcuts-table')).toBeNull()
  })

  it('shortcuts table lists expected shortcuts', async () => {
    render(<ShortcutsPanel />)
    await userEvent.click(screen.getByTestId('shortcuts-toggle'))
    const table = screen.getByTestId('shortcuts-table')
    expect(table).toHaveTextContent('## + Space')
    expect(table).toHaveTextContent('Ctrl+B')
    expect(table).toHaveTextContent('✓ button')
  })

  it('pressing Escape hides the table', async () => {
    render(<ShortcutsPanel />)
    await userEvent.click(screen.getByTestId('shortcuts-toggle'))
    expect(screen.getByTestId('shortcuts-table')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('shortcuts-table')).toBeNull()
  })

  it('clicking outside the panel hides the table', async () => {
    render(
      <div>
        <ShortcutsPanel />
        <button data-testid="outside">outside</button>
      </div>,
    )
    await userEvent.click(screen.getByTestId('shortcuts-toggle'))
    expect(screen.getByTestId('shortcuts-table')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('shortcuts-table')).toBeNull()
  })
})
