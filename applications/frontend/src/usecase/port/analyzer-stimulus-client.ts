import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

/**
 * StimulusRecord — analyzer /v1/stimuli の 1 刺激レスポンス (ADR-009)
 *
 * analyzer の StimulusResponse 形状に対応。
 * frontend は domain を import しないため独立型定義。
 */
export type StimulusRecord = Readonly<{
  stimulusIdentifier: string;
  contrast: string;
  word: string;
  speakerIdentifier: string;
  speakerSex: string;
  context: string;
  sourceCorpus: string;
  licenseIdentifier: string;
  wavBase64: string;
}>;

/**
 * AnalyzerStimulusClient — analyzer GET /v1/stimuli を呼ぶ ACL Port
 *
 * 設計の正: adr/009-hvpt-stimulus-hybrid-natural-tts.md
 *           docs/specs/training-screen.md (M-TR-5/6)
 *
 * 刺激は analyzer が carve-out / Kokoro 補完で管理する。
 * frontend は Port 経由でのみ呼び、実取得実装を infrastructure に閉じ込める。
 */
export type AnalyzerStimulusClient = Readonly<{
  /**
   * fetchStimuli — 対立・文脈でフィルタした刺激セットを取得する。
   * analyzer が刺激を持たない場合は空配列を返す (不在は validationFailed ではなく notFound)。
   *
   * @param contrast   音素対立 (例: "r-l", "ae-ah")
   * @param context    音韻文脈フィルタ (省略可)
   * @param limit      最大件数 (省略時 20、最大 50)
   */
  fetchStimuli: (
    contrast: string,
    context?: string,
    limit?: number,
  ) => ResultAsync<ReadonlyArray<StimulusRecord>, DomainError>;
}>;
