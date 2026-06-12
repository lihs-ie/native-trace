"use client";

import type { ProsodyDto } from "@/lib/api-types";

type F0ChartProps = {
  prosody: ProsodyDto | null;
};

const SVG_WIDTH = 600;
const SVG_HEIGHT = 120;
const PADDING_X = 10;
const PADDING_Y = 10;

/**
 * F0 韻律チャート (M-114 / REQ-114)
 * workspace-v2.html の `.f0card` 構造を実装する。
 * 学習者 F0 輪郭を SVG パスで描画する（お手本=実線（将来実装）、学習者=破線）。
 * データなしの場合は正直な空状態を返す。
 */
export const F0Chart = ({ prosody }: F0ChartProps) => {
  const f0Contour = prosody?.f0Contour ?? null;

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

  const { timesMs, valuesHz } = f0Contour;

  const minHz = Math.min(...valuesHz.filter((v) => v > 0));
  const maxHz = Math.max(...valuesHz);
  const hzRange = maxHz - minHz || 1;

  const minTime = timesMs[0] ?? 0;
  const maxTime = timesMs[timesMs.length - 1] ?? 1;
  const timeRange = maxTime - minTime || 1;

  const plotWidth = SVG_WIDTH - PADDING_X * 2;
  const plotHeight = SVG_HEIGHT - PADDING_Y * 2;

  const toX = (timeMs: number): number =>
    PADDING_X + ((timeMs - minTime) / timeRange) * plotWidth;

  const toY = (hz: number): number =>
    PADDING_Y + plotHeight - ((hz - minHz) / hzRange) * plotHeight;

  // voiced frame のみ path を構築（0Hz は無声として除外）
  const pathSegments: string[] = [];
  let inSegment = false;

  for (let i = 0; i < timesMs.length; i++) {
    const time = timesMs[i];
    const hz = valuesHz[i];
    if (time === undefined || hz === undefined) continue;

    if (hz > 0) {
      const x = toX(time);
      const y = toY(hz);
      if (!inSegment) {
        pathSegments.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
        inSegment = true;
      } else {
        pathSegments.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
    } else {
      inSegment = false;
    }
  }

  const pathData = pathSegments.join(" ");

  return (
    <div className="f0card">
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
        <span className="f0-legend" style={{ color: "var(--text-faint)" }}>
          <span className="ln" style={{ borderTopStyle: "dashed", borderTopColor: "var(--border)" }} />
          お手本（準備中）
        </span>
      </div>
      <svg
        className="f0-svg"
        viewBox={`0 0 ${String(SVG_WIDTH)} ${String(SVG_HEIGHT)}`}
        aria-label="F0 輪郭グラフ"
      >
        {/* grid lines */}
        <line className="f0-grid" x1={PADDING_X} y1={SVG_HEIGHT / 2} x2={SVG_WIDTH - PADDING_X} y2={SVG_HEIGHT / 2} />
        {/* axis */}
        <line className="f0-axis" x1={PADDING_X} y1={PADDING_Y} x2={PADDING_X} y2={SVG_HEIGHT - PADDING_Y} />
        <line className="f0-axis" x1={PADDING_X} y1={SVG_HEIGHT - PADDING_Y} x2={SVG_WIDTH - PADDING_X} y2={SVG_HEIGHT - PADDING_Y} />
        {/* learner F0 path */}
        {pathData && <path className="f0-learner" d={pathData} />}
      </svg>
    </div>
  );
};
