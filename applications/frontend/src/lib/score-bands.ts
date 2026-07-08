/**
 * スコア閾値の共有定数（純データ、値変更なし）。
 * 各画面に散在していた較正済み閾値を 1 箇所に集約する。
 */

/**
 * material の状態を "completed" と判定する最高スコアの下限。
 * (library 画面 `getMaterialStatus` — 最高スコア >= 90 で完了)
 */
export const MATERIAL_COMPLETED_SCORE = 90;

/**
 * スコアバーを警告色（`--sev-major`）に切り替える閾値。
 * (result 画面 `ScoreRows` — スコア < 75 で警告色)
 */
export const SCORE_WARN_THRESHOLD = 75;

/**
 * cum-bar（累積訓練時間バー）の頭打ちに使う仮想上限（分）。
 * 架空値ではなくスケール用の頭打ちであり、実測の cumulativeTrainingMinutes を
 * この値で正規化して 0–100% のバー幅にする。
 * (training 画面 `cumBarWidth` / progress 画面 `cumBarWidth`)
 */
export const TRAINING_PLATEAU_MINUTES = 400;
