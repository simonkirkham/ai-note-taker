/* Throwaway prototype — prototype/22-search-bar branch only. Never merged.
   Validates the Phase 22 search-bar UX: three result layouts (cards / dense list /
   dropdown), debounced as-you-type, loading + no-match + error states, filter
   precedence. Mock data + fake fuzzy match; no backend, no real API. */
import { useEffect, useMemo, useRef, useState } from 'react'
import './prototype.css'

type Note = {
  id: string
  title: string
  date: string
  body: string
  tags: string[]
  todos: number
  folder: string
}

const NOTES: Note[] = [
  { id: '1', title: 'Q3 Budget review', date: 'Mon, 2 Jun', folder: 'Finance', todos: 2, tags: ['finance', 'planning'], body: 'The budget was approved by finance; marketing spend capped at 40k and we revisit in August.' },
  { id: '2', title: 'Vendor call — Acme', date: 'Mon, 2 Jun', folder: 'Procurement', todos: 1, tags: ['vendor', 'budget'], body: 'Email the vendor re budget limits and the renewal terms before the quarterly deadline.' },
  { id: '3', title: 'Roadmap sync', date: 'Fri, 30 May', folder: 'Product', todos: 4, tags: ['roadmap', 'planning'], body: 'Decided to prioritise the migration ahead of search. Summary: ship the walking skeleton first.' },
  { id: '4', title: 'Migration kickoff', date: 'Thu, 29 May', folder: 'Engineering', todos: 3, tags: ['migration', 'infra'], body: 'Plan the database migration in stages. Decisions: forward-only, no downtime, rollback via snapshot.' },
  { id: '5', title: '1:1 with Sam', date: 'Wed, 28 May', folder: 'People', todos: 0, tags: ['team'], body: 'Career growth chat. Action: draft a development plan and share the roadmap for the next quarter.' },
  { id: '6', title: 'Design critique', date: 'Tue, 27 May', folder: 'Product', todos: 2, tags: ['design', 'ux'], body: 'Reviewed the new card layout and the empty states. Tighten spacing; the budget figure should stand out.' },
  { id: '7', title: 'Incident retro', date: 'Mon, 26 May', folder: 'Engineering', todos: 5, tags: ['infra', 'reliability'], body: 'Root cause was a throttled write during a cold table. Decision: bound the rebuild concurrency.' },
  { id: '8', title: 'Marketing standup', date: 'Mon, 26 May', folder: 'Marketing', todos: 1, tags: ['marketing'], body: 'Campaign timeline. The budget for paid social is confirmed; vendor invoice pending.' },
  { id: '9', title: 'Hiring loop debrief', date: 'Fri, 23 May', folder: 'People', todos: 2, tags: ['hiring', 'team'], body: 'Strong on planning and ownership. Next: schedule the final panel and send the offer.' },
  { id: '10', title: 'Quarterly planning', date: 'Thu, 22 May', folder: 'Product', todos: 6, tags: ['planning', 'roadmap'], body: 'Set the themes for next quarter: search, pagination, and the desktop app spike.' },
]

const ALL_TAGS = ['planning', 'budget', 'roadmap', 'infra', 'vendor']

// Cheap fake fuzzy: substring hit, or token within edit-distance 2 (so 'budgte' ~ 'budget').
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}

function fieldScore(field: string, q: string): number {
  const f = field.toLowerCase()
  if (f.includes(q)) return 1
  let best = 0
  for (const tok of f.split(/[^a-z0-9]+/)) {
    if (!tok) continue
    const dist = levenshtein(tok, q)
    const tol = q.length >= 6 ? 2 : 1
    if (dist <= tol) best = Math.max(best, 0.8 - dist * 0.1)
  }
  return best
}

type Scored = { note: Note; score: number; where: string }

