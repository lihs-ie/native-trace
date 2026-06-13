"use client";

/**
 * 進捗ダッシュボード — /progress
 *
 * design-reference/screens/progress.html に完全合致。
 * M-PG-4/5/6: 実スナップショット駆動・honest empty・scope-note 常時表示。
 *
 * 全表示値は GET /api/v1/progress が返した実 ProgressDto から描画する。
 * 架空数値（184min / 26h / 12日等）は一切使用しない。
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, isApiClientError } from "@/lib/api-client";
import type { ProgressDto, ProgressSnapshotDto } from "@/lib/api-types";

// ---- CEFR レーダー SVG 計算 ----
// viewBox: 0 0 220 190
// 頂点配置: overall=上 (110, 23...), segmental=右下 (172.4, 131), prosodic=左下 (47.6, 131)
// progress.html の ref 多角形（100%=外枠）から逆算:
// outer ref: 110,23 → 172.4,131 → 47.6,131  (= 100%)
// 中心: cx=110, cy=95 (重心)
// 各頂点は中心からの距離でスケールする

const RADAR_CENTER = { x: 110, y: 95 };
const RADAR_VERTICES_100 = [
  { x: 110, y: 23 }, // overall (上)
  { x: 172.4, y: 131 }, // segmental (右下)
  { x: 47.6, y: 131 }, // prosodic (左下)
];

/**
 * スコア (0–100) に比例した頂点座標を返す。
 * progress.html の ref 多角形が 100% として、中心から各頂点への比率でスケール。
 */
const radarPoint = (vertexIndex: number, score: number): { x: number; y: number } => {
  const vertex = RADAR_VERTICES_100[vertexIndex]!;
  const ratio = Math.min(100, Math.max(0, score)) / 100;
  return {
    x: RADAR_CENTER.x + (vertex.x - RADAR_CENTER.x) * ratio,
    y: RADAR_CENTER.y + (vertex.y - RADAR_CENTER.y) * ratio,
  };
};

