import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 52-A. A CSS Module class that the component references but the stylesheet never defines is
// invisible to every other gate: the test environment stubs `styles.x` to a string whether or not
// the rule exists, lint and both typechecks never read the file, and the production build compiles
// a malformed stylesheet without complaint. A stray second `*/` in a comment swallowed `.match`
// exactly this way, shipping a search that highlighted nothing while all 41 specs stayed green.
//
// Selectors are read the same way NoteEditorBlockquote.test.tsx reads its module: strip comments,
// then take the text before each `{` as the selector list.
// The defect that motivated this file was a stray second `*/`, which leaves prose outside any
// comment and lets the CSS parser swallow the following selector into one invalid rule. Checking
// class names alone does NOT catch it — the swallowed selector still contains the text `.match`,
// so a name-based check reports the class as present. Removing every well-formed comment and
// asserting no marker survives is what actually detects it.
function assertCommentsBalanced(cssPath: string) {
  const raw = readFileSync(resolve(process.cwd(), cssPath), 'utf8')
  const outsideComments = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  expect({ file: cssPath, strayOpen: outsideComments.includes('/*') }).toEqual({
    file: cssPath,
    strayOpen: false,
  })
  expect({ file: cssPath, strayClose: outsideComments.includes('*/') }).toEqual({
    file: cssPath,
    strayClose: false,
  })
}

function definedClasses(cssPath: string): Set<string> {
  const css = readFileSync(resolve(process.cwd(), cssPath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const classes = new Set<string>()
  for (const block of css.split('}')) {
    const selector = block.split('{')[0]
    if (!block.includes('{')) continue
    for (const m of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) classes.add(m[1])
  }
  return classes
}

function referencedClasses(tsxPath: string): Set<string> {
  const src = readFileSync(resolve(process.cwd(), tsxPath), 'utf8')
  const names = new Set<string>()
  for (const m of src.matchAll(/\bstyles\.([A-Za-z][\w-]*)/g)) names.add(m[1])
  return names
}

const pairs: [string, string][] = [
  ['src/components/TranscriptTab.tsx', 'src/components/TranscriptTab.module.css'],
  ['src/components/TranscriptFindBar.tsx', 'src/components/TranscriptFindBar.module.css'],
]

// Globbed over every stylesheet, not just this slice's: the defect class is repo-wide, and the
// next stray marker in any module would ship the same way. All of them are clean today.
const allStylesheets = Object.keys(
  import.meta.glob('../{components,styles}/**/*.css', { eager: false }),
).map((p) => p.replace(/^\.\.\//, 'src/'))

it('every stylesheet is listed for the comment-balance check', () => {
  expect(allStylesheets.length).toBeGreaterThan(30)
})

it.each(allStylesheets)('%s has no comment left open or closed twice', (css) => {
  assertCommentsBalanced(css)
})

it.each(pairs)('every class %s uses exists as a selector in its stylesheet', (tsx, css) => {
  const defined = definedClasses(css)
  const missing = [...referencedClasses(tsx)].filter((name) => !defined.has(name))
  expect(missing).toEqual([])
})

it.each(pairs)('%s defines no class it never uses', (tsx, css) => {
  const referenced = referencedClasses(tsx)
  const dead = [...definedClasses(css)].filter((name) => !referenced.has(name))
  expect(dead).toEqual([])
})
