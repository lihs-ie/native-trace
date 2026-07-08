"use client";

import type { AcousticEvidenceDto } from "@/lib/api-types";

/**
 * M-ADVL-1 (ADR-024): 音響音声学診断カード。
 * AcousticEvidenceDto の数値スカラー + 方向ラベルを design-system-v3 `.acoustic` 構造で描画。
 * Props: acousticEvidence が null のとき何も描画しない（M-ADVL-2）。
 * phonemeLabel: IPA シンボル（AcousticEvidenceDto は音素記号を持たないため呼び出し元から受け取る — M-ADVL-3）。
 */
type AcousticDiagnosisCardProps = {
  acousticEvidence: AcousticEvidenceDto | null;
  phonemeLabel?: string;
};

/** clamp(value, min, max) */
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * M-ADVL-4: 母音四辺形プロット座標写像。
 * left% (F2 軸) = clamp((F2Hz − 700) / (2700 − 700), 0, 1) × 100
 * top%  (F1 軸) = clamp((F1Hz − 200) / (1000 − 200), 0, 1) × 100
 */
const toVowelPlotCoords = (f1Hz: number, f2Hz: number): { left: number; top: number } => ({
  left: clamp((f2Hz - 700) / (2700 - 700), 0, 1) * 100,
  top: clamp((f1Hz - 200) / (1000 - 200), 0, 1) * 100,
});

/**
 * M-ADVL-5: measured→target ベクトルの px 変換（プロット 320×240 px 前提）。
 */
const PLOT_WIDTH_PX = 320;
const PLOT_HEIGHT_PX = 240; // aspect-ratio 4/3 → 320 × 3/4 = 240

type VecStyle = {
  left: string;
  top: string;
  width: string;
  transform: string;
};

const toVectorStyle = (
  measuredLeft: number,
  measuredTop: number,
  targetLeft: number,
  targetTop: number,
): VecStyle => {
  const dxPx = ((targetLeft - measuredLeft) / 100) * PLOT_WIDTH_PX;
  const dyPx = ((targetTop - measuredTop) / 100) * PLOT_HEIGHT_PX;
  const widthPx = Math.hypot(dxPx, dyPx);
  const angle = Math.atan2(dyPx, dxPx);
  return {
    left: `${measuredLeft}%`,
    top: `${measuredTop}%`,
    width: `${widthPx}px`,
    transform: `rotate(${angle}rad)`,
  };
};

/**
 * M-ADVL-8: スペクトル重心 Hz バーの left% 換算。
 * レンジ [1000, 8000]。left% = clamp((Hz − 1000) / 7000, 0, 1) × 100
 */
const spectralCentroidToLeftPercent = (hz: number): number => clamp((hz - 1000) / 7000, 0, 1) * 100;

/**
 * M-ADVL-8: tense 長さ比バーの left% 換算。
 * レンジ [0.5, 2.5]。left% = clamp((ratio − 0.5) / 2.0, 0, 1) × 100
 */
const tenseLengthRatioToLeftPercent = (ratio: number): number =>
  clamp((ratio - 0.5) / 2.0, 0, 1) * 100;

/**
 * M-ADVL-6/7: 方向チップの設定。
 * 各軸について arrow / label / isOk / dirHz を決定して返す。
 * null の軸はチップを描画しない。
 */
type DirChipData = {
  axis: string;
  arrow: string;
  labelJa: string;
  dirHz: string;
  isOk: boolean;
};

