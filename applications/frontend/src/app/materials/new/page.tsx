"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost, isApiClientError } from "@/lib/api-client";
import styles from "./page.module.css";

type CreateMaterialResponse = {
  material: { identifier: string };
};

const SOURCE_TYPES = ["ted", "youtube", "article", "book", "other"] as const;

export default function NewMaterialPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [speakerName, setSpeakerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMessage(null);

    const hasSource =
      sourceType !== "" ||
      sourceUrl.trim() !== "" ||
      sourceTitle.trim() !== "" ||
      speakerName.trim() !== "";

    try {
      const data = await apiPost<CreateMaterialResponse>("/api/v1/materials", {
        title: trimmedTitle,
        source: hasSource
          ? {
              sourceType: sourceType || "other",
              sourceUrl: sourceUrl.trim() || null,
              sourceTitle: sourceTitle.trim() || null,
              speakerName: speakerName.trim() || null,
            }
          : null,
      });
      router.push(`/materials/${data.material.identifier}`);
    } catch (error: unknown) {
      setErrorMessage(
        isApiClientError(error) ? error.message : "教材の作成に失敗しました",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          ← ダッシュボード
        </Link>
        <h1>新規教材作成</h1>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>
            タイトル<span className={styles.required}>*</span>
          </span>
          <input
            className={styles.input}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="TED: The power of introverts"
            required
          />
        </label>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>出典（任意）</legend>

          <label className={styles.field}>
            <span className={styles.label}>種別</span>
            <select
              className={styles.input}
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value)}
            >
              <option value="">（未設定）</option>
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>URL</span>
            <input
              className={styles.input}
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://www.ted.com/..."
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>出典タイトル</span>
            <input
              className={styles.input}
              type="text"
              value={sourceTitle}
              onChange={(event) => setSourceTitle(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>話者名</span>
            <input
              className={styles.input}
              type="text"
              value={speakerName}
              onChange={(event) => setSpeakerName(event.target.value)}
            />
          </label>
        </fieldset>

        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

        <div className={styles.actions}>
          <button className={styles.submit} type="submit" disabled={!canSubmit}>
            {submitting ? "作成中..." : "作成する"}
          </button>
        </div>
      </form>
    </div>
  );
}
