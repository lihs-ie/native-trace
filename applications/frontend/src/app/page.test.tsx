import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import LibraryPage from "./page";
import type { MaterialStatsDto } from "@/lib/api-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  isApiClientError: (error: unknown): error is { message: string } =>
    typeof error === "object" && error !== null && "message" in error,
}));

const { apiGet } = await import("@/lib/api-client");
const mockedApiGet = apiGet as ReturnType<typeof vi.fn>;

const emptyStats: MaterialStatsDto = {
  sectionSeriesCount: 0,
  recordingAttemptCount: 0,
  bestOverallScore: null,
  overallScoreHistory: [],
  lastPracticedAt: null,
};

beforeEach(() => {
  mockedApiGet.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LibraryPage", () => {
  it("renders home-top chrome with brand, nav, and new-material link", async () => {
    mockedApiGet.mockResolvedValue([]);

    const { container } = render(<LibraryPage />);

    await waitFor(() => {
      expect(within(container).getAllByText(/NativeTrace/).length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ライブラリ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "履歴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "＋ 新しい教材" })).toBeInTheDocument();
  });

  it("renders empty state when no materials exist", async () => {
    mockedApiGet.mockResolvedValue([]);

    const { container } = render(<LibraryPage />);

    await waitFor(() => {
      expect(within(container).getByText("最初の教材を作成しましょう")).toBeInTheDocument();
    });

    expect(within(container).getByText("/t/")).toBeInTheDocument();
    expect(
      within(container).getByRole("link", { name: "＋ 英文を貼り付けて作成" }),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("button", { name: "サンプル教材を読み込む" }),
    ).toBeInTheDocument();
    expect(within(container).getByText("英文を貼り付け")).toBeInTheDocument();
    expect(within(container).getByText("範囲選択でセクション作成")).toBeInTheDocument();
    expect(within(container).getByText("録音 → 解析 → 添削")).toBeInTheDocument();
  });

  it("renders populated grid when materials exist", async () => {
    const materials = [
      {
        identifier: "mat-01",
        title: "Stanford Commencement Address",
        source: {
          sourceType: "speech",
          speakerName: "Steve Jobs",
          sourceTitle: "Stanford University",
          sourceUrl: null,
        },
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        stats: {
          sectionSeriesCount: 3,
          recordingAttemptCount: 4,
          bestOverallScore: 82,
          overallScoreHistory: [60, 72, 80, 82],
          lastPracticedAt: new Date(Date.now() - 86400000).toISOString(),
        } satisfies MaterialStatsDto,
      },
      {
        identifier: "mat-02",
        title: "The Power of Vulnerability",
        source: {
          sourceType: "ted",
          speakerName: "Brené Brown",
          sourceTitle: "TEDxHouston",
          sourceUrl: "https://ted.com/x",
        },
        createdAt: new Date(Date.now() - 259200000).toISOString(),
        updatedAt: new Date(Date.now() - 259200000).toISOString(),
        stats: emptyStats,
      },
    ];

    mockedApiGet.mockResolvedValue(materials);

    const { container } = render(<LibraryPage />);

    await waitFor(() => {
      expect(within(container).getByText("教材ライブラリ")).toBeInTheDocument();
    });

    // lib-head .sub shows materials count (and optionally sections/last practiced)
    expect(within(container).getByText(/2 materials/)).toBeInTheDocument();
    expect(within(container).getByText("すべて")).toBeInTheDocument();

    // material cards
    expect(within(container).getByText("Stanford Commencement Address")).toBeInTheDocument();
    expect(within(container).getByText("The Power of Vulnerability")).toBeInTheDocument();

    // source tags: speech → スピーチ, ted → TED
    expect(within(container).getByText("スピーチ")).toBeInTheDocument();
    expect(within(container).getByText("TED")).toBeInTheDocument();

    // by line
    expect(within(container).getByText("Steve Jobs · Stanford University")).toBeInTheDocument();

    // real stats for mat-01: sections count and best score are in <b> elements inside .stats
    const statsBold = container.querySelectorAll(".mcard .stats b");
    const statsBoldTexts = Array.from(statsBold).map((el) => el.textContent);
    expect(statsBoldTexts).toContain("3");
    expect(statsBoldTexts).toContain("82");

    // honest empty for mat-02 (no sections, no attempts)
    expect(within(container).getByText("セクション未作成")).toBeInTheDocument();
    expect(within(container).getByText("未録音")).toBeInTheDocument();

    // add card at end
    expect(within(container).getByText("英文を貼り付けて新しい教材を作成")).toBeInTheDocument();

    // materials/new links exist
    const newLinks = within(container).getAllByRole("link", { name: /新しい教材/ });
    expect(newLinks.length).toBeGreaterThan(0);
  });

  it("library nav link has is-active class on library page", async () => {
    mockedApiGet.mockResolvedValue([]);

    const { container } = render(<LibraryPage />);

    await waitFor(() => {
      expect(within(container).getAllByText(/NativeTrace/).length).toBeGreaterThan(0);
    });

    const libraryLink = within(container).getByRole("link", {
      name: "ライブラリ",
    });
    expect(libraryLink).toHaveClass("is-active");

    const historyLink = within(container).getByRole("link", { name: "履歴" });
    expect(historyLink).not.toHaveClass("is-active");
  });

  it("filter counts reflect real material statuses", async () => {
    const materials = [
      {
        identifier: "mat-01",
        title: "Material With Attempts",
        source: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stats: {
          sectionSeriesCount: 2,
          recordingAttemptCount: 3,
          bestOverallScore: 75,
          overallScoreHistory: [70, 75],
          lastPracticedAt: new Date().toISOString(),
        } satisfies MaterialStatsDto,
      },
      {
        identifier: "mat-02",
        title: "Untouched Material",
        source: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stats: emptyStats,
      },
    ];

    mockedApiGet.mockResolvedValue(materials);

    const { container } = render(<LibraryPage />);

    await waitFor(() => {
      expect(within(container).getByText("教材ライブラリ")).toBeInTheDocument();
    });

    // すべて = 2
    const allPill = within(container).getByText("すべて");
    expect(allPill.closest(".fpill")?.querySelector(".fn")?.textContent).toBe("2");

    // 練習中 = 1 (mat-01: sections > 0, attempts > 0, score < 90)
    const practicingPill = within(container).getByText("練習中");
    expect(practicingPill.closest(".fpill")?.querySelector(".fn")?.textContent).toBe("1");

    // 未着手 = 1 (mat-02: no sections)
    const untouchedPill = within(container).getByText("未着手");
    expect(untouchedPill.closest(".fpill")?.querySelector(".fn")?.textContent).toBe("1");

    // 完了 = 0
    const completedPill = within(container).getByText("完了");
    expect(completedPill.closest(".fpill")?.querySelector(".fn")?.textContent).toBe("0");
  });
});
