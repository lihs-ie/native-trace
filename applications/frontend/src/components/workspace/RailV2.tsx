"use client";

import type { EngineResultDto } from "@/lib/api-types";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/phenomenon";

type RailV2Props = {
  engineResult: EngineResultDto;
};

/**
 * v2 サイドレール (M-WS / workspace-v2.html `.ws2-rail` 構造)
 * - `.mini-axis .ma`: 明瞭性 / ネイティブ性 2 軸スコア
 * - `.axis-expl`: 乖離説明
 * - `.subscale`: CEFR 3 下位尺度
 * - `.focus-row`: focus sounds
 * - `.fold` / `.hedge`: 低信頼 finding の折りたたみ
 * - `.dismissed-note`: 却下済み件数
 */
export const RailV2 = ({ engineResult }: RailV2Props) => {
  const { scores, findings, focusSounds } = engineResult;

  const intelligibility = scores.intelligibility;
  const nativeLikeness = scores.nativeLikeness;
  const cefrOverall = scores.cefrOverall;
  const cefrSegmental = scores.cefrSegmental;
  const cefrProsodic = scores.cefrProsodic;

  const lowConfidenceFindings = findings.filter(
    (f) => !f.dismissed && f.confidence < LOW_CONFIDENCE_THRESHOLD,
  );
  const dismissedCount = findings.filter((f) => f.dismissed).length;

  // 乖離スコア（明瞭性とネイティブ性の差）
  const axisDivergence =
    intelligibility !== null ? Math.abs(intelligibility - nativeLikeness) : null;

  return (
    <aside className="ws2-rail">
      {/* スコア — 二段階ゴール */}
      <div className="rail-block">
        <div className="rail-h">スコア — 二段階ゴール</div>
        <div className="mini-axis">
          <div className="ma">
            <span className="k">明瞭性</span>
            <span className="axis-bar" style={{ margin: 0 }}>
              <i
                style={{
                  width: `${String(intelligibility ?? scores.accuracy)}%`,
                  background: "var(--axis-intel)",
                }}
              />
            </span>
            <span className="n" style={{ color: "var(--axis-intel-text)" }}>
              {intelligibility ?? scores.accuracy}
            </span>
          </div>
          <div className="ma">
            <span className="k">ネイティブ性</span>
            <span className="axis-bar" style={{ margin: 0 }}>
              <i
                style={{
                  width: `${String(nativeLikeness)}%`,
                  background: "var(--axis-native)",
                }}
              />
            </span>
            <span className="n" style={{ color: "var(--axis-native-text)" }}>
              {nativeLikeness}
            </span>
          </div>
        </div>
        {axisDivergence !== null && axisDivergence >= 15 && (
          <div
            className="axis-expl"
            style={{ marginTop: "12px", padding: "10px 12px", fontSize: "var(--text-2xs)" }}
          >
            <span className="q">?</span>
            <div>
              明瞭性とネイティブ性に
              {axisDivergence}
              pt の乖離があります。高 FL の誤りが主因の可能性があります。
            </div>
          </div>
        )}
        {axisDivergence !== null && axisDivergence < 15 && (
          <div
            className="axis-expl"
            style={{ marginTop: "12px", padding: "10px 12px", fontSize: "var(--text-2xs)" }}
          >
            <span className="q">?</span>
            <div>明瞭性とネイティブ性のバランスが取れています。</div>
          </div>
        )}
      </div>

      {/* CEFR 3下位尺度 */}
      {(cefrOverall ?? cefrSegmental ?? cefrProsodic) && (
        <div className="rail-block">
          <div className="rail-h">CEFR 3 下位尺度</div>
          {cefrOverall && (
            <div
              className="subscale"
              style={{ gridTemplateColumns: "96px 1fr 28px 38px", padding: "6px 0" }}
            >
              <span className="ss-k">
                <b>全体</b>
              </span>
              <span className="sbar">
                <i style={{ width: `${String(cefrOverall.score)}%` }} />
              </span>
              <span className="srn mono" style={{ fontSize: "var(--text-xs)" }}>
                {cefrOverall.score}
              </span>
              <span className="ss-cefr">{cefrOverall.band}</span>
            </div>
          )}
          {cefrSegmental && (
            <div
              className="subscale"
              style={{ gridTemplateColumns: "96px 1fr 28px 38px", padding: "6px 0" }}
            >
              <span className="ss-k">
                <b>分節</b>
              </span>
              <span className="sbar">
                <i
                  style={{
                    width: `${String(cefrSegmental.score)}%`,
                    background: "var(--sev-major)",
                  }}
                />
              </span>
              <span className="srn mono" style={{ fontSize: "var(--text-xs)" }}>
                {cefrSegmental.score}
              </span>
              <span className="ss-cefr">{cefrSegmental.band}</span>
            </div>
          )}
          {cefrProsodic && (
            <div
              className="subscale"
              style={{ gridTemplateColumns: "96px 1fr 28px 38px", padding: "6px 0" }}
            >
              <span className="ss-k">
                <b>韻律</b>
              </span>
              <span className="sbar">
                <i
                  style={{
                    width: `${String(cefrProsodic.score)}%`,
                    background: "var(--sev-major)",
                  }}
                />
              </span>
              <span className="srn mono" style={{ fontSize: "var(--text-xs)" }}>
                {cefrProsodic.score}
              </span>
              <span className="ss-cefr">{cefrProsodic.band}</span>
            </div>
          )}
        </div>
      )}

      {/* CEFR データなし */}
      {!(cefrOverall ?? cefrSegmental ?? cefrProsodic) && (
        <div className="rail-block">
          <div className="rail-h">CEFR 3 下位尺度</div>
          <div
            style={{
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
            }}
          >
            この解析エンジンでは未提供
          </div>
        </div>
      )}

      {/* focus sounds */}
      {focusSounds && focusSounds.length > 0 && (
        <div className="rail-block">
          <div className="rail-h">Focus sounds — 漸進更新</div>
          {focusSounds.slice(0, 3).map((sound, index) => (
            <div
              key={index}
              className="focus-row"
              style={{ gridTemplateColumns: "74px 1fr auto", padding: "9px 11px" }}
            >
              <span className="focus-pair" style={{ fontSize: "var(--text-md)" }}>
                {sound.pair}
              </span>
              <span className="fl" data-rank={sound.functionalLoad}>
                <span className="fd">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              <span
                className={`prio${sound.priority === "now" ? " prio--now" : sound.priority === "low" ? " prio--low" : ""}`}
              >
                {sound.priority === "now"
                  ? "Now"
                  : sound.priority === "next"
                    ? "Next"
                    : sound.priority}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* focus sounds なし */}
      {(!focusSounds || focusSounds.length === 0) && (
        <div className="rail-block">
          <div className="rail-h">Focus sounds</div>
          <div
            style={{
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
            }}
          >
            この解析エンジンでは未提供
          </div>
        </div>
      )}

      {/* 低信頼の指摘 */}
      <div className="rail-block">
        <div className="rail-h">低信頼の指摘</div>
        {lowConfidenceFindings.length > 0 ? (
          <details className="fold">
            <summary className="fold-head">
              <span className="tri">▸</span>
              折りたたみ中
              <span className="n">{lowConfidenceFindings.length} 件</span>
            </summary>
            <div className="fold-body">
              {lowConfidenceFindings.map((finding) => (
                <p
                  key={finding.finding}
                  className="hedge"
                  style={{ margin: "0 0 8px", fontSize: "var(--text-2xs)" }}
                >
                  「{finding.expected.text ?? finding.detected.text ?? "—"}」{finding.messageJa}
                  の可能性があります
                </p>
              ))}
            </div>
          </details>
        ) : (
          <div
            style={{
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
            }}
          >
            低信頼の指摘はありません
          </div>
        )}
        {dismissedCount > 0 && (
          <div className="dismissed-note" style={{ marginTop: "10px" }}>
            却下済み {dismissedCount} 件 · 閾値調整に利用
            <span className="undo" style={{ marginLeft: "auto" }}>
              表示
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
