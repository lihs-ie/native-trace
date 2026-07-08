"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPostForm, isApiClientError } from "@/lib/api-client";
import { nowMs } from "@/lib/now";
import { detectBrowserEnvironment } from "@/lib/browser-environment";
import { formatMinutesSeconds } from "@/lib/format-time";
import {
  type AnalysisMode,
  type EngineFindingDto,
  type EngineResultDto,
  type WorkspaceDto,
} from "@/lib/api-types";
import { engineColorVariable } from "@/lib/engine-display";
import {
  EngineSegSelector,
  Ribbon,
  Gauge,
  ScoreRows,
  EngineTabs,
  DetailPanel,
  LiveWave,
  HighlightedWorkspaceText,
  WorkspaceResultV2,
  SeverityCountPills,
} from "@/components/workspace";
import { useRecordingWithVolumeMeter } from "@/components/workspace/use-recording-with-volume-meter";
import { AppTop } from "@/components/chrome";

// ワークスペースのポーリング周期（ms）。値の統一はしない（diagnostic ページの POLL_INTERVAL_MS とは別値）。
const WORKSPACE_POLL_INTERVAL_MILLISECONDS = 2000;

type PageProps = {
  params: Promise<{ materialIdentifier: string; sectionIdentifier: string }>;
};

type WorkspaceState = "idle" | "recording" | "analyzing" | "result" | "failed" | "low_quality";

export const deriveWorkspaceState = (
  workspace: WorkspaceDto | null,
  isRecording: boolean,
  submitting: boolean,
): WorkspaceState => {
  if (isRecording) return "recording";
  if (submitting) return "analyzing";
  if (!workspace) return "idle";

  const runStatus = workspace.latestAnalysisRun?.status;
  if (!runStatus) return "idle";

  if (runStatus === "failed") {
    const errorCode = workspace.latestAnalysisRun?.errorCode;
    if (errorCode === "low_quality_audio" && workspace.resultsByEngine.length === 0) {
      return "low_quality";
    }
    return workspace.resultsByEngine.length > 0 ? "result" : "failed";
  }

  if (runStatus === "succeeded" || runStatus === "partial_succeeded") {
    return workspace.resultsByEngine.length > 0 ? "result" : "failed";
  }

  if (runStatus === "running" || runStatus === "queued") return "analyzing";

  return "idle";
};

// 静的なプレイヤー波形用の高さ配列（インデックス由来の決定的値）
const PLAY_WAVE_HEIGHTS = [
  30, 55, 80, 65, 45, 70, 90, 50, 35, 60, 75, 40, 85, 55, 30, 65, 48, 72, 38, 58, 44, 68, 52, 36,
];

