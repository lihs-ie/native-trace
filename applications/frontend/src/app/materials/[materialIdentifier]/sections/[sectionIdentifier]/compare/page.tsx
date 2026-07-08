"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, isApiClientError } from "@/lib/api-client";
import type { EngineFindingDto, EngineResultDto, WorkspaceDto } from "@/lib/api-types";
import { toSeverityClass, SEVERITY_DISPLAY_LABELS } from "@/lib/severity";
import { deriveEngineAgreement } from "@/lib/engine-agreement";
import type { AgreementItem } from "@/lib/engine-agreement";
import { engineColorVariable, engineDisplayName } from "@/lib/engine-display";
import { Gauge, ScoreRows, HighlightedWorkspaceText } from "@/components/workspace";
import { AppBar } from "@/components/chrome/AppBar";
import { formatDateTimeMinutes } from "@/lib/format-time";

type PageProps = {
  params: Promise<{ materialIdentifier: string; sectionIdentifier: string }>;
};

// 静的なプレイヤー波形用の高さ配列（比較画面用）
const COMPARE_WAVE_HEIGHTS = [40, 75, 55, 85, 45, 65, 50, 80, 38, 62, 48, 70];

// engineKind から設計ラベルへの写像（design compare.html 準拠）
// oss_worker は engine-display.ts の canonical 表示名 "OSS Worker" ではなく
// このページ固有の "Rust OSS" を維持する（W33: 現行値不一致のためローカル残置）。
const ENGINE_KIND_LABELS: Record<EngineResultDto["engineKind"], string> = {
  cloud: engineDisplayName("cloud"),
  oss_worker: "Rust OSS",
};

type SeverityBadgeProps = {
  severity: EngineFindingDto["severity"];
  short?: boolean;
};

