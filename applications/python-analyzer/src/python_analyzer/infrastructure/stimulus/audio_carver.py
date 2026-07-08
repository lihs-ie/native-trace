"""WAV audio carving utilities for LibriTTS stimulus extraction.

Reads WAV files from the LibriTTS archive and cuts word-level segments
based on TextGrid word boundaries.

ADR-009: "grep the transcripts for target words → look up pre-computed
word boundary → cut → quality-filter by RMS"
"""

from __future__ import annotations

import io
import struct
import wave

# Minimum RMS quality threshold for extracted word audio.
# Below this level the segment is too quiet to be a usable stimulus.
MINIMUM_RMS_QUALITY = 0.005  # ~-46 dBFS

# Minimum word duration to accept (very short segments are likely alignment errors)
MINIMUM_WORD_DURATION_SECONDS = 0.08

# Maximum word duration (monosyllabic words should not exceed ~1 second)
MAXIMUM_WORD_DURATION_SECONDS = 1.2

# Padding added before/after the word boundary for naturalness (seconds)
BOUNDARY_PADDING_SECONDS = 0.03


def carve_word_segment(
    wav_bytes: bytes,
    start_seconds: float,
    end_seconds: float,
    padding_seconds: float = BOUNDARY_PADDING_SECONDS,
) -> bytes:
    """Extract a word-level audio segment from a WAV file.

    Applies symmetric padding and returns a new WAV file (bytes).

    Args:
        wav_bytes: Complete WAV file bytes.
        start_seconds: Word start time (from TextGrid alignment).
        end_seconds: Word end time (from TextGrid alignment).
        padding_seconds: Pre/post padding in seconds (default 30 ms).

    Returns:
        New WAV bytes containing only the word segment.

    Raises:
        ValueError: If the WAV bytes are invalid or the time range is out of bounds.
    """
    with wave.open(io.BytesIO(wav_bytes), "r") as wav_reader:
        sample_rate = wav_reader.getframerate()
        num_channels = wav_reader.getnchannels()
        sample_width = wav_reader.getsampwidth()
        total_frames = wav_reader.getnframes()

        # Apply padding, clamped to the file bounds.
        padded_start = max(0.0, start_seconds - padding_seconds)
        padded_end = min(total_frames / sample_rate, end_seconds + padding_seconds)

        start_frame = int(padded_start * sample_rate)
        end_frame = int(padded_end * sample_rate)
        num_frames_to_read = end_frame - start_frame

        if num_frames_to_read <= 0:
            raise ValueError(f"Invalid frame range: start={start_frame}, end={end_frame}")

        wav_reader.setpos(start_frame)
        raw_frames = wav_reader.readframes(num_frames_to_read)

    # Write extracted segment as new WAV.
    output_buffer = io.BytesIO()
    with wave.open(output_buffer, "w") as wav_writer:
        wav_writer.setnchannels(num_channels)
        wav_writer.setsampwidth(sample_width)
        wav_writer.setframerate(sample_rate)
        wav_writer.writeframes(raw_frames)

    return output_buffer.getvalue()


def compute_rms(wav_bytes: bytes) -> float:
    """Compute the normalised RMS amplitude of a WAV file.

    Returns a value in [0, 1] where 1.0 is full-scale clipping.

    Args:
        wav_bytes: Complete WAV file bytes.

    Returns:
        Root Mean Square amplitude (0–1 linear scale).
    """
    with wave.open(io.BytesIO(wav_bytes), "r") as wav_reader:
        sample_width = wav_reader.getsampwidth()
        num_channels = wav_reader.getnchannels()
        total_frames = wav_reader.getnframes()

        if total_frames == 0:
            return 0.0

        raw_frames = wav_reader.readframes(total_frames)

    # Determine the format string for struct.unpack.
    if sample_width == 2:
        fmt_char = "h"  # int16
        max_value = 32768.0
    elif sample_width == 1:
        fmt_char = "B"  # uint8
        max_value = 128.0
    elif sample_width == 4:
        fmt_char = "i"  # int32
        max_value = 2147483648.0
    else:
        return 0.0

    num_samples = len(raw_frames) // sample_width
    samples = struct.unpack(f"<{num_samples}{fmt_char}", raw_frames[: num_samples * sample_width])

    # For stereo, average channels.
    if num_channels > 1:
        # Reduce to mono by averaging channel samples.
        mono_samples = [
            sum(samples[i : i + num_channels]) / num_channels
            for i in range(0, len(samples), num_channels)
        ]
    else:
        mono_samples = list(samples)

    if not mono_samples:
        return 0.0

    sum_of_squares = sum(s * s for s in mono_samples)
    rms_raw = (sum_of_squares / len(mono_samples)) ** 0.5
    return rms_raw / max_value


def passes_quality_filter(
    wav_bytes: bytes,
    duration_seconds: float,
    minimum_rms: float = MINIMUM_RMS_QUALITY,
    minimum_duration: float = MINIMUM_WORD_DURATION_SECONDS,
    maximum_duration: float = MAXIMUM_WORD_DURATION_SECONDS,
) -> bool:
    """Return True if the carved segment meets quality thresholds.

    Checks:
    - Duration within [minimum_duration, maximum_duration]
    - RMS above minimum_rms (not too quiet)

    Args:
        wav_bytes: The carved WAV segment to check.
        duration_seconds: Duration of the segment (end - start, pre-padding).
        minimum_rms: Minimum acceptable RMS amplitude.
        minimum_duration: Minimum segment duration in seconds.
        maximum_duration: Maximum segment duration in seconds.

    Returns:
        True if the segment passes all quality checks.
    """
    if duration_seconds < minimum_duration or duration_seconds > maximum_duration:
        return False

    rms = compute_rms(wav_bytes)
    return rms >= minimum_rms
