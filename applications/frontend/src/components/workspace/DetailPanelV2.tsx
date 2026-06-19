"use client";

import { useState, useRef } from "react";
import type { EngineFindingDto } from "@/lib/api-types";
import { toSeverityClass, SEVERITY_DISPLAY_LABELS } from "@/lib/severity";
import {
  getPhenomenonIcon,
  getPhenomenonLabelJa,
  getPhenomenonLabelEn,
  confidenceToLevel,
} from "@/lib/phenomenon";
import { ARTICULATION_DATA, HIGH_PRIORITY_PHONEME_SET } from "@/lib/articulation-data";
import { ArticulationCard } from "./ArticulationCard";

type DetailPanelV2Props = {
  finding: EngineFindingDto | null;
  sectionIdentifier: string;
  onClose: () => void;
  onDismissed?: (findingIdentifier: string, dismissed: boolean) => void;
  /** M-CRL-1 (ADR-022): 最新 ready 録音試行 identifier（部分再生に使用）*/
  latestRecordingAttemptIdentifier: string | null;
};

type TtsSpeed = 0.5 | 0.85 | 1.0;

/** M-CRL-2: 所見スコープ A/B chip の再生モード */
type FindingPlayMode = "self" | "model";

/**
 * v2 詳細パネル (M-WS / workspace-v2.html `.panel` 構造)
 * - `.phon-compare`: expected/detected IPA 対比
 * - `.nbest`: NBest 診断（`.nbest-row.is-top` + `.nb-bar` + `.nb-p`）
 * - `.proj-badge`: matchesL1Pattern 時に表示
 * - `.fb3`: 3層フィードバック（`--what`/`--why`/`--fix`）
 * - `.badge badge--{severity}` / `.phen` / `.fl[data-rank]` / `.conf[data-level]`
 * - `.dismiss-btn`: POST /api/v1/sections/{sectionId}/findings/{findingId}/dismissal
 * - ③How 内: お手本ボタン (POST /api/v1/tts)、調音図解リンク、ドリルリンク
 * - panel-foot: 部分再生 + 自分の音/お手本 2-chip (M-CRL-1/2)
 */
