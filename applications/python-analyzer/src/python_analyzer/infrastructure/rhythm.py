"""リズム指標計算インフラ実装。

純粋ロジックのみ。外部 I/O なし。
"""

from python_analyzer.domain.measurement import RhythmMeasurement

# 英語（General American）の代表的 nPVI-V 値（文献参照帯）
# Grabe & Low (2002) による英語の vocalic nPVI 代表値: 約 60–70
_ENGLISH_REFERENCE_NPVI_VOCALIC = 65.0


def npvi(durations: list[float]) -> float:
    """母音持続時間列から nPVI（normalized Pairwise Variability Index）を計算する純関数。

    nPVI = 100 / (m - 1) * Σ |d_k - d_{k+1}| / ((d_k + d_{k+1}) / 2)

    m = len(durations)。m < 2 のときは 0.0 を返す。
    持続時間 0 のペアは除外する（ゼロ除算回避）。

    Args:
        durations: 母音持続時間のリスト（ミリ秒 or 正の数値）。

    Returns:
        nPVI 値（0.0 以上）。
    """
    if len(durations) < 2:
        return 0.0

    total = 0.0
    count = 0
    for index in range(len(durations) - 1):
        dk = durations[index]
        dk1 = durations[index + 1]
        denom = (dk + dk1) / 2.0
        if denom > 0:
            total += abs(dk - dk1) / denom
            count += 1

    if count == 0:
        return 0.0

    return 100.0 / count * total


def compute_rhythm(vowel_durations_ms: list[float]) -> RhythmMeasurement:
    """母音持続時間列から RhythmMeasurement を計算する。

    Args:
        vowel_durations_ms: 母音持続時間リスト（ミリ秒）。

    Returns:
        RhythmMeasurement。
    """
    npvi_value = npvi(vowel_durations_ms)
    return RhythmMeasurement(
        npvi_vocalic=npvi_value,
        reference_npvi_vocalic=_ENGLISH_REFERENCE_NPVI_VOCALIC,
    )
