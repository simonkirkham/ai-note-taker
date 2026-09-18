import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UpdateNotice, { UPDATE_COMMAND } from "../components/UpdateNotice";
import { RecordingControlContext, type RecordingControlValue } from "../hooks/recordingSessionContext";
import type { DesktopBridge, ReleaseEntry } from "../types/desktop";

// 53-A — the desktop update notice. Each test names the phase-doc scenario it covers.

const DAY = 24 * 60 * 60 * 1000;
const BUILT = "2026-09-10T12:00:00.000Z";
const NOW = Date.parse(BUILT) + 5 * DAY + 60_000;
const later = (days: number): ReleaseEntry => {
  const builtAt = new Date(Date.parse(BUILT) + days * DAY).toISOString();
  return { sha: builtAt, builtAt };
};

let getHistory: ReturnType<typeof vi.fn<() => Promise<ReleaseEntry[] | null>>>;
let copy: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

function installBridge() {
  window.desktop = {
    isDesktop: true,
    platform: "win32",
    updates: { getHistory, copyUpdateCommand: copy },
  } as unknown as DesktopBridge;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  vi.stubEnv("VITE_BUILD_TIME", BUILT);
  getHistory = vi.fn<() => Promise<ReleaseEntry[] | null>>();
  copy = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  localStorage.clear();
  installBridge();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete window.desktop;
});

