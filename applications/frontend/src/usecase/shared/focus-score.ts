/**
 * FocusScore 導出の共有ロジック
 *
 * 設計の正: docs/specs/progress-screen.md (M-PG-2, OQ-5)
 *          docs/03-detailed-design/domain.md §14 (DD-252)
 *
 * capture-progress-snapshot と complete-hvpt-session の両方で再利用する。
 * WeaknessProfile.focusSounds の mastery ([0,1]) を 0-100 整数スコアに変換し、
 * FocusScore の生成結果を集約する。重複実装禁止。
 */

import { Result } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import { type WeaknessProfile, type FocusScore, createFocusScore } from "../../domain/training";

/**
 * toScore0To100 — [0,1] の比率値を 0-100 の整数スコアに変換する。
 */
export const toScore0To100 = (value0To1: number): number => Math.round(value0To1 * 100);

/**
 * deriveFocusScoresFromWeaknessProfile — WeaknessProfile.focusSounds から FocusScore[] を導出する。
 * いずれかの FocusScore 生成が失敗した場合は最初のエラーを返す（Result.combine）。
 */
export const deriveFocusScoresFromWeaknessProfile = (
  weaknessProfile: WeaknessProfile,
): Result<FocusScore[], DomainError> =>
  Result.combine(
    weaknessProfile.focusSounds.map((sound) =>
      createFocusScore(String(sound.contrast), toScore0To100(Number(sound.mastery))),
    ),
  );
