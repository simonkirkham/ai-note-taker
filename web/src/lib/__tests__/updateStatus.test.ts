import { describe, expect, it } from "vitest";
import { updateStatus, type ReleaseEntry } from "../updateStatus";

// 53-A — the pure decision behind the desktop update notice: how far behind this copy is, and
// whether the notice should show given what the user already dismissed.

const DAY = 24 * 60 * 60 * 1000;
const BUILT = "2026-09-10T12:00:00Z";
const NOW = new Date(Date.parse(BUILT) + 5 * DAY + 3 * 60 * 60 * 1000);

const entry = (builtAt: string): ReleaseEntry => ({ sha: builtAt, builtAt });
const later = (days: number) => entry(new Date(Date.parse(BUILT) + days * DAY).toISOString());

describe("updateStatus", () => {
  it("Given 3 newer updates, When checked, Then it shows 3 behind and a 5-day age", () => {
    const history = [entry(BUILT), later(1), later(2), later(4)];
    expect(updateStatus({ builtAt: BUILT, history, now: NOW, dismissedLatest: null })).toEqual({
      show: true,
      behind: 3,
      ageDays: 5,
      latest: later(4).builtAt,
    });
  });

  it("Given no newer update, When checked, Then nothing shows", () => {
    const status = updateStatus({ builtAt: BUILT, history: [entry(BUILT)], now: NOW, dismissedLatest: null });
    expect(status.show).toBe(false);
  });

  it("Given this copy is older than the whole history, When checked, Then every entry counts", () => {
    const status = updateStatus({ builtAt: BUILT, history: [later(1), later(2)], now: NOW, dismissedLatest: null });
    expect(status).toMatchObject({ show: true, behind: 2 });
  });

  it("Given history out of order, When checked, Then latest is the newest entry", () => {
    const status = updateStatus({ builtAt: BUILT, history: [later(3), later(1)], now: NOW, dismissedLatest: null });
    expect(status).toMatchObject({ show: true, latest: later(3).builtAt });
  });

  it("Given the user dismissed at the current newest update, When checked, Then nothing shows", () => {
    const history = [later(1), later(2)];
    const status = updateStatus({ builtAt: BUILT, history, now: NOW, dismissedLatest: later(2).builtAt });
    expect(status.show).toBe(false);
  });

  it("Given a newer update than the one dismissed, When checked, Then it shows again with the new count", () => {
    const history = [later(1), later(2), later(3)];
    const status = updateStatus({ builtAt: BUILT, history, now: NOW, dismissedLatest: later(2).builtAt });
    expect(status).toMatchObject({ show: true, behind: 3 });
  });

  it("Given no build time (a dev build), When checked, Then nothing shows", () => {
    const status = updateStatus({ builtAt: "", history: [later(1)], now: NOW, dismissedLatest: null });
    expect(status.show).toBe(false);
  });

  it("Given an unreadable timestamp in the history, When checked, Then that entry is ignored", () => {
    const status = updateStatus({ builtAt: BUILT, history: [entry("garbage"), later(1)], now: NOW, dismissedLatest: null });
    expect(status).toMatchObject({ show: true, behind: 1, latest: later(1).builtAt });
  });

  it("Given a build from under a day ago, When checked, Then its age is 0 days", () => {
    const status = updateStatus({
      builtAt: BUILT,
      history: [later(0.1)],
      now: new Date(Date.parse(BUILT) + 0.5 * DAY),
      dismissedLatest: null,
    });
    expect(status).toMatchObject({ show: true, ageDays: 0 });
  });
});
