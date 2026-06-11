"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, isApiClientError } from "@/lib/api-client";
import type { PracticePlanDto } from "@/lib/api-types";
import styles from "./page.module.css";

type PageProps = {
  params: Promise<{ materialIdentifier: string }>;
};

export default function MaterialEditorPage({ params }: PageProps) {
  const { materialIdentifier } = use(params);
  const router = useRouter();

  const [plan, setPlan] = useState<PracticePlanDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [seriesTitle, setSeriesTitle] = useState("");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [bodyText, setBodyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // setState は async コールバック内でのみ呼ぶ（effect 同期 setState を避ける）。
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

  const handleCreateSeries = async (event: React.FormEvent) => {
    event.preventDefault();
    if (seriesTitle.trim() === "" || bodyText.trim() === "" || submitting) return;

    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost(`/api/v1/materials/${materialIdentifier}/section-series`, {
        title: seriesTitle.trim(),
        displayOrder: Number(displayOrder) || 0,
        bodyText: bodyText.trim(),
      });
      setSeriesTitle("");
      setBodyText("");
      setDisplayOrder("0");
      await loadPlan();
    } catch (error: unknown) {
      setFormError(
        isApiClientError(error) ? error.message : "セクションの作成に失敗しました",
      );
    } finally {
      setSubmitting(false);
    }
  };

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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          ← ダッシュボード
        </Link>
        {plan && <h1>{plan.material.title}</h1>}
      </header>

      {loading && <p className={styles.loadingMessage}>読み込み中...</p>}
      {!loading && errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

      {!loading && plan && (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>セクション一覧</h2>
            {plan.sectionSeries.length === 0 && (
              <p className={styles.empty}>まだセクションがありません。</p>
            )}
            <ul className={styles.seriesList}>
              {plan.sectionSeries.map((item) => (
                <li key={item.sectionSeries.identifier} className={styles.seriesItem}>
                  <div className={styles.seriesHeader}>
                    <span className={styles.seriesOrder}>#{item.sectionSeries.displayOrder}</span>
                    <span className={styles.seriesName}>{item.sectionSeries.title}</span>
                  </div>
                  {item.latestSection ? (
                    <>
                      <p className={styles.bodyPreview}>
                        {item.latestSection.bodyText.slice(0, 120)}
                        {item.latestSection.bodyText.length > 120 ? "…" : ""}
                      </p>
                      <div className={styles.seriesActions}>
                        <span className={styles.versionBadge}>
                          v{item.latestSection.version}
                        </span>
                        <Link
                          href={`/materials/${materialIdentifier}/sections/${item.latestSection.identifier}`}
                          className={styles.openLink}
                        >
                          練習する →
                        </Link>
                      </div>
                    </>
                  ) : (
                    <p className={styles.empty}>本文がありません。</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>新しいセクションを追加</h2>
            <form className={styles.form} onSubmit={handleCreateSeries}>
              <label className={styles.field}>
                <span className={styles.label}>タイトル</span>
                <input
                  className={styles.input}
                  type="text"
                  value={seriesTitle}
                  onChange={(event) => setSeriesTitle(event.target.value)}
                  placeholder="Opening story"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>表示順</span>
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  value={displayOrder}
                  onChange={(event) => setDisplayOrder(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>本文（英語）</span>
                <textarea
                  className={styles.textarea}
                  value={bodyText}
                  onChange={(event) => setBodyText(event.target.value)}
                  rows={6}
                  placeholder="When I was nine years old, I went off to summer camp..."
                />
              </label>
              {formError && <p className={styles.errorMessage}>{formError}</p>}
              <div className={styles.actions}>
                <button className={styles.submit} type="submit" disabled={submitting}>
                  {submitting ? "追加中..." : "セクションを追加"}
                </button>
              </div>
            </form>
          </section>

          <section className={styles.dangerZone}>
            <button className={styles.deleteButton} type="button" onClick={handleDeleteMaterial}>
              教材を削除する
            </button>
          </section>
        </>
      )}
    </div>
  );
}
