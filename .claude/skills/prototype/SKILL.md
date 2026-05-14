---
name: prototype
description: Build a throwaway frontend-only prototype to validate UX before real implementation. No backend changes, no specs. Run when the interaction or layout is novel or uncertain.
---

# Prototype

Run this skill when the UX is unclear enough that writing BDD specs first would be premature — you'd be speccing the wrong thing. The output is a working frontend prototype the user can interact with, not production code.

## When to prototype

Prototype if **any** of these are true:
- The interaction is novel (drag-and-drop, multi-panel layout, complex navigation flow)
- Multiple layout options exist and you can't pick one without seeing it
- The user hasn't described the UX precisely — they'll know it when they see it
- The feature touches multiple screens in ways that are hard to reason about statically

Skip if the UX is obvious CRUD (a new field, a new button that calls one endpoint).

## Rules

1. **Frontend only.** No backend code, no event model changes, no CDK.
2. **Own branch, pushed to remote.** Prototype code lives on a `prototype/<slice-name>` branch (e.g. `prototype/5-folders-tags`) created from main, committed there, and pushed to origin. This is the backup — if the local repo is lost, the prototype is still on the remote.
3. **Never merged.** The prototype branch is reference material. It is never merged into main or into a `slice/` branch. Isolation is enforced by convention, not gitignore.
4. **Quick and dirty.** Prototype code does not need to meet CI standards — no types, no tests, no clean component boundaries. Speed of feedback over code quality.
5. **Real implementation rebuilds from scratch.** After prototype approval, the real implementation is written fresh in `web/src/` on the slice branch using the archived `REFERENCE.md` and the updated phase doc as briefs. It does not copy, cherry-pick, or refactor prototype code.
6. **API stubs fire-and-forget.** Call the real API endpoint shape, but always `.catch(() => {})`. The prototype must not crash when the backend is absent or returns 4xx/5xx.
7. **`localStorage` for persistence.** Any state that must survive a page refresh goes in `localStorage`. Use lazy-init state + a `useEffect` sync:
   ```typescript
   const [x, setX] = useState(() => {
     try { return JSON.parse(localStorage.getItem("key") ?? "null") ?? default; } catch { return default; }
   });
   useEffect(() => { localStorage.setItem("key", JSON.stringify(x)); }, [x]);
   ```
8. **No BDD specs.** Prototype code is throwaway scaffolding, not a feature.
9. **Vite file-watching on WSL2** requires polling. If edits don't hot-reload, add to `web/vite.config.ts`:
   ```typescript
   server: { watch: { usePolling: true, interval: 300 } }
   ```

## Branch layout

```
main
├── prototype/<slice-name>   ← prototype lives here, pushed to remote, never merged
└── slice/<slice-name>       ← real implementation, rebuilt from phase doc GWTs + REFERENCE.md
```

## How Vite serves the prototype

Vite only compiles files reachable from the entry point (`main.tsx`). Files in `web/src/prototype/` are invisible unless explicitly imported. Wire them in by temporarily adding a dev route in `App.tsx` on the prototype branch:

```tsx
// Temporary — prototype branch only, never reaches main
import { PrototypeRoot } from "./prototype/PrototypeRoot";
// inside the router:
<Route path="/prototype" element={<PrototypeRoot />} />
```

This is fine because the prototype branch is throwaway. The route is never committed to main or a slice branch.

## Process

1. **Create the prototype branch.** From main: `git checkout -b prototype/<slice-name>`.
2. **Ask one question first.** "What's the one interaction you're most unsure about?" Start there, not with a full feature build.
3. **Build the minimum that answers the question.** Write files to `web/src/prototype/`, wire in the dev route. A static layout with no state beats a half-wired component tree.
4. **Commit and push after each meaningful iteration.** `git push -u origin prototype/<slice-name>`. Remote is the backup.
5. **Iterate on user feedback.** Each round should answer one UX question. Don't gold-plate.
6. **Exit when the user says "that's it."** Write the REFERENCE.md, update the phase doc, make a final push.

## Exit procedure

When the user approves the prototype:

1. **Write `web/src/prototype/REFERENCE.md`** on the prototype branch capturing:
   - Confirmed UX patterns (e.g. "drag from panel onto folder tree", "panel auto-updates on folder click")
   - Any API shapes implied by the prototype
   - Key component structure decisions the implementation should match
   - `localStorage` keys used

2. **Update `docs/phases/phase-X.md` on main.** Switch to main and rewrite the phase doc with confirmed Given/When/Then scenarios derived from what the prototype demonstrated. This is the one deliverable that belongs on main — it is not throwaway code. Replace any placeholder or draft scenarios. For each slice, document confirmed UX patterns, "what changes vs prototype" guidance, and user-facing GWT scenarios. Commit this directly on main.

3. **Final push.** Push both the prototype branch and main.

4. **Hand off.** The slice branch (`slice/<slice-name>`) is created fresh from main (which now has the updated phase doc). Implementation starts at CI quality using the GWTs in the phase doc as the spec.

## Exit checklist

Before moving to real implementation, confirm:
- [ ] User has approved the interaction / layout
- [ ] `web/src/prototype/REFERENCE.md` committed on the prototype branch with confirmed UX patterns, API shapes, and component decisions
- [ ] `docs/phases/phase-X.md` updated on the prototype branch with confirmed GWT scenarios
- [ ] Phase doc cherry-picked to main so the GWTs are the starting point for the slice
- [ ] Prototype branch pushed to origin — survives local repo loss
- [ ] Implementation brief ready: real implementation rebuilds from scratch on a `slice/` branch using the GWTs in the phase doc as the spec
