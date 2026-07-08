"use client";

/**
 * 診断結果画面 — /diagnostic/{diagnosticSessionIdentifier}/result
 *
 * design-reference/screens/diagnostic.html 窓2 に完全合致。
 * M-DG-5: .two-col / .result-card / .stage-track / .subscale / .focus-grid / .focus-tile
 *          / .focus-pair / .fl[data-rank] / .prio / .prio--now / .prio--low
 *
 * 表示値は GET /api/v1/diagnostic-sessions/{id}/result から取得した
 * 実 DiagnosticResultDto から描画する（固定値禁止 / seed 直焼き禁止）。
 */

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { apiGet, isApiClientError } from "@/lib/api-client";
import type { DiagnosticResultDto, DiagnosticFocusSoundDto } from "@/lib/api-types";
import { getPhenomenonIconForContrast } from "@/lib/phenomenon";

type PageProps = {
  params: Promise<{ diagnosticSessionIdentifier: string }>;
};

// ---- Stage 表示 ----
const STAGE_LABELS: Record<DiagnosticResultDto["stage"], { label: string; description: string }> = {
  stageI: {
    label: "Stage I 明瞭性",
    description:
      "現在は Stage I。優先構成: 韻律 + 母音挿入 + 高FL分節（初中級向け切替 · REQ-113）。",
  },
  stageII: {
    label: "Stage II ネイティブ性",
    description: "現在は Stage II。優先構成: 韻律・connected speech（上級向け）。",
  },
};

// ---- priority → CSS クラス・ラベル ----
const priorityToCssClass = (priority: number): string => {
  if (priority >= 0.6) return "prio--now";
  if (priority >= 0.3) return "";
  return "prio--low";
};

const priorityToLabel = (priority: number): string => {
  if (priority >= 0.6) return "Now";
  if (priority >= 0.3) return "Next";
  return "Later";
};

// ---- functionalLoadRank → data-rank 属性 ----
const functionalLoadRankToDataRank = (rank: string): string => {
  const normalized = rank.toLowerCase();
  if (normalized === "max") return "max";
  if (normalized === "high") return "high";
  if (normalized === "mid") return "mid";
  return "low";
};

// ---- CEFR スコア → バー幅 % ----
const cefrScoreToBarWidth = (score: number): number => Math.min(100, Math.max(0, score));

// ---- 推奨訓練テキスト（functionalLoadRank + contrast から簡易生成） ----
const getRecommendedTraining = (sound: DiagnosticFocusSoundDto): string => {
  const rank = sound.functionalLoadRank.toLowerCase();
  const contrast = sound.contrast.toLowerCase();
  if (contrast.includes("epenthesis") || contrast.includes("‸")) {
    return "推奨: 音声先行提示 → 模倣（模倣時は挿入が減る）";
  }
  if (contrast.includes("stress") || contrast.includes("rhythm") || contrast.includes("prosod")) {
    return "推奨: シャドーイング + F0可視化（韻律は全帯域で効く）";
  }
  if (rank === "max" || rank === "high") {
    return "推奨: HVPT 識別 → 産出ドリル（知覚→産出）";
  }
  if (rank === "low") {
    return "検出済み・優先度低 — 伝達への実害が小さいため後回しで問題ありません";
  }
  return "推奨: ミニマルペア産出ドリル";
};

// ---- focus tile の `is-now` クラス判定 ----
const isFocusTileNow = (priority: number): boolean => priority >= 0.6;

// ---- Stage トラック用スコア（overall スコアが直接取れないので CEFR overall から推定） ----
const estimateStageIScore = (result: DiagnosticResultDto): { stageI: number; stageII: number } => {
  const overallScore = result.cefrSubscales.overall?.score ?? 50;
  const prosodicScore = result.cefrSubscales.prosodic?.score ?? 50;
  const stageI = Math.min(100, overallScore);
  const stageII = result.stage === "stageII" ? Math.min(100, prosodicScore) : 0;
  return { stageI, stageII };
};

// ---- Component ----

