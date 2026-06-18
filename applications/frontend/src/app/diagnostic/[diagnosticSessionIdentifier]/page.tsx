"use client";

/**
 * 診断中画面 — /diagnostic/{diagnosticSessionIdentifier}
 *
 * design-reference/screens/diagnostic.html 窓1 に完全合致。
 * M-DG-5: .dg / .dg-main / .dg-rail / .cov / .cov-row / .dg-prog / .phen / .rec-btn
 *
 * 録音フロー（ADR-004 準拠: 既存 worker/analyzer 契約を再利用）:
 *   1. 各プロンプトを順番に表示
 *   2. .rec-btn で MediaRecorder 録音開始
 *   3. 停止で POST /api/v1/diagnostic-sessions/{id}/recording-attempts
 *      → 内部で submitPracticeAttempt（診断専用 Section 経由）→ analysis 開始
 *   4. GET /api/v1/sections/{sectionIdentifier}/workspace をポーリング
 *      → latestAnalysisRun.status が "succeeded"/"partial_succeeded" になったら
 *        resultsByEngine[0].result を AssessmentResult 識別子として取得
 *   5. 全プロンプト完了後に POST /api/v1/diagnostic-sessions/{id}/completion
 *   6. 結果ページへ遷移
 */

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiPostForm, isApiClientError } from "@/lib/api-client";
import { nowMs } from "@/lib/now";
import type { DiagnosticSessionDto, DiagnosticPromptDto, WorkspaceDto } from "@/lib/api-types";
import {
  accumulateLowDurationMs,
  applyPeakHold,
  computeRmsLevel,
  PEAK_HOLD_RELEASE_RATE_PER_MS,
  rmsLevelToDisplayPercentage,
  SUSTAINED_LOW_MS,
} from "@/components/workspace/volume-meter";

// dBFS display scale threshold aligned to ADR-015 worker gate (-36 dBFS, S-PH-1 / ADR-016 D2).
// Derivation: ((-36 - FLOOR_DB) / (CEILING_DB - FLOOR_DB)) * (100 - MIN_DISPLAY_PERCENTAGE) + MIN_DISPLAY_PERCENTAGE
//           = ((-36 + 60) / 60) * 98 + 2 = (24/60)*98 + 2 ≈ 41.2 → 41
// Confirmed by simulation (scripts/simulate_meter_peak_hold.py, 2026-06-18):
//   gate-rejected recordings (speech_active < -36 dBFS) peak at 37.9% < 41% after smoothing.
const LOW_VOLUME_DISPLAY_THRESHOLD = 41;

// ---- 録音状態 ----
type RecordingState = "idle" | "recording" | "analyzing" | "done" | "failed";

// ---- プロンプトごとの解析結果 ----
type PromptResult = {
  promptIdentifier: string;
  assessmentResultIdentifier: string;
};

// ---- phenomenon アイコン・ラベル写像 ----
const PHENOMENON_ICONS: Record<DiagnosticPromptDto["phenomenon"], string> = {
  segmental: "⇄",
  epenthesis: "‸",
  prosodic: "ˈ",
};

const PHENOMENON_LABELS: Record<DiagnosticPromptDto["phenomenon"], string> = {
  segmental: "分節音対立",
  epenthesis: "母音挿入",
  prosodic: "韻律・強勢",
};

// ---- ブラウザ情報 ----
const detectBrowserInfo = () => ({
  browserName: navigator.userAgent.includes("Chrome")
    ? "Chrome"
    : navigator.userAgent.includes("Firefox")
      ? "Firefox"
      : navigator.userAgent.includes("Safari")
        ? "Safari"
        : "Unknown",
  browserVersion: navigator.userAgent,
  deviceType: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
});

// ---- ポーリング設定 ----
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40;

// ---- recording-attempts レスポンス型 ----
type DiagnosticRecordingAttemptResponse = {
  recordingAttempt: {
    identifier: string;
    section: string;
    status: string;
  };
  analysisRun: {
    identifier: string;
    status: string;
  };
};

// ---- Component ----

type PageProps = {
  params: Promise<{ diagnosticSessionIdentifier: string }>;
};

/**
 * sessionStorage からセッション情報を読み取る（client-only）。
 * useSyncExternalStore の getSnapshot として使うため、**生文字列が変わらない限り
 * 同一参照を返す**（毎回 JSON.parse で新オブジェクトを返すと snapshot 変化と誤検知され
 * 無限再描画になる）。storage key 単位でキャッシュする。
 * - 値あり: DiagnosticSessionDto（正常）
 * - null: client 確認済みで未存在（エラー）
 */
