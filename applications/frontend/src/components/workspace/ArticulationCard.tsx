"use client";

import { useState, useRef } from "react";
import type { ArticulationEntry } from "@/lib/articulation-data";

type ArticulationCardProps = {
  entry: ArticulationEntry;
};

type TtsSpeed = 0.5 | 0.85 | 1.0;

/**
 * 調音図解カード — design §06 `.artic` 準拠 (M-ARTIC-a)
 *
 * 構造:
 * - `.artic` (2列 220px 1fr)
 *   - `.artic-fig` (aspect 1/1・斜めストライプ) > `.sym` + `.ph` プレースホルダー
 *   - 右側: IPA見出し + `.artic-steps` (手順 li counter)
 *   - `.artic-audio` (全幅・お手本TTS再生ボタン)
 *
 * TTS実配線: POST /api/v1/tts → HTMLAudioElement (M-ARTIC-d)
 */
export const ArticulationCard = ({ entry }: ArticulationCardProps) => {
  const [ttsSpeed, setTtsSpeed] = useState<TtsSpeed>(0.85);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayTts = async (text: string) => {
    if (audioRef.current) {
      if (ttsPlaying) {
        audioRef.current.pause();
        setTtsPlaying(false);
      } else {
        void audioRef.current.play();
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
      audioRef.current = audio;
      void audio.play();
      setTtsPlaying(true);
    } catch {
      // TTS unavailable — no-op
    }
  };

  const handleSpeedChange = (speed: TtsSpeed) => {
    setTtsSpeed(speed);
    // キャッシュ破棄: 速度変更時は次回 fetch で再取得
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setTtsPlaying(false);
    }
  };

  return (
    <div className="artic">
      {/* 調音図解プレースホルダー — design §06 仕様合致 */}
      <div className="artic-fig">
        <span className="sym">{entry.ipaDisplay}</span>
        <span className="ph">
          sagittal-diagram
          <br />
          placeholder
          <br />
          320×320 · SVG
        </span>
      </div>

      {/* 右カラム: 見出し + 調音手順 */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "10px",
            marginBottom: "12px",
          }}
        >
          <span className="mono" style={{ fontSize: "var(--text-xl)" }}>
            {entry.ipaDisplay}
          </span>
          <b style={{ fontSize: "var(--text-sm)" }}>
            {entry.nameJa}
          </b>
          <span
            className="kbd-label"
            style={{ marginLeft: "auto" }}
          >
            {entry.nameEn}
          </span>
        </div>

        <ol className="artic-steps">
          {entry.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>

      {/* 調音音声エリア — design §06 `.artic-audio` 全幅 */}
      <div className="artic-audio">
        <button
          className="btn btn--sm btn--secondary"
          type="button"
          onClick={() => void handlePlayTts(entry.exampleWord)}
        >
          {ttsPlaying ? "❚❚" : "▸"} お手本 {entry.ipaDisplay} 単音{" "}
          <span className="mono" style={{ opacity: 0.6 }}>
            {entry.exampleWord}
          </span>
        </button>

        {/* 速度切替 */}
        <div className="speed" style={{ display: "inline-flex", gap: "4px" }}>
          {([0.5, 0.85, 1.0] as TtsSpeed[]).map((speed) => (
            <button
              key={speed}
              className={`sp-chip${ttsSpeed === speed ? " is-active" : ""}`}
              type="button"
              onClick={() => handleSpeedChange(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* 自分で試す録音ボタン — S-ARTIC-REC: UI のみ配置、実配線は別スライス */}
        <button
          className="rec-btn"
          type="button"
          disabled
          aria-label="自分で試す（準備中）"
          style={{ width: "38px", height: "38px" }}
          title="自分で試す録音（準備中）"
        >
          <span className="rec-dot" style={{ width: "14px", height: "14px" }} />
        </button>

        <span className="note" style={{ margin: 0, fontSize: "var(--text-2xs)" }}>
          図解は音響と併置 — 聞いて・見て・出す
        </span>
      </div>
    </div>
  );
};
