import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { WorkspaceProvider } from "../workspace/WorkspaceContext";
import { resetWorkspaceForTests } from "../workspace/workspaceStore";

// Regression: switching workspaces must NOT evict cached queries. A prior
// `removeQueries` on switch matched queries by name, so it deleted the freshly-created
// current-workspace queries mid-fetch and left their observers stuck in loading even
// though the requests returned 200. Query keys already fold in the workspace id, so the
// cache is workspace-isolated without any eviction.

function SwitchButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/w/wsB")}>switch</button>;
}

afterEach(() => resetWorkspaceForTests());

it("does not evict other workspaces' cached queries when switching", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["noteCards", "wsA"], [{ noteId: "n-a" }]);
  qc.setQueryData(["meetings", "2026-06-11"], { meetings: [] });

  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/w/wsA"]}>
        <Routes>
          <Route
            path="/w/:wsId"
            element={
              <WorkspaceProvider>
                <SwitchButton />
              </WorkspaceProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await userEvent.click(screen.getByText("switch"));

  // The switch to wsB must leave the existing cache intact (no stuck-loading eviction).
  await waitFor(() => {
    expect(qc.getQueryData(["noteCards", "wsA"])).toBeDefined();
    expect(qc.getQueryData(["meetings", "2026-06-11"])).toBeDefined();
  });
});
