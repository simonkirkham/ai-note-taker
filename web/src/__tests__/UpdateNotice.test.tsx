import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UpdateNotice, { UPDATE_COMMAND } from "../components/UpdateNotice";
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
let copy: ReturnType<typeof vi.fn<(text: string) => Promise<boolean>>>;

function installBridge() {
  window.desktop = {
    isDesktop: true,
    platform: "win32",
    updates: { getHistory, copy },
  } as unknown as DesktopBridge;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  vi.stubEnv("VITE_BUILD_TIME", BUILT);
  getHistory = vi.fn<() => Promise<ReleaseEntry[] | null>>();
  copy = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true);
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
    expect(copy).toHaveBeenCalledWith(UPDATE_COMMAND);
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
