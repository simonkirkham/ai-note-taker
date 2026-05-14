import { render, screen } from '@testing-library/react'

function Hello() {
  return <p>scaffold ok</p>
}

describe('scaffold', () => {
  it('renders without crashing', () => {
    render(<Hello />)
    expect(screen.getByText('scaffold ok')).toBeInTheDocument()
  })

  it('MSW intercepts fetch without a real network call', async () => {
    const res = await fetch('/ping')
    const data = await res.json()
    expect(data).toEqual({ ok: true })
  })
})
