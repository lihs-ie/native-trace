/**
 * ImprovementMessageGenerator port。
 * UseCase 層が messageJa と feedbackLayers を生成するための依存インターフェース。
 * 実装は ACL 層に置く。クラス構文禁止。
 */

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
}>;

export type FeedbackLayersOutput = Readonly<{
  whatJa: string;
  whyJa: string;
  howJa: string;
}>;

export type ImprovementMessageGenerator = Readonly<{
  generate: (input: ImprovementMessageGeneratorInput) => string;
  generateFeedbackLayers: (input: ImprovementMessageGeneratorInput) => FeedbackLayersOutput;
}>;
