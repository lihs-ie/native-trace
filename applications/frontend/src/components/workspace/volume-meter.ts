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

/**
 * Peak-hold release rate: how many display-percentage points the held peak
 * decays per millisecond.
 *
 * Target: full scale (≈98%) decays to floor in ~300ms.
 *   98% / 300ms ≈ 0.327 %/ms
 *
 * At 60fps (16.67ms per frame) this is 0.327 * 16.67 ≈ 5.45 %/frame.
 * Confirmed by simulation on the sample corpus (scripts/simulate_meter_peak_hold.py,
 * 2026-06-18): A2 satisfied (gate-rejected file peak stays at 37.9% < 41% threshold);
 * ~300ms decay bridges inter-syllable gaps for normal speech without lifting
 * genuinely quiet recordings above LOW_VOLUME_DISPLAY_THRESHOLD.
 */
export const PEAK_HOLD_RELEASE_RATE_PER_MS = 0.327;

/**
 * Applies peak-hold smoothing to the volume meter display value.
 *
 * Attack is instant: if currentPercent exceeds previousDisplayed, the display
 * jumps immediately to currentPercent (catches syllable onsets immediately).
 *
 * Release is gradual: if currentPercent is below previousDisplayed, the display
 * decays by at most releaseAmount per call, bridging inter-syllable gaps.
 *
 * Result is clamped to ≥ 0.
 *
 * This is a pure function with no internal state or side effects.
 *
 * @param currentPercent     Raw instantaneous meter value this frame (%).
 * @param previousDisplayed  Last smoothed value shown on the meter (%).
 * @param releaseAmount      Max decay per call (% points); compute as
 *                           PEAK_HOLD_RELEASE_RATE_PER_MS * dtMs.
 */
export const applyPeakHold = (
  currentPercent: number,
  previousDisplayed: number,
  releaseAmount: number,
): number => Math.max(0, Math.max(currentPercent, previousDisplayed - releaseAmount));

/**
 * How many milliseconds of continuous sub-threshold display is required
 * before the "音量小" label fires.
 *
 * Target: ~500ms (calibrated 2026-06-18 via scripts/simulate_label_debounce.py on the
 * 30-file corpus; see .agent-evidence/meter-label-debounce-calibration.txt).
 *
 * At 500ms:
 *   - Gate-rejected file (01KTV6FJ, -39.5 dBFS): label_on_at_end = true (音量小 shows).
 *   - Normal-to-loud recordings (>= -25 dBFS): label only fires during long pauses /
 *     genuinely quiet sections, not during momentary inter-syllable dips.
 *   - Momentary dips (< 500ms below threshold) do NOT trigger the label.
 *
 * ADR-016 D4: the label (not the bar) is debounced here.
 */
export const SUSTAINED_LOW_MS = 500;

/**
 * Accumulates the duration (in ms) that the display value has stayed continuously
 * below the threshold.
 *
 * Rules:
 *   - If smoothedValue < threshold: return previousBelowMs + dtMs (accumulate).
 *   - If smoothedValue >= threshold: return 0 (reset — speaker is loud enough).
 *
 * This is a pure function with no internal state or side effects.
 * Call it each rAF tick; store the result in a ref (lowDurationRef).
 *
 * The "音量小" label fires when the returned value >= SUSTAINED_LOW_MS.
 *
 * ADR-016 D4: label debounce — fires only after sustained sub-threshold level,
 * not on instantaneous dips (inter-syllable gaps, voiceless consonants, etc.).
 *
 * @param previousBelowMs  Accumulated sub-threshold duration so far (ms).
 * @param smoothedValue    Peak-hold-smoothed display value this tick (%).
 * @param threshold        LOW_VOLUME_DISPLAY_THRESHOLD (%).
 * @param dtMs             Elapsed time since last tick (ms); use 0 on first tick.
 */
export const accumulateLowDurationMs = (
  previousBelowMs: number,
  smoothedValue: number,
  threshold: number,
  dtMs: number,
): number => (smoothedValue < threshold ? previousBelowMs + dtMs : 0);
