// 53-A — the desktop window also visits Google's sign-in pages, which get the same preload. The
// update-notice calls answer only the app's own origin. Pure, so it is unit-tested headlessly
// alongside permissionPolicy.ts.
export function isBundleOrigin(frameUrl: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!frameUrl) return false
  try {
    return allowedOrigins.includes(new URL(frameUrl).origin)
  } catch {
    return false
  }
}