export default function DiagnosticResultPage({ params }: PageProps) {
  const { diagnosticSessionIdentifier } = use(params);

  const [result, setResult] = useState<DiagnosticResultDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<DiagnosticResultDto>(`/api/v1/diagnostic-sessions/${diagnosticSessionIdentifier}/result`)
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((error: unknown) => {
        setLoadError(isApiClientError(error) ? error.message : "診断結果の取得に失敗しました");
        setLoading(false);
      });
  }, [diagnosticSessionIdentifier]);

  if (loading) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-tertiary)" }}>
        結果を読み込み中...
      </div>
    );
  }

  if (loadError || !result) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          color: "var(--sev-critical-text)",
        }}
      >
        <p>{loadError ?? "診断結果が見つかりません"}</p>
        <Link href="/" className="btn btn--primary" style={{ marginTop: "16px" }}>
          ライブラリへ
        </Link>
      </div>
    );
  }

  const stageInfo = STAGE_LABELS[result.stage];
  const stageScores = estimateStageIScore(result);

  return (
    <div>
      {/* app-top */}
      <div className="app-top">
        <div className="app-brand">
          NativeTrace <span className="ipa">/ˈneɪtɪv treɪs/</span>
        </div>
        <div className="crumb" style={{ marginLeft: "16px" }}>
          <b>診断結果</b>
          <span className="sep">·</span>
          <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
            弱点プロファイル初期化
          </span>
        </div>
        <Link href="/" className="btn btn--sm btn--ghost" style={{ marginLeft: "auto" }}>
          ライブラリへ
        </Link>
      </div>

      <div style={{ padding: "var(--sp-6) var(--sp-8)" }}>
        {/* Stage 判定 + CEFR 2列 */}
        <div className="two-col" style={{ marginBottom: "var(--sp-6)" }}>
          {/* Stage 判定 */}
          <div className="result-card">
            <div className="kbd-label" style={{ marginBottom: "14px" }}>
              Stage 判定
            </div>
            <div className="stage-track">
              <div className="stage-seg">
                <div className="sl">
                  <b>Stage I 明瞭性</b>
                  <span>{stageScores.stageI}%</span>
                </div>
                <div className="rail2">
                  <i style={{ width: `${stageScores.stageI}%` }} />
                </div>
              </div>
              <div className="stage-dot" />
              <div className="stage-seg stage-seg--native">
                <div className="sl">
                  <b>Stage II ネイティブ性</b>
                  <span>{result.stage === "stageII" ? `${stageScores.stageII}%` : "—"}</span>
                </div>
                <div className="rail2">
                  <i style={{ width: `${stageScores.stageII}%` }} />
                </div>
              </div>
            </div>
            <p className="note" style={{ margin: "16px 0 0", fontSize: "var(--text-xs)" }}>
              現在は <b style={{ color: "var(--axis-intel-text)" }}>{stageInfo.label}</b>。
              {stageInfo.description}
            </p>
          </div>

          {/* CEFR 3下位尺度 */}
          <div className="result-card">
            <div className="kbd-label" style={{ marginBottom: "14px" }}>
              CEFR 3下位尺度 初期値
            </div>
            {result.cefrSubscales.overall && (
              <div className="subscale">
                <span className="ss-k">
                  <b>全体的音韻統制</b>
                </span>
                <span className="sbar">
                  <i
                    style={{ width: `${cefrScoreToBarWidth(result.cefrSubscales.overall.score)}%` }}
                  />
                </span>
                <span className="srn mono">{result.cefrSubscales.overall.score}</span>
                <span className="ss-cefr">{result.cefrSubscales.overall.band}</span>
              </div>
            )}
            {result.cefrSubscales.segmental && (
              <div className="subscale">
                <span className="ss-k">
                  <b>分節音の調音</b>
                </span>
                <span className="sbar">
                  <i
                    style={{
                      width: `${cefrScoreToBarWidth(result.cefrSubscales.segmental.score)}%`,
                      background: "var(--sev-major)",
                    }}
                  />
                </span>
                <span className="srn mono">{result.cefrSubscales.segmental.score}</span>
                <span className="ss-cefr">{result.cefrSubscales.segmental.band}</span>
              </div>
            )}
            {result.cefrSubscales.prosodic && (
              <div className="subscale">
                <span className="ss-k">
                  <b>韻律</b>
                </span>
                <span className="sbar">
                  <i
                    style={{
                      width: `${cefrScoreToBarWidth(result.cefrSubscales.prosodic.score)}%`,
                      background: "var(--sev-major)",
                    }}
                  />
                </span>
                <span className="srn mono">{result.cefrSubscales.prosodic.score}</span>
                <span className="ss-cefr">{result.cefrSubscales.prosodic.band}</span>
              </div>
            )}
            {!result.cefrSubscales.overall &&
              !result.cefrSubscales.segmental &&
              !result.cefrSubscales.prosodic && (
                <p
                  style={{
                    margin: 0,
                    fontSize: "var(--text-xs)",
                    color: "var(--text-faint)",
                  }}
                >
                  CEFR 下位尺度は利用できません（解析エンジンがサポートしていない場合）。
                </p>
              )}
          </div>
        </div>

        {/* focus sounds */}
        <div className="kbd-label" style={{ marginBottom: "10px" }}>
          生成された focus sounds（FL × 頻度 × 習熟度）と推奨訓練
        </div>
        <div className="focus-grid">
          {result.focusSounds.map((sound) => {
            const priorityClass = priorityToCssClass(sound.priority);
            const priorityLabel = priorityToLabel(sound.priority);
            const dataRank = functionalLoadRankToDataRank(sound.functionalLoadRank);
            const isNow = isFocusTileNow(sound.priority);
            const phenomenonIcon = getPhenomenonIconForContrast(sound.contrast);
            const recommendedTraining = getRecommendedTraining(sound);

            // contrast 文字列から / / 区切りペアを分割
            const contrastParts = sound.contrast.includes("·")
              ? sound.contrast.split("·").map((part) => part.trim())
              : sound.contrast.includes("/")
                ? sound.contrast
                    .split("/")
                    .filter((part) => part.length > 0)
                    .map((part) => `/${part}/`)
                : null;

            return (
              <div
                key={sound.catalogId}
                className={`focus-tile${isNow ? " is-now" : ""}`}
                style={priorityClass === "prio--low" ? { opacity: 0.75 } : undefined}
              >
                <div className="focus-meta">
                  {contrastParts && contrastParts.length >= 2 ? (
                    <span className="focus-pair">
                      {contrastParts[0]}
                      <span className="vs">·</span>
                      {contrastParts[1]}
                    </span>
                  ) : (
                    <span
                      className="focus-pair"
                      style={{ fontSize: "var(--text-lg)", alignSelf: "center" }}
                    >
                      {sound.contrast}
                    </span>
                  )}
                  <span className={`prio ${priorityClass}`.trim()}>{priorityLabel}</span>
                </div>
                <div className="focus-meta">
                  <span className="fl" data-rank={dataRank}>
                    <span className="fd">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    FL {sound.functionalLoadRank}
                  </span>
                </div>
                <div className="focus-why">{recommendedTraining}</div>
                <div className="focus-foot">
                  <span className="phen">
                    <span className="pi">{phenomenonIcon}</span>
                    {sound.contrast}
                  </span>
                  {isNow ? (
                    <button className="btn btn--sm btn--primary" type="button">
                      開始 →
                    </button>
                  ) : priorityClass === "prio--low" ? (
                    <button className="btn btn--sm btn--ghost" type="button">
                      後で
                    </button>
                  ) : (
                    <button className="btn btn--sm btn--secondary" type="button">
                      予約
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {result.focusSounds.length === 0 && (
            <p
              style={{
                gridColumn: "1 / -1",
                fontSize: "var(--text-xs)",
                color: "var(--text-faint)",
                margin: 0,
              }}
            >
              focus sounds
              が生成されませんでした。診断録音の解析データが不足している可能性があります。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
