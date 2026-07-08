"use client";

import { buildSegments } from "@/components/highlighted-text/segment";
import { toSeverityClass } from "@/lib/severity";
import { getPhenomenonIcon } from "@/lib/phenomenon";
import type { EngineFindingDto } from "@/lib/api-types";

type HighlightedWorkspaceTextProps = {
  bodyText: string;
  findings: EngineFindingDto[];
  selectedFindingIdentifier: string | null;
  onSelect: (finding: EngineFindingDto) => void;
  showMarks: boolean;
  /** v2: phenomenon アイコン (.hl-ico) を表示するか（デフォルト false） */
  showPhenomenonIcons?: boolean;
};

export const HighlightedWorkspaceText = ({
  bodyText,
  findings,
  selectedFindingIdentifier,
  onSelect,
  showMarks,
  showPhenomenonIcons = false,
}: HighlightedWorkspaceTextProps) => {
  const highlights = showMarks
    ? findings.map((f) => ({
        finding: f.finding,
        severity: f.severity,
        category: f.category,
        textRange: f.textRange,
        tokenRange: null,
        audioRange: f.audioRange,
        messageJa: f.messageJa,
        messageEn: f.messageEn,
        confidence: f.confidence,
      }))
    : [];

  const segments = buildSegments(bodyText, highlights);

  return (
    <p className="ws-text">
      {segments.map((segment) => {
        if (segment.highlights.length === 0) {
          return (
            <span key={segment.startChar} className="w">
              {segment.text}
            </span>
          );
        }

        // 複数ハイライトが重なる場合、最初のものを代表として使う
        const dominantHighlight = segment.highlights[0];
        const severityClass = toSeverityClass(dominantHighlight.severity);
        const matchedFinding = findings.find((f) => f.finding === dominantHighlight.finding);
        const isSelected = matchedFinding?.finding === selectedFindingIdentifier;

        const classNames = ["w", "mk", `mk--${severityClass}`, isSelected ? "is-sel" : ""]
          .filter(Boolean)
          .join(" ");

        const phenomenonIcon =
          showPhenomenonIcons && matchedFinding?.phenomenon
            ? getPhenomenonIcon(matchedFinding.phenomenon)
            : null;

        return (
          <span
            key={segment.startChar}
            className={classNames}
            data-ann={dominantHighlight.finding}
            onClick={() => {
              if (matchedFinding) {
                onSelect(matchedFinding);
              }
            }}
          >
            {segment.text}
            {phenomenonIcon && <sup className="hl-ico">{phenomenonIcon}</sup>}
          </span>
        );
      })}
    </p>
  );
};
