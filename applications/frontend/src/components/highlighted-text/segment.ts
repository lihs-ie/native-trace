/**
 * HighlightedText のレンジ→セグメント変換ロジック（純関数）
 *
 * bodyText と HighlightRange[] を受け取り、色付けに必要な Segment[] を返す。
 * セグメント = テキスト断片 + 適用中のハイライト一覧。
 * 重複レンジは両方のハイライトを適用する。
 */

export type TextRange = {
  startChar: number;
  endChar: number;
};

export type HighlightRange = {
  finding: string;
  severity: "minor" | "major" | "critical" | string;
  category: string;
  textRange: TextRange;
  tokenRange: { startTokenIndex: number; endTokenIndex: number } | null;
  audioRange: { startMilliseconds: number; endMilliseconds: number } | null;
  messageJa: string | null;
  messageEn: string | null;
  confidence: number | null;
};

export type Segment = {
  text: string;
  startChar: number;
  endChar: number;
  highlights: HighlightRange[];
};

/**
 * bodyText を HighlightRange の境界で分割し Segment[] を返す。
 * 境界点: 0, 各 range の startChar / endChar, text.length
 */
export const buildSegments = (bodyText: string, highlights: HighlightRange[]): Segment[] => {
  if (bodyText.length === 0) return [];

  // 境界点を収集してソート＆デデュープ
  const boundarySet = new Set<number>([0, bodyText.length]);
  for (const h of highlights) {
    const start = Math.max(0, h.textRange.startChar);
    const end = Math.min(bodyText.length, h.textRange.endChar);
    if (start < end) {
      boundarySet.add(start);
      boundarySet.add(end);
    }
  }
  const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startChar = boundaries[i];
    const endChar = boundaries[i + 1];
    const text = bodyText.slice(startChar, endChar);

    // このセグメントに重なるハイライト
    const appliedHighlights = highlights.filter(
      (h) =>
        Math.max(0, h.textRange.startChar) <= startChar &&
        Math.min(bodyText.length, h.textRange.endChar) >= endChar,
    );

    segments.push({ text, startChar, endChar, highlights: appliedHighlights });
  }

  return segments;
};
