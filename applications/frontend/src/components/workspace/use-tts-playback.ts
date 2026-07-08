"use client";

/**
 * use-tts-playback.ts — TTS (POST /api/v1/tts) 再生の共通 hook (W34)。
 *
 * ArticulationCard / DetailPanelV2 / WorkspaceResultV2 / training page に
 * 発散していた fetch→objectURL→HTMLAudioElement 再生ルーチンを一本化し、
 * これまで revoke されていなかった `URL.createObjectURL` の後始末を
 * `ended`（要素内バッファから再再生できるため revoke 可）と unmount で保証する。
 *
 * - `fetchTtsResponse`: /api/v1/tts への fetch（契約凍結: URL・メソッド・
 *   ヘッダ・body 形状を 4 実装当時のまま変えない）。Audio 要素を使わない
 *   training シャドーイング（ArrayBuffer→AudioContext）もこれを共有する。
 * - `togglePlay` / `stop` / `isPlaying`: お手本ボタンの toggle 再生パターン
 *   （ArticulationCard / DetailPanelV2）。取得済み audio は ref で保持し、
 *   speed 変更 (`stop`) まで再生成しない。
 * - `playOnce`: ミニマルペア A/B のような「再生して ended まで待つ」使い捨て再生。
 * - `getCachedTtsAudio` / `fetchTtsAudioElement` / `manageAudioBlob`:
 *   WorkspaceResultV2 のように再生状態を自前管理する呼び出し元向けの低レベル API。
 *   `cacheAudioElements` オプションで M-AB-b の `${text}__${speed}` キャッシュ挙動を維持する
 *   （キャッシュした要素は再利用に備えて ended では revoke せず unmount で revoke する）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** /api/v1/tts へのリクエスト。契約凍結: URL・メソッド・ヘッダ・body 形状を変えない。 */
export const fetchTtsResponse = (text: string, speed: number): Promise<Response> =>
  fetch("/api/v1/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, speed }),
  });

type UseTtsPlaybackOptions = {
  /**
   * true: `${text}__${speed}` キーで HTMLAudioElement を再利用する
   * (WorkspaceResultV2 M-AB-b のキャッシュ挙動)。
   */
  cacheAudioElements?: boolean;
};

export const useTtsPlayback = ({ cacheAudioElements = false }: UseTtsPlaybackOptions = {}) => {
  /** hook が生成した objectURL の台帳 (audio 要素 → URL)。unmount で残りを全 revoke。 */
  const managedAudiosRef = useRef<Map<HTMLAudioElement, string>>(new Map());
  /** M-AB-b: `${text}__${speed}` キーの HTMLAudioElement キャッシュ（オプション時のみ使用）。 */
  const audioElementCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  /** togglePlay が保持する現在の audio。speed 変更 (`stop`) まで再生成しない。 */
  const toggleAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const releaseAudio = useCallback((audio: HTMLAudioElement) => {
    const url = managedAudiosRef.current.get(audio);
    if (url !== undefined) {
      URL.revokeObjectURL(url);
      managedAudiosRef.current.delete(audio);
    }
  }, []);

  /**
   * blob → objectURL → HTMLAudioElement。生成した URL は台帳に載せ、
   * revokeOnEnded なら ended 時に revoke（ended 後の再再生は要素内バッファから
   * 行われるため URL は不要）、そうでなくても unmount で必ず revoke する。
   */
  const manageAudioBlob = useCallback(
    (blob: Blob, { revokeOnEnded = true }: { revokeOnEnded?: boolean } = {}): HTMLAudioElement => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      managedAudiosRef.current.set(audio, url);
      if (revokeOnEnded) {
        audio.addEventListener("ended", () => releaseAudio(audio), { once: true });
      }
      return audio;
    },
    [releaseAudio],
  );

  /** キャッシュ済み audio の参照（cacheAudioElements オプション時のみヒットする）。 */
  const getCachedTtsAudio = useCallback(
    (text: string, speed: number): HTMLAudioElement | undefined =>
      audioElementCacheRef.current.get(`${text}__${String(speed)}`),
    [],
  );

  /**
   * TTS を fetch して管理下の HTMLAudioElement を返す。
   * response が !ok のときは null。ネットワーク例外は呼び出し元へ伝播する
   * （4 実装当時の try/catch 粒度を呼び出し元に残すため）。
   */
  const fetchTtsAudioElement = useCallback(
    async (text: string, speed: number): Promise<HTMLAudioElement | null> => {
      const response = await fetchTtsResponse(text, speed);
      if (!response.ok) return null;
      const blob = await response.blob();
      const audio = manageAudioBlob(blob, { revokeOnEnded: !cacheAudioElements });
      if (cacheAudioElements) {
        audioElementCacheRef.current.set(`${text}__${String(speed)}`, audio);
      }
      return audio;
    },
    [cacheAudioElements, manageAudioBlob],
  );

  /**
   * お手本ボタンの toggle 再生（ArticulationCard / DetailPanelV2 パターン）:
   * 取得済みなら pause/play を切り替え、未取得なら fetch→再生。
   * TTS 不在・ネットワークエラーはサイレントに no-op（現行挙動を維持）。
   */
  const togglePlay = useCallback(
    async (text: string, speed: number): Promise<void> => {
      if (toggleAudioRef.current) {
        if (isPlaying) {
          toggleAudioRef.current.pause();
          setIsPlaying(false);
        } else {
          void toggleAudioRef.current.play();
          setIsPlaying(true);
        }
        return;
      }

      try {
        const response = await fetchTtsResponse(text, speed);
        if (!response.ok) return;
        const blob = await response.blob();
        const audio = manageAudioBlob(blob);
        audio.addEventListener("ended", () => setIsPlaying(false));
        toggleAudioRef.current = audio;
        void audio.play();
        setIsPlaying(true);
      } catch {
        // TTS unavailable — no-op
      }
    },
    [isPlaying, manageAudioBlob],
  );

  /**
   * 使い捨て再生: fetch→再生して ended まで待つ（ミニマルペア A/B の逐次再生用）。
   * response が !ok のときは即 resolve。ネットワーク例外は呼び出し元へ伝播する。
   */
  const playOnce = useCallback(
    async (text: string, speed: number): Promise<void> => {
      const response = await fetchTtsResponse(text, speed);
      if (!response.ok) return;
      const blob = await response.blob();
      const audio = manageAudioBlob(blob);
      await new Promise<void>((resolve) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        void audio.play();
      });
    },
    [manageAudioBlob],
  );

  /** toggle 再生の停止と解放（speed 変更時）。次回 togglePlay は再 fetch する。 */
  const stop = useCallback(() => {
    if (!toggleAudioRef.current) return;
    toggleAudioRef.current.pause();
    releaseAudio(toggleAudioRef.current);
    toggleAudioRef.current = null;
    setIsPlaying(false);
  }, [releaseAudio]);

  // unmount: 再生中 TTS を停止し、未 revoke の objectURL を全て revoke する
  useEffect(() => {
    const managedAudios = managedAudiosRef.current;
    return () => {
      toggleAudioRef.current?.pause();
      toggleAudioRef.current = null;
      for (const [audio, url] of managedAudios) {
        audio.pause();
        URL.revokeObjectURL(url);
      }
      managedAudios.clear();
    };
  }, []);

  return {
    isPlaying,
    togglePlay,
    playOnce,
    stop,
    getCachedTtsAudio,
    fetchTtsAudioElement,
    manageAudioBlob,
  };
};