function SeverityBadge({ severity, short = false }: SeverityBadgeProps) {
  const severityClass = toSeverityClass(severity);
  const label = short
    ? severityClass.charAt(0).toUpperCase()
    : SEVERITY_DISPLAY_LABELS[severityClass];
  return (
    <span className={`badge badge--${severityClass}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

type AgreementColumnProps = {
  title: string;
  swatchColors: string[];
  items: AgreementItem[];
  emptyMessage: string;
  note: string;
};

function AgreementColumn({ title, swatchColors, items, emptyMessage, note }: AgreementColumnProps) {
  return (
    <div className="agree-col">
      <div className="ac-lbl">
        <span className="swatch">
          {swatchColors.map((color, index) => (
            <i key={index} style={{ background: color }} />
          ))}
        </span>
        {title}
        <span className="n">{items.length}</span>
      </div>
      <div className="ac-items">
        {items.length === 0 ? (
          <div className="detail-empty">{emptyMessage}</div>
        ) : (
          items.map((item, index) => (
            <div key={index} className="ac-item">
              <span className="w">{item.word}</span>
              <span className="sevs">
                {item.cloudSeverity !== null && (
                  <SeverityBadge severity={item.cloudSeverity} short />
                )}
                {item.ossSeverity !== null && <SeverityBadge severity={item.ossSeverity} short />}
                {item.severity !== null && <SeverityBadge severity={item.severity} />}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="note-mini">{note}</div>
    </div>
  );
}

type EngineColumnProps = {
  engineResult: EngineResultDto;
  bodyText: string;
  isOss: boolean;
};

function EngineColumn({ engineResult, bodyText, isOss }: EngineColumnProps) {
  const [selectedFinding, setSelectedFinding] = useState<EngineFindingDto | null>(null);
  const dotColor = engineColorVariable(engineResult.engineKind);

  return (
    <div className={`ecol${isOss ? " ecol--oss" : ""}`}>
      <div className="ecol-head">
        <span className="nm">
          <span className="eng-dot" style={{ background: dotColor }} />
          {ENGINE_KIND_LABELS[engineResult.engineKind]}
        </span>
        <span className="meta">{engineResult.modelName ?? engineResult.engineName}</span>
      </div>
      <div className="ecol-score">
        <Gauge overall={engineResult.scores.overall} />
        <ScoreRows scores={engineResult.scores} />
      </div>
      <div className="ecol-pass">
        <HighlightedWorkspaceText
          bodyText={bodyText}
          findings={engineResult.findings}
          selectedFindingIdentifier={selectedFinding?.finding ?? null}
          onSelect={setSelectedFinding}
          showMarks
        />
      </div>
      <div className="ecol-sev">
        {(["critical", "major", "minor", "suggestion"] as const).map((sev) => {
          const cssClass = toSeverityClass(sev);
          const count = engineResult.counts[sev];
          const label = SEVERITY_DISPLAY_LABELS[cssClass];
          return (
            <span key={sev} className="sevpill">
              <span className="dot" style={{ background: `var(--sev-${cssClass})` }} />
              {count} {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function ComparePage({ params }: PageProps) {
  const { materialIdentifier, sectionIdentifier } = use(params);

  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    apiGet<WorkspaceDto>(`/api/v1/sections/${sectionIdentifier}/workspace`)
      .then((data) => {
        setWorkspace(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(
          isApiClientError(error) ? error.message : "ワークスペースの取得に失敗しました",
        );
      });
  }, [sectionIdentifier]);

  const cloudResult = workspace?.resultsByEngine.find((r) => r.engineKind === "cloud");
  const ossResult = workspace?.resultsByEngine.find((r) => r.engineKind === "oss_worker");
  const engineCount = workspace?.resultsByEngine.length ?? 0;

  const latestAttempt = workspace?.recordingAttempts.length
    ? workspace.recordingAttempts[workspace.recordingAttempts.length - 1]
    : null;
  const audioUrl = latestAttempt
    ? `/api/v1/recording-attempts/${latestAttempt.identifier}/audio`
    : null;

  const agreement = workspace !== null ? deriveEngineAgreement(cloudResult, ossResult) : null;

  const totalFindings =
    (agreement?.both.length ?? 0) +
    (agreement?.cloudOnly.length ?? 0) +
    (agreement?.ossWorkerOnly.length ?? 0);
  const cloudTotal = (agreement?.both.length ?? 0) + (agreement?.cloudOnly.length ?? 0);
  const ossTotal = (agreement?.both.length ?? 0) + (agreement?.ossWorkerOnly.length ?? 0);

  const sectionTitle = workspace?.section ? `§${workspace.section.version}` : sectionIdentifier;

  const crumb = (
    <>
      <span>{materialIdentifier}</span>
      <span className="sep">›</span>
      <b>{sectionTitle}</b>
      <span className="sep">·</span>
      <span>比較</span>
    </>
  );

  if (loadError) {
    return (
      <div>
        <AppBar crumb={crumb} />
        <div
          style={{
            padding: "var(--sp-8)",
            color: "var(--sev-critical-text)",
            fontSize: "var(--text-sm)",
          }}
        >
          {loadError}
        </div>
      </div>
    );
  }

  if (workspace === null) {
    return (
      <div>
        <AppBar crumb={crumb} />
        <div
          style={{
            padding: "var(--sp-8)",
            color: "var(--text-faint)",
            fontSize: "var(--text-sm)",
          }}
        >
          読み込み中...
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppBar crumb={crumb} />

      {/* compare header bar */}
      <div className="cmp-bar">
        <span className="mode">
          <span className="eng-dot" style={{ background: "var(--engine-openai)" }} />
          <span
            className="eng-dot"
            style={{ background: "var(--engine-rust)", marginLeft: "-4px" }}
          />
          比較モード
        </span>
        {latestAttempt && (
          <span className="att">{formatDateTimeMinutes(latestAttempt.createdAt)}</span>
        )}
        {audioUrl && (
          <div
            className="player"
            style={{ flex: 1, minWidth: "240px", maxWidth: "460px", marginLeft: "auto" }}
          >
            <button
              className="pp"
              type="button"
              aria-label={isPlaying ? "一時停止" : "再生"}
              onClick={() => {
                setIsPlaying((prev) => !prev);
              }}
            >
              {isPlaying ? "❚❚" : "▸"}
            </button>
            <div className="wave">
              {COMPARE_WAVE_HEIGHTS.map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} className={index < 3 ? "on" : ""} />
              ))}
            </div>
            <span className="tt">0:00</span>
          </div>
        )}
        <Link
          href={`/materials/${materialIdentifier}/sections/${sectionIdentifier}`}
          className="btn btn--sm btn--ghost"
          style={{ marginLeft: audioUrl ? undefined : "auto" }}
        >
          ワークスペース
        </Link>
      </div>

      {/* main compare content */}
      <div className="cmp-wrap">
        {engineCount === 0 && (
          <div className="detail-empty" style={{ marginBottom: "var(--sp-5)" }}>
            解析結果がありません。ワークスペースで録音・解析を行ってください。
          </div>
        )}

        {engineCount === 1 && (
          <div className="callout" style={{ marginBottom: "var(--sp-5)" }}>
            <span className="ci">i</span>
            比較にはエンジン 2 つの結果が必要です。ワークスペースで「⊕
            追加解析」を実行してください。
          </div>
        )}

        {/* 2 columns or 1 column fallback */}
        <div className={engineCount >= 2 ? "cmp2" : ""}>
          {cloudResult && (
            <EngineColumn
              engineResult={cloudResult}
              bodyText={workspace.section.bodyText}
              isOss={false}
            />
          )}
          {ossResult && (
            <EngineColumn engineResult={ossResult} bodyText={workspace.section.bodyText} isOss />
          )}
        </div>

        {/* agreement strip — only when both engines present */}
        {engineCount >= 2 && agreement !== null && (
          <div className="agree">
            <div className="agree-h">
              指摘の一致と差分 — {cloudTotal} / {ossTotal} findings
            </div>
            <div className="agree-grid">
              <AgreementColumn
                title="両エンジン一致"
                swatchColors={["var(--engine-openai)", "var(--engine-rust)"]}
                items={agreement.both}
                emptyMessage="両エンジンが一致した指摘はありません"
                note="同じ箇所でも重大度が割れることがあります。"
              />
              <AgreementColumn
                title="OpenAI のみ"
                swatchColors={["var(--engine-openai)"]}
                items={agreement.cloudOnly}
                emptyMessage="OpenAI 固有の指摘はありません"
                note="母音と弱形の微差は OpenAI のみが検出することがあります。"
              />
              <AgreementColumn
                title="Rust のみ"
                swatchColors={["var(--engine-rust)"]}
                items={agreement.ossWorkerOnly}
                emptyMessage="Rust 固有の指摘はありません"
                note="結果は統合せずエンジン別に保持します。"
              />
            </div>
            {totalFindings > 0 && (
              <div className="note-mini" style={{ marginTop: "var(--sp-3)" }}>
                findings 数: 両一致 {agreement.both.length} / OpenAI のみ{" "}
                {agreement.cloudOnly.length} / Rust のみ {agreement.ossWorkerOnly.length}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