export default function WorkspacePage({ params }: PageProps) {
  const { materialIdentifier, sectionIdentifier } = use(params);

  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("comparison");
  const [submitting, setSubmitting] = useState(false);

  const [activeEngineResult, setActiveEngineResult] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<EngineFindingDto | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerTime, setPlayerTime] = useState<{ currentTime: number; duration: number }>({
    currentTime: 0,
    duration: 0,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef<number>(0);

  const refresh = useCallback(
    () =>
      apiGet<WorkspaceDto>(`/api/v1/sections/${sectionIdentifier}/workspace`)
        .then((data) => {
          setWorkspace(data);
          setLoadError(null);
          // 結果が来たらデフォルトの activeEngine を設定
          if (data.resultsByEngine.length > 0) {
            setActiveEngineResult((prev) => {
              if (prev === null) return data.resultsByEngine[0]?.result ?? null;
              const still = data.resultsByEngine.find((r) => r.result === prev);
              return still ? prev : (data.resultsByEngine[0]?.result ?? null);
            });
          }
        })
        .catch((error: unknown) => {
          setLoadError(
            isApiClientError(error) ? error.message : "ワークスペースの取得に失敗しました",
          );
        }),
    [sectionIdentifier],
  );

  // 初回取得 + 2 秒ポーリング
  useEffect(() => {
    void refresh();
    const intervalId = setInterval(() => void refresh(), WORKSPACE_POLL_INTERVAL_MILLISECONDS);
    return () => clearInterval(intervalId);
  }, [refresh]);

  const submitRecording = useCallback(
    async (blob: Blob) => {
      setSubmitting(true);
      setRecordError(null);
      const endedAt = nowMs();
      const durationMs = Math.max(1, endedAt - startedAtRef.current);

      const formData = new FormData();
      const extension = (blob.type.split("/")[1] ?? "webm").split(";")[0];
      formData.append("audio", blob, `recording.${extension}`);
      formData.append("audioSource", "browser_recording");
      formData.append("analysisMode", analysisMode);
      formData.append("recordedDurationMs", String(durationMs));
      formData.append("startedAt", new Date(startedAtRef.current).toISOString());
      formData.append("endedAt", new Date(endedAt).toISOString());
      formData.append("browserInfo", JSON.stringify(detectBrowserEnvironment()));

      try {
        await apiPostForm(`/api/v1/sections/${sectionIdentifier}/practice-attempts`, formData);
        await refresh();
      } catch (error: unknown) {
        setRecordError(isApiClientError(error) ? error.message : "録音の送信に失敗しました");
      } finally {
        setSubmitting(false);
      }
    },
    [analysisMode, sectionIdentifier, refresh],
  );

  // W35: getUserMedia 制約・AnalyserNode・peak-hold ループ・タイマー・cleanup は
  // use-recording-with-volume-meter.ts に一本化（diagnostic ページと共有）。
  // onstop 送信コールバック（submitRecording 呼び出し）はページ側に残す。
  const {
    isRecording,
    recSeconds,
    volumeLevel,
    isLowVolume,
    startRecording: startRecordingWithVolumeMeter,
    stopRecording,
  } = useRecordingWithVolumeMeter({
    onStart: (startedAt) => {
      startedAtRef.current = startedAt;
    },
    onStop: (blob) => {
      void submitRecording(blob);
    },
    onError: (message) => setRecordError(message),
  });

  const state = deriveWorkspaceState(workspace, isRecording, submitting);

  const startRecording = () => {
    setRecordError(null);
    setSelectedFinding(null);
    void startRecordingWithVolumeMeter();
  };

  const handleAddEngine = async () => {
    const latestReady = workspace?.recordingAttempts.find((r) => r.status === "ready");
    if (!latestReady) return;
    const existingKinds = new Set(workspace?.resultsByEngine.map((r) => r.engineKind) ?? []);
    const targetMode: AnalysisMode = existingKinds.has("cloud")
      ? "ossWorkerOnly"
      : existingKinds.has("oss_worker")
        ? "cloudOnly"
        : "comparison";
    try {
      await apiPost(`/api/v1/recording-attempts/${latestReady.identifier}/analysis-runs`, {
        analysisMode: targetMode,
      });
      await refresh();
    } catch (error: unknown) {
      setRecordError(isApiClientError(error) ? error.message : "追加解析の開始に失敗しました");
    }
  };

  // 録音秒数のフォーマット
  const formattedRecTime = formatMinutesSeconds(recSeconds);

  // 秒数を m:ss 形式にフォーマット
  const formatTime = (seconds: number): string => {
    const safeSeconds = isFinite(seconds) ? seconds : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = Math.floor(safeSeconds % 60);
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  };

  // 現在アクティブなエンジン結果
  const activeResult: EngineResultDto | null =
    workspace?.resultsByEngine.find((r) => r.result === activeEngineResult) ?? null;

  // アクティブエンジンの findings（highlighting 用）
  const activeFindings: EngineFindingDto[] = activeResult?.findings ?? [];

  // 最新 ready 録音の audio URL
  const latestReadyAttempt = workspace?.recordingAttempts.find((r) => r.status === "ready");
  const audioUrl = latestReadyAttempt
    ? `/api/v1/recording-attempts/${latestReadyAttempt.identifier}/audio`
    : null;

  const formattedPlayerTime = audioUrl
    ? `${formatTime(playerTime.currentTime)} / ${formatTime(playerTime.duration)}`
    : "0:00 / 0:00";

  const attemptNumber = workspace?.recordingAttempts.length ?? 0;

  const sectionLabel = workspace?.section.sectionSeries
    ? `§${workspace.section.version} セクション`
    : "セクション";

  return (
    <div className="ws" data-state={state} data-annostyle="underline" data-tone="standard">
      {/* app-top */}
      <div className="app-top">
        <AppTop />
        <div className="crumb" style={{ marginLeft: "16px" }}>
          <span>{materialIdentifier}</span>
          <span className="sep">›</span>
          <b>{sectionLabel}</b>
          <span className="sep">·</span>
          <span className="mono" style={{ fontSize: "var(--text-xs)" }}>
            試行 {String(attemptNumber).padStart(2, "0")}
          </span>
        </div>
        <Link
          className="btn btn--sm btn--ghost"
          style={{ marginLeft: "auto" }}
          href={
            workspace?.section.sectionSeries
              ? `/history?sectionSeries=${workspace.section.sectionSeries}`
              : "/history"
          }
        >
          履歴
        </Link>
      </div>

      {loadError && <div className="ws-error">{loadError}</div>}
      {recordError && <div className="ws-error">{recordError}</div>}

      {/* process ribbon */}
      <Ribbon state={state} />

      {/* body — 結果状態は v2 レイアウト、それ以外は v1 */}
      {state === "result" && activeResult ? (
        <>
          {/* engine tabs (v2 ではタブを ws2 の上部に配置) */}
          {workspace && workspace.resultsByEngine.length > 0 && (
            <div
              style={{
                padding: "var(--sp-3) var(--sp-6) 0",
                borderTop: "1px solid var(--border-faint)",
              }}
            >
              <EngineTabs
                engines={workspace.resultsByEngine}
                activeEngine={activeEngineResult}
                onSelectEngine={(resultId) => {
                  setActiveEngineResult(resultId);
                  setSelectedFinding(null);
                }}
                onAddEngine={handleAddEngine}
              />
            </div>
          )}
          <WorkspaceResultV2
            bodyText={workspace!.section.bodyText}
            engineResult={activeResult}
            sectionIdentifier={sectionIdentifier}
            latestRecordingAttemptIdentifier={latestReadyAttempt?.identifier ?? null}
          />
        </>
      ) : (
        <div className="ws-body">
          {/* main reading area */}
          <div className="ws-main">
            {workspace ? (
              <HighlightedWorkspaceText
                bodyText={workspace.section.bodyText}
                findings={activeFindings}
                selectedFindingIdentifier={selectedFinding?.finding ?? null}
                onSelect={setSelectedFinding}
                showMarks={false}
              />
            ) : (
              <p className="ws-text" />
            )}
            <div className="reading-hint">
              読み上げて録音してください。解析結果はこの本文の上に直接表示されます。
            </div>
          </div>

          {/* result rail (v1 — idle/recording/analyzing/failed 状態のみ) */}
          <div className="ws-rail">
            <div className="rail-block">
              {/* gauge + score rows */}
              {activeResult && (
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <Gauge overall={activeResult.scores.overall} />
                  <ScoreRows scores={activeResult.scores} />
                </div>
              )}

              {/* sevcount */}
              {activeResult && (
                <SeverityCountPills counts={activeResult.counts} className="sevcount" />
              )}
            </div>

            {/* detail panel (v1) */}
            <div className="rail-block">
              <div className="rail-h">選択中の指摘</div>
              <DetailPanel finding={selectedFinding} onClose={() => setSelectedFinding(null)} />
            </div>
          </div>
        </div>
      )}

      {/* dock */}
      <div className="ws-dock">
        {/* idle */}
        <div className="dock-row dock-idle">
          <div className="left">
            <EngineSegSelector value={analysisMode} onChange={setAnalysisMode} />
            <span className="hint">エンジンを選んで録音 →</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {state === "result" && (
              <span className="hint" style={{ display: "inline" }}>
                録音し直す
              </span>
            )}
            <button className="rec-go" type="button" aria-label="録音開始" onClick={startRecording}>
              <span className="d" />
            </button>
          </div>
        </div>

        {/* recording */}
        <div className="dock-row dock-rec">
          <span className="rec-time">{formattedRecTime}</span>
          <LiveWave />
          <div
            className={`volume-meter${isLowVolume ? " volume-meter--low" : ""}`}
            aria-label={`音量レベル ${Math.round(volumeLevel)}%`}
          >
            <div className="volume-meter-track">
              <div className="volume-meter-bar" style={{ width: `${volumeLevel.toFixed(1)}%` }} />
            </div>
            <span className="volume-meter-label">{isLowVolume ? "音量小" : "音量OK"}</span>
          </div>
          <span className="status status--fail" style={{ border: "none", background: "none" }}>
            <span className="sd" />
            REC
          </span>
          <button
            className="stop-go"
            type="button"
            aria-label="停止して解析"
            onClick={stopRecording}
          >
            <span className="sq" />
          </button>
        </div>

        {/* analyzing */}
        <div className="dock-row dock-analyzing">
          <div>
            {workspace?.resultsByEngine.map((engine) => (
              <div key={engine.result} className="job-row">
                <span className="jr-eng">
                  <span
                    className="eng-dot"
                    style={{
                      background: engineColorVariable(engine.engineKind),
                    }}
                  />
                  {engine.engineName}
                </span>
                <span className="job-prog job-prog--indeterminate">
                  <i />
                </span>
                <span
                  className="status status--running"
                  style={{ border: "none", background: "none" }}
                >
                  <span className="sd" />
                  running
                </span>
              </div>
            ))}
            {!workspace?.resultsByEngine.length && (
              <div className="job-row">
                <span className="jr-eng">
                  <span className="eng-dot" style={{ background: "var(--engine-openai)" }} />
                  解析中...
                </span>
                <span className="job-prog job-prog--indeterminate">
                  <i />
                </span>
                <span
                  className="status status--running"
                  style={{ border: "none", background: "none" }}
                >
                  <span className="sd" />
                  running
                </span>
              </div>
            )}
          </div>
          <div className="callout" style={{ marginTop: "4px" }}>
            <span className="ci">i</span>
            解析中も画面はこのまま。完了すると本文の上に添削が表示されます。
          </div>
        </div>

        {/* result */}
        <div className="dock-result dock-row">
          <div
            className="player"
            style={{ flex: 1, maxWidth: "420px", border: "none", background: "none", padding: 0 }}
          >
            <button
              className="pp"
              type="button"
              onClick={() => {
                if (!audioUrl) return;
                if (audioRef.current) {
                  if (isPlaying) {
                    audioRef.current.pause();
                    setIsPlaying(false);
                  } else {
                    void audioRef.current.play();
                    setIsPlaying(true);
                  }
                } else {
                  const audio = new Audio(audioUrl);
                  audioRef.current = audio;
                  audio.onended = () => setIsPlaying(false);
                  audio.addEventListener("loadedmetadata", () => {
                    setPlayerTime((prev) => ({ ...prev, duration: audio.duration }));
                  });
                  audio.addEventListener("timeupdate", () => {
                    setPlayerTime({ currentTime: audio.currentTime, duration: audio.duration });
                  });
                  void audio.play();
                  setIsPlaying(true);
                }
              }}
            >
              {isPlaying ? "❚❚" : "▸"}
            </button>
            <div className="wave">
              {PLAY_WAVE_HEIGHTS.map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} className={index < 6 ? "on" : ""} />
              ))}
            </div>
            <span className="tt">{formattedPlayerTime}</span>
          </div>
          <div className="actions">
            <button className="btn btn--sm btn--ghost" type="button" onClick={handleAddEngine}>
              ⊕ 追加解析
            </button>
            <button className="btn btn--sm btn--primary" type="button" onClick={startRecording}>
              ● 録音し直す
            </button>
          </div>
        </div>

        {/* failed */}
        <div className="dock-failed dock-row">
          <div className="failed-message">
            <span className="status status--fail">
              <span className="sd" />
              解析に失敗しました
            </span>
            <span className="failed-hint">
              サーバーとの通信でエラーが発生しました。再度録音してお試しください。
            </span>
          </div>
          <div className="dock-rerecord-group">
            <EngineSegSelector value={analysisMode} onChange={setAnalysisMode} />
            <button className="btn btn--sm btn--primary" type="button" onClick={startRecording}>
              ● 録音し直す
            </button>
          </div>
        </div>

        {/* low_quality */}
        <div className="dock-low-quality dock-row">
          <div className="failed-message">
            <span className="status status--fail">
              <span className="sd" />
              音声を認識できませんでした
            </span>
            <span className="failed-hint">
              音量が小さいか、録音時間が短すぎます。マイクに近づいて、はっきりと録音してください。
            </span>
          </div>
          <div className="dock-rerecord-group">
            <EngineSegSelector value={analysisMode} onChange={setAnalysisMode} />
            <button className="btn btn--sm btn--primary" type="button" onClick={startRecording}>
              ● 録音し直す
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
