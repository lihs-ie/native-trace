"""Kokoro-82M TTS インフラ実装（M-124）。

kokoro PyPI (KPipeline) を使用して General American 音声を合成する。
CPU のみ動作。24kHz WAV バイト列を返す。
"""

import io
import logging
import wave

logger = logging.getLogger(__name__)

# Kokoro American English 音声 ID
_DEFAULT_VOICE = "af_heart"
# Kokoro のデフォルトサンプリングレート
_KOKORO_SAMPLE_RATE = 24000


def synthesize_speech(text: str, speed: float = 1.0) -> bytes:
    """Kokoro-82M でテキストを音声合成し WAV バイト列を返す。

    Args:
        text: 合成対象テキスト。
        speed: 再生速度 (0.5–1.0)。Kokoro の speed パラメータに渡す。

    Returns:
        24kHz モノ 16bit PCM WAV バイト列（非空）。

    Raises:
        RuntimeError: kokoro が利用不可の場合。
    """
    try:
        from kokoro import KPipeline  # type: ignore[import-untyped]
    except ImportError as error:
        raise RuntimeError(
            "kokoro ライブラリが利用できません。"
            f"pyproject.toml に kokoro を追加してください: {error}"
        ) from error

    pipeline = KPipeline(lang_code="a")  # American English

    # kokoro は generator を返す。複数チャンクを結合する
    audio_chunks: list[bytes] = []
    for chunk_result in pipeline(text, voice=_DEFAULT_VOICE, speed=speed):
        # chunk_result.audio は numpy 配列 (float32, -1.0 ~ 1.0)
        if chunk_result.audio is not None:
            chunk_audio = chunk_result.audio
            # numpy float32 (-1.0, 1.0) → int16 PCM に変換する
            pcm_int16 = _float32_to_int16_pcm(chunk_audio)
            audio_chunks.append(pcm_int16)

    if not audio_chunks:
        raise RuntimeError("Kokoro TTS が空の音声を返しました")

    all_pcm = b"".join(audio_chunks)
    return _wrap_as_wav(all_pcm, sample_rate=_KOKORO_SAMPLE_RATE)


def _float32_to_int16_pcm(audio_array: "object") -> bytes:
    """float32 numpy 配列を int16 PCM バイト列に変換する。

    Args:
        audio_array: numpy.ndarray float32 の音声データ。

    Returns:
        int16 PCM バイト列。
    """
    import numpy as np

    audio_np = np.array(audio_array, dtype=np.float32)
    # クリッピング後 int16 に変換する
    audio_clipped = np.clip(audio_np, -1.0, 1.0)
    audio_int16 = (audio_clipped * 32767).astype(np.int16)
    return audio_int16.tobytes()


def _wrap_as_wav(pcm_bytes: bytes, sample_rate: int) -> bytes:
    """PCM バイト列を WAV ファイル形式にラップする。

    Args:
        pcm_bytes: int16 モノ PCM バイト列。
        sample_rate: サンプリングレート（Hz）。

    Returns:
        WAV バイト列。
    """
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)  # モノラル
        wav_file.setsampwidth(2)  # 16bit = 2 bytes
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    return buffer.getvalue()
