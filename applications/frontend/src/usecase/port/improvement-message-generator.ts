/**
 * ImprovementMessageGenerator port。
 * UseCase 層が messageJa と feedbackLayers を生成するための依存インターフェース。
 * 実装は ACL 層に置く。クラス構文禁止。
 */

import { type AcousticEvidenceDto } from "../../lib/api-types";

export type ImprovementMessageGeneratorInput = Readonly<{
  phenomenon: string;
  expected: Readonly<{ text: string | null; ipa: string | null }>;
  detected: Readonly<{ text: string | null; ipa: string | null }>;
  /** 単語内位置ラベル (例: "initial"/"medial"/"final")。不明の場合 null */
  wordPositionLabel?: string | null;
  /** カタログID。oss-worker が付与した場合に使う */
  catalogId?: string | null;
  /** connected speech 対象語ペア */
  wordPair?: Readonly<{ first: string; second: string }> | null;
  /** connected speech 期待発音 IPA */
  expectedPronunciation?: string | null;
  /** epenthesis 挿入母音 */
  insertedVowel?: string | null;
  /** D4 (ADR-017): epenthesis挿入母音の時刻位置（ミリ秒）。位置メッセージ構築に使う。*/
  insertionPositionMs?: number | null;
  /** D1 (ADR-020): worker が出す BARE IPA 記号（例: "ɾ"。"[ɾ]" ではない）。How 層分岐に使う。*/
  detectedTopCandidate?: string | null;
  /** D1 (ADR-020): worker の上位 N 件音素候補（nBest）。現在は決定論 How では使用しない（ADR-020 Non-goal C）。*/
  nBest?: ReadonlyArray<{ phoneme: string; confidence: number }> | null;
  /** D2 (ADR-021): worker が付与した GOP スコア。LLM grounding 用。 */
  gop?: number | null;
  /** D2 (ADR-021): worker が付与した機能負荷ラベル（例: "high"/"medium"/"low"）。LLM grounding 用。 */
  functionalLoad?: string | null;
  /** M-APD-14 (ADR-018): 音響音声学的証拠。方向ラベル → howJa articulatory テキスト生成に使う。*/
  acousticEvidence?: AcousticEvidenceDto | null;
}>;

export type FeedbackLayersOutput = Readonly<{
  whatJa: string;
  whyJa: string;
  howJa: string;
}>;

export type ImprovementMessageGenerator = Readonly<{
  generate: (input: ImprovementMessageGeneratorInput) => string;
  generateFeedbackLayers: (input: ImprovementMessageGeneratorInput) => FeedbackLayersOutput;
  /**
   * D2 (ADR-021): LLM プロバイダが実装する非同期生成メソッド。rule-based は未実装（undefined）。
   *
   * ADR-023 D3 byReason seam: 第 2 引数 onFallback は optional。
   * fallback が発生した場合に reason 文字列で呼ばれる。
   * reason は "timeout" | "invoker_error" | "parse_failed" | "grounding_rejected" | "cache_error" のいずれか。
   * 成功（LLM 正常返却 / cache hit）では onFallback は呼ばれない。
   * 既存の単引数呼び出しは後方互換（2nd param optional のため型チェック通過）。
   */
  generateFeedbackLayersAsync?: (
    input: ImprovementMessageGeneratorInput,
    onFallback?: (reason: string) => void,
  ) => Promise<FeedbackLayersOutput>;
}>;
