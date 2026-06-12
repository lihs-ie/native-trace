"use client";

import { useState } from "react";
import type { EngineFindingDto, EngineResultDto } from "@/lib/api-types";
import { HighlightedWorkspaceText } from "./HighlightedWorkspaceText";
import { GopHeatmap } from "./GopHeatmap";
import { F0Chart } from "./F0Chart";
import { DetailPanelV2 } from "./DetailPanelV2";
import { RailV2 } from "./RailV2";

type ViewMode = "highlight" | "gopmap" | "f0";

type WorkspaceResultV2Props = {
  bodyText: string;
  engineResult: EngineResultDto;
  sectionIdentifier: string;
};

/**
 * ワークスペース v2 結果ビュー (M-WS / workspace-v2.html)
 *
 * `.ws2` 2 カラム (main + `.ws2-rail` 332px) を React 化する。
 * - `.eng-summary`: エンジンサマリー
 * - `view-toggle` `.sp-chip`: 指摘ハイライト / GOP ヒートマップ / F0 韻律 切替
 * - 本文 passage: `.mk mk--{severity}` + `.hl-ico`
 * - `.gopmap`: GOP ヒートマップ
 * - 詳細パネル `.panel`: DetailPanelV2
 * - dock: `.ab-srcs` / player / `.speed`
 */
export const WorkspaceResultV2 = ({
  bodyText,
  engineResult,
  sectionIdentifier,
}: WorkspaceResultV2Props) => {
  const [viewMode, setViewMode] = useState<ViewMode>("highlight");
  const [selectedFinding, setSelectedFinding] = useState<EngineFindingDto | null>(null);
  const [activeAudioSource, setActiveAudioSource] = useState<"self" | "model" | "golden">("self");
  const [playSpeed, setPlaySpeed] = useState<0.5 | 0.85 | 1.0>(0.85);

  const findings = engineResult.findings;

  return (
    <div className="ws2">
      {/* main column */}
      <div className="ws2-main">
        {/* engine summary (REQ-107b) */}
        <div className="eng-summary">
          <span
            className="eng-dot"
            style={{
              background:
                engineResult.engineKind === "cloud"
                  ? "var(--engine-openai)"
                  : "var(--engine-rust)",
              marginTop: "5px",
            }}
          />
          <div>
            {engineResult.engineSummaryMessageJa ? (
              <>
                {engineResult.engineSummaryMessageJa}
                {engineResult.modelName && (
                  <span
                    className="mono"
                    style={{ color: "var(--text-faint)", fontSize: "var(--text-2xs)" }}
                  >
                    　{engineResult.modelName}
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: "var(--text-faint)", fontSize: "var(--text-xs)" }}>
                この解析エンジンではサマリーメッセージが未提供です。
              </span>
            )}
          </div>
        </div>

        {/* view toggle */}
        <div className="view-toggle">
          <button
            className={`sp-chip${viewMode === "highlight" ? " is-active" : ""}`}
            type="button"
            onClick={() => setViewMode("highlight")}
          >
            指摘ハイライト
          </button>
          <button
            className={`sp-chip${viewMode === "gopmap" ? " is-active" : ""}`}
            type="button"
            onClick={() => setViewMode("gopmap")}
          >
            GOP ヒートマップ
          </button>
          <button
            className={`sp-chip${viewMode === "f0" ? " is-active" : ""}`}
            type="button"
            onClick={() => setViewMode("f0")}
          >
            F0 韻律
          </button>
        </div>

        {/* passage — 指摘ハイライトビュー */}
        {viewMode === "highlight" && (
          <HighlightedWorkspaceText
            bodyText={bodyText}
            findings={findings}
            selectedFindingIdentifier={selectedFinding?.finding ?? null}
            onSelect={setSelectedFinding}
            showMarks
            showPhenomenonIcons
          />
        )}

        {/* GOP ヒートマップビュー */}
        {viewMode === "gopmap" && (
          <div className="gop-strip">
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                color: "var(--text-faint)",
                marginBottom: "10px",
              }}
            >
              全音素 GOP — 閾値未満も表示 (REQ-107c)
            </div>
            <GopHeatmap entries={engineResult.perPhonemeGop ?? []} />
          </div>
        )}

        {/* F0 韻律ビュー */}
        {viewMode === "f0" && <F0Chart prosody={engineResult.prosody ?? null} />}

        {/* 詳細パネル */}
        {selectedFinding && (
          <DetailPanelV2
            finding={selectedFinding}
            sectionIdentifier={sectionIdentifier}
            onClose={() => setSelectedFinding(null)}
          />
        )}
      </div>

      {/* rail */}
      <RailV2 engineResult={engineResult} />

      {/* dock (A/B sources + speed) — full-width row under the 2-column grid */}
      <div
        style={{
          gridColumn: "1 / -1",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-1)",
          padding: "var(--sp-3) var(--sp-6)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
        }}
      >
        <div className="ab-srcs">
          <button
            className={`ab-src${activeAudioSource === "self" ? " is-active" : ""}`}
            type="button"
            onClick={() => setActiveAudioSource("self")}
          >
            <span className="sd2" style={{ background: "var(--src-self)" }} />
            自分
          </button>
          <button
            className={`ab-src${activeAudioSource === "model" ? " is-active" : ""}`}
            type="button"
            onClick={() => setActiveAudioSource("model")}
          >
            <span className="sd2" style={{ background: "var(--src-model)" }} />
            お手本
          </button>
          <button
            className="ab-src"
            type="button"
            disabled
            title="Golden speaker — GPU 必要 / 準備中"
          >
            <span className="sd2" style={{ background: "var(--src-golden)" }} />
            Golden
          </button>
        </div>

        <div className="speed">
          {([0.5, 0.85, 1.0] as const).map((speed) => (
            <button
              key={speed}
              className={`sp-chip${playSpeed === speed ? " is-active" : ""}`}
              type="button"
              onClick={() => setPlaySpeed(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        {activeAudioSource === "golden" && (
          <span
            className="gs-gate"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-2xs)",
              color: "var(--text-faint)",
            }}
          >
            GPU 必要 / 準備中
          </span>
        )}
      </div>
    </div>
  );
};
