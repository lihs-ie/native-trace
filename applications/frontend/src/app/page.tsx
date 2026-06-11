"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, isApiClientError } from "@/lib/api-client";
import type { MaterialDto } from "@/lib/api-types";
import styles from "./page.module.css";

type MaterialListItem = {
  identifier: string;
  title: string;
  source: { sourceType: string } | null;
  createdAt: string;
  updatedAt: string;
};

type MaterialListData = {
  materials?: MaterialListItem[];
} | MaterialListItem[];

export default function DashboardPage() {
  const [materials, setMaterials] = useState<MaterialDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>NativeTrace</h1>
        <div className={styles.headerActions}>
          <Link href="/materials/new" className={styles.buttonPrimary}>
            新規教材作成
          </Link>
          <Link href="/history" className={styles.buttonSecondary}>
            履歴
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <h2 className={styles.sectionTitle}>教材一覧</h2>

        {loading && <p className={styles.loadingMessage}>読み込み中...</p>}

        {!loading && errorMessage && (
          <p className={styles.errorMessage}>{errorMessage}</p>
        )}

        {!loading && !errorMessage && materials.length === 0 && (
          <div className={styles.emptyState}>
            <p>教材がまだありません。最初の教材を作成しましょう。</p>
            <Link href="/materials/new" className={styles.buttonPrimary}>
              新規教材を作成する
            </Link>
          </div>
        )}

        {!loading && !errorMessage && materials.length > 0 && (
          <div className={styles.materialGrid}>
            {materials.map((material) => (
              <Link
                key={material.identifier}
                href={`/materials/${material.identifier}`}
                className={styles.materialCard}
              >
                <p className={styles.cardTitle}>{material.title}</p>
                {material.source && (
                  <p className={styles.cardMeta}>
                    種別: {material.source.sourceType}
                  </p>
                )}
                <p className={styles.cardMeta}>
                  更新: {new Date(material.updatedAt).toLocaleDateString("ja-JP")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
