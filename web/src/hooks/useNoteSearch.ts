import { useCallback, useEffect, useRef, useState } from "react";
import { SearchResult, searchNotes } from "../api/notes";

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; results: SearchResult[] }
  | { status: "empty" }
  | { status: "error" };

const DEBOUNCE_MS = 300;
const IDLE: SearchState = { status: "idle" };
const LOADING: SearchState = { status: "loading" };

// The fetched slice is keyed by the query it belongs to. Displaying it only
// when the key matches the live query lets us compute "loading" for an
// in-flight/just-changed query without a synchronous setState in the effect.
interface Fetched {
  query: string;
  state: SearchState;
}

export function useNoteSearch(query: string) {
  const trimmed = query.trim();
  const [fetched, setFetched] = useState<Fetched>({ query: "", state: IDLE });
  // Monotonic request id: only the latest query's response may render. Bumped
  // both by the effect (new query) and by retry (manual re-fire).
  const reqIdRef = useRef(0);
  // Bumped to force the effect to re-run on retry without changing `query`.
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    // A blank query has no request to fire; the displayed state is computed as
    // idle below. No synchronous setState in the effect body — that would trip
    // react-hooks/set-state-in-effect.
    if (trimmed === "") {
      reqIdRef.current += 1;
      return;
    }

    const reqId = (reqIdRef.current += 1);
    const timer = setTimeout(() => {
      searchNotes(trimmed)
        .then((results) => {
          if (reqId !== reqIdRef.current) return; // stale — a newer query won
          setFetched({
            query: trimmed,
            state:
              results.length > 0
                ? { status: "results", results }
                : { status: "empty" },
          });
        })
        .catch(() => {
          if (reqId !== reqIdRef.current) return;
          setFetched({ query: trimmed, state: { status: "error" } });
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, retryToken]);

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  // Computed display state — derived, never synced via the effect:
  //   blank query            → idle (clearing restores the prior view at once)
  //   fetched matches query  → that result/empty/error
  //   otherwise (typing/in-flight) → loading
  const state: SearchState =
    trimmed === "" ? IDLE : fetched.query === trimmed ? fetched.state : LOADING;

  return { state, retry };
}