const buildDirChips = (ae: AcousticEvidenceDto): DirChipData[] => {
  const chips: DirChipData[] = [];

  // tongueHeight — null のときチップなし
  if (ae.tongueHeight != null) {
    const isOk = ae.tongueHeight === "ok";
    const arrow = ae.tongueHeight === "tooLow" ? "↑" : ae.tongueHeight === "tooHigh" ? "↓" : "○";
    const labelJa =
      ae.tongueHeight === "tooLow"
        ? "舌が低すぎ"
        : ae.tongueHeight === "tooHigh"
          ? "舌が高すぎ"
          : "範囲内";
    const dirHz =
      ae.signedF1SdDeviation != null
        ? `F1 ${ae.signedF1SdDeviation >= 0 ? "+" : ""}${ae.signedF1SdDeviation.toFixed(1)} SD`
        : "";
    chips.push({ axis: "tongueHeight", arrow, labelJa, dirHz, isOk });
  }

  // tongueBackness — null のときチップなし
  if (ae.tongueBackness != null) {
    const isOk = ae.tongueBackness === "ok";
    const arrow =
      ae.tongueBackness === "tooBack" ? "←" : ae.tongueBackness === "tooFront" ? "→" : "○";
    const labelJa =
      ae.tongueBackness === "tooBack"
        ? "舌が後ろすぎ"
        : ae.tongueBackness === "tooFront"
          ? "舌が前すぎ"
          : "範囲内";
    const dirHz =
      ae.signedF2SdDeviation != null
        ? `F2 ${ae.signedF2SdDeviation >= 0 ? "+" : ""}${ae.signedF2SdDeviation.toFixed(1)} SD`
        : "";
    chips.push({ axis: "tongueBackness", arrow, labelJa, dirHz, isOk });
  }

  // rhoticity — null のときチップなし。非 null && ok でも is-ok チップを描く（M-ADVL-6）
  if (ae.rhoticity != null) {
    const isOk = ae.rhoticity === "ok";
    const arrow =
      ae.rhoticity === "insufficient" ? "↓" : ae.rhoticity === "overRetroflex" ? "↑" : "○";
    const labelJa =
      ae.rhoticity === "insufficient"
        ? "r音性不足"
        : ae.rhoticity === "overRetroflex"
          ? "そり舌過剰"
          : "範囲内";
    // M-ADVL-7: F3 数値を必ず表示。F3 Hz がある場合優先、なければ SD。
    let dirHz = "";
    if (ae.measuredF3Hz != null) {
      dirHz =
        ae.targetF3Hz != null
          ? `F3 ${ae.measuredF3Hz}→${ae.targetF3Hz} Hz`
          : `F3 ${ae.measuredF3Hz} Hz`;
    } else if (ae.signedF3SdDeviation != null) {
      dirHz = `F3 ${ae.signedF3SdDeviation >= 0 ? "+" : ""}${ae.signedF3SdDeviation.toFixed(1)} SD`;
    }
    chips.push({ axis: "rhoticity", arrow, labelJa, dirHz, isOk });
  }

  // sibilantPlace — null のときチップなし
  if (ae.sibilantPlace != null) {
    const isOk = ae.sibilantPlace === "ok";
    const arrow =
      ae.sibilantPlace === "tooPalatal" ? "←" : ae.sibilantPlace === "tooAlveolar" ? "→" : "○";
    const labelJa =
      ae.sibilantPlace === "tooPalatal"
        ? "口蓋寄り"
        : ae.sibilantPlace === "tooAlveolar"
          ? "歯茎寄り"
          : "範囲内";
    const dirHz = ae.spectralCentroidHz != null ? `${ae.spectralCentroidHz.toFixed(0)} Hz` : "";
    chips.push({ axis: "sibilantPlace", arrow, labelJa, dirHz, isOk });
  }

  // vowelLength — null のときチップなし
  if (ae.vowelLength != null) {
    const isOk = ae.vowelLength === "ok";
    const arrow = ae.vowelLength === "tooShort" ? "↓" : "○";
    const labelJa = ae.vowelLength === "tooShort" ? "短すぎ" : "範囲内";
    const dirHz = ae.tenseLengthRatio != null ? `ratio ${ae.tenseLengthRatio.toFixed(1)}` : "";
    chips.push({ axis: "vowelLength", arrow, labelJa, dirHz, isOk });
  }

  return chips;
};

/**
 * M-ADVL-1/2 (ADR-024): AcousticDiagnosisCard
 * acousticEvidence が null → null を返す（DOM に .acoustic を出さない）。
 */
