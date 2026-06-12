/**
 * Computes the Root Mean Square (RMS) level from a time-domain audio buffer.
 *
 * Returns a value in the range [0, 1] where 0 is silence and 1 is full scale.
 * This is a pure function with no side effects, making it independently testable.
 */
export const computeRmsLevel = (timeDomainData: Uint8Array): number => {
  if (timeDomainData.length === 0) return 0;

  let sumOfSquares = 0;
  for (let index = 0; index < timeDomainData.length; index++) {
    // Web Audio API returns values in [0, 255]; normalize to [-1, 1]
    const normalizedSample = (timeDomainData[index]! - 128) / 128;
    sumOfSquares += normalizedSample * normalizedSample;
  }

  return Math.sqrt(sumOfSquares / timeDomainData.length);
};

const FLOOR_DB = -60;
const CEILING_DB = 0;
const MIN_DISPLAY_PERCENTAGE = 2;

/**
 * Maps an RMS level [0, 1] to a display percentage using a dBFS logarithmic
 * scale so that typical speech (-30 to -10 dBFS) occupies the middle range
 * of the meter instead of being compressed near the bottom.
 *
 * Mapping:
 *   RMS 0     → MIN_DISPLAY_PERCENTAGE (2%)
 *   RMS 0.03  → ~49-52% (-30.5 dBFS)
 *   RMS 0.1   → ~69%    (-20 dBFS)
 *   RMS 1     → 100%    (0 dBFS)
 */
export const rmsLevelToDisplayPercentage = (rmsLevel: number): number => {
  if (rmsLevel <= 0) return MIN_DISPLAY_PERCENTAGE;
  const clamped = Math.min(1, rmsLevel);
  const dbfs = 20 * Math.log10(clamped);
  if (dbfs <= FLOOR_DB) return MIN_DISPLAY_PERCENTAGE;
  const percentage =
    ((dbfs - FLOOR_DB) / (CEILING_DB - FLOOR_DB)) * (100 - MIN_DISPLAY_PERCENTAGE) +
    MIN_DISPLAY_PERCENTAGE;
  return Math.min(100, percentage);
};
