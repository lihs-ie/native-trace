"""Kokoro-82M TTS インフラ実装（M-124）。

kokoro PyPI (KPipeline) を使用して General American 音声を合成する。
CPU のみ動作。24kHz WAV バイト列を返す。

ADR-009: Kokoro の 20 American voice embedding（af_* 11 + am_* 9）で
long-tail 対立の多話者刺激を合成するための voice 引数を提供する。
"""

import io
import logging
import wave

logger = logging.getLogger(__name__)

# Kokoro American English デフォルト voice ID（公開定数・handler / テストから参照可）
DEFAULT_VOICE = "af_heart"

# Kokoro American English 全 20 声（af_* 女性 11 / am_* 男性 9）
# ADR-009: long-tail 対立の多話者刺激に使用する voice 定数群。
KOKORO_FEMALE_VOICES: tuple[str, ...] = (
    "af_heart",
    "af_bella",
    "af_nicole",
    "af_aoede",
    "af_sarah",
    "af_sky",
    "af_alloy",
    "af_nova",
    "af_shimmer",
    "af_jessica",
    "af_kore",
)

KOKORO_MALE_VOICES: tuple[str, ...] = (
    "am_michael",
    "am_puck",
    "am_fenrir",
    "am_echo",
    "am_eric",
    "am_liam",
    "am_onyx",
    "am_adam",
    "am_santa",
)

# 全 20 声のセット（バリデーション用）
ALL_KOKORO_VOICES: frozenset[str] = frozenset(KOKORO_FEMALE_VOICES + KOKORO_MALE_VOICES)

# Kokoro のデフォルトサンプリングレート
_KOKORO_SAMPLE_RATE = 24000


def synthesize_speech(
    text: str,
    speed: float = 1.0,
    voice: str = DEFAULT_VOICE,
) -> bytes:
    """Kokoro-82M でテキストを音声合成し WAV バイト列を返す。

    Args:
        text: 合成対象テキスト。
        speed: 再生速度 (0.5–1.0)。Kokoro の speed パラメータに渡す。
        voice: 使用する voice ID（デフォルト af_heart）。
            ALL_KOKORO_VOICES に含まれる値のみ受け付ける。
            既存呼び出し元が省略しても af_heart で動作する（後方互換）。

    Returns:
        24kHz モノ 16bit PCM WAV バイト列（非空）。

    Raises:
        ValueError: voice が ALL_KOKORO_VOICES に含まれない場合。
        RuntimeError: kokoro が利用不可の場合、または合成が空を返した場合。
    """
    if voice not in ALL_KOKORO_VOICES:
        raise ValueError(
            f"無効な voice ID: {voice!r}。"
            f"利用可能な voice: {sorted(ALL_KOKORO_VOICES)}"
        )

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
    for chunk_result in pipeline(text, voice=voice, speed=speed):
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


def select_multi_talker_voices(
    count: int,
    require_mixed_sex: bool = True,
) -> list[str]:
    """多話者刺激合成用に voice のサブセットを選択して返す。

    ADR-009 の talker variability 要件（5 名以上・男女混在）を満たすために
    carve パイプラインが long-tail 対立の Kokoro 補完時に呼び出す contract 関数。

    Args:
        count: 必要な voice 数。2 以上 20 以下。
        require_mixed_sex: True の場合、選択に女性・男性を両方含める（デフォルト True）。

    Returns:
        voice ID のリスト（長さ count）。前半 female、後半 male の順で交互に
        ローテーションして選択する。

    Raises:
        ValueError: count が 2 未満または 20 超の場合。
                    require_mixed_sex=True かつ count < 2 の場合。
    """
    if count < 2:
        raise ValueError(f"count は 2 以上が必要です: {count}")
    if count > len(ALL_KOKORO_VOICES):
        raise ValueError(
            f"count は {len(ALL_KOKORO_VOICES)} 以下が必要です: {count}"
        )

    female_list = list(KOKORO_FEMALE_VOICES)
    male_list = list(KOKORO_MALE_VOICES)

    if require_mixed_sex:
        # 男女交互に count 名選択する（奇数 count は female が 1 名多い）
        selected: list[str] = []
        female_index = 0
        male_index = 0
        for position in range(count):
            if position % 2 == 0:
                selected.append(female_list[female_index % len(female_list)])
                female_index += 1
            else:
                selected.append(male_list[male_index % len(male_list)])
                male_index += 1
        return selected
    else:
        # 混在不要の場合は female → male の順に詰める
        combined = female_list + male_list
        return combined[:count]


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
