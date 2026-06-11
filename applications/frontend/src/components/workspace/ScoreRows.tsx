"use client";

type ScoreEntry = {
  label: string;
  value: number;
};

type ScoreRowsProps = {
  scores: {
    accuracy: number;
    nativeLikeness: number;
    connectedSpeech: number;
    prosody: number;
  };
};

const buildScoreEntries = (scores: ScoreRowsProps["scores"]): ScoreEntry[] => [
  { label: "Accuracy", value: scores.accuracy },
  { label: "Native", value: scores.nativeLikeness },
  { label: "Connected", value: scores.connectedSpeech },
  { label: "Prosody", value: scores.prosody },
];

export const ScoreRows = ({ scores }: ScoreRowsProps) => {
  const entries = buildScoreEntries(scores);

  return (
    <div className="score-rows" style={{ flex: 1 }}>
      {entries.map((entry) => {
        const barColor = entry.value < 75 ? "var(--sev-major)" : "var(--accent)";
        return (
          <div
            key={entry.label}
            className="srow"
            style={{ gridTemplateColumns: "74px 1fr 26px" }}
          >
            <span className="srl">{entry.label}</span>
            <span className="sbar">
              <i style={{ width: `${entry.value}%`, background: barColor }} />
            </span>
            <span className="srn mono">{entry.value}</span>
          </div>
        );
      })}
    </div>
  );
};
