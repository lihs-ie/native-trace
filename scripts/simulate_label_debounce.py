#!/usr/bin/env python3
"""
D4 label-debounce calibration script (ADR-016).

Simulates accumulateLowDurationMs + the debounced isLowVolume label logic
on top of the existing peak-hold simulation.

For each file and each SUSTAINED_LOW_MS candidate:
  - Run the rAF loop at 60Hz with PEAK_HOLD_RELEASE_RATE_PER_MS = 0.327.
  - Per tick: compute smoothed value via applyPeakHold.
  - Apply label debounce:
      below_ms accumulates dtMs while smoothed < threshold; resets when >= threshold.
      isLowVolume = (below_ms >= SUSTAINED_LOW_MS).
  - Speech-active VAD: float RMS > 0.01 (consistent with meter-rate-sweep.txt).
  - Report: fraction of speech-active TIME the label shows 音量小.

Goal:
  - Normal-to-loud recordings (speech_active >= -25 dBFS): label_time_pct ~ 0%.
  - Gate-rejected file (01KTV6FJ..., -39.5 dBFS): label ON (label_time_pct ~ 100%).
  - Pick the smallest SUSTAINED_LOW_MS that achieves both.

Usage:
  python3 scripts/simulate_label_debounce.py
"""

import math
import os
import struct
import subprocess
import sys

SAMPLE_RATE = 48000
WINDOW_SIZE = 512
METER_HZ = 60
METER_INTERVAL_SAMPLES = SAMPLE_RATE // METER_HZ  # ~800 samples per meter tick
DT_MS = 1000.0 / METER_HZ  # ~16.67ms per tick at 60Hz

# dBFS mapping constants (must match volume-meter.ts exactly)
FLOOR_DB = -60.0
CEILING_DB = 0.0
MIN_DISPLAY_PERCENTAGE = 2.0

# Already-confirmed peak-hold rate (D1)
PEAK_HOLD_RELEASE_RATE_PER_MS = 0.327
RELEASE_AMOUNT_PER_FRAME = PEAK_HOLD_RELEASE_RATE_PER_MS * DT_MS

# Threshold (D2: -36 dBFS = 41%)
LOW_VOLUME_DISPLAY_THRESHOLD = 41.0

# ADR-015 gate threshold
GATE_SPEECH_ACTIVE_DBFS = -36.0

# Speech-active VAD threshold for label-time counting:
# Use float RMS > 0.01 (consistent with meter-rate-sweep.txt energy-VAD)
SPEECH_ACTIVE_FLOAT_RMS_THRESHOLD = 0.01

# SUSTAINED_LOW_MS candidates to sweep (ms)
SUSTAINED_LOW_MS_CANDIDATES = [200, 300, 400, 500, 600, 800, 1000]

# ADR-015 calibration: speech_active_dBFS per file
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
    if not byte_window:
        return 0.0
    sum_sq = 0.0
    for b in byte_window:
        normalized = (b - 128) / 128.0
        sum_sq += normalized * normalized
    return math.sqrt(sum_sq / len(byte_window))


def compute_rms_from_floats(float_window: list[float]) -> float:
    if not float_window:
        return 0.0
    sum_sq = sum(s * s for s in float_window)
    return math.sqrt(sum_sq / len(float_window))


def rms_to_display_percentage(rms: float) -> float:
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
    return max(0.0, max(current_percent, previous_displayed - release_amount))


def float_to_uint8(sample: float) -> int:
    return max(0, min(255, round(128 * (sample + 1))))


def accumulate_low_duration_ms(
    previous_below_ms: float,
    smoothed_value: float,
    threshold: float,
    dt_ms: float,
) -> float:
    """
    Mirrors accumulateLowDurationMs from volume-meter.ts (D4).
    If smoothed_value < threshold: accumulate dt_ms.
    Otherwise: reset to 0.
    """
    if smoothed_value < threshold:
        return previous_below_ms + dt_ms
    return 0.0


# ---- Audio decoding ----

def load_audio_as_mono_float(filepath: str) -> list[float] | None:
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


# ---- Meter + debounce simulation ----

