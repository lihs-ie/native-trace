/**
 * 教材ソース種別の表示ラベル・判定（純粋関数）。
 * home ページの lowercase 版を canonical とする（DB 上の sourceType は小文字保存のため
 * 実データでは差異が出ない）。
 */

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  ted: "TED",
  youtube: "YouTube",
  speech: "スピーチ",
  article: "記事",
  book: "書籍",
  other: "その他",
};

export const isTed = (sourceType: string): boolean => sourceType.toLowerCase() === "ted";
