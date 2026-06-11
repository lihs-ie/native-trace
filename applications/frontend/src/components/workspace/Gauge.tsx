"use client";

const CIRCUMFERENCE = 326.7;

/**
 * overall スコア（0–100）から stroke-dashoffset を計算する（純関数）
 */
export const calcGaugeDashOffset = (overall: number): number => {
  return CIRCUMFERENCE * (1 - overall / 100);
};

type GaugeProps = {
  overall: number;
};

export const Gauge = ({ overall }: GaugeProps) => {
  const dashOffset = calcGaugeDashOffset(overall);

  return (
    <div className="gauge" style={{ width: "88px", height: "88px" }}>
      <svg viewBox="0 0 120 120" width="88" height="88">
        <circle className="g-track" cx="60" cy="60" r="52" />
        <circle
          className="g-val"
          cx="60"
          cy="60"
          r="52"
          style={{ strokeDashoffset: dashOffset.toFixed(1) }}
        />
      </svg>
      <div className="g-center">
        <span className="mono g-num" style={{ fontSize: "var(--text-2xl)" }}>
          {overall}
        </span>
      </div>
    </div>
  );
};
