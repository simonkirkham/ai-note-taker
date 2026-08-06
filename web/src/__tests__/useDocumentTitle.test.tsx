import { render } from '@testing-library/react'
import { APP_TITLE, useDocumentTitle } from '../hooks/useDocumentTitle'

function Probe({ title }: { title: string | null | undefined }) {
  useDocumentTitle(title)
  return null
}

describe('useDocumentTitle', () => {
  // Deliberately NOT APP_TITLE: seeding the app title would make every fallback assertion
  // pass whether or not the hook wrote anything (a hook that never writes on the no-title
  // path survives). Starting from a value the hook can never produce means each assertion
  // proves a write actually happened.
  const SENTINEL = 'SENTINEL-not-a-title-the-hook-can-produce'

  beforeEach(() => {
    document.title = SENTINEL
  })

  it('puts the note title in front of the app name', () => {
    render(<Probe title="Roadmap review" />)
    expect(document.title).toBe(`Roadmap review - ${APP_TITLE}`)
  })

  it('follows a rename', () => {
    const { rerender } = render(<Probe title="Roadmap review" />)
    rerender(<Probe title="Q3 planning" />)
    expect(document.title).toBe(`Q3 planning - ${APP_TITLE}`)
  })

  it('falls back to the app name for an untitled note', () => {
    render(<Probe title="" />)
    expect(document.title).toBe(APP_TITLE)
  })

  it('falls back to the app name for a whitespace-only title', () => {
    render(<Probe title="   " />)
    expect(document.title).toBe(APP_TITLE)
  })

  it('falls back to the app name when there is no note', () => {
    render(<Probe title={null} />)
    expect(document.title).toBe(APP_TITLE)
  })

  it('reverts the tab when the user clears an existing title', () => {
    const { rerender } = render(<Probe title="Roadmap review" />)
    rerender(<Probe title="" />)
    expect(document.title).toBe(APP_TITLE)
  })

  it('restores the app name when the note closes', () => {
    const { unmount } = render(<Probe title="Roadmap review" />)
    expect(document.title).toBe(`Roadmap review - ${APP_TITLE}`)
    unmount()
    expect(document.title).toBe(APP_TITLE)
  })
})
