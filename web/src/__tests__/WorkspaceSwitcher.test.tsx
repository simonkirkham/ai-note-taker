import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import WorkspaceSwitcher from "../components/WorkspaceSwitcher";
import { render, screen, waitFor, within } from "../test/render";
import { server } from "../test/setup";
import { WorkspaceProvider } from "../workspace/WorkspaceContext";

// Phase 23-E — sidebar workspace switcher (Variant A dropdown, inline CRUD).

const threeWorkspaces = {
  workspaces: [
    { workspaceId: "__default__", name: "Personal", isDefault: true },
    { workspaceId: "ws-work", name: "Work", isDefault: false },
    { workspaceId: "ws-clients", name: "Clients", isDefault: false },
  ],
};

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function renderSwitcher(wsId = "__default__") {
  return render(
    <MemoryRouter initialEntries={[`/w/${wsId}`]}>
      <Routes>
        <Route
          path="/w/:wsId"
          element={
            <WorkspaceProvider>
              <WorkspaceSwitcher />
              <Probe />
            </WorkspaceProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function openMenu() {
  await userEvent.click(await screen.findByTestId("workspace-switcher-trigger"));
  return screen.findByTestId("workspace-switcher-menu");
}

beforeEach(() => {
  server.use(http.get("/api/workspaces", () => HttpResponse.json(threeWorkspaces)));
});

describe("WorkspaceSwitcher (23-E)", () => {
  it("shows the active workspace and lists the others with the active marked", async () => {
    renderSwitcher("ws-work");
    expect(await screen.findByTestId("workspace-switcher-trigger")).toHaveTextContent("Work");
    const menu = await openMenu();
    expect(within(menu).getByText("Personal")).toBeInTheDocument();
    expect(within(menu).getByText("Clients")).toBeInTheDocument();
    // active row carries the data-active marker
    const workRow = within(menu).getByTestId("workspace-option-ws-work").closest("[data-active]");
    expect(workRow).not.toBeNull();
  });

  it("navigates to the picked workspace and closes", async () => {
    renderSwitcher("__default__");
    await openMenu();
    await userEvent.click(screen.getByTestId("workspace-option-ws-clients"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/w/ws-clients"));
    expect(screen.queryByTestId("workspace-switcher-menu")).not.toBeInTheDocument();
  });

  it("creates a workspace and switches into it (optimistic)", async () => {
    server.use(http.post("/api/workspaces", () => HttpResponse.json({ workspaceId: "ws-created" }, { status: 201 })));
    renderSwitcher("__default__");
    await openMenu();
    await userEvent.click(screen.getByTestId("workspace-create"));
    await userEvent.type(screen.getByLabelText("New workspace name"), "Team{Enter}");
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/w/ws-created"));
  });

  it("renames a workspace inline", async () => {
    let patched: string | null = null;
    server.use(http.patch("/api/workspaces/:id", async ({ request, params }) => {
      patched = (await request.json() as { name: string }).name + ":" + params.id;
      return new HttpResponse(null, { status: 200 });
    }));
    renderSwitcher("__default__");
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Rename Work" }));
    const input = within(menu).getByLabelText("Workspace name");
    await userEvent.clear(input);
    await userEvent.type(input, "Clients Inc{Enter}");
    await waitFor(() => expect(patched).toBe("Clients Inc:ws-work"));
  });

  it("deletes an empty workspace", async () => {
    let deleted: string | null = null;
    server.use(http.delete("/api/workspaces/:id", ({ params }) => { deleted = params.id as string; return new HttpResponse(null, { status: 204 }); }));
    renderSwitcher("__default__");
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Delete Clients" }));
    await waitFor(() => expect(deleted).toBe("ws-clients"));
  });

  it("returns to the default workspace after deleting the active one", async () => {
    server.use(http.delete("/api/workspaces/:id", () => new HttpResponse(null, { status: 204 })));
    renderSwitcher("ws-work");
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Delete Work" }));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/w/__default__"));
  });

  it("clears a delete error when the menu is dismissed by an outside click", async () => {
    server.use(http.delete("/api/workspaces/:id", () => new HttpResponse(null, { status: 409 })));
    renderSwitcher("__default__");
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Delete Work" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(document.body); // outside-click dismiss
    await waitFor(() => expect(screen.queryByTestId("workspace-switcher-menu")).not.toBeInTheDocument());
    await openMenu(); // reopen — the stale error must not reappear
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a 409 inline error when deleting a non-empty workspace", async () => {
    server.use(http.delete("/api/workspaces/:id", () => new HttpResponse(null, { status: 409 })));
    renderSwitcher("__default__");
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Delete Work" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not empty/i);
    // optimistic removal rolled back — the row is back
    await waitFor(() => expect(screen.getByTestId("workspace-option-ws-work")).toBeInTheDocument());
  });

  it("does not offer a delete affordance for the default workspace", async () => {
    renderSwitcher("__default__");
    const menu = await openMenu();
    expect(within(menu).queryByRole("button", { name: "Delete Personal" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Rename Personal" })).toBeInTheDocument();
  });
});
