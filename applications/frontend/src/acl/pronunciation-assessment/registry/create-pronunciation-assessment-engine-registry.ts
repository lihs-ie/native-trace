/**
 * PronunciationAssessmentEngineRegistry の ACL 実装。
 * acl.md §3.2 に準拠。
 * AnalysisEngine から対応する Adaptor を解決する。未登録は DomainError を返す（null を返さない）。
 */

import { ok, err } from "neverthrow";
import { type Result } from "neverthrow";
import { type AnalysisEngine } from "../../../domain/analysis-engine";
import { type DomainError } from "../../../domain/shared";
import { type PronunciationAssessmentEngine } from "../../../usecase/port/pronunciation-assessment-engine";
import { type PronunciationAssessmentEngineRegistry } from "../../../usecase/port/pronunciation-assessment-engine-registry";

export type PronunciationAssessmentEngineRegistryDependencies = Readonly<{
  /**
   * cloud engine 用 Adaptor。
   * 未設定の場合は find 時に設定不足エラーを返す（比較モードで片方が未設定の場合に対応）。
   */
  cloudEngine: PronunciationAssessmentEngine | null;
  /**
   * oss_worker engine 用 Adaptor。
   * 未設定の場合は find 時に設定不足エラーを返す（比較モードで片方が未設定の場合に対応）。
   */
  ossWorkerEngine: PronunciationAssessmentEngine | null;
}>;

/**
 * PronunciationAssessmentEngineRegistry ファクトリ。
 * acl.md §3.2: 未登録は null を返さず DomainError を返す。
 * 比較モードで片方が未設定の場合、そのエンジンの job だけ failed にできる。
 */
export const createPronunciationAssessmentEngineRegistry = (
  dependencies: PronunciationAssessmentEngineRegistryDependencies,
): PronunciationAssessmentEngineRegistry => ({
  find: (engine: AnalysisEngine): Result<PronunciationAssessmentEngine, DomainError> => {
    if (engine.type === "cloud") {
      if (!dependencies.cloudEngine) {
        return err({
          type: "notFound",
          resource: "pronunciationAssessmentEngine",
          identifier: "cloud",
        } satisfies DomainError);
      }
      return ok(dependencies.cloudEngine);
    }

    if (engine.type === "oss_worker") {
      if (!dependencies.ossWorkerEngine) {
        return err({
          type: "notFound",
          resource: "pronunciationAssessmentEngine",
          identifier: "oss_worker",
        } satisfies DomainError);
      }
      return ok(dependencies.ossWorkerEngine);
    }

    // TypeScript の網羅性チェック
    const _exhaustive: never = engine;
    return err({
      type: "notFound",
      resource: "pronunciationAssessmentEngine",
      identifier: String((_exhaustive as AnalysisEngine).type),
    } satisfies DomainError);
  },
});
