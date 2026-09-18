import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLabel, buildRunUrl, buildTitle } from "../buildInfo";

// CHANGE-43 — the build stamp names the pipeline run that produced it and links to it.

afterEach(() => {
  vi.unstubAllEnvs();
});

const stub = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
};

describe("buildRunUrl", () => {
  it("points at the run that built this copy", () => {
    stub({ VITE_BUILD_RUN_ID: "35120085890" });
    expect(buildRunUrl()).toBe("https://github.com/simonkirkham/ai-note-taker/actions/runs/35120085890");
  });

  it("is absent when no run built it", () => {
    stub({ VITE_BUILD_RUN_ID: "" });
    expect(buildRunUrl()).toBeUndefined();
  });

  it("refuses a run id that is not a plain number", () => {
    stub({ VITE_BUILD_RUN_ID: "../../evil" });
    expect(buildRunUrl()).toBeUndefined();
  });
});

describe("buildTitle", () => {
  // The installer version is numbered by the packaging run, the link points at the release's own
  // run — so the wording names the release, never "this run".
  it("names the release, the installer version, the commit and what opens", () => {
    stub({
      VITE_BUILD_NUMBER: "779",
      VITE_BUILD_SHA: "ceb30a9123456789abcdef0123456789abcdef01",
      VITE_BUILD_INSTALLER_VERSION: "1.0.0-20260916.226",
      VITE_BUILD_RUN_ID: "35120085890",
    });
    expect(buildTitle()).toBe(
      "Release 779 · installer 1.0.0-20260916.226 · commit ceb30a9 — click to open this release",
    );
  });

  it("leaves out the installer version in the browser build", () => {
    stub({
      VITE_BUILD_NUMBER: "779",
      VITE_BUILD_SHA: "ceb30a9123456789abcdef0123456789abcdef01",
      VITE_BUILD_INSTALLER_VERSION: "",
      VITE_BUILD_RUN_ID: "35120085890",
    });
    expect(buildTitle()).toBe("Release 779 · commit ceb30a9 — click to open this release");
  });

  it("does not promise a click when there is no run to open", () => {
    stub({
      VITE_BUILD_NUMBER: "779",
      VITE_BUILD_SHA: "ceb30a9123456789abcdef0123456789abcdef01",
      VITE_BUILD_INSTALLER_VERSION: "",
      VITE_BUILD_RUN_ID: "",
    });
    expect(buildTitle()).toBe("Release 779 · commit ceb30a9");
  });

  it("has nothing to say about a hand build", () => {
    stub({ VITE_BUILD_NUMBER: "", VITE_BUILD_SHA: "", VITE_BUILD_INSTALLER_VERSION: "", VITE_BUILD_RUN_ID: "" });
    expect(buildTitle()).toBeUndefined();
    expect(buildLabel()).toBe("Build dev");
  });
});

// Nothing pins the release number and the run id arriving together, so cover the odd pair rather
// than assume it: a run with no release number must not leave a dangling phrase.
describe("buildTitle with a run but no release number", () => {
  it("still reads as a sentence", () => {
    stub({
      VITE_BUILD_NUMBER: "",
      VITE_BUILD_SHA: "ceb30a9123456789abcdef0123456789abcdef01",
      VITE_BUILD_INSTALLER_VERSION: "",
      VITE_BUILD_RUN_ID: "35120085890",
    });
    expect(buildTitle()).toBe("commit ceb30a9 — click to open this release");
  });
});
