// Test-only utility: re-exports RTL plus a QueryClient-wrapped render.
// Fast Refresh rules don't apply to a test helper.
/* eslint-disable react-refresh/only-export-components */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router";

// Custom render that provides a fresh QueryClient per test — cache isolation,
// and retry:false so a failing query/mutation fails fast instead of retrying.
// Use this everywhere a component (or its subtree, e.g. ListView → TodoSection)
// reads server state via TanStack Query.
function customRender(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Like `render`, but also wraps the tree in a MemoryRouter — for components that
// read the URL (e.g. ListView's CHANGE-23 filters via useSearchParams). Pass a
// `route` to seed the initial location (default "/"); the rendered location is
// readable in the test via a probe component if needed.
function renderWithRouter(
  ui: ReactElement,
  { route = "/", ...options }: { route?: string } & Omit<RenderOptions, "wrapper"> = {},
) {
  return customRender(
    <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>,
    options,
  );
}

export * from "@testing-library/react";
export { customRender as render, renderWithRouter };
