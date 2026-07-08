"use client";

import type { EngineResultDto } from "@/lib/api-types";
import { toSeverityClass, SEVERITY_DISPLAY_LABELS } from "@/lib/severity";

const SEVERITY_ORDER = ["critical", "major", "minor", "suggestion"] as const;

type SeverityCountPillsProps = {
  counts: EngineResultDto["counts"];
  className: string;
};

export const SeverityCountPills = ({ counts, className }: SeverityCountPillsProps) => (
  <div className={className}>
    {SEVERITY_ORDER.map((sev) => {
      const cssClass = toSeverityClass(sev);
      const count = counts[sev];
      const label = SEVERITY_DISPLAY_LABELS[cssClass];
      return (
        <span key={sev} className="sevpill">
          <span className="dot" style={{ background: `var(--sev-${cssClass})` }} />
          {count} {label}
        </span>
      );
    })}
  </div>
);
