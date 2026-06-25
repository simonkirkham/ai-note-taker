import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import ThemePicker from "../components/ThemePicker";
import { render, screen, waitFor } from "../test/render";
import { server } from "../test/setup";
import { WorkspaceProvider } from "../workspace/WorkspaceContext";

// 36-A — per-workspace theme. A non-default workspace stores its theme server-side
// and applies it on switch; the default workspace keeps the global localStorage theme.

const workspaces = {
  workspaces: [
    { workspaceId: "__default__", name: "Personal", isDefault: true },
    { workspaceId: "ws-work", name: "Work", isDefault: false, theme: "midnight" },
    { workspaceId: "ws-clients", name: "Clients", isDefault: false },
  ],
};

function renderPicker(wsId = "__default__") {
  return render(
    <MemoryRouter initialEntries={[`/w/${wsId}`]}>
      <Routes>
        <Route
          path="/w/:wsId"
          element={
            <WorkspaceProvider>
              <ThemePicker />
            </WorkspaceProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  server.use(http.get("/api/workspaces", () => HttpResponse.json(workspaces)));
});

describe("WorkspaceTheme (36-A)", () => {
  it("applies the active workspace's stored theme on mount", async () => {
    renderPicker("ws-work");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("midnight"));
    expect(screen.getByLabelText("Theme")).toHaveValue("midnight");
  });

  it("caches the workspace's resolved theme under note-taker-theme:<wsId> for the cold-load bootstrap (36-B)", async () => {
    renderPicker("ws-work");
    await waitFor(() => expect(localStorage.getItem("note-taker-theme:ws-work")).toBe("midnight"));
  });

  it("does not write a per-workspace cache key for the default workspace (36-B)", async () => {
    renderPicker("__default__");
    await waitFor(() => expect(screen.getByLabelText("Theme")).toBeInTheDocument());
    expect(localStorage.getItem("note-taker-theme:__default__")).toBeNull();
  });

  it("selecting a theme paints optimistically and PATCHes the workspace theme endpoint", async () => {
    let patched: { id: string | readonly string[] | undefined; theme: string } | null = null;
    let workTheme = "midnight";
    server.use(
      // stateful GET so the post-write invalidation refetch reflects the persisted theme
      http.get("/api/workspaces", () =>
        HttpResponse.json({
          workspaces: [
            { workspaceId: "__default__", name: "Personal", isDefault: true },
            { workspaceId: "ws-work", name: "Work", isDefault: false, theme: workTheme },
          ],
        }),
      ),
      http.patch("/api/workspaces/:id/theme", async ({ request, params }) => {
        patched = { id: params.id, theme: (await request.json() as { theme: string }).theme };
        workTheme = patched.theme;
        return new HttpResponse(null, { status: 200, headers: { "X-Consistency-Token": "tok-1" } });
      }),
    );

    renderPicker("ws-work");
    await waitFor(() => expect(screen.getByLabelText("Theme")).toHaveValue("midnight"));

    await userEvent.selectOptions(screen.getByLabelText("Theme"), "plum");

    // optimistic immediate paint
    expect(document.documentElement.dataset.theme).toBe("plum");
    // and the write reaches the per-workspace theme endpoint
    await waitFor(() => expect(patched).toEqual({ id: "ws-work", theme: "plum" }));
  });

  it("in the default workspace, selecting a theme writes localStorage and does NOT hit the theme endpoint", async () => {
    let themePatchHit = false;
    server.use(
      http.patch("/api/workspaces/:id/theme", () => {
        themePatchHit = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    renderPicker("__default__");
    await waitFor(() => expect(screen.getByLabelText("Theme")).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText("Theme"), "violet");

    expect(localStorage.getItem("note-taker-theme")).toBe("violet");
    expect(document.documentElement.dataset.theme).toBe("violet");
    expect(themePatchHit).toBe(false);
  });

  it("rolls back to the prior theme when the PATCH fails", async () => {
    server.use(
      http.patch("/api/workspaces/:id/theme", () => new HttpResponse(null, { status: 500 })),
    );

    renderPicker("ws-work");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("midnight"));

    await userEvent.selectOptions(screen.getByLabelText("Theme"), "plum");

    // the failed write reconciles: the optimistic cache rolls back and the prior theme stays applied
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("midnight"));
    expect(screen.getByLabelText("Theme")).toHaveValue("midnight");
  });

  it("applies the default theme for a non-default workspace with no stored theme", async () => {
    renderPicker("ws-clients");
    // teal is the :root default → no data-theme attribute, and the picker shows teal.
    await waitFor(() => expect(screen.getByLabelText("Theme")).toHaveValue("teal"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
