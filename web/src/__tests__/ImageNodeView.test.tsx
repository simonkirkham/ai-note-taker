import type { NodeViewProps } from '@tiptap/react'
import ImageNodeView from '../components/ImageNodeView'
import { createEvent, fireEvent, render, screen } from '../test/render'

// NodeViewWrapper needs the ReactNodeView editor context; stub it to a passthrough
// so the component's render decision can be tested in isolation (jsdom).
vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

const RESOLVED_URL =
  'https://bucket.s3.eu-west-2.amazonaws.com/notes/note-1/abc123.png?X-Amz-Signature=deadbeef'

function renderNode(
  src: string | undefined,
  attrs: { width?: number | null; alt?: string } = {},
  overrides: Partial<NodeViewProps> = {},
) {
  const updateAttributes = vi.fn()
  const props = {
    node: { attrs: { src, alt: '', title: '', width: null, ...attrs } },
    deleteNode: vi.fn(),
    updateAttributes,
    selected: false,
    // editor.view.dom drives the content-width cap; clientWidth is 0 in jsdom.
    editor: { view: { dom: { clientWidth: 0 } } },
    ...overrides,
  }
  const utils = render(<ImageNodeView {...(props as unknown as NodeViewProps)} />)
  return { ...utils, updateAttributes }
}

describe('ImageNodeView (BUG-19)', () => {
  it('renders a placeholder, not an <img>, while the src is an unresolved S3 key', () => {
    renderNode('notes/note-1/abc123.png')
    expect(screen.getByTestId('image-placeholder')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders an <img> once the src is a resolved presigned URL', () => {
    renderNode(RESOLVED_URL)
    expect(document.querySelector('img')).toHaveAttribute('src', RESOLVED_URL)
    expect(screen.queryByTestId('image-placeholder')).toBeNull()
  })

  it('renders an <img> for a transient blob: upload preview (not a bare key)', () => {
    renderNode('blob:https://note-taker-ai.com/9f8e-uuid')
    expect(document.querySelector('img')).toBeInTheDocument()
    expect(screen.queryByTestId('image-placeholder')).toBeNull()
  })
})

describe('ImageNodeView load failure (CHANGE-31)', () => {
  const ALT = 'Whiteboard sketch of the login flow'
  const failImage = () => fireEvent.error(document.querySelector('img') as HTMLImageElement)

  it('shows the alt text instead of the broken image when the image fails to load', () => {
    renderNode(RESOLVED_URL, { alt: ALT })
    failImage()
    expect(screen.getByTestId('image-fallback')).toHaveTextContent(ALT)
    expect(document.querySelector('img')).toBeNull()
  })

  it('falls back to a generic label when the failed image has no alt text', () => {
    renderNode(RESOLVED_URL, { alt: '' })
    failImage()
    expect(screen.getByTestId('image-fallback')).toHaveTextContent('Image unavailable')
    expect(document.querySelector('img')).toBeNull()
  })

  it('treats a whitespace-only alt as no alt text', () => {
    renderNode(RESOLVED_URL, { alt: '   ' })
    failImage()
    expect(screen.getByTestId('image-fallback')).toHaveTextContent('Image unavailable')
  })

  it('keeps the image and shows no fallback while the load succeeds', () => {
    renderNode(RESOLVED_URL, { alt: ALT })
    fireEvent.load(document.querySelector('img') as HTMLImageElement)
    expect(document.querySelector('img')).toHaveAttribute('src', RESOLVED_URL)
    expect(screen.queryByTestId('image-fallback')).toBeNull()
  })

  it('shows no fallback before any error fires', () => {
    renderNode(RESOLVED_URL, { alt: ALT })
    expect(screen.queryByTestId('image-fallback')).toBeNull()
  })

  it('keeps the remove control usable on a failed image', () => {
    const deleteNode = vi.fn()
    renderNode(RESOLVED_URL, { alt: ALT }, { deleteNode })
    failImage()
    screen.getByTestId('remove-image-button').click()
    expect(deleteNode).toHaveBeenCalled()
  })

  it('hides the size and drag controls once the image has failed (nothing to resize)', () => {
    renderNode(RESOLVED_URL, { alt: ALT })
    failImage()
    expect(screen.queryByRole('group', { name: /image size/i })).toBeNull()
    expect(screen.queryByTestId('image-resize-handle')).toBeNull()
  })

  it('retries the image when the src changes after a failure', () => {
    const props = {
      node: { attrs: { src: RESOLVED_URL, alt: ALT, title: '', width: null } },
      deleteNode: vi.fn(),
      updateAttributes: vi.fn(),
      selected: false,
      editor: { view: { dom: { clientWidth: 0 } } },
    }
    const { rerender } = render(<ImageNodeView {...(props as unknown as NodeViewProps)} />)
    failImage()
    expect(screen.getByTestId('image-fallback')).toBeInTheDocument()

    const next = 'https://bucket.s3.eu-west-2.amazonaws.com/notes/note-1/abc123.png?X-Amz-Signature=fresh'
    const nextProps = { ...props, node: { attrs: { ...props.node.attrs, src: next } } }
    rerender(<ImageNodeView {...(nextProps as unknown as NodeViewProps)} />)
    expect(document.querySelector('img')).toHaveAttribute('src', next)
    expect(screen.queryByTestId('image-fallback')).toBeNull()
  })
})

describe('ImageNodeView src handling (CHANGE-31 regression)', () => {
  it('loads a remote absolute URL src unchanged', () => {
    renderNode('https://cdn.example.com/pictures/diagram.png', { alt: 'Diagram' })
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/pictures/diagram.png',
    )
    expect(screen.queryByTestId('image-fallback')).toBeNull()
  })

  it('loads a root-relative src unchanged (not mistaken for an unresolved key)', () => {
    renderNode('/uploads/diagram.png', { alt: 'Diagram' })
    expect(document.querySelector('img')).toHaveAttribute('src', '/uploads/diagram.png')
    expect(screen.queryByTestId('image-placeholder')).toBeNull()
    expect(screen.queryByTestId('image-fallback')).toBeNull()
  })

  it('loads a document-relative src unchanged', () => {
    renderNode('assets/diagram.png', { alt: 'Diagram' })
    expect(document.querySelector('img')).toHaveAttribute('src', 'assets/diagram.png')
    expect(screen.queryByTestId('image-placeholder')).toBeNull()
  })
})

