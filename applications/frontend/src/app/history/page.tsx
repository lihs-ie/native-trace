"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { apiGet, isApiClientError } from "@/lib/api-client";
import styles from "./page.module.css";

type HistoryRecordingAttempt = {
  identifier: string;
  status: string;
  createdAt: string;
};

type HistoryAnalysisRun = {
  identifier: string;
  status: string;
  createdAt: string;
};

type HistorySectionVersion = {
  section: { identifier: string; version: number; bodyText: string; createdAt: string };
  recordingAttempts: HistoryRecordingAttempt[];
  analysisRuns: HistoryAnalysisRun[];
};

type HistoryGroup = {
  sectionSeries: { identifier: string; title: string };
  sections: HistorySectionVersion[];
};

function HistoryContent() {
  const searchParams = useSearchParams();
  const sectionSeries = searchParams.get("sectionSeries");
  const material = searchParams.get("material");

  const [groups, setGroups] = useState<HistoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    if (!sectionSeries) {
      return Promise.resolve();
    }
    const query = new URLSearchParams({ sectionSeries });
    if (material) query.set("material", material);
    return apiGet<HistoryGroup[]>(`/api/v1/history?${query.toString()}`)
      .then((data) => {
        setGroups(data);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        setErrorMessage(
          isApiClientError(error) ? error.message : "履歴の取得に失敗しました",
        );
      })
      .finally(() => setLoading(false));
  }, [sectionSeries, material]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          ← ダッシュボード
        </Link>
        <h1>練習履歴</h1>
      </header>

      {!sectionSeries && (
        <p className={styles.guidance}>
          セクション系列を指定すると履歴が表示されます。教材ページからセクションを開いてください。
        </p>
      )}

      {sectionSeries && loading && <p className={styles.muted}>読み込み中...</p>}
      {sectionSeries && !loading && errorMessage && (
        <p className={styles.errorMessage}>{errorMessage}</p>
      )}

      {sectionSeries && !loading && !errorMessage && groups.length === 0 && (
        <p className={styles.muted}>履歴がありません。</p>
      )}

      {groups.map((group) => (
        <section key={group.sectionSeries.identifier} className={styles.group}>
          <h2 className={styles.groupTitle}>{group.sectionSeries.title}</h2>
          {group.sections.map((sectionVersion) => (
            <div key={sectionVersion.section.identifier} className={styles.versionBlock}>
              <h3 className={styles.versionTitle}>
                バージョン v{sectionVersion.section.version}
              </h3>
              <p className={styles.bodyPreview}>
                {sectionVersion.section.bodyText.slice(0, 100)}
                {sectionVersion.section.bodyText.length > 100 ? "…" : ""}
              </p>
              <div className={styles.stats}>
                <span>録音 {sectionVersion.recordingAttempts.length} 件</span>
                <span>解析 {sectionVersion.analysisRuns.length} 件</span>
              </div>
              <ul className={styles.runList}>
                {sectionVersion.analysisRuns.map((run) => (
                  <li key={run.identifier} className={styles.runItem}>
                    <span className={styles.runStatus}>{run.status}</span>
                    <span className={styles.runTime}>
                      {new Date(run.createdAt).toLocaleString("ja-JP")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<p className={styles.muted}>読み込み中...</p>}>
      <HistoryContent />
    </Suspense>
  );
}
