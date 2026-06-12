"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, isApiClientError } from "@/lib/api-client";
import type { PracticePlanDto } from "@/lib/api-types";
import { AppBar } from "@/components/chrome";

type PageProps = {
  params: Promise<{ materialIdentifier: string }>;
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  ted: "TED",
  youtube: "YouTube",
  speech: "スピーチ",
  article: "記事",
  book: "書籍",
  other: "その他",
};

function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}

function isTed(sourceType: string): boolean {
  return sourceType === "ted";
}

function formatDate(isoString: string): string {
  return isoString.slice(0, 10);
}

export default function MaterialDetailPage({ params }: PageProps) {
  const { materialIdentifier } = use(params);
  const router = useRouter();

  const [plan, setPlan] = useState<PracticePlanDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPlan = useCallback(
    () =>
      apiGet<PracticePlanDto>(`/api/v1/materials/${materialIdentifier}/practice-plan`)
        .then((data) => {
          setPlan(data);
          setErrorMessage(null);
        })
        .catch((error: unknown) => {
          setErrorMessage(
            isApiClientError(error) ? error.message : "練習計画の取得に失敗しました",
          );
        })
        .finally(() => setLoading(false)),
    [materialIdentifier],
  );

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const handleDeleteMaterial = async () => {
    if (!window.confirm("この教材を削除しますか？配下のセクションも表示されなくなります。")) {
      return;
    }
    try {
      await apiDelete(`/api/v1/materials/${materialIdentifier}`);
      router.push("/");
    } catch (error: unknown) {
      setErrorMessage(
        isApiClientError(error) ? error.message : "教材の削除に失敗しました",
      );
    }
  };

  const title = plan?.material.title ?? "";
  const sourceType = plan?.material.source?.sourceType ?? "";
  const sectionCount = plan?.sectionSeries.length ?? 0;
  const updatedAt = plan?.material.updatedAt ? formatDate(plan.material.updatedAt) : "";

  return (
    <>
      <AppBar
        crumb={
          <>
            <Link href="/" style={{ color: "var(--text-tertiary)", textDecoration: "none" }}>
              ライブラリ
            </Link>
            <span className="sep">›</span>
            <b>{title}</b>
          </>
        }
        action={
          <button
            className="btn btn--sm btn--ghost"
            style={{ marginLeft: "auto" }}
            type="button"
          >
            複製して編集
          </button>
        }
      />

      {loading && (
        <div style={{ padding: "var(--sp-6)", color: "var(--text-tertiary)" }}>読み込み中...</div>
      )}
      {!loading && errorMessage && (
        <div
          style={{
            padding: "var(--sp-4) var(--sp-6)",
            color: "var(--sev-critical-text)",
            fontSize: "var(--text-sm)",
          }}
        >
          {errorMessage}
        </div>
      )}

      {!loading && plan && (
        <>
          {/* material hero */}
          <div className="mhero">
            <div className="src">
              {sourceType && (
                <span
                  className={[
                    "srctag",
                    isTed(sourceType) ? "srctag--ted" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {sourceTypeLabel(sourceType)}
                </span>
              )}
            </div>
            <h2>{plan.material.title}</h2>
            <div className="mhero-foot">
              <div className="mhero-meta">
                <span>{sectionCount} sections</span>
                {updatedAt && <span>updated {updatedAt}</span>}
              </div>
              <div className="mhero-actions">
                <button
                  className="btn btn--sm btn--danger"
                  type="button"
                  onClick={handleDeleteMaterial}
                >
                  削除
                </button>
                <Link
                  href={`/materials/${materialIdentifier}/sections/new`}
                  className="btn btn--sm btn--secondary"
                >
                  ＋ セクション作成
                </Link>
              </div>
            </div>
          </div>

          {/* main grid */}
          <div className="plan-grid">
            {/* left: section series list */}
            <div className="plan-main">
              <div className="plan-h">
                <h3>セクション系列</h3>
                <span className="mono">{sectionCount} series · 最新版を表示</span>
              </div>

              {plan.sectionSeries.length === 0 && (
                <p style={{ color: "var(--text-faint)", fontSize: "var(--text-sm)" }}>
                  まだセクションがありません。
                </p>
              )}

              {plan.sectionSeries.map((item) => {
                const series = item.sectionSeries;
                const latest = item.latestSection;
                const versions = item.versions ?? [];
                const hasMultipleVersions = versions.length >= 2;
                const practiceHref = latest
                  ? `/materials/${materialIdentifier}/sections/${latest.identifier}`
                  : null;

                return (
                  <div key={series.identifier} className="ss">
                    <div className="ss-top">
                      <div className="ss-n">§{series.displayOrder}</div>
                      <div className="ss-body">
                        <div className="ss-title">
                          <b>{series.title}</b>
                          {latest && (
                            <span className="ver-badge">本文版 v{latest.version}</span>
                          )}
                        </div>
                        {latest && (
                          <p className="ss-text">{latest.bodyText}</p>
                        )}
                        <div className="ss-stats">
                          {latest ? null : (
                            <span style={{ color: "var(--text-faint)" }}>未録音</span>
                          )}
                        </div>
                      </div>
                      <div className="ss-actions">
                        {practiceHref ? (
                          <Link href={practiceHref} className="btn btn--sm btn--primary">
                            練習する
                          </Link>
                        ) : (
                          <button className="btn btn--sm btn--secondary" type="button">
                            録音する
                          </button>
                        )}
                        <button className="btn btn--sm btn--ghost" type="button">
                          編集
                        </button>
                      </div>
                    </div>

                    {hasMultipleVersions && (
                      <div className="ss-versions">
                        {versions.map((version, index) => {
                          const isCurrent = index === 0;
                          return (
                            <div key={version.identifier} className="vrow">
                              <span
                                className={["vdot", isCurrent ? "cur" : ""].filter(Boolean).join(" ")}
                              />
                              <span
                                className={["vtag", isCurrent ? "cur" : ""].filter(Boolean).join(" ")}
                              >
                                v{version.version} {isCurrent ? "最新" : ""}
                              </span>
                              <span style={{ color: isCurrent ? undefined : "var(--text-faint)" }}>
                                {isCurrent ? "" : "初版"}
                              </span>
                              <span className="vmeta" style={{ marginLeft: "auto" }}>
                                {formatDate(version.createdAt)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* right: side rail */}
            <div className="plan-side">
              <div className="plan-h">
                <h3 style={{ fontSize: "var(--text-sm)" }}>教材の進捗</h3>
              </div>
              <div className="ov-gauge-wrap">
                <div className="gauge" style={{ width: "76px", height: "76px" }}>
                  <svg viewBox="0 0 120 120" width="76" height="76">
                    <circle className="g-track" cx="60" cy="60" r="52" />
                    <circle className="g-val" cx="60" cy="60" r="52" />
                  </svg>
                  <div className="g-center">
                    <span
                      className="mono g-num"
                      style={{ fontSize: "var(--text-xl)" }}
                    >
                      —
                    </span>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="score-rows">
                    {plan.sectionSeries.map((item) => (
                      <div
                        key={item.sectionSeries.identifier}
                        className="srow"
                        style={{ gridTemplateColumns: "64px 1fr 24px" }}
                      >
                        <span className="srl">§{item.sectionSeries.displayOrder}</span>
                        <span className="sbar">
                          <i style={{ width: "0%" }} />
                        </span>
                        <span className="srn mono" style={{ color: "var(--text-faint)" }}>
                          —
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="plan-h">
                <h3 style={{ fontSize: "var(--text-sm)" }}>最近のアクティビティ</h3>
              </div>
              <div className="act-list">
                <p
                  style={{
                    color: "var(--text-faint)",
                    fontSize: "var(--text-xs)",
                    margin: 0,
                    padding: "10px 0",
                  }}
                >
                  記録なし
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
