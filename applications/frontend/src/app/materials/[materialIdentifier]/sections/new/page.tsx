"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { apiPost, isApiClientError } from "@/lib/api-client";
import { AppBar } from "@/components/chrome";
import {
  computeBodyMetrics,
  validateBody,
  MAX_BODY_TEXT_LENGTH,
  MIN_ENGLISH_CHAR_RATIO,
  LONG_BODY_WARN_LENGTH,
} from "@/lib/body-validation";

type PageProps = {
  params: Promise<{ materialIdentifier: string }>;
};

export default function NewSectionPage({ params }: PageProps) {
  const { materialIdentifier } = use(params);
  const router = useRouter();

  const [sectionTitle, setSectionTitle] = useState("");
  const [displayOrder, setDisplayOrder] = useState("1");
  const [bodyText, setBodyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedTitle = sectionTitle.trim();
  const trimmedBody = bodyText.trim();
  const canSubmit = trimmedTitle.length > 0 && trimmedBody.length > 0 && !submitting;

  const metrics = computeBodyMetrics(bodyText);
  const validation = validateBody(bodyText);

  const englishPercent = Math.round(metrics.englishRatio * 100);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await apiPost(`/api/v1/materials/${materialIdentifier}/section-series`, {
        title: trimmedTitle,
        displayOrder: Number(displayOrder) || 0,
        bodyText: trimmedBody,
      });
      router.push(`/materials/${materialIdentifier}`);
    } catch (error: unknown) {
      setErrorMessage(isApiClientError(error) ? error.message : "セクションの作成に失敗しました");
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
    >
      <AppBar
        crumb={
          <>
            <Link href="/" style={{ color: "var(--text-tertiary)", textDecoration: "none" }}>
              ライブラリ
            </Link>
            <span className="sep">›</span>
            <Link
              href={`/materials/${materialIdentifier}`}
              style={{ color: "var(--text-tertiary)", textDecoration: "none" }}
            >
              教材
            </Link>
            <span className="sep">›</span>
            <b>セクション作成</b>
          </>
        }
        action={
          <Link
            href={`/materials/${materialIdentifier}`}
            className="btn btn--sm btn--ghost"
            style={{ marginLeft: "auto" }}
          >
            キャンセル
          </Link>
        }
      />

      <div className="editor-grid" style={{ flex: 1 }}>
        <div className="editor-main">
          <div className="field-row">
            <label className="field">
              <span className="field-lbl">
                セクション名 <span className="req-star">*</span>
              </span>
              <input
                className="input"
                type="text"
                value={sectionTitle}
                onChange={(event) => setSectionTitle(event.target.value)}
                placeholder="Opening story"
              />
            </label>
            <label className="field">
              <span className="field-lbl">表示順</span>
              <input
                className="input"
                type="number"
                min={0}
                value={displayOrder}
                onChange={(event) => setDisplayOrder(event.target.value)}
              />
            </label>
          </div>

          <label className="field" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <span className="field-lbl">
              英文本文 <span className="req-star">*</span>
              <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>
                {" "}
                — General American で練習する一節を貼り付け
              </span>
            </span>
            <textarea
              className="input input--area"
              rows={8}
              style={{ flex: 1 }}
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              placeholder="When I was nine years old..."
            />
            <div className="body-meta">
              <span>
                <b>{metrics.words}</b> words
              </span>
              <span>
                <b>{metrics.chars}</b> / {MAX_BODY_TEXT_LENGTH.toLocaleString()} chars
              </span>
              <span>
                英字 <b>{englishPercent}%</b>
              </span>
            </div>
          </label>

          {errorMessage && (
            <p style={{ color: "var(--sev-critical-text)", fontSize: "var(--text-sm)", margin: 0 }}>
              {errorMessage}
            </p>
          )}
        </div>

        <div className="editor-side">
          <div className="side-h">本文の妥当性</div>
          <ul className="vchecks">
            <li className={`vcheck vcheck--${validation.isNotEmpty}`}>
              <span className="vi" />
              <span className="vt">
                空でない本文 {metrics.chars > 0 && <span>· {metrics.chars} chars</span>}
              </span>
            </li>
            <li className={`vcheck vcheck--${validation.isWithinMaxLength}`}>
              <span className="vi" />
              <span className="vt">
                最大文字数内 <span>· {MAX_BODY_TEXT_LENGTH.toLocaleString()} まで</span>
              </span>
            </li>
            <li className={`vcheck vcheck--${validation.meetsEnglishRatio}`}>
              <span className="vi" />
              <span className="vt">
                英字割合を満たす{" "}
                <span>
                  · {englishPercent}% ≥ {Math.round(MIN_ENGLISH_CHAR_RATIO * 100)}%
                </span>
              </span>
            </li>
            <li className={`vcheck vcheck--${validation.hasNoControlCharacters}`}>
              <span className="vi" />
              <span className="vt">制御文字なし</span>
            </li>
            <li className={`vcheck vcheck--${validation.isNotLong}`}>
              <span className="vi" />
              <span className="vt">
                長文は分割を推奨 <span>· {LONG_BODY_WARN_LENGTH.toLocaleString()} 字超で warn</span>
              </span>
            </li>
          </ul>
          <div className="preview-note">
            本文を後から改訂する場合、既存の録音・解析結果との整合性を保つため、旧版は上書きせず新しい本文版として保存されます。録音が読んだ本文と解析基準がずれません。
          </div>
        </div>
      </div>

      <div className="modal-foot" style={{ borderTop: "1px solid var(--border)" }}>
        <span className="req">
          <span className="req-star">*</span> セクション名と本文は必須
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          disabled
          aria-label="下書き保存（バックエンドに下書き概念がないため現在利用不可）"
        >
          下書き保存
        </button>
        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
          {submitting ? "作成中..." : "＋ セクションを作成"}
        </button>
      </div>
    </form>
  );
}
