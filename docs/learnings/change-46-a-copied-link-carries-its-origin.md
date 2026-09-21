# CHANGE-46 — a copied link is only as good as the origin it carries

**What nearly shipped:** pressing **Copy link** in the Windows app would have handed the user `http://localhost:5180/w/…/notes/…` — an address that opens on that one machine, only while the app is running. The button exists *because* the desktop window has no address bar, so the one surface that needed it was the one surface it did not work on. Caught in review, before merge.

## Why every gate missed it

| Gate | Why it passed |
|---|---|
| The specs | jsdom's origin is `http://localhost:3000`. The assertion `writeText(window.location.origin + path)` is *satisfied by the bug* — the test environment shares the broken environment's defining property |
| The build, lint, typechecks | it is a correct expression; nothing is malformed |
| CI | no workflow launches Electron; the desktop specs are pure functions |
| The manual-verification row, **as first written** | "paste it into a browser, the same note opens" — which **passes while the app is running**, because the app's own bundle server answers `localhost:5180`. The check was written by the same reasoning that wrote the bug |

The last row is the one worth keeping. A manual check inherits the author's blind spot exactly like a spec does, and it is *less* likely to be re-read adversarially. The row now names the expected scheme and host (`https://note-taker-ai.com/…`, **not** `http://localhost:5180`) and requires the app to be **closed** for the round-trip.

## The generalisable rule

**Any absolute URL a bundle-shell app builds from `window.location` is a local address, and local addresses leave the machine looking like real ones.** The shell serves the frontend from loopback for good reasons ([31-A](../phases/phase-31.md): relative `/api/*` needs a same-origin server, and Google OAuth only accepts `localhost` as a redirect target). Everything that stays inside the app is fine with that; anything the user *exports* — a copied link, a share sheet, a QR code, an email body — is not.

The fix keeps one definition: the shell already knows the public site (`PROD_ORIGIN` in `desktop/src/main.ts`), and hands it to the page over the existing bridge (`app:publicOrigin`, origin-guarded like every other channel). A browser, or a shell too old to answer, keeps `window.location.origin`. A sandboxed preload cannot import a local module, which is why the value travels over IPC rather than being duplicated as a constant.

Fetched once on mount, not at click time: Chromium's clipboard gate requires user activation, so no round-trip belongs between the click and the write.

## Two smaller things, both from the same review

**A confirmation that replaces a button's label steals the control's name.** Swapping `Copy link` → `Copied` for two seconds leaves a button whose accessible name says nothing about what pressing it does, and the name change is announced unreliably. Moving the word into a sibling `role="status"` span fixes that — but only if the region is **rendered from the start and left empty**; a live region inserted already-populated is commonly never announced at all. Rendering it always also stops **Delete** — a destructive control 12 px away — jumping sideways under the cursor.

**Advice on a permanent failure must not read as transient.** The first refusal message said "Please try again". A clipboard refusal is a permission or a missing API; it will fail identically forever, and on the desktop there is no address bar to fall back to. It now hands over the link text itself.

## What is still unproven

Nothing has watched Electron consult the permission policy for a clipboard write, or the public origin arrive over the bridge — no CI runs the desktop specs ([TI-53]), and nothing here launches the app. Three rows in `desktop/MANUAL-VERIFICATION.md` §CHANGE-46 exist for that, and until they are ticked the desktop half is code that passed review, which [this project already knows](a-mechanism-nobody-has-watched-work-is-not-working.md) is not evidence.