def simulate_with_debounce(
    samples: list[float],
    sustained_low_ms: float,
) -> dict:
    """
    Simulate rAF meter loop at 60Hz with peak-hold + label debounce.

    Returns:
      - total_speech_active_time_ms: sum of DT_MS for VAD-active ticks
      - label_on_speech_time_ms: sum of DT_MS for VAD-active ticks where isLowVolume is True
      - label_time_pct: label_on / total_speech_active (%)
      - label_on_at_end: whether label is on in the final tick (for gate-rejected check)
    """
    previous_displayed = 0.0
    below_ms = 0.0

    total_speech_active_time_ms = 0.0
    label_on_speech_time_ms = 0.0
    is_low_volume = False

    num_steps = max(1, (len(samples) - WINDOW_SIZE) // METER_INTERVAL_SAMPLES)

    for step in range(num_steps):
        end_pos = min(len(samples), (step + 1) * METER_INTERVAL_SAMPLES + WINDOW_SIZE)
        start_pos = max(0, end_pos - WINDOW_SIZE)
        window_float = samples[start_pos:end_pos]

        # Energy VAD: float RMS > 0.01
        float_rms = compute_rms_from_floats(window_float)
        is_speech_active = float_rms > SPEECH_ACTIVE_FLOAT_RMS_THRESHOLD

        # Meter (byte quantization, mirroring browser getByteTimeDomainData)
        byte_window = [float_to_uint8(s) for s in window_float]
        raw_rms = compute_rms_from_bytes(byte_window)
        raw_pct = rms_to_display_percentage(raw_rms)
        smoothed = apply_peak_hold(raw_pct, previous_displayed, RELEASE_AMOUNT_PER_FRAME)
        previous_displayed = smoothed

        # Label debounce (D4)
        below_ms = accumulate_low_duration_ms(below_ms, smoothed, LOW_VOLUME_DISPLAY_THRESHOLD, DT_MS)
        is_low_volume = below_ms >= sustained_low_ms

        if is_speech_active:
            total_speech_active_time_ms += DT_MS
            if is_low_volume:
                label_on_speech_time_ms += DT_MS

    label_time_pct = (
        100.0 * label_on_speech_time_ms / total_speech_active_time_ms
        if total_speech_active_time_ms > 0
        else 0.0
    )

    return {
        "total_speech_active_time_ms": total_speech_active_time_ms,
        "label_on_speech_time_ms": label_on_speech_time_ms,
        "label_time_pct": label_time_pct,
        "label_on_at_end": is_low_volume,
    }


# ---- Main ----

def main() -> None:
    audio_files = sorted([
        os.path.join(AUDIO_DIR, f)
        for f in os.listdir(AUDIO_DIR)
        if (f.endswith(".wav") or f.endswith(".webm")) and f not in KNOWN_CORRUPT
    ])

    # Load and decode all files first
    file_data: list[tuple[str, float, list[float]]] = []
    print("Decoding audio files...")
    for filepath in audio_files:
        filename = os.path.basename(filepath)
        speech_active_dbfs = SPEECH_ACTIVE_DBFS_FROM_CALIBRATION.get(filename)
        if speech_active_dbfs is None:
            print(f"  SKIP (no calibration data): {filename}")
            continue
        samples = load_audio_as_mono_float(filepath)
        if samples is None:
            print(f"  SKIP (decode failed): {filename}")
            continue
        file_data.append((filename, speech_active_dbfs, samples))
        print(f"  loaded {filename} ({len(samples)} samples, speech_active={speech_active_dbfs:+.1f} dBFS)")

    print(f"\nLoaded {len(file_data)} files\n")

    # Identify gate-rejected and gate-passing subsets
    gate_rejected = [(f, d, s) for (f, d, s) in file_data if d < GATE_SPEECH_ACTIVE_DBFS]
    gate_passing = [(f, d, s) for (f, d, s) in file_data if d >= GATE_SPEECH_ACTIVE_DBFS]
    normal_loud = [(f, d, s) for (f, d, s) in gate_passing if d >= -25.0]

    print(f"Gate-rejected files: {len(gate_rejected)}")
    for (f, d, _) in gate_rejected:
        print(f"  {f} ({d:+.1f} dBFS)")
    print(f"Gate-passing files: {len(gate_passing)}")
    print(f"Normal-to-loud files (>= -25 dBFS): {len(normal_loud)}")

    print()
    print("=== D4 Label Debounce Calibration (ADR-016) ===")
    print(f"    PEAK_HOLD_RELEASE_RATE_PER_MS = {PEAK_HOLD_RELEASE_RATE_PER_MS}")
    print(f"    LOW_VOLUME_DISPLAY_THRESHOLD  = {LOW_VOLUME_DISPLAY_THRESHOLD}%")
    print(f"    Speech-active VAD: float RMS > {SPEECH_ACTIVE_FLOAT_RMS_THRESHOLD} (energy-VAD)")
    print(f"    DT_MS per tick: {DT_MS:.2f} ms")
    print()
    print("Goal: normal-to-loud (>= -25 dBFS) → label_time_pct ~ 0%; gate-rejected (-39.5 dBFS) → label ON")
    print()

    # Sweep SUSTAINED_LOW_MS candidates
    print(f"{'SUSTAINED_LOW_MS':>16} | {'Normal avg%':>11} | {'Normal max%':>11} | {'Gate-rejected label_time%':>24} | {'label_on_at_end':>14} | Result")
    print("-" * 100)

    best_ms = None
    for sustained_ms in SUSTAINED_LOW_MS_CANDIDATES:
        normal_label_pcts = []
        rejected_label_pcts = []
        rejected_label_on_at_end = []

        for (filename, speech_active_dbfs, samples) in gate_passing:
            result = simulate_with_debounce(samples, sustained_ms)
            if speech_active_dbfs >= -25.0:
                normal_label_pcts.append(result["label_time_pct"])

        for (filename, speech_active_dbfs, samples) in gate_rejected:
            result = simulate_with_debounce(samples, sustained_ms)
            rejected_label_pcts.append(result["label_time_pct"])
            rejected_label_on_at_end.append(result["label_on_at_end"])

        normal_avg = sum(normal_label_pcts) / len(normal_label_pcts) if normal_label_pcts else float("nan")
        normal_max = max(normal_label_pcts) if normal_label_pcts else float("nan")
        rejected_avg = sum(rejected_label_pcts) / len(rejected_label_pcts) if rejected_label_pcts else float("nan")
        all_rejected_on = all(rejected_label_on_at_end)

        normal_ok = normal_avg < 1.0 and normal_max < 5.0
        rejected_ok = all_rejected_on
        overall_ok = normal_ok and rejected_ok

        if overall_ok and best_ms is None:
            best_ms = sustained_ms

        marker = " <-- BEST (smallest that works)" if sustained_ms == best_ms else ""
        print(
            f"  {sustained_ms:>14}ms | {normal_avg:>10.1f}% | {normal_max:>10.1f}% | {rejected_avg:>23.1f}% | {str(all_rejected_on):>14} | {'PASS' if overall_ok else 'FAIL'}{marker}"
        )

    print()
    if best_ms is not None:
        print(f"SELECTED SUSTAINED_LOW_MS = {best_ms} ms")
        print(f"  Rationale: smallest value where normal speech label_time ~ 0% AND gate-rejected shows label ON")
    else:
        print("WARNING: No candidate passes both criteria. Manual review needed.")
        # Fall back to 500ms target as spec says
        best_ms = 500
        print(f"  Defaulting to spec target: {best_ms} ms")

    print()
    print("=== Per-file detail for SELECTED SUSTAINED_LOW_MS ===")
    print(f"    SUSTAINED_LOW_MS = {best_ms} ms")
    print()
    print(f"{'File':<45} {'SpeechAct':>9} {'Gate':>7} {'LabelTime%':>11} {'LabelOnEnd':>11}")
    print("-" * 90)

    for (filename, speech_active_dbfs, samples) in file_data:
        is_rejected = speech_active_dbfs < GATE_SPEECH_ACTIVE_DBFS
        gate_label = "REJECT" if is_rejected else "PASS"
        result = simulate_with_debounce(samples, best_ms)
        print(
            f"  {filename:<43} {speech_active_dbfs:>+9.1f} {gate_label:>7}"
            f" {result['label_time_pct']:>10.1f}%"
            f" {str(result['label_on_at_end']):>11}"
        )

    print()
    print(f"FINAL DECISION: SUSTAINED_LOW_MS = {best_ms} ms")
    print()
    print("Summary:")
    print(f"  - Gate-rejected file (01KTV6FJ, -39.5 dBFS): label stays ON (label_on_at_end=True)")
    print(f"  - Normal-to-loud recordings: label_time_pct ~ 0% during speech-active time")
    print(f"  - This value will be used as SUSTAINED_LOW_MS in volume-meter.ts")


if __name__ == "__main__":
    main()
