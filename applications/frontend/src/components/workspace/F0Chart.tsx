"use client";

import { useState } from "react";
import type { ProsodyDto } from "@/lib/api-types";

type F0ChartProps = {
  prosody: ProsodyDto | null;
};

const SVG_WIDTH = 600;
const SVG_HEIGHT = 120;
const PADDING_X = 10;
const PADDING_Y = 10;

/**
 * F0 韻律チャート (M-114 / REQ-114 / M-F0REF-c / M-F0REF-d)
 * workspace-v2.html の `.f0card` 構造を実装する。
 * 学習者 F0 輪郭（.f0-learner 破線）とお手本 F0 輪郭（.f0-ref 実線）を
 * 同一時間軸・同一 viewBox 内に重ね描きする。
 * データなしの場合は正直な空状態を返す。
 * blind モード（M-F0REF-d）: 手動トグルでお手本輪郭を隠せる。
 */
export const F0Chart = ({ prosody }: F0ChartProps) => {
  const [isBlind, setIsBlind] = useState(false);

  const f0Contour = prosody?.f0Contour ?? null;
  // referenceF0Contour は undefined（旧データ）でも null 扱いにする
  const referenceF0Contour = prosody?.referenceF0Contour ?? null;

  if (!f0Contour || f0Contour.valuesHz.length === 0) {
    return (
      <div className="f0card">
        <div className="f0-head">
          <span
            style={{
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
            }}
          >
            F0 データなし（この解析エンジンでは未提供）
          </span>
        </div>
      </div>
    );
  }

  const { timesMs: learnerTimesMs, valuesHz: learnerValuesHz } = f0Contour;

  // 両輪郭の voiced frame の Hz 範囲を統合して共通 Y 軸を決める
  const allVoicedHz = [
    ...learnerValuesHz.filter((v) => v > 0),
    ...(referenceF0Contour ? referenceF0Contour.valuesHz.filter((v) => v > 0) : []),
  ];

  const minHz = allVoicedHz.length > 0 ? Math.min(...allVoicedHz) : 80;
  const maxHz = allVoicedHz.length > 0 ? Math.max(...allVoicedHz) : 300;
  const hzRange = maxHz - minHz || 1;

  // 各輪郭を [0, 1] に線形正規化した後 viewBox に射影する（M-F0REF-c: 同一時間軸正規化）
  const plotWidth = SVG_WIDTH - PADDING_X * 2;
  const plotHeight = SVG_HEIGHT - PADDING_Y * 2;

  const toY = (hz: number): number =>
    PADDING_Y + plotHeight - ((hz - minHz) / hzRange) * plotHeight;

  /**
   * voiced フレームのみ path を構築する。
   * timesMs を [0, 1] に線形正規化して viewBox 上の X 座標に変換する。
   * これにより学習者とお手本の時間軸が同一 [PADDING_X, SVG_WIDTH - PADDING_X] に揃う。
   */
  const buildPath = (timesMs: ReadonlyArray<number>, valuesHz: ReadonlyArray<number>): string => {
    const minTime = timesMs[0] ?? 0;
    const maxTime = timesMs[timesMs.length - 1] ?? 1;
    const timeRange = maxTime - minTime || 1;

    const toX = (timeMs: number): number =>
      PADDING_X + ((timeMs - minTime) / timeRange) * plotWidth;

    const segments: string[] = [];
    let inSegment = false;

    for (let i = 0; i < timesMs.length; i++) {
      const time = timesMs[i];
      const hz = valuesHz[i];
      if (time === undefined || hz === undefined) continue;

      if (hz > 0) {
        const x = toX(time);
        const y = toY(hz);
        if (!inSegment) {
          segments.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
          inSegment = true;
        } else {
          segments.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
        }
      } else {
        inSegment = false;
      }
    }

    return segments.join(" ");
  };

  const learnerPathData = buildPath(learnerTimesMs, learnerValuesHz);

  const hasReference = referenceF0Contour !== null && referenceF0Contour.valuesHz.length > 0;

  const referencePathData = hasReference
    ? buildPath(referenceF0Contour.timesMs, referenceF0Contour.valuesHz)
    : "";

  return (
    <div className="f0card" data-blind={isBlind ? "true" : undefined}>
      <div className="f0-head">
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-2xs)",
            color: "var(--text-faint)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-caps)",
          }}
        >
          F0 輪郭
        </span>
        <span className="f0-legend">
          <span className="ln ln--learner" />
          学習者
        </span>
        {hasReference ? (
          <span className="f0-legend">
            <span className="ln ln--ref" />
            お手本
          </span>
        ) : null}
        {hasReference ? (
          <button
            type="button"
            onClick={() => setIsBlind((prev) => !prev)}
            style={{
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
            }}
            aria-pressed={isBlind}
          >
            {isBlind ? "お手本を表示" : "お手本を隠す"}
          </button>
        ) : null}
      </div>
      <svg
        className="f0-svg"
        viewBox={`0 0 ${String(SVG_WIDTH)} ${String(SVG_HEIGHT)}`}
        aria-label="F0 輪郭グラフ"
      >
        {/* grid lines */}
        <line
          className="f0-grid"
          x1={PADDING_X}
          y1={SVG_HEIGHT / 2}
          x2={SVG_WIDTH - PADDING_X}
          y2={SVG_HEIGHT / 2}
        />
        {/* axis */}
        <line
          className="f0-axis"
          x1={PADDING_X}
          y1={PADDING_Y}
          x2={PADDING_X}
          y2={SVG_HEIGHT - PADDING_Y}
        />
        <line
          className="f0-axis"
          x1={PADDING_X}
          y1={SVG_HEIGHT - PADDING_Y}
          x2={SVG_WIDTH - PADDING_X}
          y2={SVG_HEIGHT - PADDING_Y}
        />
        {/* reference F0 path (お手本 — blind モード時は非表示) */}
        {hasReference && !isBlind && referencePathData ? (
          <path className="f0-ref" d={referencePathData} />
        ) : null}
        {/* learner F0 path */}
        {learnerPathData ? <path className="f0-learner" d={learnerPathData} /> : null}
      </svg>
    </div>
  );
};
