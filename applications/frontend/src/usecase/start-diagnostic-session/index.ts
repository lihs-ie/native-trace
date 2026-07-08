/**
 * StartDiagnosticSession UseCase
 *
 * 設計の正: docs/specs/diagnostic-screen.md (M-DG-1/2)
 *          docs/03-detailed-design/domain.md §14 (DD-200)
 *          adr/007-training-context-bounded-context.md
 *          adr/010-diagnostic-weakness-profile-focus-derivation.md
 *
 * 診断専用 prompt set fixture で DiagnosticSession(pending) を生成・永続化する。
 * 学習者識別子は config 由来の sentinel 値を使用する (OQ-1 解決)。
 */

import { type ResultAsync, errAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  type DiagnosticSession,
  createDiagnosticSessionIdentifier,
  createLearnerIdentifier,
} from "../../domain/training";
import { generateIdentifier } from "../shared/identifier";
import { type DiagnosticSessionRepository } from "../port/diagnostic-session-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Input ----

export type StartDiagnosticSessionInput = Readonly<{
  /** OQ-1: sentinel ULID 文字列。config.diagnosticSentinelLearnerIdentifier を渡す。 */
  learnerIdentifier: string;
  /** 診断専用 prompt set。infrastructure/training/diagnostic-prompt-fixture から取得する。 */
  promptSet: import("../../domain/training").DiagnosticPromptSet;
}>;

// ---- Output ----

export type StartDiagnosticSessionOutput = Readonly<{
  diagnosticSession: DiagnosticSession;
}>;

// ---- Dependencies ----

export type StartDiagnosticSessionDependencies = Readonly<{
  diagnosticSessionRepository: DiagnosticSessionRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

/**
 * startDiagnosticSession — 診断セッションを開始し DiagnosticSession(pending) を生成・永続化する。
 */
export const createStartDiagnosticSession =
  (dependencies: StartDiagnosticSessionDependencies) =>
  (input: StartDiagnosticSessionInput): ResultAsync<StartDiagnosticSessionOutput, DomainError> => {
    const learner = createLearnerIdentifier(input.learnerIdentifier);
    if (!learner) {
      return errAsync(validationFailed("learnerIdentifier", "不正な学習者識別子です"));
    }

    const sessionIdentifierResult = generateIdentifier(
      dependencies.entropyProvider,
      createDiagnosticSessionIdentifier,
      "sessionIdentifier",
    );
    if (sessionIdentifierResult.isErr()) {
      return errAsync(sessionIdentifierResult.error);
    }
    const sessionIdentifier = sessionIdentifierResult.value;

    const now = dependencies.clock.now();

    const diagnosticSession: DiagnosticSession = {
      type: "pending",
      identifier: sessionIdentifier,
      learner,
      promptSet: input.promptSet,
      startedAt: now,
    };

    return dependencies.diagnosticSessionRepository
      .persist(diagnosticSession)
      .map(() => ({ diagnosticSession }));
  };
