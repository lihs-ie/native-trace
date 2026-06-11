"use client";

type WorkspaceState = "idle" | "recording" | "analyzing" | "result";

type RibbonProps = {
  state: WorkspaceState;
};

const STEP_INDEX: Record<WorkspaceState, number> = {
  idle: 0,
  recording: 0,
  analyzing: 1,
  result: 2,
};

const steps = [
  { key: "record", label: "録音", number: "1" },
  { key: "analyze", label: "解析", number: "2" },
  { key: "review", label: "添削", number: "3" },
] as const;

export const Ribbon = ({ state }: RibbonProps) => {
  const activeIndex = STEP_INDEX[state];

  return (
    <div className="ribbon">
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const isDone = index < activeIndex;
        const className = ["step", isActive ? "is-active" : "", isDone ? "is-done" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={step.key}>
            <span className={className} data-step={step.key}>
              <span className="sn">{step.number}</span>
              {step.label}
            </span>
            {index < steps.length - 1 && <span className="arrow"> →</span>}
          </span>
        );
      })}
      <span className="same">all on one screen</span>
    </div>
  );
};
