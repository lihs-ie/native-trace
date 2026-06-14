"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, isApiClientError } from "@/lib/api-client";
import type {
  HistoryGroupDto,
  MaterialDto,
  PracticePlanDto,
  HistoryAnalysisRunDto,
} from "@/lib/api-types";
import { AppTop } from "@/components/chrome/AppTop";
import { HomeNav } from "@/components/chrome/HomeNav";

// ---- helpers ----

const ENGINE_MODE_LABELS: Record<string, string> = {
  cloudOnly: "OpenAI",
  ossWorkerOnly: "Rust",
  comparison: "OpenAI",
};

const ENGINE_MODE_DOT_VAR: Record<string, string> = {
  cloudOnly: "--engine-openai",
  ossWorkerOnly: "--engine-rust",
  comparison: "--engine-openai",
};

function engineLabel(mode: string): string {
  return ENGINE_MODE_LABELS[mode] ?? mode;
}

function engineDotVar(mode: string): string {
  return ENGINE_MODE_DOT_VAR[mode] ?? "--engine-openai";
}

// Per-result engine identity (so a comparison run renders OpenAI + Rust as two
// distinct .eres rows instead of repeating the run's mode label).
function engineKindLabel(engineKind: string): string {
  if (engineKind === "openai") return "OpenAI";
  if (engineKind === "oss_worker" || engineKind === "rust") return "Rust";
  return engineKind;
}

