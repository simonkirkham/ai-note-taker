// Thin wrapper over the CloudWatch RUM web client. The client is injected by
// the index.html `rum-snippet` in deployed environments and exposes a global
// `cwr` function; locally (and in tests) it is absent, so calls are no-ops.
type CwrFn = (operation: string, ...args: unknown[]) => void;

export function recordRumEvent(type: string, data: Record<string, unknown>): void {
  const cwr = (window as unknown as { cwr?: CwrFn }).cwr;
  cwr?.("recordEvent", type, data);
}
