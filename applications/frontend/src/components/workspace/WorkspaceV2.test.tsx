/**
 * v2 コンポーネント render テスト (M-WS)
 *
 * 実 DTO 形のデータを渡し、workspace-v2.html の各セレクタが存在することを assert する。
 * Done When:
 * - `.fb3-row--what` / `--why` / `--fix` が描画される
 * - `.nbest-row.is-top` が描画される
 * - `.conf[data-level]` が描画される
 * - `.hedge` / `.fold` が描画される
 * - `.dismiss-btn` が描画される
 * - `.mini-axis .ma` が描画される
 * - `.subscale` が描画される
 * - `.gopmap .gp` が描画される
 * - `.ab-src.is-active` が描画される
 * - `.phen .pe` が描画される
 * - 本文 `.hl-ico` が描画される
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EngineFindingDto, EngineResultDto } from "@/lib/api-types";
import { DetailPanelV2 } from "./DetailPanelV2";
import { GopHeatmap } from "./GopHeatmap";
import { RailV2 } from "./RailV2";
import { WorkspaceResultV2 } from "./WorkspaceResultV2";

// ---- テスト用 DTO ファクトリ ----

const buildFinding = (
  overrides: Partial<EngineFindingDto> = {},
): EngineFindingDto => ({
  finding: "finding-01",
  phenomenon: "substitution",
  gop: -13.8,
  severity: "critical",
  category: "accuracy",
  textRange: { startChar: 0, endChar: 5 },
  audioRange: { startMilliseconds: 5920, endMilliseconds: 6380 },
  expected: { text: "world", ipa: "/wɝld/" },
  detected: { text: "warudo", ipa: "/wɝɾɯdo/" },
  messageJa: "「world」語末の dark L が弾き音になっています。",
  messageEn: null,
  scoreImpact: -6,
  confidence: 0.91,
  detectedTopCandidate: "[ɾ]",
  nBest: [
    { phoneme: "[ɾ]", confidence: 0.64 },
    { phoneme: "[l]", confidence: 0.22 },
    { phoneme: "[ɫ]", confidence: 0.14 },
  ],
  matchesL1Pattern: true,
  functionalLoad: "max",
  catalogId: "l-r-contrast",
  wordPair: null,
  expectedPronunciation: null,
  insertedVowel: null,
  feedbackLayers: {
    whatJa: "「world」語末の dark L が弾き音 [ɾ] になっています。",
    whyJa: "日本語に語末の /l/ は存在せず、カタカナ語の音型が呼び出されています。",
    howJa: "語末は母音を足さずに、舌先を歯茎に当てて止めるだけで終えます。",
  },
  dismissed: false,
  ...overrides,
});

const buildLowConfidenceFinding = (): EngineFindingDto =>
  buildFinding({
    finding: "finding-02",
    phenomenon: "weakForm",
    severity: "minor",
    confidence: 0.35,
    messageJa: "弱形の実現が不十分",
    feedbackLayers: null,
    nBest: null,
    functionalLoad: "low",
  });

const buildEngineResult = (
  overrides: Partial<EngineResultDto> = {},
): EngineResultDto => ({
  result: "result-01",
  engineKind: "oss_worker",
  engineName: "OSS Worker",
  modelName: "kaldi-v1",
  scores: {
    overall: 72,
    accuracy: 68,
    nativeLikeness: 71,
    pronunciation: 70,
    connectedSpeech: 65,
    prosody: 60,
    intelligibility: 86,
    cefrOverall: { score: 64, band: "B2" },
    cefrSegmental: { score: 58, band: "B1+" },
    cefrProsodic: { score: 46, band: "B1" },
  },
  counts: { critical: 1, major: 2, minor: 3, suggestion: 0 },
  findings: [buildFinding(), buildLowConfidenceFinding()],
  engineSummaryMessageJa: "高 FL の /l/-/r/ 置換が 3 箇所あります。",
  perPhonemeGop: [
    { word: "world", phoneme: "w", gop: -2.1, heat: 0 },
    { word: "world", phoneme: "ɝ", gop: -8.3, heat: 2 },
    { word: "world", phoneme: "l", gop: -18.5, heat: 4 },
    { word: "world", phoneme: "d", gop: -4.2, heat: 1 },
  ],
  focusSounds: [
    {
      pair: "/l/·/r/",
      phenomenon: "substitution",
      functionalLoad: "max",
      occurrences: 3,
      priority: "now",
      reasonJa: "高 FL の音素対立",
      catalogId: "l-r-contrast",
    },
  ],
  prosody: {
    f0Contour: {
      timesMs: [0, 50, 100, 150, 200],
      valuesHz: [120, 135, 150, 140, 0],
    },
    wordStress: null,
    rhythmNpvi: null,
    referenceNpvi: null,
    weakFormRate: null,
  },
  ...overrides,
});

// ---- DetailPanelV2 テスト ----

describe("DetailPanelV2", () => {
  it("finding=null のとき空状態メッセージを描画する", () => {
    render(
      <DetailPanelV2 finding={null} sectionIdentifier="sec-01" onClose={() => undefined} />,
    );
    expect(
      screen.getByText("本文のハイライトをクリックすると、ここに詳細が表示されます。"),
    ).toBeInTheDocument();
  });

  it("fb3-row--what / --why / --fix が描画される", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding()}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".fb3-row--what")).toBeInTheDocument();
    expect(container.querySelector(".fb3-row--why")).toBeInTheDocument();
    expect(container.querySelector(".fb3-row--fix")).toBeInTheDocument();
  });

  it("nbest-row.is-top が描画される", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding()}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".nbest-row.is-top")).toBeInTheDocument();
  });

  it("conf[data-level] が描画される", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding()}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    const confElement = container.querySelector(".conf[data-level]");
    expect(confElement).toBeInTheDocument();
    expect(confElement?.getAttribute("data-level")).toBe("high");
  });

  it("dismiss-btn が描画される", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding()}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".dismiss-btn")).toBeInTheDocument();
  });

  it("phen .pe が描画される", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding()}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".phen .pe")).toBeInTheDocument();
  });

  it("dismissed=true のとき finding--dismissed クラスが付く", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding({ dismissed: true })}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".finding--dismissed")).toBeInTheDocument();
  });

  it("proj-badge が matchesL1Pattern=true のとき描画される", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding({ matchesL1Pattern: true })}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".proj-badge")).toBeInTheDocument();
  });

  it("feedbackLayers=null のとき messageJa fallback が描画される", () => {
    const { container } = render(
      <DetailPanelV2
        finding={buildFinding({ feedbackLayers: null })}
        sectionIdentifier="sec-01"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".panel-jp")).toBeInTheDocument();
  });
});

// ---- GopHeatmap テスト ----

describe("GopHeatmap", () => {
  it("entries が空のとき空状態を描画する", () => {
    render(<GopHeatmap entries={[]} />);
    expect(screen.getByText("GOP データなし")).toBeInTheDocument();
  });

  it(".gopmap .gp が音素数ぶん描画される", () => {
    const entries = [
      { word: "world", phoneme: "w", gop: -2.1, heat: 0 },
      { word: "world", phoneme: "ɝ", gop: -8.3, heat: 2 },
      { word: "world", phoneme: "l", gop: -18.5, heat: 4 },
    ];
    const { container } = render(<GopHeatmap entries={entries} />);
    const gpElements = container.querySelectorAll(".gopmap .gp");
    expect(gpElements).toHaveLength(3);
  });

  it(".gp に data-h 属性が設定される", () => {
    const entries = [{ word: "the", phoneme: "ð", gop: -5.0, heat: 2 }];
    const { container } = render(<GopHeatmap entries={entries} />);
    const gp = container.querySelector(".gp");
    expect(gp?.getAttribute("data-h")).toBe("2");
  });
});

// ---- RailV2 テスト ----

describe("RailV2", () => {
  it("mini-axis .ma が描画される", () => {
    const { container } = render(<RailV2 engineResult={buildEngineResult()} />);
    const maElements = container.querySelectorAll(".mini-axis .ma");
    expect(maElements.length).toBeGreaterThanOrEqual(2);
  });

  it("subscale が描画される（CEFR 3下位尺度）", () => {
    const { container } = render(<RailV2 engineResult={buildEngineResult()} />);
    const subscaleElements = container.querySelectorAll(".subscale");
    expect(subscaleElements.length).toBeGreaterThanOrEqual(1);
  });

  it("focus-row が focusSounds から描画される", () => {
    const { container } = render(<RailV2 engineResult={buildEngineResult()} />);
    expect(container.querySelector(".focus-row")).toBeInTheDocument();
  });

  it("低信頼 finding は .fold / .hedge として描画される", () => {
    const { container } = render(<RailV2 engineResult={buildEngineResult()} />);
    expect(container.querySelector(".fold")).toBeInTheDocument();
    expect(container.querySelector(".hedge")).toBeInTheDocument();
  });

  it("intelligibility=null のとき accuracy スコアで代替する", () => {
    const result = buildEngineResult({
      scores: {
        ...buildEngineResult().scores,
        intelligibility: null,
      },
    });
    const { container } = render(<RailV2 engineResult={result} />);
    const maElements = container.querySelectorAll(".mini-axis .ma");
    expect(maElements.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- WorkspaceResultV2 統合テスト ----

describe("WorkspaceResultV2", () => {
  it("ws2 コンテナが描画される", () => {
    const { container } = render(
      <WorkspaceResultV2
        bodyText="I am honored to be with you today."
        engineResult={buildEngineResult()}
        sectionIdentifier="sec-01"
      />,
    );
    expect(container.querySelector(".ws2")).toBeInTheDocument();
  });

  it("eng-summary が描画される", () => {
    const { container } = render(
      <WorkspaceResultV2
        bodyText="I am honored to be with you today."
        engineResult={buildEngineResult()}
        sectionIdentifier="sec-01"
      />,
    );
    expect(container.querySelector(".eng-summary")).toBeInTheDocument();
  });

  it("view-toggle .sp-chip が描画される", () => {
    const { container } = render(
      <WorkspaceResultV2
        bodyText="I am honored to be with you today."
        engineResult={buildEngineResult()}
        sectionIdentifier="sec-01"
      />,
    );
    const chips = container.querySelectorAll(".view-toggle .sp-chip");
    expect(chips.length).toBe(3);
  });

  it(".ab-src.is-active が描画される", () => {
    const { container } = render(
      <WorkspaceResultV2
        bodyText="I am honored to be with you today."
        engineResult={buildEngineResult()}
        sectionIdentifier="sec-01"
      />,
    );
    expect(container.querySelector(".ab-src.is-active")).toBeInTheDocument();
  });

  it("本文 .hl-ico が finding の phenomenon アイコンとして描画される", () => {
    const { container } = render(
      <WorkspaceResultV2
        bodyText="world"
        engineResult={buildEngineResult()}
        sectionIdentifier="sec-01"
      />,
    );
    // findings[0] は textRange {0,5} で bodyText "world" に重なる
    expect(container.querySelector(".hl-ico")).toBeInTheDocument();
  });

  it("engineSummaryMessageJa=null のとき空状態メッセージが描画される", () => {
    const result = buildEngineResult({ engineSummaryMessageJa: null });
    render(
      <WorkspaceResultV2
        bodyText="world"
        engineResult={result}
        sectionIdentifier="sec-01"
      />,
    );
    expect(
      screen.getByText("この解析エンジンではサマリーメッセージが未提供です。"),
    ).toBeInTheDocument();
  });
});
