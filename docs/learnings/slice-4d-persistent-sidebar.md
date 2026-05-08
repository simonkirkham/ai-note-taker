# Slice 4-D — Persistent note list sidebar

## What we built

New `Sidebar` component visible on all screens. `App.tsx` restructured into a two-column `.app-layout` (sidebar + `.app-main`). `ListView.tsx` simplified: flat note list removed (sidebar replaces it), leaving heading, New Note button, error/loading states, and `TodoSection`. Mobile: sidebar hidden by default behind `transform: translateX(-100%)`; a hamburger toggle button + overlay backdrop reveal it.

## Key decisions

**`data-testid="note-list"` on the sidebar `<ul>`.** All existing `AppPage` methods (`ClickNoteInListAsync`, `AssertNoteVisibleInListAsync`, `AssertNoteAbsentFromListAsync`) use `GetByTestId("note-list").GetByText(...)`. Placing this testid on the sidebar's list preserved backward compatibility without any page object changes beyond the new sidebar-specific assertions.

**Prop-driven open/closed state (not CSS sibling combinator).** The sidebar's open/closed state is controlled by an `open` prop that adds the `sidebar--open` class. An early alternative used the CSS sibling combinator (`.sidebar-overlay--open ~ .sidebar`), but this couples DOM order and is fragile if the layout changes. Prop-driven is explicit and predictable.

**Overlay backdrop closes the sidebar.** Tapping the dimmed overlay fires `setSidebarOpen(false)`, matching the standard mobile drawer UX pattern. No close button needed inside the sidebar.

**`ListView.tsx` note list removal.** The flat `<ul data-testid="note-list">` in `ListView` was replaced by the sidebar. Existing tests were unaffected because the sidebar carries the same `data-testid`.

## What went wrong

Nothing significant. Pure frontend slice. CI green on first attempt (PR #21).

## Permission approvals

None required.
