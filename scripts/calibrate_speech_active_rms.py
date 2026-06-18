#!/usr/bin/env python3
"""Calibration runner: compute whole-file vs speech-active dBFS for the audio corpus.

Usage:
    python3 scripts/calibrate_speech_active_rms.py

Mirrors the analyzer path exactly:
  - ffmpeg decode to 16kHz mono float32 (same as _load_audio_tensor)
  - compute_speech_active_rms from audio_energy (same as measure_audio_quality after ADR-015)
  - 20 * log10(speech_active_rms) → speech-active dBFS

Output: .agent-evidence/calibration-speech-active-rms.txt
"""

import math
import subprocess
import sys
from pathlib import Path

import numpy as np

# Add python-analyzer src to path
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "applications/python-analyzer/src"))

from python_analyzer.infrastructure.audio_energy import (  # noqa: E402
    ENERGY_SILENCE_RMS_THRESHOLD,
    compute_speech_active_rms,
)

AUDIO_DIR = REPO_ROOT / "applications/frontend/data/audio"
OUTPUT_FILE = REPO_ROOT / ".agent-evidence/calibration-speech-active-rms.txt"

SAMPLE_RATE = 16000


def decode_to_float32(audio_path: Path) -> np.ndarray:
    """Decode audio file to 16kHz mono float32 via ffmpeg (mirrors analyzer path)."""
    cmd = [
        "ffmpeg",
        "-i", str(audio_path),
        "-f", "f32le",
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "pipe:1",
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {audio_path.name}: {result.stderr.decode()[:200]}")
    return np.frombuffer(result.stdout, dtype=np.float32)


def whole_file_dbfs(waveform: np.ndarray) -> float:
    """Whole-file RMS dBFS (old method, for comparison)."""
    rms = float(np.sqrt(np.mean(waveform**2)))
    if rms < 1e-9:
        return -100.0
    return 20.0 * math.log10(rms)


def speech_active_dbfs(waveform: np.ndarray) -> float:
    """Speech-active-frame RMS dBFS (new method, ADR-015 D1)."""
    rms = compute_speech_active_rms(waveform)
    if rms < 1e-9:
        return -100.0
    return 20.0 * math.log10(rms)


def main() -> None:
    audio_files = sorted(AUDIO_DIR.glob("*.webm")) + sorted(AUDIO_DIR.glob("*.wav"))
    if not audio_files:
        print(f"No audio files found in {AUDIO_DIR}", file=sys.stderr)
        sys.exit(1)

    rows = []
    errors = []
    for audio_path in audio_files:
        try:
            waveform = decode_to_float32(audio_path)
            whole = whole_file_dbfs(waveform)
            speech = speech_active_dbfs(waveform)
            sentinel = speech < -99.0
            gain = speech - whole if not sentinel else float("nan")
            rows.append((audio_path.name, whole, speech, sentinel, gain))
        except Exception as exc:
            errors.append((audio_path.name, str(exc)))

    # Sort by whole-file dBFS ascending (loudest at bottom)
    rows.sort(key=lambda r: r[1])

    speech_dbfs_values = [r[2] for r in rows if not r[3]]

    lines = []
    lines.append("# Calibration: speech-active-frame RMS dBFS vs whole-file RMS dBFS")
    lines.append(f"# Corpus: {AUDIO_DIR}")
    lines.append(f"# Files processed: {len(rows)}  Errors: {len(errors)}")
    lines.append(f"# ENERGY_SILENCE_RMS_THRESHOLD: {ENERGY_SILENCE_RMS_THRESHOLD}")
    lines.append(f"# Date: 2026-06-17")
    lines.append("")
    lines.append(
        f"{'filename':<45} {'whole_dBFS':>10} {'speech_dBFS':>12} {'sentinel':>8} {'gain_dB':>8}"
    )
    lines.append("-" * 90)
    for name, whole, speech, sentinel, gain in rows:
        gain_str = f"{gain:+.1f}" if not math.isnan(gain) else "  N/A"
        sentinel_str = "yes" if sentinel else "no"
        lines.append(f"{name:<45} {whole:>10.1f} {speech:>12.1f} {sentinel_str:>8} {gain_str:>8}")

    if errors:
        lines.append("")
        lines.append("# Errors:")
        for name, msg in errors:
            lines.append(f"#   {name}: {msg}")

    if speech_dbfs_values:
        speech_arr = np.array(speech_dbfs_values)
        lines.append("")
        lines.append("# Speech-active dBFS distribution (non-sentinel only):")
        lines.append(f"#   N:    {len(speech_arr)}")
        lines.append(f"#   min:  {speech_arr.min():.1f} dBFS")
        lines.append(f"#   P10:  {float(np.percentile(speech_arr, 10)):.1f} dBFS")
        lines.append(f"#   P25:  {float(np.percentile(speech_arr, 25)):.1f} dBFS")
        lines.append(f"#   med:  {float(np.median(speech_arr)):.1f} dBFS")
        lines.append(f"#   P75:  {float(np.percentile(speech_arr, 75)):.1f} dBFS")
        lines.append(f"#   max:  {speech_arr.max():.1f} dBFS")

    # Print to stdout and also note 01KTT0W1 specifically
    ktt0w1_rows = [r for r in rows if "01KTT0W1" in r[0]]
    if ktt0w1_rows:
        lines.append("")
        lines.append("# 01KTT0W1 (reference clip — was falsely rejected at -35.0 threshold):")
        for r in ktt0w1_rows:
            lines.append(f"#   {r[0]}: whole={r[1]:.1f} speech_active={r[2]:.1f} dBFS")

    lines.append("")
    lines.append("# Threshold selection rule (ADR-015 band: -33 to -38 dBFS):")
    # Choose threshold: we want 01KTT0W1-class (~-30 dBFS speech-active) to PASS
    # and genuinely silent clips (speech_active <= -40 dBFS or sentinel) to FAIL.
    # Based on the distribution, pick the threshold in [-33, -38] range.
    # Default recommendation: -36.0 unless data shows otherwise.
    if speech_dbfs_values:
        p10 = float(np.percentile(speech_arr, 10))
        # Target: P10 of speech-active values, clamped to [-33, -38] band
        candidate = max(-38.0, min(-33.0, p10))
        lines.append(f"#   P10 of speech-active dBFS: {p10:.1f} dBFS")
        lines.append(f"#   Clamped to ADR-015 band [-33, -38]: {candidate:.1f} dBFS")
        lines.append(f"#   RECOMMENDED audioQualityMinMeanDbfs: {candidate:.1f} dBFS")
        lines.append("#")
        lines.append(
            "#   Rule: clips with speech_active_dBFS < threshold are rejected as low_quality."
        )
        lines.append(
            "#   01KTT0W1-class (speech_active ~-30 dBFS) must pass (> threshold)."
        )
        lines.append(
            "#   Truly silent clips (sentinel or speech_active <= -40 dBFS) must fail."
        )

    output_text = "\n".join(lines) + "\n"
    print(output_text)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(output_text)
    print(f"\n[saved to {OUTPUT_FILE}]", file=sys.stderr)


if __name__ == "__main__":
    main()