const toPolygonPoints = (
  overallScore: number,
  segmentalScore: number,
  prosodicScore: number,
): string => {
  const p0 = radarPoint(0, overallScore);
  const p1 = radarPoint(1, segmentalScore);
  const p2 = radarPoint(2, prosodicScore);
  return `${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
};

// ---- Stage スコア推定（diagnostic result 画面と同ロジック） ----
const estimateStageScores = (
  snapshot: ProgressSnapshotDto,
): { stageI: number; stageII: number } => {
  const overallScore = snapshot.cefrSubscales.overall?.score ?? 50;
  const prosodicScore = snapshot.cefrSubscales.prosodic?.score ?? 50;
  const stageI = Math.min(100, overallScore);
  const stageII = overallScore >= 70 ? Math.min(100, prosodicScore) : 0;
  return { stageI, stageII };
};

// ---- focus 推移 sparkline 計算 ----
// SVG viewBox: 0 0 200 30, preserveAspectRatio="none"
// スコア 0–100 → y 座標 4..26 (上が高スコア)
const SPARK_WIDTH = 200;
const SPARK_HEIGHT = 30;
const SPARK_PAD = 4;

const scoreToY = (score: number): number => {
  const normalized = Math.min(100, Math.max(0, score));
  // 上が高スコアなので反転: score=100 → y=SPARK_PAD, score=0 → y=SPARK_HEIGHT-SPARK_PAD
  return SPARK_PAD + (1 - normalized / 100) * (SPARK_HEIGHT - SPARK_PAD * 2);
};

type SparkData = {
  contrast: string;
  points: Array<{ score: number; capturedAt: string }>;
};

/**
 * snapshots の配列から contrast 別に推移点列を構築する。
 * 各スナップショットの focusScores から同一 contrast の点を収集する。
 */
const buildSparkData = (snapshots: ProgressSnapshotDto[]): SparkData[] => {
  const contrastMap = new Map<string, Array<{ score: number; capturedAt: string }>>();

  for (const snapshot of snapshots) {
    for (const fs of snapshot.focusScores) {
      if (!contrastMap.has(fs.contrast)) {
        contrastMap.set(fs.contrast, []);
      }
      contrastMap.get(fs.contrast)!.push({ score: fs.score, capturedAt: snapshot.capturedAt });
    }
  }

  return Array.from(contrastMap.entries()).map(([contrast, points]) => ({ contrast, points }));
};

/**
 * SparkSvg — 1 行の focus 推移 SVG sparkline。
 * 点が 1 件のみなら sdot のみ（偽の折れ線を引かない）。
 */
const SparkSvg = ({
  points,
}: {
  points: Array<{ score: number; capturedAt: string }>;
}) => {
  if (points.length === 0) return null;

  const lastPoint = points[points.length - 1]!;
  const lastX = points.length === 1 ? SPARK_WIDTH / 2 : SPARK_WIDTH - SPARK_PAD;
  const lastY = scoreToY(lastPoint.score);

  if (points.length === 1) {
    // 1 点のみ: 中央に sdot のみ (M-PG-5b: 偽折れ線を引かない)
    return (
      <svg
        className="spark-svg"
        width="100%"
        height={SPARK_HEIGHT}
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <circle className="sdot" cx={lastX} cy={lastY} r="2.5" />
      </svg>
    );
  }

  // 複数点: 折れ線 + 末尾 sdot
  const pointsStr = points
    .map((point, index) => {
      const x = SPARK_PAD + (index / (points.length - 1)) * (SPARK_WIDTH - SPARK_PAD * 2);
      const y = scoreToY(point.score);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className="spark-svg"
      width="100%"
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
    >
      <polyline className="sline" points={pointsStr} />
      <circle className="sdot" cx={lastX} cy={lastY} r="2.5" />
    </svg>
  );
};

// ---- delta 表示 ----
type DeltaDisplay = { className: "delta-up" | "delta-dn" | "mono"; text: string };

const buildDeltaDisplay = (
  points: Array<{ score: number }>,
): DeltaDisplay => {
  if (points.length < 2) {
    return {
      className: "mono",
      text: "—",
    };
  }
  const first = points[0]!.score;
  const last = points[points.length - 1]!.score;
  const delta = last - first;
  if (delta > 0) {
    return { className: "delta-up", text: `▲ ${delta.toFixed(1)}` };
  }
  if (delta < 0) {
    return { className: "delta-dn", text: `▼ ${Math.abs(delta).toFixed(1)}` };
  }
  return { className: "mono", text: "±0" };
};

// ---- priority ラベル（最新スナップショットの focusScores 順序から推定） ----
const focusPriorityLabel = (index: number, total: number): string => {
  if (total === 0) return "";
  const ratio = index / total;
  if (ratio < 0.33) return "Now";
  if (ratio < 0.66) return "Next";
  return "Later";
};

const focusPriorityClass = (index: number, total: number): string => {
  if (total === 0) return "";
  const ratio = index / total;
  if (ratio < 0.33) return "prio--now";
  if (ratio < 0.66) return "";
  return "prio--low";
};

// ---- Component ----

export default function ProgressPage() {
  const [progressDto, setProgressDto] = useState<ProgressDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ProgressDto>("/api/v1/progress")
      .then((data) => {
        setProgressDto(data);
        setLoading(false);
      })
      .catch((error: unknown) => {
        setLoadError(
          isApiClientError(error) ? error.message : "進捗データの取得に失敗しました",
        );
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-tertiary)" }}>
        読み込み中...
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          color: "var(--sev-critical-text)",
        }}
      >
        <p>{loadError}</p>
        <Link href="/" className="btn btn--primary" style={{ marginTop: "16px" }}>
          ライブラリへ
        </Link>
      </div>
    );
  }

  const now = progressDto?.now ?? null;
  const prev = progressDto?.prev ?? null;
  const snapshots = progressDto?.snapshots ?? [];

  // ---- Stage 情報 ----
  const stageScores = now ? estimateStageScores(now) : { stageI: 0, stageII: 0 };

  // ---- CEFR レーダー ----
  const nowOverall = now?.cefrSubscales.overall?.score ?? 0;
  const nowSegmental = now?.cefrSubscales.segmental?.score ?? 0;
  const nowProsodic = now?.cefrSubscales.prosodic?.score ?? 0;
  const prevOverall = prev?.cefrSubscales.overall?.score ?? 0;
  const prevSegmental = prev?.cefrSubscales.segmental?.score ?? 0;
  const prevProsodic = prev?.cefrSubscales.prosodic?.score ?? 0;

  const nowPolygonPoints = now
    ? toPolygonPoints(nowOverall, nowSegmental, nowProsodic)
    : null;
  const prevPolygonPoints = prev
    ? toPolygonPoints(prevOverall, prevSegmental, prevProsodic)
    : null;

  // ---- focus 推移 ----
  const sparkData = buildSparkData(snapshots);
  const nowFocusContrasts = new Set((now?.focusScores ?? []).map((fs) => fs.contrast));
  // now のfocusScoresの順序でsparkDataを並べる
  const sortedSparkData = sparkData.sort((a, b) => {
    const aIndex = (now?.focusScores ?? []).findIndex((fs) => fs.contrast === a.contrast);
    const bIndex = (now?.focusScores ?? []).findIndex((fs) => fs.contrast === b.contrast);
    const aNorm = aIndex === -1 ? 999 : aIndex;
    const bNorm = bIndex === -1 ? 999 : bIndex;
    return aNorm - bNorm;
  });

  // ---- 訓練統計 ----
  // M-PG-5c: training 未実装なので honest empty (0 / 「訓練データなし」)
  const cumulativeTrainingMinutes = now?.cumulativeTrainingMinutes ?? 0;
  const hasCumulativeTraining = cumulativeTrainingMinutes > 0;
  // cum-bar 幅は仮想 400min 頭打ちでスケール (架空値は出さないが、0以外ならバーを表示)
  const cumBarWidth = hasCumulativeTraining
    ? Math.min(100, (cumulativeTrainingMinutes / 400) * 100)
    : 0;

  // ---- axis-expl テキスト ----
  const buildAxisExplanation = (): string => {
    if (!now) return "診断データがありません。まず診断を実施してください。";
    const lowest = (() => {
      const candidates = [
        { label: "全体的音韻統制", score: nowOverall },
        { label: "分節音", score: nowSegmental },
        { label: "韻律", score: nowProsodic },
      ];
      return candidates.reduce((min, c) => (c.score < min.score ? c : min));
    })();
    return `Stage I 到達度 ${stageScores.stageI}%。${lowest.label}（${lowest.score}）が最も低い尺度です。この改善が Stage II への近道です。`;
  };

  return (
    <div>
      {/* app-top — M-PG-6: scope-note 常時表示（条件分岐で消えない） */}
      <div className="app-top">
        <div className="app-brand">
          NativeTrace <span className="ipa">/ˈneɪtɪv treɪs/</span>
        </div>
        <div className="crumb" style={{ marginLeft: "16px" }}>
          <b>進捗</b>
          <span className="sep">·</span>
          <span className="mono" style={{ fontSize: "var(--text-xs)" }}>
            直近 6 週
          </span>
        </div>
        {/* scope-note: M-PG-6 / 研究 E-2 — 常時表示 */}
        <span className="scope-note" style={{ marginLeft: "auto" }}>
          読み上げ課題での改善 — 自発発話への転移は別計測
        </span>
      </div>

      <div className="pg">
        {/* スナップショット 0 件の場合の honest empty */}
        {snapshots.length === 0 && (
          <div
            className="card"
            style={{ padding: "var(--sp-6)", textAlign: "center", color: "var(--text-faint)" }}
          >
            <p style={{ margin: 0 }}>
              進捗データがありません。診断を完了すると、ここに結果が表示されます。
            </p>
            <Link
              href="/"
              className="btn btn--sm btn--secondary"
              style={{ marginTop: "16px", display: "inline-flex" }}
            >
              診断を始める
            </Link>
          </div>
        )}

        {snapshots.length > 0 && (
          <>
            {/* 二段階ゴール */}
            <div className="card">
              <div className="card-h">
                <b>二段階ゴール — 現在地</b>
                <span className="en">Stage I → II</span>
              </div>
              <div className="stage-track" style={{ maxWidth: "760px", marginBottom: "var(--sp-5)" }}>
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
                    <span>{stageScores.stageII > 0 ? `${stageScores.stageII}%` : "—"}</span>
                  </div>
                  <div className="rail2">
                    <i style={{ width: `${stageScores.stageII}%` }} />
                  </div>
                </div>
              </div>
              <div className="axis-expl" style={{ margin: 0 }}>
                <span className="q">?</span>
                <div>{buildAxisExplanation()}</div>
              </div>
            </div>

            <div className="pg-grid">
              {/* focus sounds スコア推移 */}
              <div className="card">
                <div className="card-h">
                  <b>focus sounds — スコア推移</b>
                  <span className="en">per-feature GOP</span>
                </div>

                {sortedSparkData.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: "var(--text-xs)",
                      color: "var(--text-faint)",
                    }}
                  >
                    focus データがありません。
                  </p>
                ) : (
                  sortedSparkData.map((spark, index) => {
                    const delta = buildDeltaDisplay(spark.points);
                    const priorityLabel = focusPriorityLabel(index, sortedSparkData.length);
                    const priorityClass = focusPriorityClass(index, sortedSparkData.length);
                    const isNowFocus = nowFocusContrasts.has(spark.contrast);
                    return (
                      <div
                        key={spark.contrast}
                        className="fs-trend"
                        style={priorityClass === "prio--low" ? { opacity: 0.7 } : undefined}
                      >
                        <span
                          className="pair"
                          style={
                            spark.contrast.length > 6
                              ? { fontSize: "var(--text-sm)" }
                              : undefined
                          }
                        >
                          {spark.contrast}
                        </span>
                        <SparkSvg points={spark.points} />
                        <span
                          className={delta.className}
                          style={
                            delta.className === "mono"
                              ? {
                                  fontFamily: "var(--font-mono)",
                                  fontSize: "var(--text-2xs)",
                                  color: "var(--text-faint)",
                                }
                              : undefined
                          }
                        >
                          {delta.text}
                        </span>
                        {isNowFocus && (
                          <span className={`prio ${priorityClass}`.trim()}>{priorityLabel}</span>
                        )}
                      </div>
                    );
                  })
                )}

                <p
                  className="note"
                  style={{ margin: "14px 0 0", fontSize: "var(--text-2xs)" }}
                >
                  同一診断文セットの再録音で計測。解析のたびに漸進更新（再診断テストは不要）。
                </p>
              </div>

              {/* CEFR レーダー */}
              <div className="card">
                <div className="card-h">
                  <b>CEFR 音韻統制 3下位尺度</b>
                  <span className="en">overall · segmental · prosody</span>
                </div>
                <svg
                  viewBox="0 0 220 190"
                  width="100%"
                  style={{ maxWidth: "300px", display: "block", margin: "0 auto" }}
                >
                  {/* 参照グリッド (ref) — 100%/75%/50% */}
                  <polygon
                    className="radar-poly--ref"
                    points={toPolygonPoints(100, 100, 100)}
                  />
                  <polygon
                    className="radar-poly--ref"
                    points={toPolygonPoints(75, 75, 75)}
                  />
                  <polygon
                    className="radar-poly--ref"
                    points={toPolygonPoints(50, 50, 50)}
                  />

                  {/* M-PG-5a: prev がある場合のみ描画 */}
                  {prevPolygonPoints && (
                    <polygon className="radar-poly--prev" points={prevPolygonPoints} />
                  )}

                  {/* now — 常に実スコアで描画 */}
                  {nowPolygonPoints && (
                    <polygon className="radar-poly--now" points={nowPolygonPoints} />
                  )}

                  {/* ラベル */}
                  <text className="radar-lbl" x="110" y="14" textAnchor="middle">
                    全体的音韻統制 · {now?.cefrSubscales.overall?.band ?? "—"}
                  </text>
                  <text className="radar-val" x="110" y="42" textAnchor="middle">
                    {nowOverall > 0 ? nowOverall : "—"}
                  </text>
                  <text className="radar-lbl" x="180" y="148" textAnchor="middle">
                    分節 · {now?.cefrSubscales.segmental?.band ?? "—"}
                  </text>
                  <text className="radar-val" x="152" y="128" textAnchor="middle">
                    {nowSegmental > 0 ? nowSegmental : "—"}
                  </text>
                  <text className="radar-lbl" x="42" y="148" textAnchor="middle">
                    韻律 · {now?.cefrSubscales.prosodic?.band ?? "—"}
                  </text>
                  <text className="radar-val" x="76" y="122" textAnchor="middle">
                    {nowProsodic > 0 ? nowProsodic : "—"}
                  </text>
                </svg>

                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    justifyContent: "center",
                    marginTop: "6px",
                  }}
                >
                  <span className="f0-legend">
                    <span className="ln" style={{ borderColor: "var(--axis-intel)" }} />
                    今回
                  </span>
                  {/* M-PG-5a: prev がある場合のみ凡例表示 */}
                  {prev && (
                    <span className="f0-legend">
                      <span
                        className="ln ln--learner"
                        style={{ borderColor: "var(--text-faint)" }}
                      />
                      前回
                    </span>
                  )}
                </div>

                {/* M-PG-5a: prev なしの注記 */}
                {!prev && (
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: "var(--text-2xs)",
                      color: "var(--text-faint)",
                      textAlign: "center",
                    }}
                  >
                    前回比なし（スナップショット 1 件）
                  </p>
                )}

                {now && (
                  <div className="callout" style={{ marginTop: "14px" }}>
                    <span className="ci">↗</span>
                    <span>
                      {(() => {
                        const lowest = [
                          { label: "全体的音韻統制", score: nowOverall },
                          { label: "分節音（Segmental）", score: nowSegmental },
                          { label: "韻律（Prosodic）", score: nowProsodic },
                        ].reduce((min, c) => (c.score < min.score ? c : min));
                        return `${lowest.label}（${lowest.score}）が最も低い — 全習熟度帯で伝わりやすさに効く軸です。`;
                      })()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 訓練統計 */}
            <div className="card">
              <div className="card-h">
                <b>訓練の累計と間隔</b>
                <span className="en">spacing · volume</span>
              </div>
              <div className="stats-row">
                {/* M-PG-5c: 訓練未実装なら 0 / 「訓練データなし」 */}
                <div className="stat">
                  <span className="sk">累計訓練時間</span>
                  {hasCumulativeTraining ? (
                    <span className="sv">
                      {cumulativeTrainingMinutes}
                      <small> min</small>
                    </span>
                  ) : (
                    <span className="sv" style={{ fontSize: "var(--text-sm)", color: "var(--text-faint)" }}>
                      訓練データなし
                    </span>
                  )}
                  <span className="sd3">
                    {hasCumulativeTraining
                      ? "（≈300–400分で頭打ち）"
                      : "training 機能は今後リリース予定"}
                  </span>
                </div>
                <div className="stat">
                  <span className="sk">平均訓練間隔</span>
                  <span className="sv" style={{ fontSize: "var(--text-sm)", color: "var(--text-faint)" }}>
                    —
                  </span>
                  <span className="sd3">訓練データなし</span>
                </div>
                <div className="stat">
                  <span className="sk">診断スナップショット</span>
                  <span className="sv">
                    {snapshots.length}
                    <small> 件</small>
                  </span>
                  <span className="sd3">
                    {snapshots.length >= 2 ? "前回比較可能" : "あと 1 件で前回比較"}
                  </span>
                </div>
                <div className="stat">
                  <span className="sk">直近の診断</span>
                  <span
                    className="sv"
                    style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}
                  >
                    {now
                      ? new Date(now.capturedAt).toLocaleDateString("ja-JP", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </span>
                  <span className="sd3">
                    {now ? new Date(now.capturedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
              </div>
              {/* cum-bar — 訓練データなしなら honest empty (0% バー) */}
              <div className="cum-bar" style={{ maxWidth: "560px", marginTop: "22px" }}>
                <i style={{ width: `${cumBarWidth}%` }} />
                <span className="plateau" style={{ left: "80%" }} data-lbl="≈300–400min 頭打ち" />
              </div>
              {!hasCumulativeTraining && (
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "var(--text-2xs)",
                    color: "var(--text-faint)",
                  }}
                >
                  訓練データなし — 訓練を開始すると累計時間が記録されます
                </p>
              )}
            </div>

            {/* 比較再生 — M-PG-5d: 複数録音なければ honest empty */}
            <div className="card">
              <div className="card-h">
                <b>同一セクションの過去録音と比較</b>
                <span className="en">REQ-018 拡張</span>
              </div>
              {snapshots.length >= 2 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div className="ab-srcs">
                    {snapshots
                      .slice()
                      .reverse()
                      .slice(0, 3)
                      .map((snapshot, index) => (
                        <button
                          key={snapshot.identifier}
                          type="button"
                          className={`ab-src${index === 0 ? " is-active" : ""}`}
                        >
                          <span
                            className="sd2"
                            style={{
                              background:
                                index === 0 ? "var(--src-self)" : "var(--text-faint)",
                            }}
                          />
                          試行{" "}
                          {String(snapshots.length - index).padStart(2, "0")} ·{" "}
                          {new Date(snapshot.capturedAt).toLocaleDateString("ja-JP", {
                            month: "numeric",
                            day: "numeric",
                          })}
                        </button>
                      ))}
                  </div>
                  <button type="button" className="btn btn--sm btn--ghost">
                    ⇄ 交互再生
                  </button>
                  <div className="player" style={{ flex: 1, minWidth: "260px" }}>
                    <button type="button" className="pp">
                      ▶
                    </button>
                    <div className="wave">
                      <i className="on" style={{ height: "36%" }} />
                      <i className="on" style={{ height: "60%" }} />
                      <i style={{ height: "48%" }} />
                      <i style={{ height: "72%" }} />
                      <i style={{ height: "52%" }} />
                      <i style={{ height: "64%" }} />
                      <i style={{ height: "40%" }} />
                      <i style={{ height: "56%" }} />
                    </div>
                    <span className="tt">—</span>
                  </div>
                </div>
              ) : (
                /* M-PG-5d: 比較対象なし */
                <p
                  style={{
                    margin: 0,
                    fontSize: "var(--text-xs)",
                    color: "var(--text-faint)",
                  }}
                >
                  比較対象なし — 同一セクションの録音が複数蓄積されると比較再生が有効になります。
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
