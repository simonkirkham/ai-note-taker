import { useEffect, useState } from "react";

// CHANGE-46 — the origin a copied link should carry.
//
// In a browser that is simply the address the user is already on. In the desktop window it is
// `http://localhost:5180` (the shell serves the bundle from a loopback origin), which resolves
// on that one machine, only while the app is running — so a note link copied there would be
// useless to whoever it was sent to. The shell is asked for the public site instead; it owns the
// value (`PROD_ORIGIN` in desktop/src/main.ts) and a sandboxed preload cannot import it, so it
// arrives over the same IPC bridge as everything else.
//
// Fetched once on mount rather than at click time: the copy must not wait on a round-trip, and
// a shell too old to answer (or one that refuses, off the bundle origin) simply leaves the
// local origin in place.
export function usePublicOrigin(): string {
  const [origin, setOrigin] = useState(window.location.origin);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.isDesktop || !bridge.app) return;
    let cancelled = false;
    void bridge.app
      .getPublicOrigin()
      .then((publicOrigin) => {
        if (!cancelled && publicOrigin) setOrigin(publicOrigin);
      })
      .catch(() => {
        /* shell refused or is too old — the local origin is all there is */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return origin;
}
