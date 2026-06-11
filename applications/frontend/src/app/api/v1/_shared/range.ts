/**
 * HTTP Range ヘッダ解釈ユーティリティ (§API-016)
 */

export type ParsedRange = { startByte: number; endByte: number };

/**
 * Range: bytes=<start>-<end> を解釈する。
 * - null: Range ヘッダなし（200 全体返却）
 * - "invalid": 範囲不正（416 応答）
 * - ParsedRange: 有効な範囲
 */
export const parseRangeHeader = (
  rangeHeader: string | null,
  totalBytes: number,
): ParsedRange | "invalid" | null => {
  if (!rangeHeader) return null;

  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const endRaw = match[2];
  const end = endRaw !== "" ? parseInt(endRaw, 10) : totalBytes - 1;

  if (start > end || start >= totalBytes || end >= totalBytes) {
    return "invalid";
  }

  return { startByte: start, endByte: end };
};