describe('ImageNodeView size control (28-A)', () => {
  it('renders an accessible, labelled size control with the preset options', () => {
    renderNode(RESOLVED_URL)
    const group = screen.getByRole('group', { name: /image size/i })
    expect(group).toBeInTheDocument()
    for (const label of ['Small', 'Medium', 'Large', 'Original']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('size buttons are real buttons (keyboard-operable, no pointer required)', () => {
    renderNode(RESOLVED_URL)
    const small = screen.getByRole('button', { name: 'Small' })
    expect(small.tagName).toBe('BUTTON')
    expect(small).toHaveAttribute('type', 'button')
  })

  it('choosing a preset sets the width attribute (clamped)', () => {
    const { updateAttributes } = renderNode(RESOLVED_URL)
    screen.getByRole('button', { name: 'Medium' }).click()
    expect(updateAttributes).toHaveBeenCalledWith({ width: 480 })
  })

  it('choosing Original clears the width attribute (renders at natural size)', () => {
    const { updateAttributes } = renderNode(RESOLVED_URL, { width: 480 })
    screen.getByRole('button', { name: 'Original' }).click()
    expect(updateAttributes).toHaveBeenCalledWith({ width: null })
  })

  it('applies the stored width to the rendered image', () => {
    renderNode(RESOLVED_URL, { width: 300 })
    const img = document.querySelector('img') as HTMLImageElement
    expect(img.style.width).toBe('300px')
  })

  it('renders the image at natural size when no width is set', () => {
    renderNode(RESOLVED_URL, { width: null })
    const img = document.querySelector('img') as HTMLImageElement
    expect(img.style.width).toBe('')
  })

  it('does not show the size control while the image is an unresolved placeholder', () => {
    renderNode('notes/note-1/abc123.png')
    expect(screen.queryByRole('group', { name: /image size/i })).toBeNull()
  })
})

describe('ImageNodeView drag-resize handle (28-B)', () => {
  it('renders a corner resize handle on a resolved image', () => {
    renderNode(RESOLVED_URL)
    expect(screen.getByTestId('image-resize-handle')).toBeInTheDocument()
  })

  it('does not show the resize handle while the image is an unresolved placeholder', () => {
    renderNode('notes/note-1/abc123.png')
    expect(screen.queryByTestId('image-resize-handle')).toBeNull()
  })

  it('keeps the handle out of the tab order (the preset control is the a11y path)', () => {
    renderNode(RESOLVED_URL)
    const handle = screen.getByTestId('image-resize-handle')
    expect(handle.tagName).not.toBe('BUTTON')
    expect(handle).toHaveAttribute('aria-hidden', 'true')
  })

  it('prevents default on mousedown so a drag does not start text selection', () => {
    renderNode(RESOLVED_URL, { width: 400 })
    const handle = screen.getByTestId('image-resize-handle')
    const down = createEvent.mouseDown(handle, { clientX: 100 })
    fireEvent(handle, down)
    expect(down.defaultPrevented).toBe(true)
  })

  it('dragging the handle outward updates the width live (clamped)', () => {
    const { updateAttributes } = renderNode(RESOLVED_URL, { width: 400 })
    const handle = screen.getByTestId('image-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 150 })
    expect(updateAttributes).toHaveBeenCalledWith({ width: 450 })
    fireEvent.mouseUp(window)
  })

  it('dragging the handle inward shrinks the width', () => {
    const { updateAttributes } = renderNode(RESOLVED_URL, { width: 400 })
    const handle = screen.getByTestId('image-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 30 })
    expect(updateAttributes).toHaveBeenCalledWith({ width: 330 })
    fireEvent.mouseUp(window)
  })

  it('stops updating once the drag is released', () => {
    const { updateAttributes } = renderNode(RESOLVED_URL, { width: 400 })
    const handle = screen.getByTestId('image-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseUp(window)
    updateAttributes.mockClear()
    fireEvent.mouseMove(window, { clientX: 300 })
    expect(updateAttributes).not.toHaveBeenCalled()
  })
})
