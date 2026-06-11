/**
 * 現在時刻取得ヘルパ。
 * React コンポーネント本体で `Date.now()` を直接呼ぶと react-hooks/purity に抵触するため、
 * 純粋でない時刻読み取りはこのモジュール関数に閉じ込める（イベントハンドラから呼ぶ）。
 */

export const nowMs = (): number => Date.now();
