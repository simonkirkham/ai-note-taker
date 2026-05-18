# Backlog

Deferred ideas captured during planning. These are not committed to any phase — they exist so good ideas aren't forgotten. Review this list when planning a new phase or looking for the next thin slice.

Each entry records what it is, why it was deferred, and what phase or slice it was raised in.

---

## Action items

### Delete action item from the home screen
**What:** A delete button on each todo item on the home screen, so users can remove an item without navigating to the note.
**Why deferred:** Not essential for 3-E (delete from note screen covers the core need). Adding delete to two surfaces at once increases slice width.
**Raised in:** Phase 3 planning
**Depends on:** Slice 3-E (delete action item) must land first.

---

---

## Infrastructure / CI

### Upgrade GitHub Actions to Node.js 24
**What:** Update `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`, `aws-actions/configure-aws-credentials` to versions that run on Node.js 24. Alternatively, set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in workflows as a quick opt-in to verify nothing breaks, then pin updated action versions.
**Why deferred:** Node.js 20 actions are deprecated; GitHub will force Node.js 24 by default from 2026-06-02 and remove Node 20 from runners on 2026-09-16. Not urgent today but will break CI if ignored.
**Raised in:** Phase 6 / adhoc CI observation
**Depends on:** Nothing blocking. Check updated major versions exist for each action before upgrading.

---

---

## Notes

_Add entries here whenever an idea is surfaced during Scout planning but explicitly deferred. Format: name, what, why deferred, raised in, any dependencies._
