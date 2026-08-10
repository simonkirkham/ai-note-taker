// Thin wrapper over the CloudWatch RUM web client. The client is injected by
// the index.html `rum-snippet` in deployed environments and exposes a global
// `cwr` function; locally (and in tests) it is absent, so calls are no-ops.
type CwrFn = (operation: string, ...args: unknown[]) => void;

function cwr(): CwrFn | undefined {
  return (window as unknown as { cwr?: CwrFn }).cwr;
}

export function recordRumEvent(type: string, data: Record<string, unknown>): void {
  // BUG-74: `cwr` is a global installed by a third-party snippet, so this call can throw. Telemetry
  // must never break its caller — and the callers that matter most are catch blocks in teardown and
  // corrupt-storage paths, where a throw from the diagnostic re-creates the very fault being
  // reported. This bug is exactly that: guarding the on-device teardown, then emitting the failure
  // from inside the guard, put a fresh unguarded throw on the pre-commit path. Guarded once here
  // rather than at each of the ~14 call sites.
  try {
    cwr()?.("recordEvent", type, data);
  } catch {
    /* a failed diagnostic is not worth a failed operation */
  }
}

// The resource URL lives on `src` (img/script/media) or `href` (link).
function resourceUrl(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target as Element & { src?: string; href?: string };
  // `link.href`/`img.src` resolve to absolute URLs; treat empty/missing as "not a resource".
  return el.src || el.href || null;
}

// Forward a DOM resource-load failure (a failed <img>/<script>/<link>/media fetch)
// to RUM. We use `recordError` rather than a custom `recordEvent` so the failure
// counts toward RUM's JsErrorCount metric — already plotted on the notetaker-ops
// dashboard and surfaced in the unified all-errors table via the
// com.amazon.rum.js_error_event log shape — so no new metric/widget is needed.
// A real uncaught JS error has `event.target === window` (no src/href), so it is
// ignored here to avoid double-counting what the `errors` telemetry already records.
export function reportResourceError(event: Event): void {
  const url = resourceUrl(event.target);
  if (!url) return;
  const tagName = (event.target as Element).tagName;
  const route = window.location.pathname;
  // BUG-74: same rule as recordEvent — a failed diagnostic must not break its caller. This one runs
  // from a capture-phase window listener, so a throw would surface as an unrelated uncaught error
  // on a page that merely failed to load an image.
  try {
    cwr()?.(
      "recordError",
      new Error(`Resource load failed: ${tagName} ${url} (route: ${route})`),
    );
  } catch {
    /* nothing to report the reporting failure to */
  }
}

// Register once at app startup. The capture phase (3rd arg `true`) is REQUIRED:
// resource-load `error` events do not bubble, so a non-capture listener never sees
// them. No-op when `window.cwr` is absent (handled in reportResourceError).
export function installResourceErrorHandler(): void {
  window.addEventListener("error", reportResourceError, true);
}