const sessionSnapshotCache = new Map<
  string,
  { raw: string | null; value: DiagnosticSessionDto | null }
>();

function readSessionFromStorage(diagnosticSessionIdentifier: string): DiagnosticSessionDto | null {
  const key = `diagnostic-session-${diagnosticSessionIdentifier}`;
  const stored = sessionStorage.getItem(key);
  const cached = sessionSnapshotCache.get(key);
  if (cached !== undefined && cached.raw === stored) {
    return cached.value;
  }
  let value: DiagnosticSessionDto | null = null;
  if (stored) {
    try {
      value = JSON.parse(stored) as DiagnosticSessionDto;
    } catch {
      value = null;
    }
  }
  sessionSnapshotCache.set(key, { raw: stored, value });
  return value;
}

/** useSyncExternalStore 用 no-op subscribe（sessionStorage は同一タブ内で変更通知を発火しない） */
const subscribeToSessionStorage =
  (_callback: () => void): (() => void) =>
  () =>
    undefined;

/**
 * SSR 時は undefined を返す（"未確定" sentinel）。
 * client hydration 後に getSnapshot が実行され null | DiagnosticSessionDto が確定する。
 * server=undefined / client=null|dto で初回描画が一致し hydration mismatch を防ぐ。
 */
const getServerSnapshot = (): undefined => undefined;

