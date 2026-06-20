"""drift sentinel のユニットテスト（ネットワーク / docker 不要）。

S-DRIFT-1: _hash_pip_lines（純粋関数）と classify_drift（純粋関数）を
docker / analyzer なしで検証する。

pytest でそのまま実行可能:
    pytest applications/python-analyzer/test/selfeval/test_drift_check.py
"""

from __future__ import annotations

import os
import sys
import tempfile

import pytest

# test ルートを sys.path に追加する
_TEST_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _TEST_ROOT not in sys.path:
    sys.path.insert(0, _TEST_ROOT)

from selfeval.compute_fingerprint import _hash_pip_lines  # noqa: E402
from selfeval.drift_check import classify_drift, _extract_fresh_signals  # noqa: E402


# ---------------------------------------------------------------------------
# テストヘルパー
# ---------------------------------------------------------------------------


def _make_dockerfile(lines: list[str]) -> str:
    """一時 Dockerfile を作成してパスを返す。テスト後は呼び出し元が削除する。"""
    content = "\n".join(lines) + "\n"
    with tempfile.NamedTemporaryFile(
        mode="w", suffix="Dockerfile", delete=False, encoding="utf-8"
    ) as temp_file:
        temp_file.write(content)
        return temp_file.name


def _make_pinned_observed(
    band_min: float = -16.0,
    band_max: float = -5.0,
    phonemes: list[str] | None = None,
) -> dict:
    """テスト用 pinned observed ブロックを生成する。"""
    if phonemes is None:
        phonemes = ["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]
    return {
        "analyzerCommit": "docker:sha256:PINNED|pip:PINNED",
        "gop": {"band": {"min": band_min, "max": band_max}},
        "topNBest": {"phonemes": phonemes},
    }


def _make_fresh_signals(
    gop_values: list[float],
    top1_phonemes: list[str],
    detected_ipa: str = "hɛloʊ wɜːld",
    structure_intact: bool = True,
    structure_error: str | None = None,
) -> dict:
    """テスト用 fresh_signals dict を生成する（_extract_fresh_signals の出力形状と同じ）。"""
    if gop_values:
        gop_band = {"min": min(gop_values), "max": max(gop_values)}
    else:
        gop_band = {"min": 0.0, "max": 0.0}
    return {
        "gop_values": gop_values,
        "gop_band": gop_band,
        "top1_phonemes": top1_phonemes,
        "detected_ipa": detected_ipa,
        "structure_intact": structure_intact,
        "structure_error": structure_error,
    }


# ---------------------------------------------------------------------------
# _hash_pip_lines のテスト（S-DRIFT-1: 純粋関数、docker 不要）
# ---------------------------------------------------------------------------


class TestHashPipLines:
    def test_extracts_pip_install_lines(self) -> None:
        """pip install を含む行が抽出されて hash に含まれること。"""
        dockerfile_path = _make_dockerfile(
            [
                "FROM python:3.11-slim",
                "RUN pip install numpy scipy",
                "COPY src/ /app/src/",
                "RUN pip3 install torch",
                "CMD python app.py",
            ]
        )
        try:
            result = _hash_pip_lines(dockerfile_path)
            assert isinstance(result, str)
            assert len(result) == 64, "SHA-256 hex は 64 文字"
        finally:
            os.unlink(dockerfile_path)

    def test_pip_line_change_changes_hash(self) -> None:
        """pip install 行が変わると hash が変わること。"""
        dockerfile_a_path = _make_dockerfile(
            [
                "FROM python:3.11-slim",
                "RUN pip install numpy==1.24.0",
            ]
        )
        dockerfile_b_path = _make_dockerfile(
            [
                "FROM python:3.11-slim",
                "RUN pip install numpy==2.0.0",
            ]
        )
        try:
            hash_a = _hash_pip_lines(dockerfile_a_path)
            hash_b = _hash_pip_lines(dockerfile_b_path)
            assert hash_a != hash_b, "pip バージョン変化で hash が変わること"
        finally:
            os.unlink(dockerfile_a_path)
            os.unlink(dockerfile_b_path)

    def test_non_pip_line_change_does_not_change_hash(self) -> None:
        """pip install 以外の行が変わっても hash が変わらないこと。"""
        common_pip = "RUN pip install numpy"
        dockerfile_a_path = _make_dockerfile(
            [
                "FROM python:3.11-slim AS builder",
                common_pip,
            ]
        )
        dockerfile_b_path = _make_dockerfile(
            [
                "FROM python:3.11-slim AS runtime",  # non-pip 行が違う
                common_pip,
            ]
        )
        try:
            hash_a = _hash_pip_lines(dockerfile_a_path)
            hash_b = _hash_pip_lines(dockerfile_b_path)
            assert hash_a == hash_b, "pip 行が同じなら hash は同じ"
        finally:
            os.unlink(dockerfile_a_path)
            os.unlink(dockerfile_b_path)

    def test_no_pip_lines_returns_deterministic_hash(self) -> None:
        """pip install 行がゼロ件でも決定論的な hash を返すこと（エラーにならない）。"""
        dockerfile_path = _make_dockerfile(
            [
                "FROM python:3.11-slim",
                "COPY src/ /app/",
                "CMD python app.py",
            ]
        )
        try:
            result = _hash_pip_lines(dockerfile_path)
            assert isinstance(result, str)
            assert len(result) == 64
        finally:
            os.unlink(dockerfile_path)

    def test_pip3_install_is_captured(self) -> None:
        """pip3 install を含む行も hash に含まれること。"""
        dockerfile_with_pip3 = _make_dockerfile(
            ["FROM python:3.11-slim", "RUN pip3 install torch"]
        )
        dockerfile_without_pip3 = _make_dockerfile(
            ["FROM python:3.11-slim", "# no pip lines"]
        )
        try:
            hash_with = _hash_pip_lines(dockerfile_with_pip3)
            hash_without = _hash_pip_lines(dockerfile_without_pip3)
            assert hash_with != hash_without, "pip3 行が hash に寄与すること"
        finally:
            os.unlink(dockerfile_with_pip3)
            os.unlink(dockerfile_without_pip3)

    def test_hash_is_deterministic(self) -> None:
        """同じ Dockerfile に対して複数回呼んでも同じ hash を返すこと。"""
        dockerfile_path = _make_dockerfile(
            ["FROM python:3.11-slim", "RUN pip install numpy scipy"]
        )
        try:
            hash_1 = _hash_pip_lines(dockerfile_path)
            hash_2 = _hash_pip_lines(dockerfile_path)
            assert hash_1 == hash_2
        finally:
            os.unlink(dockerfile_path)


# ---------------------------------------------------------------------------
# classify_drift のテスト（S-DRIFT-1: 純粋関数、analyzer 不要）
# ---------------------------------------------------------------------------


class TestClassifyDrift:
    """classify_drift のテスト。

    M-DRIFT-4 改訂:
        HARD regression: gop sign-flip / gop out-of-band / structure broken
        ADVISORY (majority-gated): topNBest IPA 変化
            - 変化位置 ≥ ceil(N/2) → escalate（regression）
            - 変化位置 < ceil(N/2) → benign + advisoryIpaDrift に記録
    """

    def test_benign_when_all_conditions_met(self) -> None:
        """全条件が満たされる場合は benign を返すこと。"""
        pinned = _make_pinned_observed(band_min=-16.0, band_max=-5.0)
        # band 内の負 gop、phoneme 一致
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "benign"
        # IPA 変化ゼロ → advisory は記録のみ（escalated=False、benign）
        assert advisory["changedPositions"] == 0
        assert advisory["escalated"] is False
        # 拡散 CTC advisory diff 行のみ（regression diff 行なし）
        regression_diff_lines = [l for l in diff_lines if "topNBest IPA change:" in l]
        assert regression_diff_lines == []

    def test_regression_on_gop_sign_flip(self) -> None:
        """pinned band が全負なのに fresh gop が正なら regression（符号反転）。"""
        pinned = _make_pinned_observed(band_min=-16.0, band_max=-5.0)
        # 1 つの gop が正
        fresh = _make_fresh_signals(
            gop_values=[2.1, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "regression"
        assert any("sign-flip" in line for line in diff_lines)

    def test_minority_ipa_change_stays_benign(self) -> None:
        """topNBest top-1 phoneme が少数（minority）変化した場合は benign（advisory のみ）。

        8 phonemes 中 1 position 変化 → 1 < ceil(8/2)=4 → benign。
        advisoryIpaDrift に記録されること。
        """
        pinned = _make_pinned_observed(
            band_min=-16.0, band_max=-5.0, phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]
        )
        # pos0 の phoneme が 'ZZZ' に変化（1/8 = minority）
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["ZZZ", "ə", "l", "oʊ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "benign", "1/8 minority change must not escalate"
        assert advisory["changedPositions"] == 1
        assert advisory["total"] == 8
        assert advisory["escalated"] is False
        # advisory 行が記録されること
        advisory_lines = [l for l in diff_lines if "advisoryIpaDrift" in l]
        assert len(advisory_lines) == 1
        assert "pos0" in advisory_lines[0]
        # regression 用の "topNBest IPA change:" 行は出ないこと
        regression_ipa_lines = [l for l in diff_lines if "topNBest IPA change:" in l]
        assert regression_ipa_lines == []

    def test_majority_ipa_change_escalates_to_regression(self) -> None:
        """topNBest top-1 phoneme が過半数（majority）変化した場合は regression。

        8 phonemes 全て変化 → 8 ≥ ceil(8/2)=4 → regression（model-swap class）。
        """
        pinned = _make_pinned_observed(
            band_min=-16.0, band_max=-5.0, phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]
        )
        # 全 phonemes が 'ZZZ' に変化（8/8 = majority）
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["ZZZ", "ZZZ", "ZZZ", "ZZZ", "ZZZ", "ZZZ", "ZZZ", "ZZZ"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "regression"
        assert advisory["changedPositions"] == 8
        assert advisory["total"] == 8
        assert advisory["escalated"] is True
        # topNBest IPA change 行が出ること
        ipa_change_lines = [l for l in diff_lines if "topNBest IPA change:" in l]
        assert len(ipa_change_lines) == 8

    def test_exactly_majority_threshold_escalates(self) -> None:
        """変化位置が exactly ceil(N/2) の場合は escalate。

        8 phonemes 中 4 position 変化 → 4 == ceil(8/2)=4 → regression。
        """
        pinned = _make_pinned_observed(
            band_min=-16.0, band_max=-5.0, phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]
        )
        # pos0,1,2,3 が変化（4/8 = exactly majority）
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["ZZZ", "ZZZ", "ZZZ", "ZZZ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "regression"
        assert advisory["changedPositions"] == 4
        assert advisory["escalated"] is True

    def test_below_majority_threshold_stays_benign(self) -> None:
        """変化位置が ceil(N/2) - 1 の場合は benign（advisory のみ）。

        8 phonemes 中 3 position 変化 → 3 < ceil(8/2)=4 → benign。
        """
        pinned = _make_pinned_observed(
            band_min=-16.0, band_max=-5.0, phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]
        )
        # pos0,1,2 が変化（3/8 = below majority）
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["ZZZ", "ZZZ", "ZZZ", "oʊ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "benign"
        assert advisory["changedPositions"] == 3
        assert advisory["escalated"] is False

    def test_regression_on_gop_out_of_band_beyond_epsilon(self) -> None:
        """gop が band から ε=2.0 を超えて外れると regression。"""
        pinned = _make_pinned_observed(band_min=-16.0, band_max=-5.0)
        # -19.5 は band_min(-16) から 3.5 離れており ε=2.0 を超える
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -19.5],
            top1_phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "regression"
        assert any("out-of-band" in line for line in diff_lines)

    def test_benign_within_epsilon_of_band_boundary(self) -> None:
        """gop が band 境界から ε 以内（厳密には band 外だが ε 範囲内）なら benign。"""
        pinned = _make_pinned_observed(band_min=-16.0, band_max=-5.0)
        # -17.5 は band_min(-16) から 1.5 離れており ε=2.0 以内
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -17.5],
            top1_phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "benign"
        # advisory lines のみ（regression diff 行なし）
        regression_lines = [l for l in diff_lines if "sign-flip" in l or "out-of-band" in l or "structure broken" in l]
        assert regression_lines == []

    def test_regression_on_structure_broken_empty_nbest(self) -> None:
        """nBest が空なら構造破損として regression。"""
        pinned = _make_pinned_observed()
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0],
            top1_phonemes=[],
            structure_intact=False,
            structure_error="perPhonemeGop[1] has empty nBest",
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "regression"
        assert any("structure broken" in line for line in diff_lines)

    def test_regression_on_topnbest_length_mismatch_majority(self) -> None:
        """topNBest の長さが大幅不一致（majority 超過）の場合は regression。

        pinned=8, fresh=3 → 5 positions changed (extra 5) + 0 mismatches in overlap → 5/8 ≥ 4 → regression。
        """
        pinned = _make_pinned_observed(
            phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]  # 8 phonemes
        )
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0],
            top1_phonemes=["h", "ə", "l"],  # 3 phonemes (large mismatch: 5 extra missing)
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "regression"
        assert advisory["escalated"] is True

    def test_advisory_ipa_drift_in_benign_result(self) -> None:
        """benign 時も advisoryIpaDrift dict が返ること（changedPositions=0 の場合）。"""
        pinned = _make_pinned_observed(
            phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]
        )
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"],
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "benign"
        assert "changedPositions" in advisory
        assert "total" in advisory
        assert "escalated" in advisory
        assert advisory["changedPositions"] == 0
        assert advisory["total"] == 8
        assert advisory["escalated"] is False

    def test_multiple_ipa_changes_all_reported_when_majority(self) -> None:
        """majority の IPA 変化が全て diff_lines に含まれること。"""
        pinned = _make_pinned_observed(
            phonemes=["h", "ə", "l", "oʊ", "w", "ɜː", "l", "d"]
        )
        fresh = _make_fresh_signals(
            gop_values=[-6.0, -7.0, -8.0, -9.0, -10.0, -11.0, -12.0, -13.0],
            top1_phonemes=["ZZZ", "ə", "XXX", "YYY", "AAA", "ɜː", "l", "d"],  # 4/8 = majority
        )
        classification, diff_lines, advisory = classify_drift(fresh, pinned)
        assert classification == "regression"
        # pos0, pos2, pos3, pos4 の 4 positions が報告されること
        ipa_change_lines = [l for l in diff_lines if "topNBest IPA change:" in l]
        assert len(ipa_change_lines) == 4


