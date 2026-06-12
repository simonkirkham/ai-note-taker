import type { NodeViewProps } from '@tiptap/react'
import ImageNodeView from '../components/ImageNodeView'
import { render, screen } from '../test/render'

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
  attrs: { width?: number | null } = {},
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
