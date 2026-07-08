/**
 * 時刻・秒数の表示整形（純粋関数）。
 * 日時整形・秒数整形は 5+ の流儀が発散していたため、一致するものだけをここに集約する。
 */

/** ISO 日時文字列を `YYYY-MM-DD HH:mm` に整形する（history ページ実装を canonical とする）。 */
export const formatDateTimeMinutes = (isoString: string): string => {
  const date = new Date(isoString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
};

/** 秒数（整数想定）を `m:ss` に整形する。 */
export const formatMinutesSeconds = (totalSeconds: number): string =>
  `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
