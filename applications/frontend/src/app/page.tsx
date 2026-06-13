"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, isApiClientError } from "@/lib/api-client";
import type { MaterialDto, DiagnosticSessionDto } from "@/lib/api-types";
import { AppTop } from "@/components/chrome/AppTop";
import { HomeNav } from "@/components/chrome/HomeNav";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  ted: "TED",
  youtube: "YouTube",
  speech: "スピーチ",
  article: "記事",
  book: "書籍",
  other: "その他",
};

const isTed = (sourceType: string): boolean => sourceType.toLowerCase() === "ted";

const formatRelativeDate = (isoString: string): string => {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) return "たった今";
    return `${diffHours}時間前`;
  }
  if (diffDays === 1) return "昨日";
  if (diffDays < 7) return `${diffDays}日前`;
  if (diffDays < 14) return "先週";
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週間前`;
  return `${Math.floor(diffDays / 30)}ヶ月前`;
};

const getSourceLabel = (sourceType: string): string =>
  SOURCE_TYPE_LABELS[sourceType.toLowerCase()] ?? sourceType;

const buildByLine = (
  speakerName: string | null | undefined,
  sourceTitle: string | null | undefined,
): string => {
  const parts = [speakerName, sourceTitle].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.join(" · ");
};

type MaterialListData = { materials?: MaterialDto[] } | MaterialDto[];

export default function LibraryPage() {
  const router = useRouter();
  const [materials, setMaterials] = useState<MaterialDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diagnosticStarting, setDiagnosticStarting] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);

  const startDiagnosticSession = async () => {
    setDiagnosticStarting(true);
    setDiagnosticError(null);
    try {
      const session = await apiPost<DiagnosticSessionDto>("/api/v1/diagnostic-sessions", {});
      sessionStorage.setItem(`diagnostic-session-${session.identifier}`, JSON.stringify(session));
      router.push(`/diagnostic/${session.identifier}`);
    } catch (error: unknown) {
      setDiagnosticStarting(false);
      setDiagnosticError(
        isApiClientError(error) ? error.message : "診断セッションの開始に失敗しました",
      );
    }
  };

  useEffect(() => {
    apiGet<MaterialListData>("/api/v1/materials")
      .then((data) => {
        if (Array.isArray(data)) {
          setMaterials(data as MaterialDto[]);
        } else {
          const listData = data as { materials?: MaterialDto[] };
          setMaterials(listData.materials ?? []);
        }
      })
      .catch((error: unknown) => {
        if (isApiClientError(error)) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("教材の取得に失敗しました");
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div>
      <div className="home-top">
        <AppTop />
        <HomeNav active="library" />
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
          {diagnosticError && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--sev-critical-text)" }}>
              {diagnosticError}
            </span>
          )}
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => void startDiagnosticSession()}
            disabled={diagnosticStarting}
          >
            {diagnosticStarting ? "開始中..." : "診断を始める"}
          </button>
          <Link href="/materials/new" className="btn btn--sm btn--primary">
            ＋ 新しい教材
          </Link>
        </div>
      </div>

      <main>
        {loading && (
          <div
            style={{
              padding: "64px 24px",
              textAlign: "center",
              color: "var(--text-tertiary)",
            }}
          >
            読み込み中...
          </div>
        )}

        {!loading && errorMessage && (
          <div
            style={{
              padding: "32px 24px",
              textAlign: "center",
              color: "var(--sev-critical-text)",
            }}
          >
            {errorMessage}
          </div>
        )}

        {!loading && !errorMessage && materials.length === 0 && (
          <div className="empty-wrap">
            <div className="empty-mark">/t/</div>
            <h2>最初の教材を作成しましょう</h2>
            <p>
              TED
              やスピーチのスクリプトを貼り付けて題材を作り、本文をドラッグ選択して練習セクションに切り出します。録音・解析・添削はすべて同じ画面で行えます。
            </p>
            <div className="empty-actions">
              <Link href="/materials/new" className="btn btn--primary">
                ＋ 英文を貼り付けて作成
              </Link>
              <button type="button" className="btn btn--ghost">
                サンプル教材を読み込む
              </button>
            </div>
            <div className="empty-steps">
              <span className="estep">
                <span className="en">1</span>英文を貼り付け
              </span>
              <span className="estep">
                <span className="en">2</span>範囲選択でセクション作成
              </span>
              <span className="estep">
                <span className="en">3</span>録音 → 解析 → 添削
              </span>
            </div>
          </div>
        )}

        {!loading && !errorMessage && materials.length > 0 && (
          <>
            <div className="lib-head">
              <div>
                <h2>教材ライブラリ</h2>
                <div className="sub">{materials.length} materials</div>
              </div>
            </div>

            <div className="lib-filters">
              <span className="fpill is-active">
                すべて <span className="fn">{materials.length}</span>
              </span>
              <span className="fpill">
                練習中 <span className="fn">0</span>
              </span>
              <span className="fpill">
                未着手 <span className="fn">0</span>
              </span>
              <span className="fpill">
                完了 <span className="fn">0</span>
              </span>
            </div>

            <div className="mat-grid">
              {materials.map((material) => {
                const sourceType = material.source?.sourceType ?? "";
                const sourceLabel = sourceType ? getSourceLabel(sourceType) : null;
                const byLine = buildByLine(
                  material.source?.speakerName,
                  material.source?.sourceTitle,
                );

                return (
                  <Link
                    key={material.identifier}
                    href={`/materials/${material.identifier}`}
                    className="mcard"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="src">
                      {sourceLabel && (
                        <span
                          className={["srctag", isTed(sourceType) ? "srctag--ted" : ""]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {sourceLabel}
                        </span>
                      )}
                      <span className="when">{formatRelativeDate(material.updatedAt)}</span>
                    </div>
                    <div>
                      <h3>{material.title}</h3>
                      {byLine && <div className="by">{byLine}</div>}
                    </div>
                    <div className="spark" style={{ opacity: 0.4 }}>
                      <i style={{ height: "18%" }}></i>
                      <i style={{ height: "18%" }}></i>
                      <i style={{ height: "18%" }}></i>
                    </div>
                    <div className="stats">
                      <span style={{ color: "var(--text-faint)" }}>セクション未作成</span>
                      <span className="best" style={{ color: "var(--text-faint)" }}>
                        未録音
                      </span>
                    </div>
                  </Link>
                );
              })}

              <Link
                href="/materials/new"
                className="mcard mcard--empty"
                style={{
                  gridColumn: "1 / -1",
                  minHeight: "96px",
                  flexDirection: "row",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span className="plus">＋</span>
                <span style={{ fontSize: "var(--text-sm)" }}>英文を貼り付けて新しい教材を作成</span>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
