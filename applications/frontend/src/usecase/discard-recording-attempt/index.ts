import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import {
  createRecordingAttemptIdentifier,
  deleteRecordingAttempt,
  type RecordingAttemptDeleted,
} from "../../domain/recording-attempt";
import {
  requestAudioFileDeletion,
  type AudioFileDeletionRequested,
  type AudioFileDeleted,
} from "../../domain/audio-file";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AudioFileRepository } from "../port/audio-file-repository";
import { type AudioStorage } from "../port/audio-storage";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { parseInput } from "../shared/validation";

// ---- Input ----

const discardRecordingAttemptSchema = z.object({
  recordingAttempt: z.string().min(1, "録音試行IDは空にできません"),
});

export type DiscardRecordingAttemptInput = z.infer<typeof discardRecordingAttemptSchema>;

// ---- Output ----

export type DiscardRecordingAttemptOutput = Readonly<{
  recordingAttempt: Readonly<{
    identifier: string;
    state: "deleted";
  }>;
  audioPhysicallyDeleted: boolean;
  events: NonEmptyList<RecordingAttemptDeleted | AudioFileDeletionRequested | AudioFileDeleted>;
}>;

// ---- Dependencies ----

export type DiscardRecordingAttemptDependencies = Readonly<{
  recordingAttemptRepository: RecordingAttemptRepository;
  audioFileRepository: AudioFileRepository;
  audioStorage: AudioStorage;
  analysisRunRepository: AnalysisRunRepository;
  assessmentResultRepository: AssessmentResultRepository;
  transactionManager: TransactionManager;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

export const createDiscardRecordingAttempt =
  (dependencies: DiscardRecordingAttemptDependencies) =>
  (
    input: DiscardRecordingAttemptInput,
  ): ResultAsync<DiscardRecordingAttemptOutput, DomainError> => {
    const parsedInput = parseInput(discardRecordingAttemptSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const recordingAttemptIdentifier = createRecordingAttemptIdentifier(parsed.recordingAttempt);
    if (!recordingAttemptIdentifier) {
      return errAsync(validationFailed("recordingAttempt", "不正な録音試行IDです"));
    }

    const now = dependencies.clock.now();

    // Ready な RecordingAttempt を取得（find は ReadyRecordingAttempt のみ返す）
    return dependencies.recordingAttemptRepository
      .find(recordingAttemptIdentifier)
      .andThen((readyAttempt) =>
        // AudioFile を取得（StoredAudioFile のみ返す）
        dependencies.audioFileRepository
          .findByRecordingAttempt(readyAttempt.identifier)
          .andThen((audioFile) => {
            // requestAudioFileDeletion は StoredAudioFile を受け取る
            const { audioFile: pendingAudioFile, events: deletionRequestedEvents } =
              requestAudioFileDeletion(audioFile, now);

            const { recordingAttempt: deletedAttempt, events: deletedAttemptEvents } =
              deleteRecordingAttempt(readyAttempt, now);

            // DB 論理削除をコミット
            return dependencies.transactionManager
              .execute(() =>
                dependencies.recordingAttemptRepository
                  .persist(deletedAttempt)
                  .andThen(() => dependencies.audioFileRepository.persist(pendingAudioFile))
                  .map(() => undefined),
              )
              .andThen(() =>
                // 物理削除
                dependencies.audioStorage
                  .delete(pendingAudioFile.storageKey)
                  .andThen(() => {
                    const deletedAudioFile = {
                      type: "deleted" as const,
                      identifier: pendingAudioFile.identifier,
                      recordingAttempt: pendingAudioFile.recordingAttempt,
                      deletedAt: now,
                    };
                    return dependencies.audioFileRepository.persist(deletedAudioFile).map(() => {
                      dependencies.logger.info("discardRecordingAttempt: completed", {
                        recordingAttemptIdentifier: readyAttempt.identifier as string,
                      });

                      const allEvents = [
                        ...deletedAttemptEvents,
                        ...deletionRequestedEvents,
                        {
                          type: "audioFileDeleted" as const,
                          audioFile: deletedAudioFile,
                          occurredAt: now,
                        },
                      ] as NonEmptyList<
                        RecordingAttemptDeleted | AudioFileDeletionRequested | AudioFileDeleted
                      >;

                      return {
                        recordingAttempt: {
                          identifier: deletedAttempt.identifier as string,
                          state: "deleted" as const,
                        },
                        audioPhysicallyDeleted: true,
                        events: allEvents,
                      } satisfies DiscardRecordingAttemptOutput;
                    });
                  })
                  .orElse((deleteError) => {
                    // 物理削除失敗 → AudioFile を delete_failed に更新して冪等再試行可能にする
                    dependencies.logger.error(
                      "discardRecordingAttempt: physical delete failed",
                      deleteError,
                    );
                    const deleteFailedAudioFile = {
                      type: "deleteFailed" as const,
                      identifier: pendingAudioFile.identifier,
                      recordingAttempt: pendingAudioFile.recordingAttempt,
                      storageKey: pendingAudioFile.storageKey,
                      failedAt: now,
                      failureReason:
                        "reason" in deleteError ? String(deleteError.reason) : "unknown",
                    };
                    return dependencies.audioFileRepository
                      .persist(deleteFailedAudioFile)
                      .andThen(() => errAsync(deleteError));
                  }),
              );
          }),
      );
  };
