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

function renderNode(src: string | undefined) {
  const props = { node: { attrs: { src, alt: '', title: '' } }, deleteNode: vi.fn(), selected: false }
  return render(<ImageNodeView {...(props as unknown as NodeViewProps)} />)
}

describe('ImageNodeView (BUG-19)', () => {
  it('renders a placeholder, not an <img>, while the src is an unresolved S3 key', () => {
    renderNode('notes/note-1/abc123.png')
    expect(screen.getByTestId('image-placeholder')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders an <img> once the src is a resolved presigned URL', () => {
    const url = 'https://bucket.s3.eu-west-2.amazonaws.com/notes/note-1/abc123.png?X-Amz-Signature=deadbeef'
    renderNode(url)
    expect(document.querySelector('img')).toHaveAttribute('src', url)
    expect(screen.queryByTestId('image-placeholder')).toBeNull()
  })

  it('renders an <img> for a transient blob: upload preview (not a bare key)', () => {
    renderNode('blob:https://note-taker-ai.com/9f8e-uuid')
    expect(document.querySelector('img')).toBeInTheDocument()
    expect(screen.queryByTestId('image-placeholder')).toBeNull()
  })
})
