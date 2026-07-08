"use client";

import type { EngineFindingDto } from "@/lib/api-types";
import { toSeverityClass, SEVERITY_DISPLAY_LABELS } from "@/lib/severity";

type DetailPanelProps = {
  finding: EngineFindingDto | null;
  onClose: () => void;
  onPlaySegment?: () => void;
};

export const DetailPanel = ({ finding, onClose, onPlaySegment }: DetailPanelProps) => {
  if (!finding) {
    return (
      <div className="detail-empty">
        本文のハイライトをクリックすると、ここに詳細が表示されます。
      </div>
    );
  }

  const severityClass = toSeverityClass(finding.severity);
  const severityLabel = SEVERITY_DISPLAY_LABELS[severityClass];
  const hasIpa = finding.expected.ipa !== null || finding.detected.ipa !== null;

  return (
    <div className="panel" style={{ maxWidth: "none", boxShadow: "none" }}>
      <div className="panel-top" style={{ padding: "var(--sp-4) var(--sp-4) var(--sp-3)" }}>
        <div>
          <div className="panel-target" style={{ fontSize: "var(--text-md)" }}>
            <span className={`mk mk--${severityClass}`}>
              {finding.expected.text ?? finding.detected.text ?? "—"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              marginTop: "8px",
              flexWrap: "wrap",
            }}
          >
            <span className={`badge badge--${severityClass}`}>
              <span className="dot" />
              {severityLabel}
            </span>
            <span className="chip chip--sm">{finding.category}</span>
          </div>
        </div>
        <button className="icon-btn" type="button" onClick={onClose}>
          ✕
        </button>
      </div>

      {hasIpa && (
        <div className="phon-compare" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
          {finding.expected.ipa !== null && (
            <div className="phon">
              <div className="phon-lbl">期待</div>
              <div className="phon-val" style={{ fontSize: "var(--text-sm)" }}>
                {finding.expected.ipa}
              </div>
            </div>
          )}
          {finding.expected.ipa !== null && finding.detected.ipa !== null && (
            <div className="phon-arrow">→</div>
          )}
          {finding.detected.ipa !== null && (
            <div className="phon phon--actual">
              <div className="phon-lbl">検出</div>
              <div className="phon-val" style={{ fontSize: "var(--text-sm)" }}>
                {finding.detected.ipa}
              </div>
            </div>
          )}
        </div>
      )}

      {finding.messageJa && (
        <p className="panel-jp" style={{ padding: "var(--sp-3) var(--sp-4) 0" }}>
          {finding.messageJa}
        </p>
      )}

      <div className="panel-foot" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
        {onPlaySegment && (
          <button className="btn btn--sm btn--secondary" type="button" onClick={onPlaySegment}>
            ▸ 部分再生
          </button>
        )}
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            color:
              finding.scoreImpact === 0 ? "var(--text-faint)" : `var(--sev-${severityClass}-text)`,
          }}
        >
          {finding.scoreImpact === 0
            ? "±0 pt"
            : `${finding.scoreImpact > 0 ? "+" : ""}${finding.scoreImpact} pt`}
        </span>
      </div>
    </div>
  );
};
