"""analyzer-level drift sentinel（ADR-031 D12 Stage-3 / M-DRIFT-2/4/5）。

使用方法:
    python3 applications/python-analyzer/test/selfeval/drift_check.py \
        --analyzer-url http://localhost:8788

出力フォーマット（stdout）:
    DRIFT fingerprint=match status=skip
        → 指紋一致時（再実行なし、exit 0）

    DRIFT <entryIdentifier> <benign|regression> fingerprint=mismatch
        classification=<benign|regression>
        → 指紋不一致時（再実行あり）

    regression があれば続けて diff 行:
        gop sign-flip: <phoneme> <pinned_sign_representative> -> <fresh_gop>
        gop out-of-band: <phoneme> fresh=<v> band=[<min>,<max>] margin=<ε>
        topNBest IPA change: pos<i> fresh=<p> pinned=<q>
        structure broken: <reason>

終了コード:
    0: 指紋一致（skip）または benign ドリフトのみ
    1: regression 1 件以上

注意:
    drift_check は NEVER manifest を書き換えない。
    re-pin は compute_fingerprint.py --write を明示的に実行した時のみ。

計測レイヤの境界（analyzer contract / M-DRIFT-4 コメント）:
    AnalysisResponse は perPhonemeGop[*].{gop, nBest} / detectedIpa / estimatedSnrDb を返す。
    severity / findingFires は worker = Scoring.hs の出力であり、/v1/analyze は返さない。
    drift-check は analyzer が実際に emit する信号のみを比較する。

依存: 標準ライブラリのみ（urllib, json, argparse, sys, os, pathlib）。
本番コードへの import は禁止（test scope 専用モジュール）。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Any

# transforms と compute_fingerprint をパス解決できるよう sys.path に test ルートを追加する
_TEST_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _TEST_ROOT not in sys.path:
    sys.path.insert(0, _TEST_ROOT)

from selfeval.compute_fingerprint import compute_fingerprint  # noqa: E402
from selfeval.transforms import call_analyze, load_wav, to_wav_bytes  # noqa: E402

# ---------------------------------------------------------------------------
# デフォルトパス定数
# ---------------------------------------------------------------------------

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
_DEFAULT_MANIFEST = os.path.join(
    _REPO_ROOT,
    "applications",
    "python-analyzer",
    "test",
    "fixtures",
    "corpus",
    "manifest.json",
)

# regression 判定の GOP out-of-band margin（既定 ε=2.0 GOP units）
_GOP_MARGIN_EPSILON: float = 2.0


# ---------------------------------------------------------------------------
# AnalysisResponse から drift 比較用シグナルを抽出する
# ---------------------------------------------------------------------------


def _extract_fresh_signals(
    response: dict[str, Any],
) -> dict[str, Any]:
    """AnalysisResponse から drift-check が監視するシグナルを抽出して返す。

    返す dict:
        gop_values: list[float] — perPhonemeGop[*].gop（位置順）
        gop_band: dict{"min": float, "max": float} — fresh gop の帯域
        top1_phonemes: list[str] — perPhonemeGop[*].nBest[0].phoneme（位置順）
        detected_ipa: str — detectedIpa フィールド（なければ空文字列）
        structure_intact: bool — 必須フィールド存在 + nBest 非空チェック
        structure_error: str | None — 構造破損があれば説明、なければ None
    """
    per_phoneme_gop: list[dict[str, Any]] = response.get("perPhonemeGop", [])

    # 構造チェック: perPhonemeGop 非空
    if not per_phoneme_gop:
        return {
            "gop_values": [],
            "gop_band": {"min": 0.0, "max": 0.0},
            "top1_phonemes": [],
            "detected_ipa": response.get("detectedIpa", ""),
            "structure_intact": False,
            "structure_error": "perPhonemeGop is empty or missing",
        }

    gop_values: list[float] = []
    top1_phonemes: list[str] = []
    structure_error: str | None = None

    for index, phoneme_entry in enumerate(per_phoneme_gop):
        # gop フィールド存在確認
        if "gop" not in phoneme_entry:
            structure_error = f"perPhonemeGop[{index}] missing 'gop' field"
            break
        gop_values.append(float(phoneme_entry["gop"]))

        # nBest 非空確認
        nbest = phoneme_entry.get("nBest", [])
        if not nbest:
            structure_error = f"perPhonemeGop[{index}] has empty nBest"
            break
        top1_phonemes.append(str(nbest[0].get("phoneme", "")))

    detected_ipa = response.get("detectedIpa", "")

    # detectedIpa 型チェック（str でなければ構造破損）
    if not isinstance(detected_ipa, str):
        structure_error = f"detectedIpa is not a string: {type(detected_ipa)}"

    structure_intact = structure_error is None and len(gop_values) == len(per_phoneme_gop)

    gop_band: dict[str, float]
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
# 純粋分類関数（S-DRIFT-1: pytest でテスト可能）
# ---------------------------------------------------------------------------


def classify_drift(
    fresh_signals: dict[str, Any],
    pinned_observed: dict[str, Any],
    gop_margin_epsilon: float = _GOP_MARGIN_EPSILON,
) -> tuple[str, list[str], dict[str, Any]]:
    """fresh シグナルと pinned 観測値を比較して分類を返す（純粋関数）。

    Args:
        fresh_signals: _extract_fresh_signals() が返す dict。
        pinned_observed: manifest.json の entries[*].observed ブロック。
        gop_margin_epsilon: out-of-band 判定の margin（既定 ε=2.0 GOP units）。

    Returns:
        (classification, diff_lines, advisory_ipa_drift):
            classification: "benign" | "regression"
            diff_lines: regression 時の人間可読 diff 行のリスト（benign なら空リスト）。
            advisory_ipa_drift: topNBest IPA 変化の advisory 情報 dict:
                {changedPositions: int, total: int, escalated: bool}

    分類基準（M-DRIFT-4 改訂版）:
        HARD regression トリガー（いずれかで escalate / exit 1）:
            - gop 符号反転（pinned band 全負なのに fresh が正、またはその逆）
            - gop が pinned band を ε を超えて外れる（out-of-band beyond margin）
            - 構造破損（perPhonemeGop / detectedIpa フィールド消失・型変化・nBest 空）
        topNBest IPA 変化 = ADVISORY（多数決ゲート）:
            - 変化位置が過半数（≥ ceil(N/2)）以上 → escalate（モデルスワップ class）
            - 変化位置が少数（< ceil(N/2)）→ benign + advisoryIpaDrift に記録
              （拡散 CTC ノイズ class）
            ※ rawTop1Conf=0.0142 の拡散 CTC では 1 位置の変化はノイズに相当する
              majority gate により scipy-incident class（全音素変化）は検出し続ける
        benign: HARD トリガー全て不成立 + IPA 変化が少数の場合
    """
    diff_lines: list[str] = []
    is_regression = False

    # --- 構造チェック（HARD トリガー）---
    if not fresh_signals["structure_intact"]:
        error_message = fresh_signals.get("structure_error") or "structure broken"
        diff_lines.append(f"  structure broken: {error_message}")
        is_regression = True

    # --- GOP チェック（HARD トリガー）---
    pinned_gop_band = pinned_observed.get("gop", {}).get("band", {})
    pinned_band_min = float(pinned_gop_band.get("min", 0.0))
    pinned_band_max = float(pinned_gop_band.get("max", 0.0))

    # pinned band の符号を判定（全体として負か正か）
    # band が全負 = max < 0（max が最大値でも負）
    pinned_band_all_negative = pinned_band_max < 0.0
    pinned_band_all_positive = pinned_band_min > 0.0

    fresh_gop_values: list[float] = fresh_signals["gop_values"]
    for fresh_gop in fresh_gop_values:
        # 符号反転チェック（HARD）
        if pinned_band_all_negative and fresh_gop > 0.0:
            diff_lines.append(
                f"  gop sign-flip: pinned band all-negative but "
                f"fresh gop={fresh_gop:.2f} is positive"
            )
            is_regression = True
        elif pinned_band_all_positive and fresh_gop < 0.0:
            diff_lines.append(
                f"  gop sign-flip: pinned band all-positive but "
                f"fresh gop={fresh_gop:.2f} is negative"
            )
            is_regression = True

        # out-of-band チェック（HARD / ε を超えた逸脱）
        if fresh_gop < pinned_band_min - gop_margin_epsilon:
            diff_lines.append(
                f"  gop out-of-band: fresh={fresh_gop:.2f} "
                f"below band=[{pinned_band_min},{pinned_band_max}] margin={gop_margin_epsilon}"
            )
            is_regression = True
        elif fresh_gop > pinned_band_max + gop_margin_epsilon:
            diff_lines.append(
                f"  gop out-of-band: fresh={fresh_gop:.2f} "
                f"above band=[{pinned_band_min},{pinned_band_max}] margin={gop_margin_epsilon}"
            )
            is_regression = True

    # --- topNBest IPA チェック（ADVISORY / majority-gated）---
    pinned_top1_phonemes: list[str] = pinned_observed.get("topNBest", {}).get("phonemes", [])
    fresh_top1_phonemes: list[str] = fresh_signals["top1_phonemes"]

    ipa_changed_positions: list[int] = []
    ipa_diff_details: list[tuple[int, str, str]] = []

    # 長さ不一致はそれ自体を advisory に記録し、比較対象の長さを揃える
    total_positions = max(len(fresh_top1_phonemes), len(pinned_top1_phonemes))

    for position, (fresh_phoneme, pinned_phoneme) in enumerate(
        zip(fresh_top1_phonemes, pinned_top1_phonemes, strict=False)
    ):
        if fresh_phoneme != pinned_phoneme:
            ipa_changed_positions.append(position)
            ipa_diff_details.append((position, fresh_phoneme, pinned_phoneme))

    # 長さ不一致がある場合は超過分を全て変化位置として扱う
    length_mismatch = len(fresh_top1_phonemes) != len(pinned_top1_phonemes)
    if length_mismatch:
        # 超過分の位置数を変化数に加算
        extra_count = abs(len(fresh_top1_phonemes) - len(pinned_top1_phonemes))
        for extra_index in range(extra_count):
            extra_position = min(len(fresh_top1_phonemes), len(pinned_top1_phonemes)) + extra_index
            ipa_changed_positions.append(extra_position)

    # majority gate: ≥ ceil(N/2) positions changed → escalate
    changed_count = len(ipa_changed_positions)
    majority_threshold = math.ceil(total_positions / 2) if total_positions > 0 else 1
    ipa_escalated = changed_count >= majority_threshold

    if ipa_escalated:
        # majority 超過 → HARD regression として昇格
        for position, fresh_phoneme, pinned_phoneme in ipa_diff_details:
            diff_lines.append(
                f"  topNBest IPA change: pos{position} "
                f"fresh={fresh_phoneme} pinned={pinned_phoneme}"
            )
        if length_mismatch:
            diff_lines.append(
                f"  topNBest length mismatch: fresh={len(fresh_top1_phonemes)} "
                f"pinned={len(pinned_top1_phonemes)}"
            )
        diff_lines.append(
            f"  topNBest IPA majority changed: {changed_count}/{total_positions} "
            f"positions (threshold={majority_threshold}) → escalated"
        )
        is_regression = True
    else:
        # minority → advisory のみ（benign に影響しない）
        for position, fresh_phoneme, pinned_phoneme in ipa_diff_details:
            diff_lines.append(
                f"  advisoryIpaDrift pos{position}: "
                f"fresh={fresh_phoneme} pinned={pinned_phoneme} "
                f"(minority {changed_count}/{total_positions}, not escalated)"
            )

    advisory_ipa_drift: dict[str, Any] = {
        "changedPositions": changed_count,
        "total": total_positions,
        "escalated": ipa_escalated,
    }

    classification = "regression" if is_regression else "benign"
    return classification, diff_lines, advisory_ipa_drift


# ---------------------------------------------------------------------------
# 1 entry の再実行と分類
# ---------------------------------------------------------------------------


def _rerun_entry(
    entry: dict[str, Any],
    analyzer_url: str,
    repo_root: str,
) -> dict[str, Any]:
    """1 corpus entry を /v1/analyze に送り fresh シグナルを収集して分類する。

    Returns:
        rerun 結果 dict（M-DRIFT-5 JSON reruns[] 要素の形状）。
    """
    entry_identifier: str = entry["entryIdentifier"]
    fixture_file: str = entry["fixtureFile"]
    reference_text: str = entry["referenceText"]
    observed: dict[str, Any] = entry.get("observed", {})

    # fixture ファイルのパス解決（repo_root 相対）
    if not os.path.isabs(fixture_file):
        fixture_path = os.path.join(repo_root, fixture_file)
    else:
        fixture_path = fixture_file

    # WAV 読み込み
    waveform, sample_rate = load_wav(fixture_path)
    wav_bytes = to_wav_bytes(waveform, sample_rate)
    duration_milliseconds = int(len(waveform) / sample_rate * 1000)

    # POST /v1/analyze
    response = call_analyze(analyzer_url, wav_bytes, reference_text, duration_milliseconds)

    # fresh シグナル抽出
    fresh_signals = _extract_fresh_signals(response)

    # 分類
    classification, diff_lines, advisory_ipa_drift = classify_drift(fresh_signals, observed)

    # freshVsPinned 構築（M-DRIFT-5）
    pinned_gop_band = observed.get("gop", {}).get("band", {})
    pinned_top1_phonemes = observed.get("topNBest", {}).get("phonemes", [])
    fresh_top1_phonemes = fresh_signals["top1_phonemes"]

    # GOP 符号反転フラグ（report 用）
    pinned_band_all_negative = float(pinned_gop_band.get("max", 0.0)) < 0.0
    sign_flip = any((pinned_band_all_negative and gop > 0.0) for gop in fresh_signals["gop_values"])

    # top-1 phoneme match フラグ
    nbest_match = len(fresh_top1_phonemes) == len(pinned_top1_phonemes) and all(
        f == p for f, p in zip(fresh_top1_phonemes, pinned_top1_phonemes, strict=False)
    )

    # in-band フラグ（全 gop が ε 内に収まるか）
    in_band = all(
        float(pinned_gop_band.get("min", 0.0)) - _GOP_MARGIN_EPSILON
        <= gop
        <= float(pinned_gop_band.get("max", 0.0)) + _GOP_MARGIN_EPSILON
        for gop in fresh_signals["gop_values"]
    )

    rerun_result: dict[str, Any] = {
        "entryIdentifier": entry_identifier,
        "classification": classification,
        "freshVsPinned": {
            "gop": {
                "fresh": fresh_signals["gop_band"],
                "pinned": pinned_gop_band,
                "inBand": in_band,
                "signFlip": sign_flip,
            },
            "topNBest": {
                "fresh": fresh_top1_phonemes,
                "pinned": pinned_top1_phonemes,
                "match": nbest_match,
                "advisoryIpaDrift": advisory_ipa_drift,
            },
            "detectedIpa": {
                "fresh": fresh_signals["detected_ipa"],
                "structureIntact": fresh_signals["structure_intact"],
            },
        },
        "_diff_lines": diff_lines,
    }

    return rerun_result


# ---------------------------------------------------------------------------
# メイン: drift_check シーケンス
# ---------------------------------------------------------------------------


def run_drift_check(
    analyzer_url: str,
    manifest_path: str,
    repo_root: str,
) -> tuple[int, dict[str, Any]]:
    """drift check を実行して (exit_code, report) を返す。

    M-DRIFT-2/4/5 のシーケンス:
        1. LIVE 指紋を計算する。
        2. manifest の pinned 指紋と比較する。
        3. 一致 → skip（exit 0）。
        4. 不一致 → 各 entry を再実行して benign/regression を分類する。
        5. regression ≥ 1 → exit 1。benign のみ → exit 0。

    Returns:
        (exit_code, report_dict)
    """
    # LIVE 指紋の計算
    try:
        fingerprint_live = compute_fingerprint(repo_root)
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1, {}

    # manifest の読み込みと pinned 指紋の取得
    with open(manifest_path, encoding="utf-8") as file_handle:
        manifest = json.load(file_handle)

    entries: list[dict[str, Any]] = manifest.get("entries", [])

    # pinned 指紋: 全 entries が同じ analyzerCommit を持つ前提（最初の entry から取得）
    fingerprint_pinned: str = ""
    if entries:
        fingerprint_pinned = entries[0].get("observed", {}).get("analyzerCommit", "")

    fingerprint_match = fingerprint_live == fingerprint_pinned

    # --- 指紋一致: skip ---
    if fingerprint_match:
        print("DRIFT fingerprint=match status=skip")
        sys.stdout.flush()
        report: dict[str, Any] = {
            "fingerprintLive": fingerprint_live,
            "fingerprintPinned": fingerprint_pinned,
            "fingerprintMatch": True,
            "reruns": [],
            "escalate": False,
            "regressionCount": 0,
        }
        return 0, report

    # --- 指紋不一致: 各 entry を再実行して分類 ---
    print(f"DRIFT fingerprint=mismatch live={fingerprint_live!r} pinned={fingerprint_pinned!r}")
    sys.stdout.flush()

    reruns: list[dict[str, Any]] = []
    regression_count = 0

    for entry in entries:
        entry_identifier = entry["entryIdentifier"]
        try:
            rerun_result = _rerun_entry(entry, analyzer_url, repo_root)
        except Exception as error:
            # analyzer 呼び出し失敗は regression 扱いとしてエスカレーション
            error_message = str(error)
            print(
                f"DRIFT {entry_identifier} regression fingerprint=mismatch "
                "classification=regression",
                flush=True,
            )
            print(f"  analyzer call failed: {error_message}", flush=True)
            reruns.append(
                {
                    "entryIdentifier": entry_identifier,
                    "classification": "regression",
                    "freshVsPinned": None,
                    "_error": error_message,
                }
            )
            regression_count += 1
            continue

        classification = rerun_result["classification"]
        diff_lines: list[str] = rerun_result.pop("_diff_lines", [])

        if classification == "regression":
            regression_count += 1

        # human-readable 出力
        print(
            f"DRIFT {entry_identifier} {classification} fingerprint=mismatch "
            f"classification={classification}",
            flush=True,
        )
        for diff_line in diff_lines:
            print(diff_line, flush=True)

        reruns.append(rerun_result)

    escalate = regression_count >= 1
    report = {
        "fingerprintLive": fingerprint_live,
        "fingerprintPinned": fingerprint_pinned,
        "fingerprintMatch": False,
        "reruns": reruns,
        "escalate": escalate,
        "regressionCount": regression_count,
    }

    exit_code = 1 if escalate else 0
    return exit_code, report


# ---------------------------------------------------------------------------
# CLI エントリポイント
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "analyzer-level drift sentinel（ADR-031 D12 Stage-3）。\n"
            "指紋一致時はスキップ（exit 0）。\n"
            "不一致時は /v1/analyze を再実行し benign/regression を分類する。\n"
            "regression 1 件以上で exit 1（エスカレーション）。\n"
            "NOTE: このスクリプトは manifest を書き換えない。"
            "re-pin は compute_fingerprint.py --write を使用する。"
        )
    )
    parser.add_argument(
        "--analyzer-url",
        default="http://localhost:8788",
        help="analyzer の base URL（デフォルト: http://localhost:8788）",
    )
    parser.add_argument(
        "--manifest",
        default=_DEFAULT_MANIFEST,
        help=f"manifest.json のパス（デフォルト: {_DEFAULT_MANIFEST}）",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="drift report JSON の出力先ファイルパス（省略時は stdout に出力しない）",
    )
    parser.add_argument(
        "--repo-root",
        default=_REPO_ROOT,
        help=f"リポジトリルートのパス（デフォルト: {_REPO_ROOT}）",
    )
    arguments = parser.parse_args()

    exit_code, report = run_drift_check(
        analyzer_url=arguments.analyzer_url,
        manifest_path=arguments.manifest,
        repo_root=arguments.repo_root,
    )

    if not report:
        return exit_code

    if arguments.report:
        with open(arguments.report, "w", encoding="utf-8") as file_handle:
            json.dump(report, file_handle, indent=2, ensure_ascii=False)
            file_handle.write("\n")
        print(f"REPORT written to {arguments.report}", flush=True)
    else:
        # --report 未指定 + skip でない場合は JSON を stdout に出力する
        if not report.get("fingerprintMatch", False):
            print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
