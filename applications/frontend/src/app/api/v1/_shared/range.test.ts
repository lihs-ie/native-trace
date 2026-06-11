/**
 * API-016 Range ヘッダ解釈のユニットテスト
 */

import { describe, it, expect } from "vitest";
import { parseRangeHeader } from "./range";

const TOTAL_BYTES = 1_000_000;

describe("parseRangeHeader", () => {
  it("Range ヘッダなし → null を返す", () => {
    expect(parseRangeHeader(null, TOTAL_BYTES)).toBeNull();
  });

  it("有効な Range: bytes=0-999999 → ParsedRange を返す", () => {
    const result = parseRangeHeader("bytes=0-999999", TOTAL_BYTES);
    expect(result).toEqual({ startByte: 0, endByte: 999999 });
  });

  it("end 省略形 bytes=500- → 末尾まで", () => {
    const result = parseRangeHeader("bytes=500-", TOTAL_BYTES);
    expect(result).toEqual({ startByte: 500, endByte: TOTAL_BYTES - 1 });
  });

  it("bytes=0-0 → 1バイト", () => {
    const result = parseRangeHeader("bytes=0-0", TOTAL_BYTES);
    expect(result).toEqual({ startByte: 0, endByte: 0 });
  });

  it("start > end → invalid", () => {
    expect(parseRangeHeader("bytes=100-50", TOTAL_BYTES)).toBe("invalid");
  });

  it("start >= totalBytes → invalid", () => {
    expect(parseRangeHeader(`bytes=${TOTAL_BYTES}-${TOTAL_BYTES}`, TOTAL_BYTES)).toBe("invalid");
  });

  it("end >= totalBytes → invalid", () => {
    expect(parseRangeHeader(`bytes=0-${TOTAL_BYTES}`, TOTAL_BYTES)).toBe("invalid");
  });

  it("形式不正 (suffix-range) → null を返す（未対応形式は全体返却扱い）", () => {
    expect(parseRangeHeader("bytes=-500", TOTAL_BYTES)).toBeNull();
  });

  it("形式不正 (非 bytes 単位) → null", () => {
    expect(parseRangeHeader("items=0-100", TOTAL_BYTES)).toBeNull();
  });

  it("空白付き Range → トリムして解釈できる", () => {
    const result = parseRangeHeader("  bytes=0-999  ", TOTAL_BYTES);
    expect(result).toEqual({ startByte: 0, endByte: 999 });
  });
});
