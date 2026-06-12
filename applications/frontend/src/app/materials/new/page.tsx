"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost, isApiClientError } from "@/lib/api-client";

type CreateMaterialResponse = {
  material: { identifier: string };
};

type SourceType = "ted" | "youtube" | "article" | "book" | "other";

const SOURCE_TYPES: { value: SourceType; label: string }[] = [
  { value: "ted", label: "TED" },
  { value: "youtube", label: "YouTube" },
  { value: "article", label: "記事" },
  { value: "book", label: "書籍" },
  { value: "other", label: "その他" },
];

export default function NewMaterialPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [speakerName, setSpeakerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (trimmedTitle.length === 0) {
      setTitleError(true);
      return;
    }

    setTitleError(false);
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
              sourceType: sourceType !== "" ? sourceType : "other",
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
    <div style={{ position: "relative", minHeight: "540px" }}>
      {/* dimmed library backdrop */}
      <div className="backdrop">
        <div className="bd-ghost">
          <div className="bd-row" style={{ width: "38%", height: "22px" }} />
          <div className="bd-row" style={{ width: "90%" }} />
          <div className="bd-row" style={{ width: "70%" }} />
          <div className="bd-row" style={{ width: "82%" }} />
        </div>
      </div>

      {/* modal */}
      <div className="modal">
        <div className="modal-top">
          <div>
            <div className="eyebrow">New material</div>
            <h2>新しい教材を作成</h2>
          </div>
          <Link href="/" className="icon-btn" aria-label="閉じる">
            ✕
          </Link>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <label className="field">
              <span className="field-lbl">
                教材タイトル <span className="req-star">*</span>
              </span>
              <input
                className={`input${titleError ? " is-error" : ""}`}
                type="text"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (titleError && event.target.value.trim().length > 0) {
                    setTitleError(false);
                  }
                }}
                placeholder="例: Stanford Commencement"
              />
              {titleError && (
                <div className="err-msg">タイトルを入力してください</div>
              )}
            </label>

            <div className="field">
              <span className="field-lbl">ソース種別</span>
              <div className="seg seg--wrap">
                {SOURCE_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`seg-item${sourceType === value ? " is-active" : ""}`}
                    onClick={() => setSourceType(sourceType === value ? "" : value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <label className="field">
                <span className="field-lbl">話者名</span>
                <input
                  className="input"
                  type="text"
                  value={speakerName}
                  onChange={(event) => setSpeakerName(event.target.value)}
                  placeholder="例: Steve Jobs"
                />
              </label>
              <label className="field">
                <span className="field-lbl">ソースタイトル</span>
                <input
                  className="input"
                  type="text"
                  value={sourceTitle}
                  onChange={(event) => setSourceTitle(event.target.value)}
                  placeholder="例: Stanford University · 2005"
                />
              </label>
            </div>

            <label className="field">
              <span className="field-lbl">
                ソースURL{" "}
                <span style={{ color: "var(--text-faint)" }}>（任意）</span>
              </span>
              <input
                className="input"
                type="text"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://..."
              />
              <div className="help">
                URL は任意です。不正な形式の場合は保存前に警告します。MVP では外部サイトからの自動取得は行いません。
              </div>
            </label>

            {errorMessage && (
              <p style={{ color: "var(--sev-critical-text)", fontSize: "var(--text-sm)", margin: 0 }}>
                {errorMessage}
              </p>
            )}
          </div>

          <div className="modal-foot">
            <span className="req">
              <span className="req-star">*</span> 必須項目
            </span>
            <Link href="/" className="btn btn--ghost">
              キャンセル
            </Link>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!canSubmit}
            >
              {submitting ? "作成中..." : "教材を作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
