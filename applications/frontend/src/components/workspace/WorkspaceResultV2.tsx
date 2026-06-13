"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { EngineFindingDto, EngineResultDto } from "@/lib/api-types";
import { HighlightedWorkspaceText } from "./HighlightedWorkspaceText";
import { GopHeatmap } from "./GopHeatmap";
import { F0Chart } from "./F0Chart";
import { DetailPanelV2 } from "./DetailPanelV2";
import { RailV2 } from "./RailV2";

type ViewMode = "highlight" | "gopmap" | "f0";
type AudioSource = "self" | "model" | "golden";

type WorkspaceResultV2Props = {
  bodyText: string;
  engineResult: EngineResultDto;
  sectionIdentifier: string;
  /** 最新の ready 録音試行 identifier (self ソース再生に使用) — M-AB-a */
  latestRecordingAttemptIdentifier: string | null;
};

/** m:ss.s フォーマット */
const formatPlayerTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return "0:00.0";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(Math.floor(remainingSeconds)).padStart(2, "0")}.${String(Math.floor((remainingSeconds % 1) * 10))}`;
};

const WAVE_BAR_COUNT = 15;

/**
 * ワークスペース v2 結果ビュー (M-WS / workspace-v2.html)
 *
 * `.ws2` 2 カラム (main + `.ws2-rail` 332px) を React 化する。
 * - `.eng-summary`: エンジンサマリー
 * - `view-toggle` `.sp-chip`: 指摘ハイライト / GOP ヒートマップ / F0 韻律 切替
 * - 本文 passage: `.mk mk--{severity}` + `.hl-ico`
 * - `.gopmap`: GOP ヒートマップ
 * - 詳細パネル `.panel`: DetailPanelV2
 * - dock: `.ab-srcs` / player / `.speed` — M-AB 実再生配線
 */
export const WorkspaceResultV2 = ({
  bodyText,
  engineResult,
  sectionIdentifier,
  latestRecordingAttemptIdentifier,
}: WorkspaceResultV2Props) => {
  const [viewMode, setViewMode] = useState<ViewMode>("highlight");
  const [selectedFinding, setSelectedFinding] = useState<EngineFindingDto | null>(null);
  const [activeAudioSource, setActiveAudioSource] = useState<AudioSource>("self");
  const [playSpeed, setPlaySpeed] = useState<0.5 | 0.85 | 1.0>(0.85);

  // player 状態
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** TTS キャッシュ: キー = `${text}__${speed}` */
  const ttsCache = useRef<Map<string, HTMLAudioElement>>(new Map());

  const findings = engineResult.findings;

  /** audio イベントリスナーを付与する共通ユーティリティ */
  const attachAudioEvents = useCallback((audio: HTMLAudioElement) => {
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  /** 既存 audio を停止してリセット */
  const stopCurrentAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, []);

  // ソース切替時は再生を止める
  useEffect(() => {
    stopCurrentAudio();
  }, [activeAudioSource, stopCurrentAudio]);

  // speed 変更時: self は playbackRate を変更、model はキャッシュを使わず次回 fetch (M-AB-c)
  useEffect(() => {
    if (audioRef.current && activeAudioSource === "self") {
      audioRef.current.playbackRate = playSpeed;
    }
  }, [playSpeed, activeAudioSource]);

  // アンマウント時の cleanup
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  /** self ソース: 録音音声を取得・再生 (M-AB-a) */
  const playSelfAudio = useCallback(async () => {
    if (!latestRecordingAttemptIdentifier) return;

    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        void audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    try {
      const response = await fetch(
        `/api/v1/recording-attempts/${latestRecordingAttemptIdentifier}/audio`,
      );
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = playSpeed;
      const cleanup = attachAudioEvents(audio);
      // store cleanup ref — we don't need to call it explicitly on pause, only on unmount/source change
      void cleanup; // linter: intentionally unused but attach was called for side effects
      audioRef.current = audio;
      void audio.play();
      setIsPlaying(true);
    } catch {
      // fetch unavailable — no-op
    }
  }, [latestRecordingAttemptIdentifier, isPlaying, playSpeed, attachAudioEvents]);

  /** model ソース: TTS を取得・再生 (M-AB-b) */
  const playModelAudio = useCallback(async () => {
    const cacheKey = `${bodyText}__${String(playSpeed)}`;

    if (audioRef.current) {
      const cached = ttsCache.current.get(cacheKey);
      if (cached && audioRef.current === cached) {
        if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
        } else {
          void audioRef.current.play();
          setIsPlaying(true);
        }
        return;
      }
    }

    // キャッシュ確認 (M-AB-b: 同一テキスト・同一速度では再利用)
    const cachedAudio = ttsCache.current.get(cacheKey);
    if (cachedAudio) {
      stopCurrentAudio();
      cachedAudio.currentTime = 0;
      const cleanup = attachAudioEvents(cachedAudio);
      void cleanup;
      audioRef.current = cachedAudio;
      void cachedAudio.play();
      setIsPlaying(true);
      return;
    }

    try {
      const response = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: bodyText, speed: playSpeed }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const cleanup = attachAudioEvents(audio);
      void cleanup;
      ttsCache.current.set(cacheKey, audio);
      stopCurrentAudio();
      audioRef.current = audio;
      void audio.play();
      setIsPlaying(true);
    } catch {
      // TTS unavailable — no-op
    }
  }, [bodyText, playSpeed, isPlaying, stopCurrentAudio, attachAudioEvents]);

  /** player 再生/一時停止ボタンのハンドラ */
  const handlePlayerToggle = useCallback(() => {
    if (activeAudioSource === "self") {
      void playSelfAudio();
    } else if (activeAudioSource === "model") {
      void playModelAudio();
    }
    // golden は何もしない (M-AB-e)
  }, [activeAudioSource, playSelfAudio, playModelAudio]);

  /** speed chip 変更 (M-AB-c) */
  const handleSpeedChange = useCallback(
    (speed: 0.5 | 0.85 | 1.0) => {
      setPlaySpeed(speed);
      // model の場合はキャッシュを無効化（新速度キーで次回 fetch）
      if (activeAudioSource === "model") {
        stopCurrentAudio();
      }
    },
    [activeAudioSource, stopCurrentAudio],
  );

  const isGoldenSelected = activeAudioSource === "golden";
  const isPlayerDisabled = isGoldenSelected || (activeAudioSource === "self" && !latestRecordingAttemptIdentifier);
  const playerTimeText = `${formatPlayerTime(currentTime)} / ${formatPlayerTime(duration)}`;

  return (
    <div className="ws2">
      {/* main column */}
      <div className="ws2-main">
        {/* engine summary (REQ-107b) */}
        <div className="eng-summary">
          <span
            className="eng-dot"
            style={{
              background:
                engineResult.engineKind === "cloud"
                  ? "var(--engine-openai)"
                  : "var(--engine-rust)",
              marginTop: "5px",
            }}
          />
          <div>
            {engineResult.engineSummaryMessageJa ? (
              <>
                {engineResult.engineSummaryMessageJa}
                {engineResult.modelName && (
                  <span
                    className="mono"
                    style={{ color: "var(--text-faint)", fontSize: "var(--text-2xs)" }}
                  >
                    　{engineResult.modelName}
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: "var(--text-faint)", fontSize: "var(--text-xs)" }}>
                この解析エンジンではサマリーメッセージが未提供です。
              </span>
            )}
          </div>
        </div>

        {/* view toggle */}
        <div className="view-toggle">
          <button
            className={`sp-chip${viewMode === "highlight" ? " is-active" : ""}`}
            type="button"
            onClick={() => setViewMode("highlight")}
          >
            指摘ハイライト
          </button>
          <button
            className={`sp-chip${viewMode === "gopmap" ? " is-active" : ""}`}
            type="button"
            onClick={() => setViewMode("gopmap")}
          >
            GOP ヒートマップ
          </button>
          <button
            className={`sp-chip${viewMode === "f0" ? " is-active" : ""}`}
            type="button"
            onClick={() => setViewMode("f0")}
          >
            F0 韻律
          </button>
        </div>

        {/* passage — 指摘ハイライトビュー */}
        {viewMode === "highlight" && (
          <HighlightedWorkspaceText
            bodyText={bodyText}
            findings={findings}
            selectedFindingIdentifier={selectedFinding?.finding ?? null}
            onSelect={setSelectedFinding}
            showMarks
            showPhenomenonIcons
          />
        )}

        {/* GOP ヒートマップビュー */}
        {viewMode === "gopmap" && (
          <div className="gop-strip">
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                color: "var(--text-faint)",
                marginBottom: "10px",
              }}
            >
              全音素 GOP — 閾値未満も表示 (REQ-107c)
            </div>
            <GopHeatmap entries={engineResult.perPhonemeGop ?? []} />
          </div>
        )}

        {/* F0 韻律ビュー */}
        {viewMode === "f0" && <F0Chart prosody={engineResult.prosody ?? null} />}

        {/* 詳細パネル */}
        {selectedFinding && (
          <DetailPanelV2
            finding={selectedFinding}
            sectionIdentifier={sectionIdentifier}
            onClose={() => setSelectedFinding(null)}
          />
        )}
      </div>

      {/* rail */}
      <RailV2 engineResult={engineResult} />

      {/* dock (A/B sources + player + speed) — full-width row under the 2-column grid */}
      <div
        style={{
          gridColumn: "1 / -1",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-1)",
          padding: "var(--sp-3) var(--sp-6)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
        }}
      >
        {/* A/B ソース切替 */}
        <div className="ab-srcs">
          <button
            className={`ab-src${activeAudioSource === "self" ? " is-active" : ""}`}
            type="button"
            onClick={() => setActiveAudioSource("self")}
          >
            <span className="sd2" style={{ background: "var(--src-self)" }} />
            自分
          </button>
          <button
            className={`ab-src${activeAudioSource === "model" ? " is-active" : ""}`}
            type="button"
            onClick={() => setActiveAudioSource("model")}
          >
            <span className="sd2" style={{ background: "var(--src-model)" }} />
            お手本
          </button>
          <button
            className="ab-src"
            type="button"
            disabled
            title="Golden speaker — GPU 必要 / 準備中"
          >
            <span className="sd2" style={{ background: "var(--src-golden)" }} />
            Golden
          </button>
        </div>

        {/* player UI — M-AB-d */}
        <div className="player" style={{ flex: 1, maxWidth: "420px" }}>
          {/* .pp 再生/停止ボタン */}
          <button
            className="pp"
            type="button"
            disabled={isPlayerDisabled}
            onClick={handlePlayerToggle}
            aria-label={isPlaying ? "一時停止" : "再生"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>

          {/* .wave 波形ビジュアライザー (最低 10 本 `<i>`) */}
          <div className="wave">
            {Array.from({ length: WAVE_BAR_COUNT }, (_, index) => {
              const progress = duration > 0 ? currentTime / duration : 0;
              const isActive = isPlaying && index / WAVE_BAR_COUNT < progress;
              return (
                <i
                  key={index}
                  className={isActive ? "on" : undefined}
                  style={{
                    height: `${20 + Math.round(Math.sin(index * 1.3) * 30 + Math.cos(index * 0.7) * 20) + 30}%`,
                  }}
                />
              );
            })}
          </div>

          {/* .tt 時間表示 m:ss.s / m:ss.s */}
          <span className="tt">{playerTimeText}</span>
        </div>

        {/* speed chips */}
        <div className="speed">
          {([0.5, 0.85, 1.0] as const).map((speed) => (
            <button
              key={speed}
              className={`sp-chip${playSpeed === speed ? " is-active" : ""}`}
              type="button"
              onClick={() => handleSpeedChange(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* golden プレースホルダー (M-AB-e) */}
        {isGoldenSelected && (
          <span
            className="gs-gate"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-2xs)",
              color: "var(--text-faint)",
            }}
          >
            GPU 必要 / 準備中
          </span>
        )}
      </div>
    </div>
  );
};
