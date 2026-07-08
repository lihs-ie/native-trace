import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import { type AssessmentResultIdentifier } from "../../domain/assessment-result";

/**
 * 却下の記録に必要な入力
 */
export type RecordDismissalInput = Readonly<{
  identifier: string;
  assessmentResult: AssessmentResultIdentifier;
  findingIdentifier: string;
  dismissedAt: number;
  reason: string | null;
}>;

/**
 * FindingDismissalRepository — finding 却下の永続化ポート
 *
 * - record: 却下を記録する（既存の active 却下があれば上書きしない — 重複は呼び出し側で防ぐ）
 * - restore: 取消（undone_at を現在時刻で埋める）
 * - findActiveDismissedIdentifiers: 指定 assessmentResult に対して undone_at が NULL の
 *   finding_identifier 集合を返す（ORPHAN-3 解消用）
 */
export type FindingDismissalRepository = Readonly<{
  record: (input: RecordDismissalInput) => ResultAsync<void, DomainError>;
  restore: (
    assessmentResult: AssessmentResultIdentifier,
    findingIdentifier: string,
    undoneAt: number,
  ) => ResultAsync<void, DomainError>;
  findActiveDismissedIdentifiers: (
    assessmentResult: AssessmentResultIdentifier,
  ) => ResultAsync<ReadonlySet<string>, DomainError>;
  findActiveDismissedIdentifiersByResults: (
    assessmentResults: ReadonlyArray<AssessmentResultIdentifier>,
  ) => ResultAsync<ReadonlyMap<string, ReadonlySet<string>>, DomainError>;
}>;