export default function DiagnosticSessionPage({ params }: PageProps) {
  const { diagnosticSessionIdentifier } = use(params);
  const router = useRouter();

  // useSyncExternalStore:
  //   server rendering → undefined（未確定）→ loading 表示
  //   client hydration 後 → sessionStorage の値 or null（確定）
  const sessionSnapshot = useSyncExternalStore<DiagnosticSessionDto | null | undefined>(
    subscribeToSessionStorage,
    () => readSessionFromStorage(diagnosticSessionIdentifier),
    getServerSnapshot,
  );

  // undefined = SSR/hydration 前（loading中）
  // null = client 確認済みで未存在（エラー）
  // DiagnosticSessionDto = 正常
  const diagnosticSession = sessionSnapshot !== undefined ? sessionSnapshot : null;
  const loadError =
    sessionSnapshot === null
      ? "診断セッション情報が見つかりません。ライブラリから診断を開始してください。"
      : null;
  const [recordError, setRecordError] = useState<string | null>(null);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [promptResults, setPromptResults] = useState<PromptResult[]>([]);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  // D4: debounced label state — true only after SUSTAINED_LOW_MS of continuous sub-threshold level
  const [isLowVolume, setIsLowVolume] = useState(false);
  const [completing, setCompleting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousVolumeLevelRef = useRef<number>(0);
  const lastMeterTimestampRef = useRef<number>(0);
  // D4: accumulated sub-threshold duration for label debounce
  const lowDurationRef = useRef<number>(0);

  // 完了済みセッションを結果ページへリダイレクト（非同期 API 確認）
  useEffect(() => {
    apiGet<{ status: string }>(`/api/v1/diagnostic-sessions/${diagnosticSessionIdentifier}`)
      .then((data) => {
        if (data.status === "completed") {
          router.push(`/diagnostic/${diagnosticSessionIdentifier}/result`);
        }
      })
      .catch(() => {
        // セッション確認失敗は無視（sessionStorage のデータで続行）
      });
  }, [diagnosticSessionIdentifier, router]);

  // AudioContext cleanup
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current !== null) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const cleanupAudioContext = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current !== null) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    // WARN-2: reset peak-hold state so a second recording does not inherit a stale held peak.
    previousVolumeLevelRef.current = 0;
    lastMeterTimestampRef.current = 0;
    setVolumeLevel(0);
    // D4: reset label debounce state so a second recording starts with label off.
    lowDurationRef.current = 0;
    setIsLowVolume(false);
  }, []);

  // workspace API をポーリングして AssessmentResult 識別子を取得
  const pollWorkspaceForAssessmentResult = useCallback(
    async (sectionIdentifier: string): Promise<string> => {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const workspace = await apiGet<WorkspaceDto>(
          `/api/v1/sections/${sectionIdentifier}/workspace`,
        );
        const runStatus = workspace.latestAnalysisRun?.status;
        if (runStatus === "succeeded" || runStatus === "partial_succeeded") {
          const firstResult = workspace.resultsByEngine[0];
          if (firstResult?.result) {
            return firstResult.result;
          }
        }
        if (runStatus === "failed") {
          throw new Error("解析に失敗しました");
        }
      }
      throw new Error("解析がタイムアウトしました");
    },
    [],
  );

  const submitRecording = useCallback(
    async (blob: Blob, currentPrompt: DiagnosticPromptDto) => {
      setRecordingState("analyzing");
      setRecordError(null);
      const endedAt = nowMs();
      const durationMs = Math.max(1, endedAt - startedAtRef.current);

      const formData = new FormData();
      const extension = (blob.type.split("/")[1] ?? "webm").split(";")[0];
      formData.append("audio", blob, `recording.${extension}`);
      formData.append("audioSource", "browser_recording");
      formData.append("promptIdentifier", currentPrompt.identifier);
      formData.append("promptText", currentPrompt.text);
      formData.append("recordedDurationMs", String(durationMs));
      formData.append("startedAt", new Date(startedAtRef.current).toISOString());
      formData.append("endedAt", new Date(endedAt).toISOString());
      formData.append("browserInfo", JSON.stringify(detectBrowserInfo()));

      try {
        const recordingResponse = await apiPostForm<DiagnosticRecordingAttemptResponse>(
          `/api/v1/diagnostic-sessions/${diagnosticSessionIdentifier}/recording-attempts`,
          formData,
        );

        const sectionIdentifier = recordingResponse.recordingAttempt.section;
        const assessmentResultIdentifier =
          await pollWorkspaceForAssessmentResult(sectionIdentifier);

        setPromptResults((previous) => [
          ...previous,
          {
            promptIdentifier: currentPrompt.identifier,
            assessmentResultIdentifier,
          },
        ]);
        setRecordingState("done");
      } catch (error: unknown) {
        setRecordingState("failed");
        setRecordError(
          isApiClientError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "録音の送信に失敗しました",
        );
      }
    },
    [diagnosticSessionIdentifier, pollWorkspaceForAssessmentResult],
  );

  const startRecording = useCallback(async () => {
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
        },
      });

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 512;
      const mediaStreamSource = audioContext.createMediaStreamSource(stream);
      mediaStreamSource.connect(analyserNode);

      const timeDomainBuffer = new Uint8Array(analyserNode.fftSize);
      const updateVolumeMeter = (timestamp: DOMHighResTimeStamp) => {
        analyserNode.getByteTimeDomainData(timeDomainBuffer);
        const rmsLevel = computeRmsLevel(timeDomainBuffer);
        const rawPercent = rmsLevelToDisplayPercentage(rmsLevel);
        const dtMs =
          lastMeterTimestampRef.current > 0 ? timestamp - lastMeterTimestampRef.current : 0;
        lastMeterTimestampRef.current = timestamp;
        const releaseAmount = PEAK_HOLD_RELEASE_RATE_PER_MS * dtMs;
        const smoothed = applyPeakHold(rawPercent, previousVolumeLevelRef.current, releaseAmount);
        previousVolumeLevelRef.current = smoothed;
        setVolumeLevel(smoothed);
        // D4: label debounce — accumulate sub-threshold duration; fire label only when sustained.
        lowDurationRef.current = accumulateLowDurationMs(
          lowDurationRef.current,
          smoothed,
          LOW_VOLUME_DISPLAY_THRESHOLD,
          dtMs,
        );
        setIsLowVolume(lowDurationRef.current >= SUSTAINED_LOW_MS);
        animationFrameRef.current = requestAnimationFrame(updateVolumeMeter);
      };
      animationFrameRef.current = requestAnimationFrame(updateVolumeMeter);

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      const currentPrompt = diagnosticSession?.promptSet.prompts[currentPromptIndex];
      if (!currentPrompt) return;

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        cleanupAudioContext();
        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void submitRecording(audioBlob, currentPrompt);
      };

      startedAtRef.current = nowMs();
      setRecSeconds(0);
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingState("recording");

      recTimerRef.current = setInterval(() => {
        setRecSeconds((seconds) => seconds + 1);
      }, 1000);
    } catch {
      cleanupAudioContext();
      setRecordError("マイクへのアクセスに失敗しました。ブラウザの権限を確認してください。");
    }
  }, [diagnosticSession, currentPromptIndex, submitRecording, cleanupAudioContext]);

  const stopRecording = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setRecordingState("idle");
  }, []);

  const advanceToNextPrompt = useCallback(() => {
    if (!diagnosticSession) return;
    const totalPrompts = diagnosticSession.promptSet.prompts.length;
    if (currentPromptIndex + 1 < totalPrompts) {
      setCurrentPromptIndex((index) => index + 1);
      setRecordingState("idle");
    }
  }, [diagnosticSession, currentPromptIndex]);

  const completeDiagnosticSession = useCallback(async () => {
    if (promptResults.length === 0) return;
    setCompleting(true);
    setRecordError(null);

    try {
      await apiPost(`/api/v1/diagnostic-sessions/${diagnosticSessionIdentifier}/completion`, {
        assessmentResultIdentifiers: promptResults.map(
          (result) => result.assessmentResultIdentifier,
        ),
      });
      router.push(`/diagnostic/${diagnosticSessionIdentifier}/result`);
    } catch (error: unknown) {
      setCompleting(false);
      setRecordError(isApiClientError(error) ? error.message : "診断の完了処理に失敗しました");
    }
  }, [diagnosticSessionIdentifier, promptResults, router]);

  // セッション情報がない場合のロード中表示
  if (loadError && !diagnosticSession) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          color: "var(--sev-critical-text)",
        }}
      >
        <p>{loadError}</p>
        <Link href="/" className="btn btn--primary" style={{ marginTop: "16px" }}>
          ライブラリへ
        </Link>
      </div>
    );
  }

  if (!diagnosticSession) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-tertiary)" }}>
        読み込み中...
      </div>
    );
  }

  const prompts = diagnosticSession.promptSet.prompts;
  const totalPrompts = prompts.length;
  const currentPrompt = prompts[currentPromptIndex];
  const progressPercent = Math.round((currentPromptIndex / totalPrompts) * 100);
  const isLastPrompt = currentPromptIndex === totalPrompts - 1;
  const currentPromptDone = promptResults.some(
    (result) => result.promptIdentifier === currentPrompt?.identifier,
  );
  const allPromptsCompleted = promptResults.length === totalPrompts;

  const formattedRecTime = `${Math.floor(recSeconds / 60)}:${String(recSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="ws" data-state={recordingState}>
      {/* app-top */}
      <div className="app-top">
        <div className="app-brand">
          NativeTrace <span className="ipa">/ˈneɪtɪv treɪs/</span>
        </div>
        <div className="crumb" style={{ marginLeft: "16px" }}>
          <b>診断テスト</b>
          <span className="sep">·</span>
          <span className="mono" style={{ fontSize: "var(--text-xs)" }}>
            所要 約3分
          </span>
        </div>
        <div className="dg-prog" style={{ marginLeft: "auto" }}>
          <span>
            {currentPromptIndex + 1} / {totalPrompts}
          </span>
          <span className="bar">
            <i style={{ width: `${progressPercent}%` }} />
          </span>
          <span>{formattedRecTime}</span>
        </div>
      </div>

      {recordError && (
        <div
          style={{
            padding: "8px 24px",
            background: "var(--sev-critical-soft)",
            color: "var(--sev-critical-text)",
            fontSize: "var(--text-xs)",
          }}
        >
          {recordError}
        </div>
      )}

      {/* 診断中レイアウト */}
      {!allPromptsCompleted ? (
        <div className="dg">
          {/* 左: メイン課題エリア */}
          <div className="dg-main">
            {currentPrompt && (
              <>
                <div>
                  <div className="kbd-label" style={{ marginBottom: "14px" }}>
                    声に出して読んでください
                  </div>
                  <p
                    className="passage"
                    style={{ fontSize: "var(--text-2xl)", maxWidth: "40ch", margin: 0 }}
                  >
                    {currentPrompt.text}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      justifyContent: "center",
                      marginTop: "16px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="phen">
                      <span className="pi">{PHENOMENON_ICONS[currentPrompt.phenomenon]}</span>
                      {PHENOMENON_LABELS[currentPrompt.phenomenon]}
                    </span>
                    {currentPrompt.targetCatalogId && (
                      <span className="phen">
                        <span className="pi">◎</span>
                        {currentPrompt.targetCatalogId}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
                  {recordingState === "idle" && !currentPromptDone && (
                    <>
                      <button
                        className="rec-btn"
                        aria-label="録音"
                        style={{ width: "62px", height: "62px" }}
                        onClick={() => void startRecording()}
                        type="button"
                      >
                        <span className="rec-dot" style={{ width: "22px", height: "22px" }} />
                      </button>
                      <span className="note" style={{ margin: 0 }}>
                        タップして録音開始
                      </span>
                    </>
                  )}

                  {recordingState === "recording" && (
                    <>
                      <button
                        type="button"
                        aria-label="停止して解析"
                        onClick={stopRecording}
                        style={{
                          width: "62px",
                          height: "62px",
                          borderRadius: "50%",
                          background: "var(--sev-critical-soft)",
                          border: "2px solid var(--sev-critical)",
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: "20px",
                            height: "20px",
                            background: "var(--sev-critical)",
                            borderRadius: "3px",
                          }}
                        />
                      </button>
                      <span
                        className="status status--running"
                        style={{ border: "none", background: "none" }}
                      >
                        <span className="sd" />
                        REC {formattedRecTime}
                      </span>
                      <div
                        style={{
                          width: "80px",
                          height: "6px",
                          background: "var(--surface-3)",
                          borderRadius: "var(--r-full)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${volumeLevel}%`,
                            background: isLowVolume ? "var(--sev-minor)" : "var(--positive)",
                            transition: "width 0.05s",
                          }}
                        />
                      </div>
                    </>
                  )}

                  {recordingState === "analyzing" && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <span
                        className="status status--running"
                        style={{ border: "none", background: "none" }}
                      >
                        <span className="sd" />
                        解析中...
                      </span>
                    </div>
                  )}

                  {recordingState === "done" && currentPromptDone && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <span
                        className="status status--ok"
                        style={{ border: "none", background: "none" }}
                      >
                        <span className="sd" />
                        解析完了
                      </span>
                      {!isLastPrompt ? (
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={advanceToNextPrompt}
                        >
                          次の文へ →
                        </button>
                      ) : (
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={() => void completeDiagnosticSession()}
                          disabled={completing}
                        >
                          {completing ? "処理中..." : "診断を完了する →"}
                        </button>
                      )}
                    </div>
                  )}

                  {recordingState === "failed" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span className="status status--fail">
                        <span className="sd" />
                        失敗
                      </span>
                      <button
                        className="btn btn--sm btn--primary"
                        type="button"
                        onClick={() => setRecordingState("idle")}
                      >
                        やり直す
                      </button>
                    </div>
                  )}
                </div>

                <p className="note" style={{ margin: 0, fontSize: "var(--text-2xs)" }}>
                  音声はお手本を先に聞かずに読みます —
                  カタカナ読みの混入をそのまま観測するため（E-11）。
                </p>
              </>
            )}
          </div>

          {/* 右: カバレッジレール */}
          <aside className="dg-rail">
            <div className="rail-block">
              <div className="rail-h">カバレッジ — カタログ網羅</div>
              <div className="cov">
                {prompts.map((prompt, index) => {
                  const isDone = promptResults.some(
                    (result) => result.promptIdentifier === prompt.identifier,
                  );
                  const isNow = index === currentPromptIndex;
                  const rowClass = [
                    "cov-row",
                    isDone ? "is-done" : "",
                    isNow && !isDone ? "is-now" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div key={prompt.identifier} className={rowClass}>
                      <span className="ck">{isDone ? "✓" : isNow ? "▶" : ""}</span>
                      <span>{PHENOMENON_LABELS[prompt.phenomenon]}</span>
                      <span className="mono">文{index + 1}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rail-block">
              <div className="rail-h">この診断が作るもの</div>
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-jp)",
                  fontSize: "var(--text-2xs)",
                  color: "var(--text-tertiary)",
                  lineHeight: 1.7,
                }}
              >
                focus sounds の初期リスト・Stage
                判定（明瞭性/ネイティブ性）・推奨訓練の組合せ。以後は日常の解析で漸進更新されます。
              </p>
            </div>
          </aside>
        </div>
      ) : (
        /* 全プロンプト完了後の完了待ちビュー */
        <div
          style={{
            padding: "var(--sp-8)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--sp-5)",
            textAlign: "center",
          }}
        >
          <div className="kbd-label">全プロンプトの録音が完了しました</div>
          <p className="note" style={{ margin: 0 }}>
            {promptResults.length} / {totalPrompts} プロンプトを解析しました
          </p>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void completeDiagnosticSession()}
            disabled={completing}
          >
            {completing ? "処理中..." : "弱点プロファイルを生成する →"}
          </button>
          <Link href="/" className="btn btn--ghost btn--sm">
            ライブラリに戻る
          </Link>
        </div>
      )}
    </div>
  );
}
