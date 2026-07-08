"use client";

import type { EngineResultDto } from "@/lib/api-types";
import { engineColorVariable, engineDisplayName } from "@/lib/engine-display";

type EngineTabsProps = {
  engines: EngineResultDto[];
  activeEngine: string | null;
  onSelectEngine: (engineResultIdentifier: string) => void;
  onAddEngine?: () => void;
};

const missingEngineName = (engines: EngineResultDto[]): string => {
  const hasCloud = engines.some((engine) => engine.engineKind === "cloud");
  if (!hasCloud) return engineDisplayName("cloud");
  return engineDisplayName("oss_worker");
};

export const EngineTabs = ({
  engines,
  activeEngine,
  onSelectEngine,
  onAddEngine,
}: EngineTabsProps) => {
  return (
    <div className="eng-tabs">
      {engines.map((engine) => {
        const isActive = engine.result === activeEngine;
        const tabClass = ["eng-tab", isActive ? "is-active" : ""].filter(Boolean).join(" ");
        return (
          <button
            key={engine.result}
            className={tabClass}
            type="button"
            onClick={() => onSelectEngine(engine.result)}
          >
            <span
              className="eng-dot"
              style={{ background: engineColorVariable(engine.engineKind, "var(--text-faint)") }}
            />
            {engine.engineName}
            <span className="et-score">{engine.scores.overall}</span>
          </button>
        );
      })}
      {engines.length < 2 && onAddEngine && (
        <button className="eng-tab eng-tab--add" type="button" onClick={onAddEngine}>
          ⊕ {missingEngineName(engines)}
        </button>
      )}
    </div>
  );
};
