"""per-phoneme フォルマント・スペクトル重心計測インフラ実装（parselmouth / Praat バックエンド）。

GPL-3.0 の parselmouth を使用。python-analyzer 内部利用に限定する（ADR-006 境界）。
`import parselmouth` はこのファイル内にのみ存在すること。

ADR-018 D2: to_formant_burg を発話全体で 1 回呼び、境界中点でサンプリングする。
             max_number_of_formants=5 (定数・本数) / maximum_formant=Hz 天井 (呼び出し側から受け取る)。
ADR-018 D3: 40ms 未満ガード (f1/f2/f3=None), 重心は 30ms 未満で None。
M-APD-19: 単一中点サンプリングを多点 median サンプリングに置換。区間内側 0.3〜0.7 の 5 点で
           get_value_at_time を取り、NaN を除いた median を採る。全点 NaN の場合のみ None。
           forced-alignment が区間を過大に伸ばし幾何中点が voicing offset を越える音素（例: /r/）でも
           内側の有声フレームから formant を取得できる。spectral centroid は区間全体計算のため不変。
"""

import logging

from scipy import signal as scipy_signal  # hard dependency — fails loudly at startup if absent

from python_analyzer.domain.measurement import PhonemeAcousticMeasurement
from python_analyzer.domain.phoneme import AlignmentBoundary

logger = logging.getLogger(__name__)

# S-APD-3 (Phase 2 実装者向け注記):
# VOT 計測を追加する際、/v/-/b/ 等の有声閉塞音・摩擦音には VOT ではなく
# 摩擦エネルギー比 (frication_energy_ratio) を使用すること。
# VOT は /p/-/t/-/k/ 等の無声閉塞音にのみ適用する（ADR-018 Phase 2 スコープ）。


def _decode_samples(raw: bytes) -> tuple[object, int]:
    """音声バイト列を numpy 配列 + サンプリングレートにデコードする。

    soundfile(libsndfile) は WAV/FLAC 等しか読めず、ブラウザ録音の WebM/OGG は読めない。
    まず soundfile を試し、失敗したら ffmpeg で WAV PCM に変換して読み直す
    (ffmpeg は入力フォーマットをストリームから自動判定するため mime_type 不要)。
    parselmouth_prosody.py の同一パターンを踏襲する。
    """
    import io
    import subprocess

    import soundfile as sf

    try:
        return sf.read(io.BytesIO(raw), dtype="float64")
    except Exception:
        result = subprocess.run(
            [
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-i", "pipe:0", "-f", "wav", "-acodec", "pcm_s16le", "pipe:1",
            ],
            input=raw,
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg デコード失敗: {result.stderr.decode(errors='replace')}"
            )
        return sf.read(io.BytesIO(result.stdout), dtype="float64")


