import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TaskItem } from '@tiptap/extension-task-item';
import { MarkdownTaskList } from '../lib/markdownTaskList';
import { BlankLineParagraph } from '../lib/blankLineParagraph';
import { AgendaChip, AgendaHeading } from './prototypeExtensions';
import {
  VARIANTS,
  addTaskItem,
  byId,
  deleteNodeAt,
  matchAgainstHeadings,
  readChips,
  readHeadings,
  readTaskItems,
  replaceNodeText,
  setChipDone,
  setHeadingAgenda,
  setTaskChecked,
  toggleHeadingStrike,
  type DerivedItem,
  type VariantId,
} from './agendaVariants';
import './prototype.css';

/* ── Seed notes ──────────────────────────────────────────────────────── */

const PROSE = [
  'Rob says cloud spend is 8% over, he will pull the breakdown before Friday.',
  'Moved on to hiring — two open reqs but we are holding the second until the platform work lands.',
  'September on-call cover is thin. Revisit once the new starter is through onboarding.',
];

const SEED: Record<VariantId, string> = {
  task: `- [ ] Budget (Q3)\n- [ ] Hiring plan\n- [ ] On-call rotation\n\n${PROSE.join('\n\n')}`,
  heading: `## Budget (Q3)\n\n${PROSE[0]}\n\n## Hiring plan\n\n${PROSE[1]}\n\n## On-call rotation\n\n${PROSE[2]}`,
  loose: `## Budget (Q3)\n\n${PROSE[0]}\n\n## Hiring plan\n\n${PROSE[1]}\n\n## On-call rotation\n\n${PROSE[2]}`,
  match: `## Budget (Q3)\n\n${PROSE[0]}\n\n## Hiring plan\n\n${PROSE[1]}\n\n## On-call rotation\n\n${PROSE[2]}`,
  chip: `${PROSE[0]}\n\n${PROSE[1]}\n\n${PROSE[2]}`,
};

const SIDE_LIST = () => [
  { key: 's1', text: 'Budget (Q3)', done: false },
  { key: 's2', text: 'Hiring plan', done: false },
  { key: 's3', text: 'On-call rotation', done: false },
];

type LogEntry = { kind: 'agenda' | 'content' | 'none'; name: string; note: string };

/* ── Root ────────────────────────────────────────────────────────────── */

export default function AgendaPrototype() {
  const [variantId, setVariantId] = useState<VariantId>('task');
  return (
    <div className="wrap">
      <header className="masthead">
        <span className="eyebrow">Phase 43 · editable prototype</span>
        <h1>Ticking an agenda point from inside the note</h1>
        <p className="standfirst">
          A real Tiptap editor — the same StarterKit, Markdown and task-list extensions the app uses.
          Type in the note, tick things, press ⌘Z. The panels show the markdown that would actually be
          persisted and the events that would be appended.
        </p>
      </header>

      <div className="cols">
        <nav className="rail" aria-label="Variants">
          <span className="railLabel">Variant</span>
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              className="vBtn"
              aria-pressed={v.id === variantId}
              onClick={() => setVariantId(v.id)}
            >
              <span className="vName">
                {v.name}
                {v.chosen && <span className="chosenTag">your design</span>}
              </span>
              <span className="vGloss">{v.gloss}</span>
              <span className={`owner ${v.owner}`}>
                {v.owner === 'events' ? 'agenda events' : 'markdown'}
              </span>
            </button>
          ))}
        </nav>

        <Stage key={variantId} variantId={variantId} />
      </div>
    </div>
  );
}

/* ── Stage: one live editor per variant ──────────────────────────────── */