function engineKindDotVar(engineKind: string): string {
  return engineKind === "openai" ? "--engine-openai" : "--engine-rust";
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

function statusPillClass(status: string): string {
  if (status === "succeeded") return "status status--ok";
  if (status === "running" || status === "analyzing") return "status status--running";
  if (status === "failed") return "status status--fail";
  return "status";
}

function statusLabel(status: string): string {
  if (status === "succeeded") return "succeeded";
  if (status === "running" || status === "analyzing") return "解析中";
  if (status === "failed") return "failed";
  return status;
}

// ---- Tree types ----

type TreeSection = {
  sectionSeriesIdentifier: string;
  title: string;
  displayOrder: number;
  bestScore: number | null;
};

type TreeMaterial = {
  identifier: string;
  title: string;
  sections: TreeSection[];
  expanded: boolean;
};

// ---- Trend helpers ----

type TrendBar = {
  attemptIndex: number;
  score: number;
};

function buildTrendBars(analysisRuns: HistoryAnalysisRunDto[]): TrendBar[] {
  const bars: TrendBar[] = [];
  let attemptIndex = 0;
  for (const run of [...analysisRuns].reverse()) {
    const scores = run.assessmentResults.map((r) => r.overallScore);
    if (scores.length > 0) {
      attemptIndex += 1;
      const maxScore = Math.max(...scores);
      bars.push({ attemptIndex, score: maxScore });
    }
  }
  return bars;
}

// ---- fetch helpers (pure async, no setState) ----

async function fetchTree(sectionSeriesParam: string | null): Promise<TreeMaterial[]> {
  const raw = await apiGet<MaterialDto[] | { materials?: MaterialDto[] }>("/api/v1/materials");
  const materials = Array.isArray(raw)
    ? (raw as MaterialDto[])
    : ((raw as { materials?: MaterialDto[] }).materials ?? []);

  return Promise.all(
    materials.map((material) =>
      apiGet<PracticePlanDto>(`/api/v1/materials/${material.identifier}/practice-plan`).then(
        (plan) => {
          const sections: TreeSection[] = plan.sectionSeries.map((item) => ({
            sectionSeriesIdentifier: item.sectionSeries.identifier,
            title: item.sectionSeries.title,
            displayOrder: item.sectionSeries.displayOrder,
            // practice-plan の section series 集計 (material-detail と同源) から最高スコアを配線
            bestScore: item.stats.bestOverallScore,
          }));
          return {
            identifier: material.identifier,
            title: material.title,
            sections,
            expanded: sections.some((s) => s.sectionSeriesIdentifier === sectionSeriesParam),
          };
        },
      ),
    ),
  );
}

async function fetchHistory(sectionSeriesParam: string): Promise<HistoryGroupDto[]> {
  const query = new URLSearchParams({ sectionSeries: sectionSeriesParam });
  return apiGet<HistoryGroupDto[]>(`/api/v1/history?${query.toString()}`);
}

// ---- Main content ----

function HistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sectionSeriesParam = searchParams.get("sectionSeries");

  const [groups, setGroups] = useState<HistoryGroupDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [treeMaterials, setTreeMaterials] = useState<TreeMaterial[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  // Load tree once on mount — all setState calls are inside async callbacks
  useEffect(() => {
    fetchTree(sectionSeriesParam)
      .then((treeData) => {
        setTreeMaterials(treeData);
        setTreeError(null);
        setTreeLoading(false);
      })
      .catch((error: unknown) => {
        setTreeError(isApiClientError(error) ? error.message : "教材ツリーの取得に失敗しました");
        setTreeLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: tree loads once

  // Load history when sectionSeries changes — all setState calls are inside async callbacks
  useEffect(() => {
    if (!sectionSeriesParam) return;
    fetchHistory(sectionSeriesParam)
      .then((data) => {
        setGroups(data);
        setHistoryError(null);
        setHistoryLoading(false);
      })
      .catch((error: unknown) => {
        setHistoryError(isApiClientError(error) ? error.message : "履歴の取得に失敗しました");
        setHistoryLoading(false);
      });
  }, [sectionSeriesParam]);

  const handleSectionClick = (sectionSeriesIdentifier: string) => {
    router.replace(`/history?sectionSeries=${encodeURIComponent(sectionSeriesIdentifier)}`);
  };

  const handleMaterialToggle = (materialIdentifier: string) => {
    setTreeMaterials((prev) =>
      prev.map((m) => (m.identifier === materialIdentifier ? { ...m, expanded: !m.expanded } : m)),
    );
  };

  // Derive active section info from groups
  const activeGroup = groups.length > 0 ? groups[0] : null;
  const activeSectionSeries = activeGroup?.sectionSeries;
  const activeSections = activeGroup?.sections ?? [];

  // Enriched run type: carry sectionIdentifier so compare Link can be built
  type EnrichedAnalysisRun = HistoryAnalysisRunDto & { sectionIdentifier: string };

  // Collect all analysisRuns across sections (flattened, newest first), preserving sectionIdentifier
  const allAnalysisRuns: EnrichedAnalysisRun[] = activeSections
    .flatMap((sv) =>
      sv.analysisRuns.map((run) => ({ ...run, sectionIdentifier: sv.section.identifier })),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Resolve materialIdentifier from treeMaterials by sectionSeries
  const resolvedMaterialIdentifier: string | null = (() => {
    if (!activeSectionSeries) return null;
    const foundMaterial = treeMaterials.find((material) =>
      material.sections.some(
        (section) => section.sectionSeriesIdentifier === activeSectionSeries.identifier,
      ),
    );
    return foundMaterial?.identifier ?? null;
  })();

  // Latest section version for head display
  const latestSectionVersion = activeSections[0] ?? null;

  // Trend bars from all runs
  const trendBars = buildTrendBars(allAnalysisRuns);
  const maxScore = trendBars.length > 0 ? Math.max(...trendBars.map((b) => b.score)) : 0;
  const minScore = trendBars.length > 0 ? Math.min(...trendBars.map((b) => b.score)) : 0;
  const hasTrend = trendBars.length >= 2;
  const scoreDelta =
    trendBars.length >= 2 ? trendBars[trendBars.length - 1].score - trendBars[0].score : null;

  const totalAttemptCount = activeSections.reduce(
    (sum, sv) => sum + sv.recordingAttempts.length,
    0,
  );

  return (
    <div>
      <div className="home-top">
        <AppTop />
        <HomeNav active="history" />
      </div>

      <div className="hist-grid">
        {/* ---- Tree ---- */}
        <div className="hist-tree">
          <div className="tree-h">教材 / セクション</div>

          {treeLoading && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-faint)",
                padding: "var(--sp-2)",
              }}
            >
              読み込み中...
            </div>
          )}

          {!treeLoading && treeError && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--sev-critical-text)",
                padding: "var(--sp-2)",
              }}
            >
              {treeError}
            </div>
          )}

          {!treeLoading && !treeError && treeMaterials.length === 0 && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-faint)",
                padding: "var(--sp-2)",
              }}
            >
              教材がありません
            </div>
          )}

          {!treeLoading &&
            !treeError &&
            treeMaterials.map((material) => (
              <div key={material.identifier} className="tmat">
                <div
                  className="tmat-top"
                  onClick={() => handleMaterialToggle(material.identifier)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleMaterialToggle(material.identifier);
                    }
                  }}
                >
                  <span className="caret">{material.expanded ? "▾" : "▸"}</span>
                  {material.title}
                  <span className="tn">{material.sections.length}</span>
                </div>

                {material.expanded &&
                  material.sections.map((section) => (
                    <div
                      key={section.sectionSeriesIdentifier}
                      className={[
                        "tsec",
                        section.sectionSeriesIdentifier === sectionSeriesParam ? "is-active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => handleSectionClick(section.sectionSeriesIdentifier)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          handleSectionClick(section.sectionSeriesIdentifier);
                        }
                      }}
                    >
                      <span className="sn">§{section.displayOrder}</span>
                      {section.title}
                      <span
                        className={["sb", section.bestScore === null ? "none" : ""]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {section.bestScore !== null ? section.bestScore : "—"}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
        </div>

        {/* ---- Main ---- */}
        <div className="hist-main">
          {!sectionSeriesParam && (
            <div
              style={{
                padding: "var(--sp-8)",
                color: "var(--text-faint)",
                fontSize: "var(--text-sm)",
              }}
            >
              セクション系列を指定すると履歴が表示されます。左のツリーからセクションを選択してください。
            </div>
          )}

          {sectionSeriesParam && historyLoading && (
            <div
              style={{
                padding: "var(--sp-8)",
                color: "var(--text-faint)",
                fontSize: "var(--text-sm)",
              }}
            >
              読み込み中...
            </div>
          )}

          {sectionSeriesParam && !historyLoading && historyError && (
            <div
              style={{
                padding: "var(--sp-4)",
                color: "var(--sev-critical-text)",
                fontSize: "var(--text-sm)",
              }}
            >
              {historyError}
            </div>
          )}

          {sectionSeriesParam && !historyLoading && !historyError && (
            <>
              {/* head */}
              <div className="hist-head">
                <h2>{activeSectionSeries?.title ?? ""}</h2>
                {latestSectionVersion && (
                  <span
                    className="badge badge--minor"
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text-tertiary)",
                      borderColor: "var(--border-faint)",
                    }}
                  >
                    本文版 v{latestSectionVersion.section.version}
                  </span>
                )}
                <span className="meta">{totalAttemptCount} 試行</span>
              </div>

              {/* trend */}
              {hasTrend && (
                <div className="trend">
                  <div className="trend-left">
                    <div className="tl-lbl">試行ごとの Overall</div>
                    <div className="trend-bars">
                      {trendBars.map((bar) => {
                        const isBest = bar.score === maxScore;
                        const range = maxScore - minScore;
                        const heightPx =
                          range > 0
                            ? Math.max(20, Math.round(((bar.score - minScore) / range) * 60) + 20)
                            : 60;
                        return (
                          <div key={bar.attemptIndex} className="tbar">
                            <div
                              className={["col", isBest ? "best" : ""].filter(Boolean).join(" ")}
                              style={{ height: `${heightPx}px` }}
                            >
                              <span className="v">{bar.score}</span>
                            </div>
                            <div className="lbl">
                              試行{String(bar.attemptIndex).padStart(2, "0")}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {scoreDelta !== null && (
                      <div className="delta" style={{ marginTop: "10px" }}>
                        伸び {scoreDelta >= 0 ? "+" : ""}
                        {scoreDelta} pt（試行01 → {String(trendBars.length).padStart(2, "0")}）
                      </div>
                    )}
                  </div>
                  {/* trend-cats: per-axis score unavailable, render empty */}
                  <div className="trend-cats" />
                </div>
              )}

              {/* att list */}
              {allAnalysisRuns.length === 0 && (
                <div
                  style={{
                    color: "var(--text-faint)",
                    fontSize: "var(--text-sm)",
                    padding: "var(--sp-4) 0",
                  }}
                >
                  録音試行がありません。
                </div>
              )}

              {allAnalysisRuns.length > 0 && (
                <>
                  <div className="att-h">録音試行 — 新しい順</div>
                  {allAnalysisRuns.map((run, index) => {
                    const isFailed = run.status === "failed";
                    const isRunning = run.status === "running" || run.status === "analyzing";
                    const attemptNumber = allAnalysisRuns.length - index;

                    return (
                      <div
                        key={run.identifier}
                        className={["att", isFailed ? "is-failed" : ""].filter(Boolean).join(" ")}
                      >
                        <div className="att-no">
                          <div className="n">{String(attemptNumber).padStart(2, "0")}</div>
                          <div className="src">録音</div>
                        </div>
                        <div className="att-mid">
                          <div className="att-when">{formatDateTime(run.createdAt)}</div>
                          <div className="att-engines">
                            {!isRunning && !isFailed && (
                              <span
                                className={statusPillClass(run.status)}
                                style={{ fontSize: "var(--text-2xs)" }}
                              >
                                <span className="sd" />
                                {statusLabel(run.status)}
                              </span>
                            )}
                            {isFailed && (
                              <span
                                className="status status--fail"
                                style={{ fontSize: "var(--text-2xs)" }}
                              >
                                <span className="sd" />
                                failed
                              </span>
                            )}
                            {isRunning && (
                              <span
                                className="status status--running"
                                style={{ fontSize: "var(--text-2xs)" }}
                              >
                                <span className="sd" />
                                解析中
                              </span>
                            )}
                            {run.assessmentResults.length > 0 &&
                              run.assessmentResults.map((result) => (
                                <span key={result.identifier} className="eres">
                                  <span
                                    className="eng-dot"
                                    style={{
                                      background: `var(${engineKindDotVar(result.engineKind)})`,
                                    }}
                                  />
                                  {engineKindLabel(result.engineKind)}{" "}
                                  <span className="sc">{result.overallScore}</span>
                                </span>
                              ))}
                            {run.assessmentResults.length === 0 && !isFailed && (
                              <span className="eres">
                                <span
                                  className="eng-dot"
                                  style={{
                                    background: `var(${engineDotVar(run.mode)})`,
                                  }}
                                />
                                {engineLabel(run.mode)} <span className="sc">—</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="att-right">
                          <div className="att-findings">
                            {run.assessmentResults.length > 0
                              ? `${run.assessmentResults.reduce(
                                  (sum, r) => sum + r.findingsCount,
                                  0,
                                )} 指摘`
                              : "—"}
                          </div>
                          {resolvedMaterialIdentifier !== null ? (
                            <Link
                              href={`/materials/${resolvedMaterialIdentifier}/sections/${run.sectionIdentifier}/compare`}
                              className="btn btn--sm btn--primary"
                            >
                              比較
                            </Link>
                          ) : (
                            <button
                              className="btn btn--sm btn--primary"
                              type="button"
                              disabled
                              aria-label="比較（識別子解決不可）"
                            >
                              比較
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "var(--sp-8)", color: "var(--text-faint)" }}>読み込み中...</div>
      }
    >
      <HistoryContent />
    </Suspense>
  );
}
