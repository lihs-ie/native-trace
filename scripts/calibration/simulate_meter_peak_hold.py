#!/usr/bin/env python3
"""
Simulation script for peak-hold volume meter smoothing (ADR-016).

Decodes audio files in applications/frontend/data/audio/ (WAV and WebM),
simulates the browser rAF meter loop at ~60Hz using the AnalyserNode model
(fftSize=512, getByteTimeDomainData), applies applyPeakHold smoothing,
and reports per-file statistics.

Gate classification uses the ADR-015 calibration data
(.agent-evidence/calibration-speech-active-rms.txt):
  - speech_active_dBFS < -36.0  → worker REJECTS (low_quality); meter must show 音量小
  - speech_active_dBFS >= -36.0 → worker PASSES;  meter OK is expected for normal speech

A1 counts only SPEECH-ACTIVE meter frames (raw meter > silence floor) per spec language
"speech-active meter updates" — consistent with ADR-016 Context "発話区間フレームの 26.4%".

The ADR-016 Context says:
  "発話区間フレームの 26.4% が < 43%"  → only speech-active frames, not silence frames.

Usage:
  python3 scripts/simulate_meter_peak_hold.py [--release-rate-per-ms RATE]
  python3 scripts/simulate_meter_peak_hold.py --sweep  # sweep multiple rates
"""

import argparse
import contextlib
import io
import math
import os
import struct
import subprocess
import sys

SAMPLE_RATE = 48000
WINDOW_SIZE = 512          # fftSize = 512
METER_HZ = 60              # target rAF rate
METER_INTERVAL_SAMPLES = SAMPLE_RATE // METER_HZ  # ~800 samples per meter tick

# dBFS mapping constants — must match volume-meter.ts exactly
FLOOR_DB = -60.0
CEILING_DB = 0.0
MIN_DISPLAY_PERCENTAGE = 2.0

# ADR-015 gate threshold (speech-active RMS, calibrated 2026-06-17)
GATE_SPEECH_ACTIVE_DBFS = -36.0

# Speech-active frame threshold for meter VAD:
# Frames with raw meter ≤ SILENCE_FLOOR_PCT are considered silence (not speech-active).
# MIN_DISPLAY_PERCENTAGE (2%) = silence floor from the meter formula.
# We use > 2% (strictly above floor) as "speech-active meter frame".
SILENCE_METER_FLOOR_PCT = MIN_DISPLAY_PERCENTAGE

# ADR-015 calibration: speech_active_dBFS per file
# Source: .agent-evidence/calibration-speech-active-rms.txt (2026-06-17)
SPEECH_ACTIVE_DBFS_FROM_CALIBRATION: dict[str, float] = {
    "01KTV6FJXPP5DRB1HK97Y1VNVC.webm": -39.5,  # ONLY gate-rejected file (< -36 dBFS)
    "01KV2FX22P979SM93ZFWCE8ERP.webm": -32.9,
    "01KTTR2ZYFQMCYZECW3BDKCN0F.webm": -28.8,
    "01KV2GSS131VN7R88FCM4DP2BG.webm": -29.7,
    "01KTT0W1A46FCACAMANCWVX65Q.webm": -24.7,
    "01KV28W19WFQ22EP6RB15Z29M7.webm": -28.1,
    "01KTSZKPWVZ5Q4THPJK3XPCX7E.webm": -18.6,
    "01KTV3FEMT682Y61E8CF6JF1N6.webm": -19.9,
    "01KV257J4QC6YBH0YF94SG0ZDA.webm": -19.5,
    "01KV2Y9N8WM5E8EFSR2Y00P39N.webm": -22.5,
    "01KV2D8B9JNZJFBSZ8001XS7R4.webm": -25.1,
    "01KV2QEY42DD3D084WYN57T1E0.webm": -19.4,
    "01KTTK5Q9QDAN8SHW3XKEB7GW6.webm": -14.7,
    "01KV25A3SEP1PSES5R7CJ2VPAM.webm": -25.8,
    "01KV2SK0KPRPPTQXTBSKJ72T9B.webm": -23.5,
    "01KTTPHHA8T8A9H8N6G6JCKKJC.webm": -13.7,
    "01KTTKJSBSVDQN1SVAYGZJ4W33.webm": -15.9,
    "01KTTR0NSKGC8S90645VADSD7M.webm": -15.9,
    "01KV28XM6PJZBGA86M0769NTB7.webm": -22.5,
    "01KTZP6F645MPXGCX96N9W9ACN.wav": -21.5,
    "01KTZRJC810H914GVX372NF7P9.wav": -21.5,
    "01KTZZ5QZNTS2WBCB27NHT1ZS6.wav": -21.5,
    "01KTV7JYYZXZ6V6R84WMWGX09N.webm": -19.2,
    "01KTV60D15FC3XJCS3JYKPCHPV.webm": -19.1,
    "01KV43FD1GMTK93F5SVQXEKZ0J.webm": -18.6,
    "01KV43FSGXP0QYR1X4HTAVHRV4.webm": -18.6,
    "01KTV7GNY4742VS7X8XVB45MVE.webm": -18.0,
    "01KTV33M7H9PVD4J55J73J6X6P.webm": -13.8,
    "01KTTKKSR2H9T8VZSG9N9EWNVS.webm": -12.1,
    "01KTV6G18E07JFTG5PPY4SADVT.webm": -11.2,
}