export const DetailPanelV2 = ({
  finding,
  sectionIdentifier,
  onClose,
  onDismissed,
  latestRecordingAttemptIdentifier,
}: DetailPanelV2Props) => {
  const [isDismissed, setIsDismissed] = useState(finding?.dismissed ?? false);
  const [ttsSpeed, setTtsSpeed] = useState<TtsSpeed>(0.85);
  const [ttsAudio, setTtsAudio] = useState<HTMLAudioElement | null>(null);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [dismissLoading, setDismissLoading] = useState(false);
  const [showArticulation, setShowArticulation] = useState(false);

  // M-CRL-1/2: 部分再生 + A/B chip state
  const [findingPlayMode, setFindingPlayMode] = useState<FindingPlayMode>("self");
  const [audioRangePlaying, setAudioRangePlaying] = useState(false);
  /** S-CRL-2: finding identifier キーでデコード済み AudioBuffer をキャッシュ */
  const audioBufferCache = useRef<Map<string, AudioBuffer>>(new Map());
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  if (!finding) {
    return (
      <div className="detail-empty">
        本文のハイライトをクリックすると、ここに詳細が表示されます。
      </div>
    );
  }

  const severityClass = toSeverityClass(finding.severity);
  const severityLabel = SEVERITY_DISPLAY_LABELS[severityClass];
  const confidenceLevel = confidenceToLevel(finding.confidence);
  const hasIpa = finding.expected.ipa !== null || finding.detected.ipa !== null;
  const dismissed = isDismissed || finding.dismissed;

  const handleDismiss = async () => {
    if (dismissLoading) return;
    setDismissLoading(true);
    try {
      const response = await fetch(
        `/api/v1/sections/${sectionIdentifier}/findings/${finding.finding}/dismissal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (response.ok) {
        setIsDismissed(true);
        onDismissed?.(finding.finding, true);
      }
    } finally {
      setDismissLoading(false);
    }
  };

  const handleRestoreDismissal = async () => {
    if (dismissLoading) return;
    setDismissLoading(true);
    try {
      const response = await fetch(
        `/api/v1/sections/${sectionIdentifier}/findings/${finding.finding}/dismissal`,
        { method: "DELETE" },
      );
      if (response.ok) {
        setIsDismissed(false);
        onDismissed?.(finding.finding, false);
      }
    } finally {
      setDismissLoading(false);
    }
  };

  const handlePlayTts = async () => {
    const text = finding.expected.text ?? finding.detected.text ?? "";
    if (!text) return;

    if (ttsAudio) {
      if (ttsPlaying) {
        ttsAudio.pause();
        setTtsPlaying(false);
      } else {
        void ttsAudio.play();
        setTtsPlaying(true);
      }
      return;
    }

    try {
      const response = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, speed: ttsSpeed }),
      });
      if (!response.ok) return;

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.onended = () => {
        setTtsPlaying(false);
      };
      setTtsAudio(audio);
      void audio.play();
      setTtsPlaying(true);
    } catch {
      // TTS unavailable — no-op, button stays
    }
  };

  /**
   * M-CRL-1: 部分再生 — Web Audio decodeAudioData + AudioBuffer スライス。
   * GET /api/v1/recording-attempts/{id}/audio から全 blob を取得し、
   * audioRange [startMs/1000, endMs/1000] 区間のみ AudioBuffer にスライスして再生する。
   * S-CRL-2: finding.finding キーで AudioBuffer をキャッシュ（所見切替でキャッシュ破棄）。
   */
  const handlePlayAudioRange = async () => {
    if (!finding.audioRange || !latestRecordingAttemptIdentifier) return;

    // 再生中なら停止
    if (audioRangePlaying && audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
      setAudioRangePlaying(false);
      return;
    }

    const cacheKey = finding.finding;
    const startSec = finding.audioRange.startMilliseconds / 1000;
    const endSec = finding.audioRange.endMilliseconds / 1000;

    try {
      // S-CRL-2: キャッシュヒット確認
      let decoded = audioBufferCache.current.get(cacheKey) ?? null;

      if (!decoded) {
        const response = await fetch(
          `/api/v1/recording-attempts/${latestRecordingAttemptIdentifier}/audio`,
        );
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();

        const audioContext = new AudioContext();
        decoded = await audioContext.decodeAudioData(arrayBuffer);
        // S-CRL-2: キャッシュに保存（所見切替まで有効）
        audioBufferCache.current.set(cacheKey, decoded);
      }

      const audioContext = new AudioContext();
      const sampleRate = decoded.sampleRate;
      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.min(Math.ceil(endSec * sampleRate), decoded.length);
      const sliceLength = Math.max(0, endSample - startSample);

      // 区間を新しい AudioBuffer にコピー
      const sliced = audioContext.createBuffer(decoded.numberOfChannels, sliceLength, sampleRate);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const sourceData = decoded.getChannelData(ch);
        const sliceData = sliced.getChannelData(ch);
        for (let i = 0; i < sliceLength; i++) {
          sliceData[i] = sourceData[startSample + i] ?? 0;
        }
      }

      const source = audioContext.createBufferSource();
      source.buffer = sliced;
      source.connect(audioContext.destination);
      source.onended = () => {
        audioSourceRef.current = null;
        setAudioRangePlaying(false);
      };
      source.start();
      audioSourceRef.current = source;
      setAudioRangePlaying(true);
    } catch {
      // Web Audio unavailable — no-op
      setAudioRangePlaying(false);
    }
  };

  /**
   * M-CRL-2: findingPlayMode に応じて自分の音 or お手本 TTS を再生する。
   * chip ボタンの onClick: mode を切り替えてそれぞれのハンドラを呼ぶ。
   */
  const handleFindingPlay = () => {
    if (findingPlayMode === "self") {
      void handlePlayAudioRange();
    } else {
      void handlePlayTts();
    }
  };

  const wordText = finding.expected.text ?? finding.detected.text ?? "—";
  const hasNBest = finding.nBest !== null && finding.nBest.length > 0;
  const hasFeedbackLayers = finding.feedbackLayers !== null;

  // 高優先音素かどうか判定 (M-ARTIC-c)
  const expectedIpa = finding.expected.ipa;
  const isHighPriorityPhoneme = expectedIpa !== null && HIGH_PRIORITY_PHONEME_SET.has(expectedIpa);
  const articulationEntry = isHighPriorityPhoneme
    ? (ARTICULATION_DATA.find((entry) => entry.ipaDisplay === expectedIpa) ?? null)
    : null;

  return (
    <div className={`panel${dismissed ? " finding--dismissed" : ""}`} style={{ maxWidth: "none" }}>
      {/* panel-top */}
      <div className="panel-top">
        <div>
          <div className="panel-target">
            …<span className={`mk mk--${severityClass}`}>{wordText}</span>.
          </div>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              marginTop: "8px",
              flexWrap: "wrap",
            }}
          >
            <span className={`badge badge--${severityClass}`}>
              <span className="dot" />
              {severityLabel}
            </span>
            {finding.phenomenon && (
              <span className="phen">
                <span className="pi">{getPhenomenonIcon(finding.phenomenon)}</span>
                {getPhenomenonLabelJa(finding.phenomenon)}{" "}
                <span className="pe">{getPhenomenonLabelEn(finding.phenomenon)}</span>
              </span>
            )}
            {finding.functionalLoad && (
              <span className="fl" data-rank={finding.functionalLoad}>
                <span className="fd">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                FL {finding.functionalLoad}
              </span>
            )}
            <span className="conf" data-level={confidenceLevel}>
              <span className="cd">
                <i />
                <i />
                <i />
              </span>
              {finding.confidence.toFixed(2)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {!dismissed ? (
            <button
              className="dismiss-btn"
              type="button"
              onClick={() => void handleDismiss()}
              disabled={dismissLoading}
            >
              ✕ 却下
            </button>
          ) : (
            <button
              className="dismiss-btn"
              type="button"
              onClick={() => void handleRestoreDismissal()}
              disabled={dismissLoading}
            >
              ↩ 復元
            </button>
          )}
          <button className="icon-btn" type="button" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* dismissed note */}
      {dismissed && (
        <div className="dismissed-note" style={{ margin: "0 var(--sp-5)" }}>
          却下済み — 低優先度として記録されました
          <span
            className="undo"
            onClick={() => void handleRestoreDismissal()}
            style={{ marginLeft: "auto" }}
          >
            取消
          </span>
        </div>
      )}

      {/* phon-compare */}
      {hasIpa && (
        <div className="phon-compare">
          {finding.expected.ipa !== null && (
            <div className="phon">
              <div className="phon-lbl">期待 · expected</div>
              <div className="phon-val">{finding.expected.ipa}</div>
              {finding.expected.text && <div className="phon-meta">{finding.expected.text}</div>}
            </div>
          )}
          {finding.expected.ipa !== null && finding.detected.ipa !== null && (
            <div className="phon-arrow">→</div>
          )}
          {finding.detected.ipa !== null && (
            <div className="phon phon--actual">
              <div className="phon-lbl">検出 · detected</div>
              <div className="phon-val">{finding.detected.ipa}</div>
              {finding.detected.text && <div className="phon-meta">{finding.detected.text}</div>}
            </div>
          )}
        </div>
      )}

      {/* NBest */}
      {hasNBest && (
        <div style={{ padding: "var(--sp-4) var(--sp-5) 0" }}>
          <div
            className="kbd-label"
            style={{
              marginBottom: "8px",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-2xs)",
              color: "var(--text-faint)",
            }}
          >
            NBest — 実際に聞こえた音
          </div>
          <div className="nbest" style={{ maxWidth: "380px" }}>
            {(finding.nBest ?? []).slice(0, 3).map((candidate, index) => (
              <div key={index} className={`nbest-row${index === 0 ? " is-top" : ""}`}>
                <span className="nb-ipa">{candidate.phoneme}</span>
                <span className="nb-bar">
                  <i style={{ width: `${(candidate.confidence * 100).toFixed(0)}%` }} />
                </span>
                <span className="nb-p">
                  .{String(Math.round(candidate.confidence * 100)).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
          {finding.matchesL1Pattern && finding.nBest && finding.nBest[0] && (
            <div style={{ marginTop: "10px" }}>
              <span className="proj-badge">
                <span className="pj">
                  {finding.expected.ipa ?? "?"} → {`[${finding.nBest[0].phoneme}]`}
                </span>
                日本語話者典型パターン
              </span>
            </div>
          )}
        </div>
      )}

      {/* 3層フィードバック */}
      {hasFeedbackLayers && (
        <div style={{ padding: "var(--sp-2) var(--sp-5) var(--sp-2)" }}>
          <div className="fb3">
            <div className="fb3-row fb3-row--what">
              <span className="fb3-num">①</span>
              <div>
                <div className="fb3-k">
                  What <span className="jp">観測</span>
                </div>
                <div className="fb3-t">{finding.feedbackLayers!.whatJa}</div>
              </div>
            </div>
            <div className="fb3-row fb3-row--why">
              <span className="fb3-num">②</span>
              <div>
                <div className="fb3-k">
                  Why <span className="jp">原因 — L1 干渉</span>
                </div>
                <div className="fb3-t">{finding.feedbackLayers!.whyJa}</div>
              </div>
            </div>
            <div className="fb3-row fb3-row--fix">
              <span className="fb3-num">③</span>
              <div>
                <div className="fb3-k">
                  How <span className="jp">修正 — 調音指示</span>
                </div>
                <div className="fb3-t">
                  {finding.feedbackLayers!.howJa}
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                    <button
                      className="btn btn--sm btn--secondary"
                      type="button"
                      onClick={() => void handlePlayTts()}
                    >
                      {ttsPlaying ? "❚❚" : "▸"} お手本 {wordText}{" "}
                      <span className="mono" style={{ opacity: 0.6 }}>
                        {ttsSpeed}x
                      </span>
                    </button>
                    <div className="speed" style={{ display: "inline-flex", gap: "4px" }}>
                      {([0.5, 0.85, 1.0] as TtsSpeed[]).map((speed) => (
                        <button
                          key={speed}
                          className={`sp-chip${ttsSpeed === speed ? " is-active" : ""}`}
                          type="button"
                          onClick={() => {
                            setTtsSpeed(speed);
                            setTtsAudio(null);
                            setTtsPlaying(false);
                          }}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                    <button
                      className="btn btn--sm btn--ghost"
                      type="button"
                      disabled={!isHighPriorityPhoneme}
                      onClick={() => setShowArticulation((prev) => !prev)}
                      title={
                        isHighPriorityPhoneme
                          ? `調音図解 ${expectedIpa ?? ""}`
                          : "この音素の調音図解は現在準備中です"
                      }
                    >
                      調音図解 → {finding.expected.ipa ?? ""}
                    </button>
                    <button className="btn btn--sm btn--ghost" type="button" disabled>
                      ドリルへ →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 調音図解カード展開 (M-ARTIC-c) — M-CRL-3: finding prop を追加 (W-3) */}
      {showArticulation && articulationEntry && (
        <div style={{ padding: "var(--sp-4) var(--sp-5)" }}>
          <ArticulationCard entry={articulationEntry} finding={finding} />
        </div>
      )}

      {/* messageJa fallback（feedbackLayers がない場合） */}
      {!hasFeedbackLayers && (
        <p className="panel-jp" style={{ padding: "var(--sp-3) var(--sp-5) 0" }}>
          {finding.messageJa}
        </p>
      )}

      {/* panel-foot */}
      <div className="panel-foot">
        {finding.audioRange && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {/* M-CRL-1: 部分再生ボタン — onClick で Web Audio スライス再生 */}
            <button
              className="btn btn--sm btn--secondary"
              type="button"
              onClick={() => void handleFindingPlay()}
              disabled={findingPlayMode === "self" && !latestRecordingAttemptIdentifier}
            >
              {(findingPlayMode === "self" ? audioRangePlaying : ttsPlaying) ? "❚❚" : "▸"} 部分再生{" "}
              <span className="mono" style={{ opacity: 0.6 }}>
                {(finding.audioRange.startMilliseconds / 1000).toFixed(2)}–
                {(finding.audioRange.endMilliseconds / 1000).toFixed(2)}s
              </span>
            </button>
            {/* M-CRL-2: 自分の音 / お手本 A/B トグル — v3 .scope-ab（音源アイデンティティ dot, golden は first slice 外） */}
            <div className="scope-ab">
              <button
                className={findingPlayMode === "self" ? "is-active" : ""}
                type="button"
                onClick={() => setFindingPlayMode("self")}
              >
                <span className="sa-dot" style={{ background: "var(--src-self)" }} />
                自分の音
              </button>
              <button
                className={findingPlayMode === "model" ? "is-active" : ""}
                type="button"
                onClick={() => setFindingPlayMode("model")}
              >
                <span className="sa-dot" style={{ background: "var(--src-model)" }} />
                お手本
              </button>
            </div>
          </div>
        )}
        <div className="panel-meta">
          {finding.gop !== null && <span className="mono">GOP {finding.gop.toFixed(1)}</span>}
          <span
            className="mono"
            style={{
              color:
                finding.scoreImpact === 0
                  ? "var(--text-faint)"
                  : `var(--sev-${severityClass}-text)`,
            }}
          >
            {finding.scoreImpact === 0
              ? "±0 pt"
              : `${finding.scoreImpact > 0 ? "+" : ""}${finding.scoreImpact} pt`}
          </span>
        </div>
      </div>
    </div>
  );
};
