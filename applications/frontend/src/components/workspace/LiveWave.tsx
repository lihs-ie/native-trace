"use client";

const WAVE_BAR_COUNT = 32;

export const LiveWave = () => {
  return (
    <div className="live-wave">
      {Array.from({ length: WAVE_BAR_COUNT }, (_, index) => (
        <i key={index} style={{ animationDelay: `${(index * 0.045).toFixed(3)}s` }} />
      ))}
    </div>
  );
};