def extract_phoneme_acoustics(
    audio_bytes: bytes,
    boundaries: tuple[AlignmentBoundary, ...],
    sample_rate: int,
    maximum_formant_hz: float,
) -> tuple[PhonemeAcousticMeasurement, ...]:
    """音素ごとのフォルマント・スペクトル重心・持続時間を計測する。

    ADR-018 D2: to_formant_burg を発話全体で 1 回呼び、各境界の中点でサンプリングする。
    ADR-018 D3: 40ms 未満区間は f1/f2/f3 None (サンプリングスキップ)。
                30ms 未満区間はスペクトル重心 None。
                持続時間は常に算出。

    Args:
        audio_bytes: 音声バイト列（WAV ヘッダー付き）。
        boundaries: 音素アライメント境界 tuple。
        sample_rate: サンプリングレート（Hz）。使用は _decode_samples に委譲。
        maximum_formant_hz: フォルマント推定の Hz 天井（F→6500, M/unknown→5500）。

    Returns:
        PhonemeAcousticMeasurement の tuple。parselmouth 利用不可時は ()。
    """
    try:
        import parselmouth  # type: ignore[import-untyped]
    except ImportError as error:
        logger.warning("parselmouth が利用不可のため音素音響計測を空で返す: %s", error)
        return ()

    import numpy as np

    if not boundaries:
        return ()

    try:
        samples, decoded_rate = _decode_samples(audio_bytes)
        # ステレオはモノにまとめる
        if hasattr(samples, "ndim") and samples.ndim > 1:  # type: ignore[union-attr]
            samples = samples.mean(axis=1)  # type: ignore[union-attr]
        samples_array = np.asarray(samples, dtype="float64")

        sound = parselmouth.Sound(samples_array, sampling_frequency=decoded_rate)

        # ADR-018 D2: to_formant_burg を発話全体で 1 回呼ぶ（per-phoneme では呼ばない）
        # max_number_of_formants=5 は本数（定数）; maximum_formant は Hz 天井（呼び出し側から受け取る）
        # NOTE: これらの引数を取り違えると全フォルマントが無効になる致命的バグ（D2 regression risk）。
        formants = sound.to_formant_burg(
            time_step=0.005,
            max_number_of_formants=5,
            maximum_formant=maximum_formant_hz,
            window_length=0.025,
            pre_emphasis_from=50,
        )

        results: list[PhonemeAcousticMeasurement] = []

        for boundary in boundaries:
            start_ms = boundary.start_milliseconds
            end_ms = boundary.end_milliseconds
            duration_ms = end_ms - start_ms

            # フォルマント: 40ms 未満区間はサンプリングをスキップ（ADR-018 D3）
            if duration_ms < 40:
                f1: float | None = None
                f2: float | None = None
                f3: float | None = None
            else:
                # M-APD-19: 多点 median サンプリング（単一中点 → 区間内側 0.3〜0.7 の 5 点）。
                # forced-alignment が区間を過大伸張し幾何中点が voicing offset を越える場合（例: /r/）でも
                # 内側の有声フレームから formant を取得できる。F1/F2/F3 を独立に NaN 除去して median を採る。
                # 全点 NaN の場合のみ当該 formant を None にする（spec M-APD-19 参照）。
                start_s = start_ms / 1000.0
                end_s = end_ms / 1000.0
                sample_fractions = [0.3, 0.4, 0.5, 0.6, 0.7]
                sample_times = [start_s + f * (end_s - start_s) for f in sample_fractions]
                f1 = _get_formant_median(formants, 1, sample_times)
                f2 = _get_formant_median(formants, 2, sample_times)
                f3 = _get_formant_median(formants, 3, sample_times)

            # スペクトル重心: 30ms 未満区間は None（ADR-018 D3）
            # 重心計算失敗はフォルマント結果を捨てないよう独立ガードで保護する
            if duration_ms < 30:
                spectral_centroid: float | None = None
            else:
                try:
                    spectral_centroid = _compute_spectral_centroid(
                        samples_array, decoded_rate, start_ms, end_ms
                    )
                except Exception as centroid_error:
                    logger.warning(
                        "スペクトル重心計算エラー（フォルマントは維持）: %s", centroid_error
                    )
                    spectral_centroid = None

            results.append(
                PhonemeAcousticMeasurement(
                    phoneme=boundary.phoneme.value,
                    start_milliseconds=start_ms,
                    end_milliseconds=end_ms,
                    f1_hz=f1,
                    f2_hz=f2,
                    f3_hz=f3,
                    spectral_centroid_hz=spectral_centroid,
                    duration_milliseconds=duration_ms,
                )
            )

        return tuple(results)

    except Exception as error:
        logger.error("音素音響計測エラー: %s", error, exc_info=True)
        return ()


def _get_formant_value(formants: object, formant_number: int, time_s: float) -> float | None:
    """フォルマントオブジェクトから指定番号のフォルマント値を取得する。

    NaN（未定義・無声区間）は None を返す。
    """
    value = formants.get_value_at_time(formant_number, time_s)  # type: ignore[union-attr]
    # NaN チェック: NaN != NaN は Python で True
    if value != value:
        return None
    return float(value)


def _get_formant_median(
    formants: object, formant_number: int, sample_times: list[float]
) -> float | None:
    """複数サンプル点の NaN 除去 median を返す（M-APD-19 多点サンプリング）。

    指定 formant_number を各 sample_times で取得し、有効値（非 NaN）の中央値を返す。
    全点 NaN の場合のみ None を返す。F1/F2/F3 を独立に処理することで、
    特定 formant が一部時点で NaN でも他の formant の値には影響しない。

    statistics.median は Python 3.4+ 標準ライブラリ（外部依存なし）。
    """
    import statistics

    valid_values = [
        v for t in sample_times if (v := _get_formant_value(formants, formant_number, t)) is not None
    ]
    if not valid_values:
        return None
    return statistics.median(valid_values)


def _compute_spectral_centroid(
    samples: object,
    sample_rate: float,
    start_ms: int,
    end_ms: int,
) -> float | None:
    """scipy/numpy で指定区間のスペクトル重心 Hz を計算する。

    sum(f * P(f)) / sum(P(f)) で定義。パワーがゼロの場合は None を返す。
    """
    import numpy as np

    samples_array = np.asarray(samples, dtype="float64")
    start_sample = int(start_ms * sample_rate / 1000)
    end_sample = int(end_ms * sample_rate / 1000)
    segment = samples_array[start_sample:end_sample]

    if len(segment) < 2:
        return None

    # Welch 法で PSD を推定する
    freqs, power_spectral_density = scipy_signal.welch(
        segment,
        fs=sample_rate,
        nperseg=min(256, len(segment)),
    )

    total_power = float(np.sum(power_spectral_density))
    if total_power <= 0.0:
        return None

    centroid = float(np.sum(freqs * power_spectral_density) / total_power)
    return centroid
