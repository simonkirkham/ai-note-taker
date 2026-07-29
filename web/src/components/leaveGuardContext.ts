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
 */
export type RequestLeave = (proceed: () => void) => void;

export const LeaveGuardContext = createContext<RequestLeave | null>(null);

export function useRequestLeave(): RequestLeave {
  return useContext(LeaveGuardContext) ?? ((proceed) => proceed());
}