export const AcousticDiagnosisCard = ({
  acousticEvidence,
  phonemeLabel,
}: AcousticDiagnosisCardProps) => {
  if (acousticEvidence == null) return null;

  const ae = acousticEvidence;
  const chips = buildDirChips(ae);

  // M-ADVL-4: measured 点と target 点の座標（F1/F2 が揃っているときのみ描画）
  const measuredCoordsAvailable = ae.measuredF1Hz != null && ae.measuredF2Hz != null;
  const targetCoordsAvailable = ae.targetF1Hz != null && ae.targetF2Hz != null;

  const measuredCoords =
    measuredCoordsAvailable && ae.measuredF1Hz != null && ae.measuredF2Hz != null
      ? toVowelPlotCoords(ae.measuredF1Hz, ae.measuredF2Hz)
      : null;

  const targetCoords =
    targetCoordsAvailable && ae.targetF1Hz != null && ae.targetF2Hz != null
      ? toVowelPlotCoords(ae.targetF1Hz, ae.targetF2Hz)
      : null;

  // M-ADVL-5: ベクトル（両点が揃っているときのみ描画）
  const vectorStyle =
    measuredCoords != null && targetCoords != null
      ? toVectorStyle(measuredCoords.left, measuredCoords.top, targetCoords.left, targetCoords.top)
      : null;

  // M-ADVL-8: measure-bar の表示可否
  const showSpectralBar = ae.spectralCentroidHz != null;
  const showTenseBar = ae.tenseLengthRatio != null;

  return (
    <div className="acoustic">
      {/* M-ADVL-3: ヘッダ — IPA + ADR バッジ + 推定タグ */}
      <div className="acoustic-head">
        {phonemeLabel && <b style={{ fontSize: "var(--text-sm)" }}>{phonemeLabel}</b>}
        <span className="adr-badge adr-badge--accepted">ADR-018 · Accepted</span>
        <span className="layer-tag layer-tag--enrich">
          <span className="lt-ico">~</span>推定 · 減点せず
        </span>
      </div>

      {/* M-ADVL-4/5/6/7/8: 二列レイアウト — 左: 母音四辺形、右: 方向チップ + measure-bar */}
      <div className="grid-2">
        {/* 左列: 母音四辺形プロット */}
        <div>
          <div className="kbd-label" style={{ marginBottom: "14px" }}>
            母音四辺形 — 実測 vs 目標ノルム
          </div>
          <div className="vowel-plot">
            <span className="vp-axis-y">F1 ↑ 舌が低い</span>
            <span className="vp-axis-x">F2 → 舌が前</span>

            {/* M-ADVL-4: target 点 */}
            {targetCoords != null && (
              <div
                className="vp-pt vp-pt--target"
                style={{ left: `${targetCoords.left}%`, top: `${targetCoords.top}%` }}
              >
                <span className="vp-lbl">目標</span>
              </div>
            )}

            {/* M-ADVL-4: measured 点 */}
            {measuredCoords != null && (
              <div
                className="vp-pt vp-pt--measured"
                style={{ left: `${measuredCoords.left}%`, top: `${measuredCoords.top}%` }}
              >
                <span className="vp-lbl">あなた</span>
              </div>
            )}

            {/* M-ADVL-5: measured→target ベクトル */}
            {vectorStyle != null && (
              <div
                className="vp-vec"
                style={{
                  left: vectorStyle.left,
                  top: vectorStyle.top,
                  width: vectorStyle.width,
                  transform: vectorStyle.transform,
                }}
              />
            )}
          </div>
        </div>

        {/* 右列: 方向チップ + measure-bar */}
        <div>
          <div className="kbd-label" style={{ marginBottom: "14px" }}>
            方向ラベル（worker しきい値判定）
          </div>

          {/* M-ADVL-6/7: 方向チップ */}
          <div className="dir-grid">
            {chips.map((chip) => (
              <div key={chip.axis} className={`dir-chip${chip.isOk ? " is-ok" : ""}`}>
                <span className="dir-arrow">{chip.arrow}</span>
                <div>
                  <div className="dir-k">{chip.axis}</div>
                  <div className="dir-v">{chip.labelJa}</div>
                  <div className="dir-hz">{chip.dirHz}</div>
                </div>
              </div>
            ))}
          </div>

          {/* M-ADVL-8: measure-bar 2 本 */}
          <div style={{ marginTop: "14px" }}>
            {showSpectralBar && ae.spectralCentroidHz != null && (
              <div className="measure-bar">
                <span>/s/ 重心 Hz</span>
                <span className="mb-track">
                  {ae.targetSpectralCentroidHz != null && (
                    <span
                      className="mb-target"
                      style={{
                        left: `${spectralCentroidToLeftPercent(ae.targetSpectralCentroidHz)}%`,
                      }}
                    />
                  )}
                  <span
                    className="mb-val"
                    style={{
                      left: `${spectralCentroidToLeftPercent(ae.spectralCentroidHz)}%`,
                    }}
                  />
                </span>
                <span>{(ae.spectralCentroidHz / 1000).toFixed(1)}k</span>
              </div>
            )}
            {showTenseBar && ae.tenseLengthRatio != null && (
              <div className="measure-bar">
                <span>tense 長さ比</span>
                <span className="mb-track">
                  {ae.targetTenseLengthRatio != null && (
                    <span
                      className="mb-target"
                      style={{
                        left: `${tenseLengthRatioToLeftPercent(ae.targetTenseLengthRatio)}%`,
                      }}
                    />
                  )}
                  <span
                    className="mb-val"
                    style={{
                      left: `${tenseLengthRatioToLeftPercent(ae.tenseLengthRatio)}%`,
                    }}
                  />
                </span>
                <span>{ae.tenseLengthRatio.toFixed(1)}×</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* M-ADVL-9: disclaimer — 1 ブロック、3 caveat: Lobanov 正規化 / 母音<3 でスキップ / 二重減点なし */}
      <div className="disclaimer" style={{ marginTop: "var(--sp-4)" }}>
        <span className="dc-ico">~</span>
        <span>
          方向は目安。話者性別未指定時は発話内 Lobanov
          正規化、母音3個未満では方向判定をスキップ（偽陽性回避）。GOP
          が既に減点済みのため音響偏差は減点しない（二重減点回避）。
        </span>
      </div>
    </div>
  );
};
