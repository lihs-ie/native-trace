"use client";

import type { PerPhonemeGopDto } from "@/lib/api-types";

type GopHeatmapProps = {
  entries: PerPhonemeGopDto[];
};

/**
 * GOP ヒートマップ (M-107c / REQ-107)
 * workspace-v2.html の `.gopmap` 構造を逐語的に実装する。
 * `.gopw` / `.cells` / `.gp[data-h]` のクラス名厳守。
 */
export const GopHeatmap = ({ entries }: GopHeatmapProps) => {
  if (entries.length === 0) {
    return (
      <div className="gopmap">
        <span
          style={{
            fontFamily: "var(--font-jp)",
            fontSize: "var(--text-xs)",
            color: "var(--text-faint)",
          }}
        >
          GOP データなし
        </span>
      </div>
    );
  }

  // word ごとにグループ化する（順序保持）
  const wordGroups = new Map<string, PerPhonemeGopDto[]>();
  for (const entry of entries) {
    const key = entry.word;
    const group = wordGroups.get(key);
    if (group) {
      group.push(entry);
    } else {
      wordGroups.set(key, [entry]);
    }
  }

  return (
    <div className="gopmap">
      {Array.from(wordGroups.entries()).map(([word, phonemes]) => (
        <div key={word} className="gopw">
          <span className="gw">{word}</span>
          <div className="cells">
            {phonemes.map((entry, index) => (
              <span
                key={index}
                className="gp"
                data-h={String(entry.heat)}
                title={`GOP: ${entry.gop.toFixed(1)}`}
              >
                {entry.phoneme}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