describe("UpdateNotice", () => {
  it("Scenario: Behind by several updates — shows age, count and the command", async () => {
    getHistory.mockResolvedValue([later(1), later(2), later(3)]);
    render(<UpdateNotice />);
    expect(
      await screen.findByText("A newer version is available — your copy is 5 days old and 3 updates behind."),
    ).toBeInTheDocument();
    expect(screen.getByText(UPDATE_COMMAND)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy update command" })).toBeInTheDocument();
  });

  it("uses singular wording for one update and one day", async () => {
    vi.setSystemTime(Date.parse(BUILT) + 1 * DAY + 60_000);
    getHistory.mockResolvedValue([later(0.5)]);
    render(<UpdateNotice />);
    expect(
      await screen.findByText("A newer version is available — your copy is 1 day old and 1 update behind."),
    ).toBeInTheDocument();
  });

  it("says 'less than a day old' for a copy built today", async () => {
    vi.setSystemTime(Date.parse(BUILT) + 0.5 * DAY);
    getHistory.mockResolvedValue([later(0.25)]);
    render(<UpdateNotice />);
    expect(await screen.findByText(/your copy is less than a day old and 1 update behind/)).toBeInTheDocument();
  });

  it("Scenario: Up to date — no notice", async () => {
    getHistory.mockResolvedValue([{ sha: "x", builtAt: BUILT }]);
    const { container } = render(<UpdateNotice />);
    await waitFor(() => expect(getHistory).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("Scenario: Copy the command — puts it on the clipboard and says Copied", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    await user.click(await screen.findByRole("button", { name: "Copy update command" }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("does not claim Copied when the copy failed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    copy.mockResolvedValue(false);
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    await user.click(await screen.findByRole("button", { name: "Copy update command" }));
    expect(await screen.findByRole("button", { name: "Copy failed — select the command" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
  });

  it("Scenario: Dismiss until the next update — hides now, stays hidden, returns for a newer one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getHistory.mockResolvedValue([later(1), later(2), later(3)]);
    const first = render(<UpdateNotice />);
    await user.click(await screen.findByRole("button", { name: "Dismiss update notice" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    first.unmount();

    // Restart with the same history: still hidden.
    const second = render(<UpdateNotice />);
    await waitFor(() => expect(getHistory).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    second.unmount();

    // A 4th update is published: back, with the new count.
    getHistory.mockResolvedValue([later(1), later(2), later(3), later(4)]);
    vi.setSystemTime(Date.parse(BUILT) + 5 * DAY + 60_000);
    render(<UpdateNotice />);
    expect(await screen.findByText(/4 updates behind/)).toBeInTheDocument();
  });

  it("Scenario: Update published while the app is open — appears within the hour", async () => {
    getHistory.mockResolvedValue([{ sha: "x", builtAt: BUILT }]);
    render(<UpdateNotice />);
    await waitFor(() => expect(getHistory).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    getHistory.mockResolvedValue([{ sha: "x", builtAt: BUILT }, later(5)]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/1 update behind/)).toBeInTheDocument();
  });

  it("keeps showing the notice when a later hourly check fails", async () => {
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    expect(await screen.findByText(/1 update behind/)).toBeInTheDocument();

    getHistory.mockResolvedValue(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/1 update behind/)).toBeInTheDocument();
  });

  it("only runs the downloaded script when the download succeeded", () => {
    expect(UPDATE_COMMAND).toMatch(/; if \(\$\?\) \{ powershell -ExecutionPolicy Bypass -File \$f \}$/);
  });

  it("Scenario: Check fails — no notice, no error", async () => {
    getHistory.mockResolvedValue(null);
    const { container } = render(<UpdateNotice />);
    await waitFor(() => expect(getHistory).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("Scenario: Check fails — a rejected check is swallowed too", async () => {
    getHistory.mockRejectedValue(new Error("ipc gone"));
    const { container } = render(<UpdateNotice />);
    await waitFor(() => expect(getHistory).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("Scenario: Browser — never checks, never shows", async () => {
    delete window.desktop;
    const { container } = render(<UpdateNotice />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("shows nothing and never checks in a desktop build with no build time", async () => {
    vi.stubEnv("VITE_BUILD_TIME", "");
    getHistory.mockResolvedValue([later(1)]);
    const { container } = render(<UpdateNotice />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("shows nothing in an older desktop shell that has no update bridge", async () => {
    window.desktop = { isDesktop: true, platform: "win32" } as unknown as DesktopBridge;
    const { container } = render(<UpdateNotice />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});

// 54-A — the app updates itself. The notice offers "Restart now" once an update has downloaded,
// stays quiet while one is downloading, and falls back to the 53-A command when updating fails.
describe("UpdateNotice — self-updating", () => {
  type State = "disabled" | "checking" | "downloading" | "ready" | "none" | "failed";
  let getState: ReturnType<typeof vi.fn<() => Promise<State | null>>>;
  let restart: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let push: (s: State) => void;

  beforeEach(() => {
    getState = vi.fn<() => Promise<State | null>>();
    restart = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    push = () => {};
    window.desktop = {
      isDesktop: true,
      platform: "win32",
      updates: {
        getHistory,
        copyUpdateCommand: copy,
        getState,
        restart,
        onState: (cb: (s: State) => void) => {
          push = (s) => act(() => cb(s));
          return () => {
            push = () => {};
          };
        },
      },
    } as unknown as DesktopBridge;
  });

  const busy = (noteId: string | null) =>
    ({ children }: { children: React.ReactNode }) => (
      <RecordingControlContext.Provider value={{ busyNoteId: noteId } as unknown as RecordingControlValue}>
        {children}
      </RecordingControlContext.Provider>
    );

  it("Scenario: Update ready notice — says it installs on close and offers Restart now", async () => {
    getState.mockResolvedValue("ready");
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    expect(await screen.findByText("An update is ready — it installs when you close the app.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart now" })).toBeInTheDocument();
    // The 53-A command is not offered alongside it.
    expect(screen.queryByText(UPDATE_COMMAND)).not.toBeInTheDocument();
  });

  it("Scenario: Update ready notice — appears when the download finishes while the app is open", async () => {
    getState.mockResolvedValue("downloading");
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    push("ready");
    expect(await screen.findByRole("button", { name: "Restart now" })).toBeInTheDocument();
  });

  it("Scenario: Restart now — installs and reopens", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getState.mockResolvedValue("ready");
    getHistory.mockResolvedValue([]);
    render(<UpdateNotice />);
    await user.click(await screen.findByRole("button", { name: "Restart now" }));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("Scenario: Recording in progress — no Restart now, still says it installs on close", async () => {
    getState.mockResolvedValue("ready");
    getHistory.mockResolvedValue([]);
    render(<UpdateNotice />, { wrapper: busy("note-1") });
    expect(await screen.findByText("An update is ready — it installs when you close the app.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart now" })).not.toBeInTheDocument();
  });

  it("Scenario: Download in progress — no notice, not even the command", async () => {
    getState.mockResolvedValue("downloading");
    getHistory.mockResolvedValue([later(1), later(2)]);
    const { container } = render(<UpdateNotice />);
    await waitFor(() => expect(getHistory).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing until the update state is known", async () => {
    getState.mockReturnValue(new Promise(() => {}));
    getHistory.mockResolvedValue([later(1)]);
    const { container } = render(<UpdateNotice />);
    await waitFor(() => expect(getHistory).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("Scenario: Automatic update fails — the notice with the copyable command appears", async () => {
    getState.mockResolvedValue("downloading");
    getHistory.mockResolvedValue([later(1), later(2)]);
    render(<UpdateNotice />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    push("failed");
    expect(await screen.findByText(/2 updates behind/)).toBeInTheDocument();
    expect(screen.getByText(UPDATE_COMMAND)).toBeInTheDocument();
  });

  it("Scenario: Up to date — no notice", async () => {
    getState.mockResolvedValue("none");
    getHistory.mockResolvedValue([{ sha: "x", builtAt: BUILT }]);
    const { container } = render(<UpdateNotice />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("Scenario: Dismiss — hides the ready notice", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getState.mockResolvedValue("ready");
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    await user.click(await screen.findByRole("button", { name: "Dismiss update notice" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(restart).not.toHaveBeenCalled();
  });

  it("keeps a change pushed before the first answer arrives", async () => {
    let answer: (s: State) => void = () => {};
    getState.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    push("ready");
    await act(async () => answer("downloading"));
    expect(screen.getByRole("button", { name: "Restart now" })).toBeInTheDocument();
  });

  it("falls back to the command notice when the update state cannot be read", async () => {
    getState.mockRejectedValue(new Error("ipc gone"));
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    expect(await screen.findByText(/1 update behind/)).toBeInTheDocument();
  });

  it("Scenario: Automatic update fails — 'nothing newer' while behind still shows the command", async () => {
    getState.mockResolvedValue("none");
    getHistory.mockResolvedValue([later(1)]);
    render(<UpdateNotice />);
    expect(await screen.findByText(/1 update behind/)).toBeInTheDocument();
    expect(screen.getByText(UPDATE_COMMAND)).toBeInTheDocument();
  });

  it("stops listening for update changes when it unmounts", async () => {
    getState.mockResolvedValue("downloading");
    getHistory.mockResolvedValue([]);
    const { unmount } = render(<UpdateNotice />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    const before = push;
    unmount();
    expect(push).not.toBe(before);
  });
});
