/**
 * 録音時のブラウザ環境検出（純粋関数）。
 * multipart フィールド `browserInfo`（契約・凍結）の値を組み立てるために使う。
 */

export const detectBrowserInfo = () => ({
  browserName: navigator.userAgent.includes("Chrome")
    ? "Chrome"
    : navigator.userAgent.includes("Firefox")
      ? "Firefox"
      : navigator.userAgent.includes("Safari")
        ? "Safari"
        : "Unknown",
  browserVersion: navigator.userAgent,
  deviceType: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
});