# 3 known-corrupt webm files (skip per task instruction)
KNOWN_CORRUPT = {
    "01KTST3YJGKXQJ0HVQG3HX2NPS.webm",
    "01KTT0ASB353YJYWNQ9Y4C88NM.webm",
    "01KTTPJZ5966E4JZZ58F7MAQYW.webm",
}

AUDIO_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "applications", "frontend", "data", "audio",
)


# ---- Pure functions mirroring volume-meter.ts ----

def compute_rms_from_bytes(byte_window: list[int]) -> float:
    """Mirrors computeRmsLevel(timeDomainData: Uint8Array)."""
    if not byte_window:
        return 0.0
    sum_sq = 0.0
    for b in byte_window:
        normalized = (b - 128) / 128.0
        sum_sq += normalized * normalized
    return math.sqrt(sum_sq / len(byte_window))


def rms_to_display_percentage(rms: float) -> float:
    """Mirrors rmsLevelToDisplayPercentage from volume-meter.ts."""
    if rms <= 0:
        return MIN_DISPLAY_PERCENTAGE
    clamped = min(1.0, rms)
    dbfs = 20.0 * math.log10(clamped)
    if dbfs <= FLOOR_DB:
        return MIN_DISPLAY_PERCENTAGE
    pct = (
        ((dbfs - FLOOR_DB) / (CEILING_DB - FLOOR_DB)) * (100 - MIN_DISPLAY_PERCENTAGE)
        + MIN_DISPLAY_PERCENTAGE
    )
    return min(100.0, pct)


def apply_peak_hold(current_percent: float, previous_displayed: float, release_amount: float) -> float:
    """Mirrors applyPeakHold (to be implemented in volume-meter.ts)."""
    return max(0.0, max(current_percent, previous_displayed - release_amount))


def float_to_uint8(sample: float) -> int:
    """Quantize [-1,1] float to [0,255] byte (mirroring getByteTimeDomainData)."""
    return max(0, min(255, round(128 * (sample + 1))))


# ---- Audio decoding ----

