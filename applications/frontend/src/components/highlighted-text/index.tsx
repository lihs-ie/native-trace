"use client";

import { buildSegments, severityToColorClass, type HighlightRange } from "./segment";
import styles from "./highlighted-text.module.css";

const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  major: 2,
  minor: 1,
  info: 0,
};

// セグメントに複数ハイライトが重なる場合、最も重大な severity を表示色にする。
const dominantHighlight = (highlights: HighlightRange[]): HighlightRange =>
  highlights.reduce((dominant, current) =>
    (SEVERITY_RANK[current.severity] ?? 0) > (SEVERITY_RANK[dominant.severity] ?? 0)
      ? current
      : dominant,
  );

type HighlightedTextProps = {
  bodyText: string;
  highlights: HighlightRange[];
  onSelectHighlight?: (highlight: HighlightRange) => void;
};

export const HighlightedText = ({
  bodyText,
  highlights,
  onSelectHighlight,
}: HighlightedTextProps) => {
  const segments = buildSegments(bodyText, highlights);

  return (
    <p className={styles.body}>
      {segments.map((segment) => {
        if (segment.highlights.length === 0) {
          return <span key={segment.startChar}>{segment.text}</span>;
        }
        const dominant = dominantHighlight(segment.highlights);
        const colorClass = severityToColorClass(dominant.severity);
        return (
          <mark
            key={segment.startChar}
            className={`${styles.highlight} ${styles[colorClass] ?? ""}`}
            onClick={() => onSelectHighlight?.(dominant)}
            title={`${dominant.category} / ${dominant.severity}`}
          >
            {segment.text}
          </mark>
        );
      })}
    </p>
  );
};
