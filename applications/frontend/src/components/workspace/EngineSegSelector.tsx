import type { AnalysisMode } from "@/lib/api-types";

type EngineSegSelectorProps = {
  value: AnalysisMode;
  onChange: (mode: AnalysisMode) => void;
};

export function EngineSegSelector({ value, onChange }: EngineSegSelectorProps) {
  return (
    <div className="seg">
      <button
        className={`seg-item${value === "cloudOnly" ? " is-active" : ""}`}
        type="button"
        data-eng="openai"
        onClick={() => onChange("cloudOnly")}
      >
        <span className="eng-dot" style={{ background: "var(--engine-openai)" }} />
        OpenAI API
      </button>
      <button
        className={`seg-item${value === "ossWorkerOnly" ? " is-active" : ""}`}
        type="button"
        data-eng="rust"
        onClick={() => onChange("ossWorkerOnly")}
      >
        <span className="eng-dot" style={{ background: "var(--engine-rust)" }} />
        OSS Worker
      </button>
      <button
        className={`seg-item${value === "comparison" ? " is-active" : ""}`}
        type="button"
        data-eng="compare"
        onClick={() => onChange("comparison")}
      >
        ⊕ 比較
      </button>
    </div>
  );
}