def load_audio_as_mono_float(filepath: str) -> list[float] | None:
    """Decode audio to 48kHz mono float using ffmpeg. Returns samples in [-1,1] or None."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", filepath, "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )
        if result.returncode != 0:
            return None
        raw = result.stdout
        num_samples = len(raw) // 4
        samples = list(struct.unpack(f"<{num_samples}f", raw[:num_samples * 4]))
        return samples
    except Exception as e:
        print(f"  ERROR decoding {os.path.basename(filepath)}: {e}", file=sys.stderr)
        return None


# ---- Meter simulation ----

def simulate_meter(
    samples: list[float],
    release_rate_per_ms: float,
    threshold: float,
) -> dict:
    """
    Simulate the browser rAF meter loop at ~60Hz.

    Per tick:
    - Advance METER_INTERVAL_SAMPLES (~800) through audio.
    - Read the latest WINDOW_SIZE (512) samples.
    - Quantize to uint8 (getByteTimeDomainData).
    - computeRmsLevel → rmsLevelToDisplayPercentage → applyPeakHold.
    - release_amount = release_rate_per_ms * (1000/60) [constant at 60fps].

    Counts for A1: only speech-active frames (raw > SILENCE_METER_FLOOR_PCT).
    Counts for A2: all frames (smoothed peak over entire clip).
    """
    release_amount_per_frame = release_rate_per_ms * (1000.0 / METER_HZ)

    previous_displayed = 0.0
    # All frames (for A2 peak tracking)
    all_smoothed = []
    # Speech-active frames only (for A1 below-threshold counting)
    speech_raw = []
    speech_smoothed = []

    num_steps = max(1, (len(samples) - WINDOW_SIZE) // METER_INTERVAL_SAMPLES)

    for step in range(num_steps):
        end_pos = min(len(samples), (step + 1) * METER_INTERVAL_SAMPLES + WINDOW_SIZE)
        start_pos = max(0, end_pos - WINDOW_SIZE)
        window_float = samples[start_pos:end_pos]

        # Quantize to uint8
        byte_window = [float_to_uint8(s) for s in window_float]

        raw_rms = compute_rms_from_bytes(byte_window)
        raw_pct = rms_to_display_percentage(raw_rms)
        smoothed_pct = apply_peak_hold(raw_pct, previous_displayed, release_amount_per_frame)
        previous_displayed = smoothed_pct

        all_smoothed.append(smoothed_pct)

        # Only count speech-active frames in A1 (strictly above silence floor)
        if raw_pct > SILENCE_METER_FLOOR_PCT:
            speech_raw.append(raw_pct)
            speech_smoothed.append(smoothed_pct)

    if not all_smoothed:
        return {
            "num_frames_total": 0,
            "num_frames_speech_active": 0,
            "raw_speech_below_threshold_pct": 0.0,
            "smoothed_speech_below_threshold_pct": 0.0,
            "smoothed_peak_all": 0.0,
        }

    raw_speech_below = sum(1 for p in speech_raw if p < threshold)
    smoothed_speech_below = sum(1 for p in speech_smoothed if p < threshold)
    n_speech = len(speech_raw)

    return {
        "num_frames_total": len(all_smoothed),
        "num_frames_speech_active": n_speech,
        "raw_speech_below_threshold_pct": 100.0 * raw_speech_below / n_speech if n_speech > 0 else 0.0,
        "smoothed_speech_below_threshold_pct": 100.0 * smoothed_speech_below / n_speech if n_speech > 0 else 0.0,
        "smoothed_peak_all": max(all_smoothed),
    }


# ---- Main simulation runner ----

def run_simulation(release_rate_per_ms: float, threshold: float, verbose: bool = True) -> dict:
    """Run simulation across all non-corrupt audio files. Returns aggregate stats."""
    audio_files = sorted([
        os.path.join(AUDIO_DIR, f)
        for f in os.listdir(AUDIO_DIR)
        if (f.endswith(".wav") or f.endswith(".webm")) and f not in KNOWN_CORRUPT
    ])

    results = []
    passing_gate_below_values = []   # A1: gate-passing files, speech-active frames below threshold
    rejected_peaks = []              # A2: gate-rejected files, smoothed peak
    rejected_above_threshold = 0

    if verbose:
        release_per_frame = release_rate_per_ms * (1000.0 / METER_HZ)
        decay_ms = 98.0 / release_rate_per_ms if release_rate_per_ms > 0 else float("inf")
        print(
            f"\n=== Peak-hold meter simulation (ADR-016) ==="
            f"\n    RELEASE_RATE_PER_MS = {release_rate_per_ms:.4f} %/ms"
            f"\n    release per frame   = {release_per_frame:.3f} % (at {METER_HZ} fps)"
            f"\n    full→floor decay    ≈ {decay_ms:.0f} ms"
            f"\n    threshold           = {threshold:.1f}%"
        )
        print()
        print(
            f"{'File':<45} {'SpeechAct':>9} {'Gate':>7}"
            f" {'RawBelow%(sa)':>13} {'SmBelow%(sa)':>12} {'SmPeak%':>8}"
        )
        print("-" * 100)

    for filepath in audio_files:
        filename = os.path.basename(filepath)
        speech_active_dbfs = SPEECH_ACTIVE_DBFS_FROM_CALIBRATION.get(filename)
        if speech_active_dbfs is None:
            if verbose:
                print(f"  SKIP (no calibration data): {filename}")
            continue

        samples = load_audio_as_mono_float(filepath)
        if samples is None:
            if verbose:
                print(f"  SKIP (decode failed): {filename}")
            continue

        is_gate_rejected = speech_active_dbfs < GATE_SPEECH_ACTIVE_DBFS

        stats = simulate_meter(samples, release_rate_per_ms, threshold)
        stats["filename"] = filename
        stats["speech_active_dbfs"] = speech_active_dbfs
        stats["is_gate_rejected"] = is_gate_rejected
        results.append(stats)

        gate_label = "REJECT" if is_gate_rejected else "PASS"

        if verbose:
            breach_marker = " *** BREACH" if is_gate_rejected and stats["smoothed_peak_all"] >= threshold else ""
            print(
                f"  {filename:<43} {speech_active_dbfs:>+9.1f} {gate_label:>7}"
                f" {stats['raw_speech_below_threshold_pct']:>13.1f}"
                f" {stats['smoothed_speech_below_threshold_pct']:>12.1f}"
                f" {stats['smoothed_peak_all']:>8.1f}{breach_marker}"
            )

        if not is_gate_rejected:
            passing_gate_below_values.append(stats["smoothed_speech_below_threshold_pct"])

        if is_gate_rejected:
            rejected_peaks.append(stats["smoothed_peak_all"])
            if stats["smoothed_peak_all"] >= threshold:
                rejected_above_threshold += 1

    if verbose:
        print()
        print("--- AGGREGATE ---")

        if passing_gate_below_values:
            avg_below = sum(passing_gate_below_values) / len(passing_gate_below_values)
            max_below = max(passing_gate_below_values)
            a1_pass = avg_below <= 5.0
            print(
                f"  A1 (gate-passing, n={len(passing_gate_below_values)}):"
                f" avg speech-active frames below threshold = {avg_below:.1f}%,"
                f" max = {max_below:.1f}%"
                f"  (target avg ≤5%)  → {'PASS' if a1_pass else 'FAIL'}"
            )
        else:
            print("  A1: no gate-passing files decoded")
            a1_pass = False

        if rejected_peaks:
            a2_pass = rejected_above_threshold == 0
            print(
                f"  A2 (gate-rejected, n={len(rejected_peaks)}):"
                f" smoothed peaks = {[f'{p:.1f}' for p in rejected_peaks]}"
                f"  (must all be < {threshold:.0f}%)  → {'PASS' if a2_pass else 'FAIL'}"
            )
        else:
            print("  A2: no gate-rejected files decoded")
            a2_pass = False
        print()

    a1_avg = sum(passing_gate_below_values) / len(passing_gate_below_values) if passing_gate_below_values else None
    quiet_peak_max = max(rejected_peaks) if rejected_peaks else 0.0

    return {
        "results": results,
        "a1_avg_below_pct": a1_avg,
        "a1_max_below_pct": max(passing_gate_below_values) if passing_gate_below_values else None,
        "a1_count": len(passing_gate_below_values),
        "a2_peak_max": quiet_peak_max,
        "a2_above_threshold_count": rejected_above_threshold,
        "a2_count": len(rejected_peaks),
        "a1_pass": a1_avg is not None and a1_avg <= 5.0,
        "a2_pass": rejected_above_threshold == 0,
    }


def sweep_rates(threshold: float) -> None:
    """Sweep RELEASE_RATE_PER_MS values to find optimal."""
    rates = [0.05, 0.1, 0.15, 0.2, 0.25, 0.327, 0.35, 0.4, 0.5, 0.6, 0.8, 1.0]
    print(f"\n=== SWEEP: threshold={threshold}% ===\n")
    print(
        f"{'Rate(%/ms)':>12} {'Frm(%/f)':>9} {'A1avg%':>7} {'A1max%':>7}"
        f" {'A1pass':>7} {'A2maxpeak%':>11} {'A2pass':>7}"
    )
    print("-" * 68)
    for rate in rates:
        with contextlib.redirect_stdout(io.StringIO()):
            agg = run_simulation(rate, threshold, verbose=False)
        a1_avg = agg["a1_avg_below_pct"]
        a1_max = agg["a1_max_below_pct"]
        a1_pass = agg["a1_pass"]
        a2_peak = agg["a2_peak_max"]
        a2_pass = agg["a2_pass"]
        frame_decay = rate * (1000.0 / 60)
        print(
            f"  {rate:>10.4f} {frame_decay:>9.3f}"
            f" {(a1_avg if a1_avg is not None else float('nan')):>7.1f}"
            f" {(a1_max if a1_max is not None else float('nan')):>7.1f}"
            f" {str(a1_pass):>7}"
            f" {a2_peak:>11.1f} {str(a2_pass):>7}"
        )
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate peak-hold volume meter (ADR-016)")
    parser.add_argument(
        "--release-rate-per-ms", type=float, default=0.327,
        help="Release rate in %%/ms (default: 0.327 ≈ 98%%/300ms)",
    )
    parser.add_argument(
        "--threshold", type=float, default=41.0,
        help="LOW_VOLUME_DISPLAY_THRESHOLD in %% (default: 41 = -36 dBFS)",
    )
    parser.add_argument(
        "--sweep", action="store_true",
        help="Sweep multiple release rates to find optimal value",
    )
    args = parser.parse_args()

    computed_threshold = (
        ((-36 - FLOOR_DB) / (CEILING_DB - FLOOR_DB)) * (100 - MIN_DISPLAY_PERCENTAGE)
        + MIN_DISPLAY_PERCENTAGE
    )
    print(
        f"Threshold derivation: -36 dBFS on current curve"
        f" = ((-36+60)/60)*98+2 = {computed_threshold:.2f}% → using {args.threshold:.0f}%"
    )

    if args.sweep:
        sweep_rates(args.threshold)
    else:
        run_simulation(args.release_rate_per_ms, args.threshold, verbose=True)


if __name__ == "__main__":
    main()
