// Test-only utility: re-exports RTL plus a QueryClient-wrapped render.
// Fast Refresh rules don't apply to a test helper.
/* eslint-disable react-refresh/only-export-components */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// Custom render that provides a fresh QueryClient per test — cache isolation,
// and retry:false so a failing query/mutation fails fast instead of retrying.
// Use this everywhere a component (or its subtree, e.g. ListView → TodoSection)
// reads server state via TanStack Query.
function customRender(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

export * from "@testing-library/react";
export { customRender as render };
