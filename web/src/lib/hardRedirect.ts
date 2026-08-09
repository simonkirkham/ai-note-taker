// The single place the app leaves the SPA for an external URL (the OAuth authorize endpoints).
//
// Isolated as its own module for one reason: BUG-60's whole guarantee is that a redirect must NOT
// fire when the PKCE verifier could not be stored, and jsdom does not allow `window.location` to be
// stubbed or redefined — so an inline `window.location.href = url` makes "we did not navigate"
// unobservable, and the guard becomes untestable. A test can mock this module.
export function hardRedirect(url: string): void {
  window.location.href = url;
}