function Stage({ variantId }: { variantId: VariantId }) {
  const variant = byId(variantId);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [sideList, setSideList] = useState(SIDE_LIST);
  const [addText, setAddText] = useState('');
  const lastMd = useRef('');

  const pushLog = useCallback((e: LogEntry) => setLog((l) => [e, ...l].slice(0, 10)), []);

  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({ link: false, paragraph: false, heading: false }),
      BlankLineParagraph,
      AgendaHeading,
      Markdown,
      MarkdownTaskList,
      TaskItem.configure({ nested: true }),
      ...(variantId === 'chip' ? [AgendaChip] : []),
    ],
    content: '',
    onUpdate: () => bump(),
    onSelectionUpdate: () => bump(),
  });

  // Seed from markdown once the editor exists.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(SEED[variantId]);
    lastMd.current = editor.storage.markdown.getMarkdown();
    bump();
  }, [editor, variantId, bump]);

  // Any document change is a ContentEdited on the real note. Log it once per settle.
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => {
      const md = editor.storage.markdown.getMarkdown();
      if (md !== lastMd.current && lastMd.current !== '') {
        lastMd.current = md;
        pushLog({
          kind: 'content',
          name: 'ContentEdited',
          note: 'the whole note body is re-serialised and saved.',
        });
      }
      lastMd.current = md;
    }, 700);
    return () => clearTimeout(t);
  });

  if (!editor) return <div className="stage" />;

  /* Derive the agenda for this variant from the live document. */
  let items: DerivedItem[] = [];
  if (variantId === 'task') items = readTaskItems(editor);
  else if (variantId === 'chip') items = readChips(editor);
  else if (variantId === 'heading')
    items = readHeadings(editor)
      .filter((h) => h.agenda)
      .map((h) => ({ key: `h${h.pos}`, text: h.text, done: h.struck, pos: h.pos }));
  else if (variantId === 'match') items = matchAgainstHeadings(editor, sideList);
  else items = sideList.map((s) => ({ ...s, pos: null }));

  const done = items.filter((i) => i.done).length;
  const bodyOwned = variantId === 'task' || variantId === 'chip' || variantId === 'heading';

  /* ── Header-strip write-backs ── */
  function tick(item: DerivedItem, next: boolean) {
    if (variantId === 'task' && item.pos !== null) {
      setTaskChecked(editor!, item.pos, next);
      pushLog({
        kind: 'content',
        name: 'ContentEdited',
        note: `the body line becomes <code>- [${next ? 'x' : ' '}] ${esc(item.text)}</code>. One writer — the markdown.`,
      });
    } else if (variantId === 'chip' && item.pos !== null) {
      setChipDone(editor!, item.pos, next);
      pushLog({ kind: 'agenda', name: 'AgendaItemDiscussedSet', note: `chip "${esc(item.text)}" → ${next}.` });
    } else if (variantId === 'heading' && item.pos !== null) {
      toggleHeadingStrike(editor!, item.pos);
      pushLog({ kind: 'agenda', name: 'AgendaItemDiscussedSet', note: `heading "${esc(item.text)}" → ${next}.` });
    } else if (variantId === 'match') {
      setSideList((l) => l.map((s) => (s.key === item.key ? { ...s, done: next } : s)));
      pushLog(
        item.orphan
          ? { kind: 'none', name: 'no matching heading', note: 'the item ticks, but nothing in the body reflects it.' }
          : { kind: 'agenda', name: 'AgendaItemDiscussedSet', note: `matched by wording to a heading.` },
      );
    } else {
      setSideList((l) => l.map((s) => (s.key === item.key ? { ...s, done: next } : s)));
      pushLog({
        kind: 'agenda',
        name: 'AgendaItemDiscussedSet',
        note: 'the header list only — the body is a separate, unlinked record.',
      });
    }
    bump();
  }

  function remove(item: DerivedItem) {
    if (bodyOwned && item.pos !== null) {
      deleteNodeAt(editor!, item.pos);
      pushLog({
        kind: 'content',
        name: 'ContentEdited',
        note: 'the line is deleted out of the note body. ⌘Z brings it straight back.',
      });
    } else {
      setSideList((l) => l.filter((s) => s.key !== item.key));
      pushLog({ kind: 'agenda', name: 'AgendaItemRemoved', note: 'the body is untouched.' });
    }
    bump();
  }

  function rename(item: DerivedItem, text: string) {
    if (!text.trim() || text === item.text) return;
    if (variantId === 'task' && item.pos !== null) {
      replaceNodeText(editor!, item.pos, text);
      pushLog({ kind: 'content', name: 'ContentEdited', note: `the body line is reworded.` });
    } else {
      setSideList((l) => l.map((s) => (s.key === item.key ? { ...s, text } : s)));
      pushLog({ kind: 'agenda', name: 'AgendaItemTextEdited', note: `item reworded to "${esc(text)}".` });
    }
    bump();
  }

  function add() {
    const t = addText.trim();
    if (!t) return;
    setAddText('');
    if (variantId === 'task') {
      addTaskItem(editor!, t);
      pushLog({
        kind: 'content',
        name: 'ContentEdited',
        note: 'the line joins the first task list in the note — a new list at the top if there is none.',
      });
    } else {
      setSideList((l) => [...l, { key: `s${Date.now()}`, text: t, done: false }]);
      pushLog({ kind: 'agenda', name: 'AgendaItemAdded', note: 'header only — nothing appears in the body.' });
    }
    bump();
  }

  const headings = readHeadings(editor);
  const md = editor.storage.markdown.getMarkdown();

  return (
    <div className="stage">
      <section className="card">
        <div className="cardHead">
          <span className="cardTitle">{variant.name}</span>
          <span className="cardHint">{variant.hint}</span>
        </div>

        <div className="app">
          <div className="appPanel">
            <h2 className="noteTitle">Ops weekly — 6 Aug</h2>
            <p className="noteMeta">Meeting note · Google Calendar</p>

            <div className="agenda" role="group" aria-label="Agenda">
              <div className="agHead">
                <span className="agLabel">Agenda</span>
                <span className="agCoverage" aria-label={`${done} of ${items.length} agenda items covered`}>
                  {done} / {items.length}
                </span>
                {bodyOwned && <span className="derivedTag">derived from the body</span>}
              </div>
              <ul className="agItems">
                {items.map((i) => (
                  <HeaderPill
                    key={i.key}
                    item={i}
                    onTick={(n) => tick(i, n)}
                    onRename={(t) => rename(i, t)}
                    onRemove={() => remove(i)}
                  />
                ))}
                <li className="addRow">
                  <input
                    className="addInput"
                    value={addText}
                    placeholder="+ add item…"
                    aria-label="Add agenda item"
                    onChange={(e) => setAddText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        add();
                      }
                    }}
                    onBlur={add}
                  />
                </li>
              </ul>
            </div>

            <div className="divider" />
            <div className="bodyHead">
              <span className="bodyLabel">Notes</span>
              <span className="bodyHint">editable — type, tick, ⌘Z</span>
            </div>

            {variantId === 'loose' && <LooseToolbar editor={editor} onStrike={pushLog} />}
            {variantId === 'heading' && (
              <HeadingMarkers editor={editor} headings={headings} onMark={pushLog} bump={bump} />
            )}

            <EditorContent editor={editor} className="proseHost" />
          </div>
        </div>
      </section>

      <div className="panels">
        <section className="card">
          <div className="cardHead">
            <span className="cardTitle">Persisted note body</span>
            <span className="cardHint">live markdown</span>
          </div>
          <div className="panelBody">
            <pre className="mono">{md}</pre>
          </div>
        </section>

        <section className="card">
          <div className="cardHead">
            <span className="cardTitle">Events appended</span>
            <span className="cardHint">newest first</span>
          </div>
          <div className="panelBody">
            {log.length === 0 && <p className="empty">Nothing yet — type something, or tick an item.</p>}
            <ul className="log">
              {log.map((e, i) => (
                <li key={i}>
                  <span className={`evt ${e.kind}`}>{e.name}</span>
                  <span className="evtNote" dangerouslySetInnerHTML={{ __html: e.note }} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="cardHead">
          <span className="cardTitle">Where this variant lands</span>
        </div>
        <div className="verdict">
          {variant.verdict.map(([k, t], i) => (
            <div className="vRow" key={i}>
              <span className={`vKey ${k}`}>{k === 'good' ? 'strength' : k}</span>
              <span className="vTxt" dangerouslySetInnerHTML={{ __html: t }} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── Bits ────────────────────────────────────────────────────────────── */

function HeaderPill({
  item,
  onTick,
  onRename,
  onRemove,
}: {
  item: DerivedItem;
  onTick: (next: boolean) => void;
  onRename: (text: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);

  return (
    <li className={`agItem ${item.done ? 'done' : ''} ${item.orphan ? 'orphan' : ''}`}>
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => onTick(e.target.checked)}
        aria-label={`Mark "${item.text}" discussed`}
      />
      {editing ? (
        <input
          className="editInput"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setEditing(false);
              onRename(draft);
            } else if (e.key === 'Escape') {
              setEditing(false);
              setDraft(item.text);
            }
          }}
          onBlur={() => {
            setEditing(false);
            onRename(draft);
          }}
        />
      ) : (
        <button
          type="button"
          className="t"
          onClick={() => {
            setDraft(item.text);
            setEditing(true);
          }}
        >
          {item.text || <em>empty</em>}
        </button>
      )}
      {item.orphan && <span className="orphanTag">link lost</span>}
      <button type="button" className="rm" onClick={onRemove} aria-label={`Remove "${item.text}"`}>
        ×
      </button>
    </li>
  );
}

/** The 43-E control, restored: strikes the heading the caret is inside. */
function LooseToolbar({ editor, onStrike }: { editor: Editor; onStrike: (e: LogEntry) => void }) {
  const active = editor.isActive('heading');
  return (
    <div className="looseBar">
      <button
        type="button"
        className="tickBtn"
        disabled={!active}
        onClick={() => {
          const { $from } = editor.state.selection;
          const pos = $from.before($from.depth);
          toggleHeadingStrike(editor, pos);
          onStrike({
            kind: 'content',
            name: 'ContentEdited',
            note: 'the heading text is wrapped in <code>~~ ~~</code>. The header list is untouched.',
          });
        }}
      >
        ✓ Mark as discussed
      </button>
      <span className="looseHint">
        {active ? 'caret is in a heading — the ✓ will fire' : 'put the caret inside a heading to enable this'}
      </span>
    </div>
  );
}

function HeadingMarkers({
  editor,
  headings,
  onMark,
  bump,
}: {
  editor: Editor;
  headings: ReturnType<typeof readHeadings>;
  onMark: (e: LogEntry) => void;
  bump: () => void;
}) {
  if (headings.length === 0) return <p className="noHeads">No headings in this note — nothing can be marked.</p>;
  return (
    <div className="markBar">
      <span className="markLabel">Mark as a topic:</span>
      {headings.map((h) => (
        <button
          key={h.pos}
          type="button"
          className={`markBtn ${h.agenda ? 'on' : ''}`}
          onClick={() => {
            setHeadingAgenda(editor, h.pos, !h.agenda);
            onMark({
              kind: 'agenda',
              name: h.agenda ? 'AgendaItemRemoved' : 'AgendaItemAdded',
              note: `heading "${esc(h.text)}" ${h.agenda ? 'unlinked' : 'linked'}; the markdown gains a trailing token.`,
            });
            bump();
          }}
        >
          {h.agenda ? '●' : '○'} {h.text || 'untitled'}
        </button>
      ))}
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