# ---------------------------------------------------------------------------
# _extract_fresh_signals のテスト
# ---------------------------------------------------------------------------


class TestExtractFreshSignals:
    def _make_valid_response(
        self,
        gops: list[float] | None = None,
        phonemes: list[str] | None = None,
        detected_ipa: str = "hɛloʊ",
    ) -> dict:
        if gops is None:
            gops = [-6.0, -7.0, -8.0]
        if phonemes is None:
            phonemes = ["h", "ə", "l"]
        assert len(gops) == len(phonemes)
        per_phoneme_gop = [
            {
                "phoneme": phoneme,
                "gop": gop,
                "nBest": [{"phoneme": phoneme, "confidence": 0.01}],
            }
            for phoneme, gop in zip(phonemes, gops)
        ]
        return {
            "perPhonemeGop": per_phoneme_gop,
            "detectedIpa": detected_ipa,
            "estimatedSnrDb": 5.0,
        }

    def test_extracts_gop_values_and_band(self) -> None:
        """gop_values と gop_band が正しく抽出されること。"""
        response = self._make_valid_response(gops=[-6.0, -10.0, -14.0])
        signals = _extract_fresh_signals(response)
        assert signals["gop_values"] == [-6.0, -10.0, -14.0]
        assert signals["gop_band"] == {"min": -14.0, "max": -6.0}

    def test_extracts_top1_phonemes(self) -> None:
        """nBest[0].phoneme が top1_phonemes に抽出されること。"""
        response = self._make_valid_response(phonemes=["h", "ə", "l"])
        signals = _extract_fresh_signals(response)
        assert signals["top1_phonemes"] == ["h", "ə", "l"]

    def test_structure_intact_for_valid_response(self) -> None:
        """正常なレスポンスは structure_intact=True であること。"""
        response = self._make_valid_response()
        signals = _extract_fresh_signals(response)
        assert signals["structure_intact"] is True
        assert signals["structure_error"] is None

    def test_structure_broken_on_empty_per_phoneme_gop(self) -> None:
        """perPhonemeGop が空の場合は structure_intact=False であること。"""
        response = {"perPhonemeGop": [], "detectedIpa": "hɛloʊ"}
        signals = _extract_fresh_signals(response)
        assert signals["structure_intact"] is False
        assert signals["structure_error"] is not None

    def test_structure_broken_on_empty_nbest(self) -> None:
        """nBest が空の場合は structure_intact=False であること。"""
        response = {
            "perPhonemeGop": [
                {"phoneme": "h", "gop": -6.0, "nBest": []},  # nBest が空
            ],
            "detectedIpa": "hɛloʊ",
        }
        signals = _extract_fresh_signals(response)
        assert signals["structure_intact"] is False
        assert signals["structure_error"] is not None

    def test_detected_ipa_extracted(self) -> None:
        """detectedIpa が detected_ipa に抽出されること。"""
        response = self._make_valid_response(detected_ipa="hɛloʊ wɜːld")
        signals = _extract_fresh_signals(response)
        assert signals["detected_ipa"] == "hɛloʊ wɜːld"
