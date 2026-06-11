/**
 * severity 変換ヘルパ（純関数）
 * API / usecase の "suggestion" を CSS クラス名用 "suggest" に変換する。
 */

export type SeverityClass = "critical" | "major" | "minor" | "suggest";

/**
 * API severity 文字列を CSS クラスサフィックスに変換する。
 * "suggestion" → "suggest"（CSS `.mk--suggest`/`.badge--suggest`/`.sevpill` 等に対応）
 */
export const toSeverityClass = (severity: string): SeverityClass => {
  switch (severity) {
    case "critical":
      return "critical";
    case "major":
      return "major";
    case "minor":
      return "minor";
    case "suggestion":
    case "suggest":
      return "suggest";
    default:
      return "minor";
  }
};

export const SEVERITY_DISPLAY_LABELS: Record<SeverityClass, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  suggest: "Suggest",
};
