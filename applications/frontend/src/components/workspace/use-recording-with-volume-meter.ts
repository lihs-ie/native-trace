"use client";

/**
 * use-recording-with-volume-meter.ts — 録音 + リアルタイム音量メーターの共通 hook (W35)。
 *
 * sections/[sectionIdentifier] と diagnostic/[diagnosticSessionIdentifier] の
 * 2 ページにほぼ同一コピーされていた getUserMedia 制約・AnalyserNode セットアップ・
 * peak-hold ループ・録音タイマー・cleanup 順序を一本化する。
 * getUserMedia 制約（autoGainControl 等）・rAF ループの数式・cleanup 順序は
 * 元実装から文字単位で変更していない。
 *
 * 送信コールバック（onStop）は各ページに残す（診断ページは currentPrompt を
 * 束ねて 2 引数の submitRecording を呼ぶ、sections ページは 1 引数など、
 * ページごとに構造が異なるため）。onStart / onError も同様にオプションの
 * コールバックとして呼び出し元に委譲する。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  accumulateLowDurationMs,
  applyPeakHold,
  computeRmsLevel,
  LOW_VOLUME_DISPLAY_THRESHOLD,
  PEAK_HOLD_RELEASE_RATE_PER_MS,
  rmsLevelToDisplayPercentage,
  SUSTAINED_LOW_MS,
} from "@/components/workspace/volume-meter";
import { nowMs } from "@/lib/now";

/** マイクアクセス失敗時のエラーメッセージ（2 ページで文字列を共有）。 */
export const MIC_ACCESS_ERROR_MESSAGE =
  "マイクへのアクセスに失敗しました。ブラウザの権限を確認してください。";

type UseRecordingWithVolumeMeterOptions = {
  /** 録音停止（recorder.onstop）時に呼ばれる。引数は録音済み Blob。 */
  onStop: (blob: Blob) => void;
  /** getUserMedia 失敗時に呼ばれる（MIC_ACCESS_ERROR_MESSAGE を渡す）。 */
  onError?: (message: string) => void;
  /**
   * recorder.start() 直後（録音開始確定時）に呼ばれる。
   * 引数は録音開始時刻（ms epoch、`nowMs()` 由来）— 呼び出し元の
   * submitRecording が durationMs 算出に使う値を、ref をまたがず直接渡す。
   */
  onStart?: (startedAt: number) => void;
};

type UseRecordingWithVolumeMeterResult = {
  isRecording: boolean;
  recSeconds: number;
  volumeLevel: number;
  isLowVolume: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
};

export function useRecordingWithVolumeMeter({
  onStop,
  onError,
  onStart,
}: UseRecordingWithVolumeMeterOptions): UseRecordingWithVolumeMeterResult {
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  // D4: debounced label state — true only after SUSTAINED_LOW_MS of continuous sub-threshold level
  const [isLowVolume, setIsLowVolume] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousVolumeLevelRef = useRef<number>(0);
  const lastMeterTimestampRef = useRef<number>(0);
  // D4: accumulated sub-threshold duration for label debounce
  const lowDurationRef = useRef<number>(0);

  // オプションは常に最新を参照する（呼び出し元に useCallback でのメモ化を強制しない）。
  // ref への書き込みは render 中に行えない（react-hooks/refs）ため effect 内で同期する。
  const onStopRef = useRef(onStop);
  const onErrorRef = useRef(onError);
  const onStartRef = useRef(onStart);
  useEffect(() => {
    onStopRef.current = onStop;
    onErrorRef.current = onError;
    onStartRef.current = onStart;
  });

  // AudioContext のアンマウント時 cleanup
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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
        },
      });

      // Set up AudioContext for real-time volume metering
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
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        cleanupAudioContext();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        onStopRef.current(blob);
      };
      const startedAt = nowMs();
      setRecSeconds(0);
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      onStartRef.current?.(startedAt);

      recTimerRef.current = setInterval(() => {
        setRecSeconds((s) => s + 1);
      }, 1000);
    } catch {
      cleanupAudioContext();
      onErrorRef.current?.(MIC_ACCESS_ERROR_MESSAGE);
    }
  }, [cleanupAudioContext]);

  const stopRecording = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    // AudioContext cleanup happens in recorder.onstop after stream tracks are stopped
  }, []);

  return {
    isRecording,
    recSeconds,
    volumeLevel,
    isLowVolume,
    startRecording,
    stopRecording,
  };
}
