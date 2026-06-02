import { effectiveDate, isEditedToday, localDateISO, localTodayISO } from "../dates";

describe("dates helpers", () => {
  describe("localDateISO", () => {
    it("formats a date as local YYYY-MM-DD", () => {
      // Local-time constructor so the assertion is timezone-independent.
      const d = new Date(2026, 3, 21, 9, 30); // 2026-04-21 09:30 local
      expect(localDateISO(d)).toBe("2026-04-21");
    });

    it("zero-pads month and day", () => {
      const d = new Date(2026, 0, 5, 0, 0); // 2026-01-05 local
      expect(localDateISO(d)).toBe("2026-01-05");
    });
  });

  describe("localTodayISO", () => {
    it("returns the local calendar date of the supplied now", () => {
      expect(localTodayISO(new Date(2026, 5, 2, 23, 59))).toBe("2026-06-02");
    });
  });

  describe("effectiveDate", () => {
    it("uses the explicit date when present", () => {
      expect(
        effectiveDate({ date: "2026-04-21", createdAt: "2026-01-01T00:00:00+00:00" }),
      ).toBe("2026-04-21");
    });

    it("falls back to the local calendar date of createdAt when date is null", () => {
      // Build an ISO string for local midday so the local-date fallback is stable.
      const created = new Date(2026, 2, 15, 12, 0).toISOString();
      expect(effectiveDate({ date: null, createdAt: created })).toBe("2026-03-15");
    });
  });

  describe("isEditedToday", () => {
    it("is true when lastModifiedAt is on the given local day", () => {
      const modified = new Date(2026, 5, 2, 8, 0).toISOString();
      expect(isEditedToday({ lastModifiedAt: modified }, "2026-06-02")).toBe(true);
    });

    it("is false when lastModifiedAt is on a different day", () => {
      const modified = new Date(2026, 5, 1, 8, 0).toISOString();
      expect(isEditedToday({ lastModifiedAt: modified }, "2026-06-02")).toBe(false);
    });
  });
});
