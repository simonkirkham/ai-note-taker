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

### CloudFront proxy for API (remove VITE_API_URL build-time coupling)
**What:** Add a CloudFront behaviour that routes `/api/*` → API Gateway, with a CloudFront Function stripping the `/api` prefix. The frontend calls `/api/notes` as a relative path — no environment variable needed at build time. The frontend build moves into the `validate` CI job and runs once, decoupled from deployment order.
**Why deferred:** Correct solution but requires CDK behaviour + CloudFront Function + route changes in api.ts + acceptance test URL update. Non-trivial slice; pipeline was the immediate priority.
**Raised in:** Phase 5/6 CI hardening work
**Depends on:** Nothing blocking.

---

## Notes

_Add entries here whenever an idea is surfaced during Scout planning but explicitly deferred. Format: name, what, why deferred, raised in, any dependencies._
