/**
 * WorkspacePage render integration tests (Must-1 / Must-2)
 *
 * Verifies that EngineSegSelector (`.seg-item` buttons) is actually rendered
 * inside the dock row for each error state:
 *   - low_quality: `.dock-low-quality` contains 3 `.seg-item` buttons
 *   - failed:      `.dock-failed`      contains 3 `.seg-item` buttons
 *
 * Must-3 (optional): clicking OSS Worker in low_quality dock moves `is-active`.
 *
 * Production code is NOT modified. All mocks are scoped to this test file.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDto } from "@/lib/api-types";

// ---- module mocks ----------------------------------------------------------------

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPostForm: vi.fn(),
  isApiClientError: (error: unknown): error is { message: string } =>
    typeof error === "object" && error !== null && "message" in error,
}));

vi.mock("@/lib/now", () => ({
  nowMs: () => Date.now(),
}));

// next/link renders as a plain <a> in jsdom — no mock needed.

// ---- import after mocks ----------------------------------------------------------

const { apiGet } = await import("@/lib/api-client");
const mockedApiGet = apiGet as ReturnType<typeof vi.fn>;

// Dynamic import so the module sees the mocked dependencies.
const { default: WorkspacePage } = await import("./page");

// ---- WorkspaceDto factories ------------------------------------------------------

const buildSection = () => ({
  identifier: "s1",
  sectionSeries: "series-1",
  version: 1,
  bodyText: "Hello world.",
  createdAt: "2024-01-01T00:00:00.000Z",
});

const buildLowQualityWorkspace = (): WorkspaceDto => ({
  section: buildSection(),
  sectionTokens: [],
  recordingAttempts: [],
  latestAnalysisRun: {
    identifier: "run-1",
    status: "failed",
    errorCode: "low_quality_audio",
  },
  resultsByEngine: [],
  highlightRangesByEngine: [],
});

const buildFailedWorkspace = (): WorkspaceDto => ({
  section: buildSection(),
  sectionTokens: [],
  recordingAttempts: [],
  latestAnalysisRun: {
    identifier: "run-2",
    status: "failed",
    errorCode: "analysis_error",
  },
  resultsByEngine: [],
  highlightRangesByEngine: [],
});

// ---- helpers ---------------------------------------------------------------------

/**
 * Render WorkspacePage inside Suspense (required because the page calls `use(params)`).
 * `apiGet` is pre-configured to resolve immediately with the given workspace data.
 */
const renderWorkspacePage = async (workspace: WorkspaceDto) => {
  mockedApiGet.mockResolvedValue(workspace);

  const params = Promise.resolve({
    materialIdentifier: "m1",
    sectionIdentifier: "s1",
  });

  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>loading...</div>}>
        <WorkspacePage params={params} />
      </Suspense>,
    );
  });

  return result;
};

// ---- lifecycle -------------------------------------------------------------------

beforeEach(() => {
  mockedApiGet.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---- tests -----------------------------------------------------------------------

describe("WorkspacePage dock render — low_quality state", () => {
  it("dock-low-quality contains 3 .seg-item buttons (Must-1)", async () => {
    const { container } = await renderWorkspacePage(buildLowQualityWorkspace());

    await waitFor(() => {
      const dockLowQuality = container.querySelector(".dock-low-quality");
      expect(dockLowQuality).toBeInTheDocument();
      const segItems = dockLowQuality?.querySelectorAll(".seg-item");
      expect(segItems).toHaveLength(3);
    });
  });

  it("seg-item buttons in dock-low-quality have correct labels", async () => {
    const { container } = await renderWorkspacePage(buildLowQualityWorkspace());

    await waitFor(() => {
      const dockLowQuality = container.querySelector(".dock-low-quality");
      expect(dockLowQuality).toBeInTheDocument();
      const segItems = Array.from(dockLowQuality?.querySelectorAll(".seg-item") ?? []);
      const labels = segItems.map((el) => el.textContent?.trim());
      expect(labels.some((label) => label?.includes("OpenAI API"))).toBe(true);
      expect(labels.some((label) => label?.includes("OSS Worker"))).toBe(true);
      expect(labels.some((label) => label?.includes("比較"))).toBe(true);
    });
  });
});

describe("WorkspacePage dock render — failed state", () => {
  it("dock-failed contains 3 .seg-item buttons (Must-2)", async () => {
    const { container } = await renderWorkspacePage(buildFailedWorkspace());

    await waitFor(() => {
      const dockFailed = container.querySelector(".dock-failed");
      expect(dockFailed).toBeInTheDocument();
      const segItems = dockFailed?.querySelectorAll(".seg-item");
      expect(segItems).toHaveLength(3);
    });
  });

  it("seg-item buttons in dock-failed have correct labels", async () => {
    const { container } = await renderWorkspacePage(buildFailedWorkspace());

    await waitFor(() => {
      const dockFailed = container.querySelector(".dock-failed");
      expect(dockFailed).toBeInTheDocument();
      const segItems = Array.from(dockFailed?.querySelectorAll(".seg-item") ?? []);
      const labels = segItems.map((el) => el.textContent?.trim());
      expect(labels.some((label) => label?.includes("OpenAI API"))).toBe(true);
      expect(labels.some((label) => label?.includes("OSS Worker"))).toBe(true);
      expect(labels.some((label) => label?.includes("比較"))).toBe(true);
    });
  });
});

describe("WorkspacePage dock-low-quality — analysisMode toggle (Must-3)", () => {
  it("clicking OSS Worker button moves is-active from comparison to ossWorkerOnly", async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspacePage(buildLowQualityWorkspace());

    await waitFor(() => {
      const dockLowQuality = container.querySelector(".dock-low-quality");
      expect(dockLowQuality?.querySelectorAll(".seg-item")).toHaveLength(3);
    });

    const dockLowQuality = container.querySelector(".dock-low-quality")!;
    const segItems = Array.from(dockLowQuality.querySelectorAll(".seg-item"));

    // initial state: comparison (index 2) is active
    expect(segItems[2]).toHaveClass("is-active");
    expect(segItems[1]).not.toHaveClass("is-active");

    // click OSS Worker (index 1)
    await user.click(segItems[1]);

    // is-active should move to OSS Worker
    expect(segItems[1]).toHaveClass("is-active");
    expect(segItems[2]).not.toHaveClass("is-active");
  });
});
