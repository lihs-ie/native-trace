/**
 * sessionStorage キーの共有定義（純データ、キー文字列は 1 文字も変えない — ワイヤ契約）。
 *
 * `diagnosticSessionKey` の生成文字列は `diagnostic-session-${identifier}` のまま。
 * `TRAINING_WEAKNESS_PROFILE_KEY` の値 `"training-weakness-profile-id"` は
 * e2e `training.spec.ts:194` が同じ文字列を literal で書いているため、
 * ここでの命名は文字列値を変えない前提の別名付けにすぎない。
 */

export const diagnosticSessionKey = (identifier: string): string =>
  `diagnostic-session-${identifier}`;

export const TRAINING_WEAKNESS_PROFILE_KEY = "training-weakness-profile-id";
