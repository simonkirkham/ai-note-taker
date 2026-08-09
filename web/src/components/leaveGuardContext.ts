import { createContext, useContext } from "react";

/**
 * BUG-54 / 49-A. A mounted note can be RECORDING, and unmounting it mid-capture loses the
 * transcript (the failure BUG-34 was filed for). The BUG-34 popstate trap only catches
 * browser Back — an in-app `navigate` PUSHES, so the trap never fires for it.
 *
 * So any component that navigates away from the note screen routes through `requestLeave`
 * instead of calling `navigate` directly: it hands over the continuation, and the recording
 * note either runs it immediately (nothing to protect) or holds it behind its existing
 * "still recording" confirmation and runs it once the user agrees.
 *
 * Default (no provider) is to proceed — a component rendered outside the app shell, as in
 * its own unit tests, has no note to protect.
 *
 * CHANGE-33: `destination` is the caller's own name for what `proceed` will do, phrased to
 * complete "Still recording — …?" ("go to Home", "switch to Work", "sign out"). Required,
 * not optional: only the caller knows where it is going, and an optional one would let a
 * new guarded exit silently reinstate the anonymous banner this exists to remove.
 */
export type RequestLeave = (proceed: () => void, destination: string) => void;

export const LeaveGuardContext = createContext<RequestLeave | null>(null);

// Stable identity so a consumer can safely put it in a dep array.
const PROCEED: RequestLeave = (proceed) => proceed();

export function useRequestLeave(): RequestLeave {
  const requestLeave = useContext(LeaveGuardContext);
  // No provider means nothing to protect (a component rendered standalone, as in its own
  // unit tests). That is the right default, but it fails OPEN — a navigating component
  // mounted outside the provider by mistake would silently lose recordings, with no type
  // or lint error to catch it. Say so in dev.
  if (!requestLeave && import.meta.env.DEV) {
    console.warn(
      "useRequestLeave: no LeaveGuardContext provider — navigation will not be guarded. " +
        "If this component can navigate away from a note, mount it inside AppContent.",
    );
  }
  return requestLeave ?? PROCEED;
}