function search(notes: Note[], rawQ: string): Scored[] {
  const q = rawQ.trim().toLowerCase()
  if (!q) return []
  const out: Scored[] = []
  for (const note of notes) {
    const scores = {
      title: fieldScore(note.title, q) * 2, // title weighted highest
      tags: Math.max(0, ...note.tags.map((t) => fieldScore(t, q))),
      body: fieldScore(note.body, q),
    }
    const best = Math.max(scores.title, scores.tags, scores.body)
    if (best >= 0.5) {
      const where = scores.title >= scores.tags && scores.title >= scores.body ? 'title'
        : scores.tags >= scores.body ? 'tag' : 'notes'
      out.push({ note, score: best, where })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

function snippet(note: Note, q: string): string {
  const body = note.body
  const i = body.toLowerCase().indexOf(q.trim().toLowerCase())
  if (i < 0) return body.slice(0, 90) + (body.length > 90 ? '…' : '')
  const start = Math.max(0, i - 30)
  return (start > 0 ? '…' : '') + body.slice(start, i + q.length + 50) + '…'
}

function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim()
  if (!needle) return <>{text}</>
  const idx = text.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  )
}

type Layout = 'cards' | 'list' | 'dropdown'
type Phase = 'idle' | 'loading' | 'results' | 'empty' | 'error'

export function PrototypeRoot() {
  const [layout, setLayout] = useState<Layout>('cards')
  const [forceError, setForceError] = useState(false)
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [results, setResults] = useState<Scored[]>([])
  const [activeTag, setActiveTag] = useState<string | null>('planning')
  const reqId = useRef(0)

  const searching = query.trim().length > 0

  // Debounced fake search with simulated latency + out-of-order guard.
  useEffect(() => {
    if (!searching) {
      setPhase('idle')
      setResults([])
      return
    }
    setPhase('loading')
    const myReq = ++reqId.current
    const latency = 250 + Math.random() * 350
    const t = setTimeout(() => {
      if (myReq !== reqId.current) return // stale response — discard
      if (forceError || query.trim().toLowerCase() === 'fail') {
        setPhase('error')
        return
      }
      const r = search(NOTES, query)
      setResults(r)
      setPhase(r.length ? 'results' : 'empty')
    }, latency)
    return () => clearTimeout(t)
  }, [query, forceError, searching])

  const baseNotes = useMemo(
    () => (activeTag ? NOTES.filter((n) => n.tags.includes(activeTag)) : NOTES),
    [activeTag],
  )

  function retry() {
    setForceError(false)
    setQuery((q) => q + ' ')
    setTimeout(() => setQuery((q) => q.trimEnd()), 0)
  }

  return (
    <div className="shell">
      {/* prototype-only control strip */}
      <div className="protoBar">
        <strong>PROTOTYPE</strong>
        <span>results layout:</span>
        <div className="seg">
          {(['cards', 'list', 'dropdown'] as Layout[]).map((l) => (
            <button key={l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}>
              {l === 'cards' ? 'Cards' : l === 'list' ? 'Dense list' : 'Dropdown'}
            </button>
          ))}
        </div>
        <label className="protoToggle">
          <input type="checkbox" checked={forceError} onChange={(e) => setForceError(e.target.checked)} />
          simulate error
        </label>
        <span style={{ color: 'var(--color-text-muted)' }}>· type “fail” to error · try “budgte” (typo)</span>
      </div>

      <div className="homeHead">
        <h1>My Notes</h1>
        <span className="count">
          {searching ? (phase === 'results' ? `${results.length} match${results.length === 1 ? '' : 'es'}` : '') : `${baseNotes.length} notes`}
        </span>
      </div>

      {/* Search field — wrapped for dropdown anchoring */}
      <div className={layout === 'dropdown' ? 'ddWrap' : ''}>
        <div className="searchWrap">
          <div className="searchField">
            <span className="icon">🔍</span>
            <input
              autoFocus
              placeholder="Search notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search notes"
            />
            {searching && (
              <button className="clear" aria-label="Clear search" onClick={() => setQuery('')}>
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Dropdown layout renders results floating here */}
        {layout === 'dropdown' && searching && (
          <div className="dropdown">
            {phase === 'loading' && <div className="ddEmpty"><span className="spin" />Searching…</div>}
            {phase === 'empty' && <div className="ddEmpty">No notes match “{query.trim()}”.</div>}
            {phase === 'error' && (
              <div className="ddEmpty" style={{ color: 'var(--color-error)' }}>
                Search failed. <button className="chip" onClick={retry}>Retry</button>
              </div>
            )}
            {phase === 'results' &&
              results.map((r) => (
                <div className="row" key={r.note.id}>
                  <div className="rtitle">
                    <span><Highlight text={r.note.title} q={query} /></span>
                    <span className="where">{r.note.folder} · matched {r.where}</span>
                  </div>
                  <div className="rsnip"><Highlight text={snippet(r.note, query)} q={query} /></div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Filters — suspended while searching to show precedence */}
      <div className={`filters${searching ? ' suspended' : ''}`}>
        <span className="lbl">Tags:</span>
        {ALL_TAGS.map((t) => (
          <button
            key={t}
            className={`chip${activeTag === t ? ' active' : ''}`}
            onClick={() => setActiveTag((cur) => (cur === t ? null : t))}
          >
            {t}
          </button>
        ))}
      </div>
      {searching && <div className="suspendNote" style={{ marginTop: '-16px', marginBottom: 'var(--space-4)' }}>Filters paused while searching — clear search to return to them.</div>}

      {/* Body: cards/list layouts replace the grid; dropdown keeps the (dimmed) grid behind */}
      {layout === 'dropdown' ? (
        <div className={searching ? 'dimBehind' : ''}>
          <Grid notes={baseNotes} q="" />
        </div>
      ) : !searching ? (
        <Grid notes={baseNotes} q="" />
      ) : phase === 'loading' ? (
        <div className="state"><div className="big"><span className="spin" />Searching…</div></div>
      ) : phase === 'error' ? (
        <div className="state error">
          <div className="big">Search failed</div>
          <div>Something went wrong running your search.</div>
          <button onClick={retry}>Retry</button>
        </div>
      ) : phase === 'empty' ? (
        <div className="state">
          <div className="big">No notes match “{query.trim()}”</div>
          <div>Try a different word, or check the spelling.</div>
        </div>
      ) : layout === 'cards' ? (
        <ResultCards results={results} q={query} />
      ) : (
        <ResultList results={results} q={query} />
      )}
    </div>
  )
}

function Grid({ notes, q }: { notes: Note[]; q: string }) {
  return (
    <div className="grid">
      {notes.map((n) => (
        <div className="card" key={n.id}>
          <h3><Highlight text={n.title} q={q} /></h3>
          <span className="date">{n.date}</span>
          <span className="snip">{n.body.slice(0, 70)}…</span>
          <div className="meta">
            {n.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
          </div>
          {n.todos > 0 && <span className="todo">☑ {n.todos} to-do{n.todos === 1 ? '' : 's'}</span>}
        </div>
      ))}
    </div>
  )
}

function ResultCards({ results, q }: { results: Scored[]; q: string }) {
  return (
    <div className="grid">
      {results.map((r) => (
        <div className="card" key={r.note.id}>
          <h3><Highlight text={r.note.title} q={q} /></h3>
          <span className="date">{r.note.date} · {r.note.folder}</span>
          <span className="snip"><Highlight text={snippet(r.note, q)} q={q} /></span>
          <div className="meta">
            {r.note.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
          </div>
        </div>
      ))}
    </div>
  )
}

function ResultList({ results, q }: { results: Scored[]; q: string }) {
  return (
    <div className="list">
      {results.map((r) => (
        <div className="row" key={r.note.id}>
          <div className="rtitle">
            <span><Highlight text={r.note.title} q={q} /></span>
            <span className="where">{r.note.date} · {r.note.folder} · matched {r.where}</span>
          </div>
          <div className="rsnip"><Highlight text={snippet(r.note, q)} q={q} /></div>
        </div>
      ))}
    </div>
  )
}
