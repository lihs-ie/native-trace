import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import { createSectionIdentifier } from "../../domain/section";
import {
  createRecordingAttemptIdentifier,
  createRecordingDuration,
  startRecordingAttempt,
  markRecordingAttemptReady,
  createOriginalFileName,
  type RecordingOrigin,
} from "../../domain/recording-attempt";
import {
  createAudioFileIdentifier,
  createAudioMimeType,
  type StoredAudioFile,
} from "../../domain/audio-file";
import {
  createAnalysisRunIdentifier,
  createAnalysisRun,
  type AnalysisMode,
  type AnalysisRunStarted,
} from "../../domain/analysis-run";
import {
  createAnalysisJobIdentifier,
  createAnalysisJob,
  type AnalysisJobQueued,
  type EngineType,
} from "../../domain/analysis-job";
import { type SectionRepository } from "../port/section-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AudioFileRepository } from "../port/audio-file-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type AudioStorage } from "../port/audio-storage";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { parseInput } from "../shared/validation";

// ---- Constants ----

const MAX_AUDIO_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const SUPPORTED_MIME_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
] as const;

// ---- Input ----

const browserInfoInputSchema = z.object({
  browserName: z.string().min(1),
  deviceType: z.enum(["pc", "mobile"]),
  recordingApiType: z.string().min(1),
  userAgent: z.string().min(1),
});

const audioSourceInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("browser_recording"),
    data: z.instanceof(Buffer),
    mimeType: z.enum(SUPPORTED_MIME_TYPES),
    durationMilliseconds: z.number().int().positive(),
    startedAt: z.date(),
    endedAt: z.date(),
    browserInfo: browserInfoInputSchema,
  }),
  z.object({
    type: z.literal("uploaded_file"),
    data: z.instanceof(Buffer),
    mimeType: z.enum(SUPPORTED_MIME_TYPES),
    durationMilliseconds: z.number().int().positive(),
    originalFileName: z.string().min(1),
  }),
]);

const submitPracticeAttemptSchema = z.object({
  section: z.string().min(1, "セクションIDは空にできません"),
  audioSource: audioSourceInputSchema,
  analysisMode: z.enum(["cloud_only", "oss_worker_only", "comparison"]),
});

export type SubmitPracticeAttemptInput = z.infer<typeof submitPracticeAttemptSchema>;

// ---- Output ----

export type SubmitPracticeAttemptOutput = Readonly<{
  recordingAttempt: Readonly<{
    identifier: string;
    state: "ready";
    createdAt: string;
  }>;
  audioFile: Readonly<{
    identifier: string;
    mimeType: string;
    sizeBytes: number;
    durationMilliseconds: number;
  }>;
  analysisRun: Readonly<{
    identifier: string;
    mode: string;
    createdAt: string;
  }>;
  analysisJobs: ReadonlyArray<
    Readonly<{
      identifier: string;
      engine: string;
      state: "queued";
    }>
  >;
  events: NonEmptyList<AnalysisRunStarted | AnalysisJobQueued>;
}>;

// ---- Dependencies ----

export type SubmitPracticeAttemptDependencies = Readonly<{
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  audioFileRepository: AudioFileRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  audioStorage: AudioStorage;
  transactionManager: TransactionManager;
  entropyProvider: EntropyProvider;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

export const createSubmitPracticeAttempt =
  (dependencies: SubmitPracticeAttemptDependencies) =>
  (input: SubmitPracticeAttemptInput): ResultAsync<SubmitPracticeAttemptOutput, DomainError> => {
    // 1. Zod 検証
    const parsedInput = parseInput(submitPracticeAttemptSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const sectionIdentifier = createSectionIdentifier(parsed.section);
    if (!sectionIdentifier) {
      return errAsync(validationFailed("section", "不正なセクションIDです"));
    }

    // 2. audioSource 検証（最大10分 / 最大100MB / 対応MIME）
    const { audioSource, analysisMode } = parsed;

    if (audioSource.durationMilliseconds > MAX_AUDIO_DURATION_MS) {
      return errAsync(validationFailed("audioSource", "音声は最大10分までです"));
    }
    if (audioSource.data.length > MAX_AUDIO_SIZE_BYTES) {
      return errAsync(validationFailed("audioSource", "音声ファイルは最大100MBまでです"));
    }

    const mimeType = createAudioMimeType(audioSource.mimeType);
    if (!mimeType) {
      return errAsync(validationFailed("audioSource.mimeType", "対応していない音声形式です"));
    }

    // 3. Section 取得（Active であることを確認）
    return dependencies.sectionRepository.find(sectionIdentifier).andThen((section) => {
      const now = dependencies.clock.now();

      // 識別子生成
      const audioFileRawId = dependencies.entropyProvider.generateUlid();
      const audioFileIdentifier = createAudioFileIdentifier(audioFileRawId);
      if (!audioFileIdentifier) {
        return errAsync(validationFailed("audioFileIdentifier", "ULID 生成に失敗しました"));
      }

      const recordingAttemptRawId = dependencies.entropyProvider.generateUlid();
      const recordingAttemptIdentifier = createRecordingAttemptIdentifier(recordingAttemptRawId);
      if (!recordingAttemptIdentifier) {
        return errAsync(validationFailed("recordingAttemptIdentifier", "ULID 生成に失敗しました"));
      }

      // 4. AudioStorage.save は DB トランザクション外
      return dependencies.audioStorage
        .save(audioFileIdentifier, audioSource.data, audioSource.mimeType)
        .andThen((savedAudio) => {
          const duration = createRecordingDuration(audioSource.durationMilliseconds);
          if (!duration) {
            return errAsync(
              validationFailed("durationMilliseconds", "録音時間は正の値である必要があります"),
            );
          }

          // RecordingOrigin を Choice Type として構築（平坦化禁止）
          let origin: RecordingOrigin;
          if (audioSource.type === "browser_recording") {
            origin = {
              type: "browser_recording",
              startedAt: audioSource.startedAt,
              endedAt: audioSource.endedAt,
              browserInfo: {
                browserName: audioSource.browserInfo.browserName,
                deviceType: audioSource.browserInfo.deviceType,
                recordingApiType: audioSource.browserInfo.recordingApiType,
                userAgent: audioSource.browserInfo.userAgent,
              },
            };
          } else {
            const originalFileName = createOriginalFileName(audioSource.originalFileName);
            if (!originalFileName) {
              return errAsync(validationFailed("originalFileName", "ファイル名が不正です"));
            }
            origin = {
              type: "uploaded_file",
              originalFileName,
              uploadedAt: now,
            };
          }

          // SavingRecordingAttempt → ReadyRecordingAttempt
          const { recordingAttempt: savingAttempt } = startRecordingAttempt({
            identifier: recordingAttemptIdentifier,
            section: section.identifier,
            inputKind: audioSource.type,
            now,
          });

          const { recordingAttempt: readyAttempt } = markRecordingAttemptReady(
            savingAttempt,
            audioFileIdentifier,
            { origin, duration },
          );

          const storedAudioFile: StoredAudioFile = {
            type: "stored",
            identifier: audioFileIdentifier,
            recordingAttempt: recordingAttemptIdentifier,
            storageKey: savedAudio.storageKey,
            mimeType,
            sizeBytes: savedAudio.sizeBytes,
            // AudioStorage は音声を復号せず duration を算出できない（常に 0 を返す）。
            // 録音時間はクライアント計測値（検証済み正値）を正とする。
            durationMilliseconds: audioSource.durationMilliseconds,
            sha256: savedAudio.sha256,
            createdAt: now,
            updatedAt: now,
          };

          // 5. DB トランザクション
          return dependencies.transactionManager
            .execute(() => {
              const analysisRunRawId = dependencies.entropyProvider.generateUlid();
              const analysisRunIdentifier = createAnalysisRunIdentifier(analysisRunRawId);
              if (!analysisRunIdentifier) {
                return errAsync(
                  validationFailed("analysisRunIdentifier", "ULID 生成に失敗しました"),
                );
              }

              const mode: AnalysisMode = analysisMode;
              const { analysisRun, events: runEvents } = createAnalysisRun({
                identifier: analysisRunIdentifier,
                recordingAttempt: recordingAttemptIdentifier,
                mode,
                now,
              });

              // AnalysisJob を mode に応じて作成
              const engines: EngineType[] =
                analysisMode === "cloud_only"
                  ? ["cloud"]
                  : analysisMode === "oss_worker_only"
                    ? ["oss_worker"]
                    : ["cloud", "oss_worker"];

              type JobCreateResult = {
                analysisJob: ReturnType<typeof createAnalysisJob>["analysisJob"];
                events: ReturnType<typeof createAnalysisJob>["events"];
              };

              const jobCreations: JobCreateResult[] = [];
              for (const engine of engines) {
                const jobRawId = dependencies.entropyProvider.generateUlid();
                const jobIdentifier = createAnalysisJobIdentifier(jobRawId);
                if (!jobIdentifier) {
                  return errAsync(
                    validationFailed("analysisJobIdentifier", "ULID 生成に失敗しました"),
                  );
                }
                jobCreations.push(
                  createAnalysisJob({
                    identifier: jobIdentifier,
                    analysisRun: analysisRunIdentifier,
                    engine,
                    engineConfigJson: "{}",
                    now,
                  }),
                );
              }

              // 順次 persist
              const persistJobs = (index: number): ResultAsync<void, DomainError> => {
                if (index >= jobCreations.length) return okAsync(undefined);
                return dependencies.analysisJobRepository
                  .persist(jobCreations[index].analysisJob)
                  .andThen(() => persistJobs(index + 1));
              };

              return dependencies.recordingAttemptRepository
                .persist(readyAttempt)
                .andThen(() => dependencies.audioFileRepository.persist(storedAudioFile))
                .andThen(() => dependencies.analysisRunRepository.persist(analysisRun))
                .andThen(() => persistJobs(0))
                .map(() => {
                  dependencies.logger.info("submitPracticeAttempt: created", {
                    recordingAttemptIdentifier: recordingAttemptIdentifier as string,
                    analysisRunIdentifier: analysisRunIdentifier as string,
                  });

                  const allJobQueued = jobCreations.flatMap((r) => [...r.events]);
                  const allEvents = [...runEvents, ...allJobQueued] as NonEmptyList<
                    AnalysisRunStarted | AnalysisJobQueued
                  >;

                  return {
                    recordingAttempt: {
                      identifier: readyAttempt.identifier as string,
                      state: "ready" as const,
                      createdAt: readyAttempt.createdAt.toISOString(),
                    },
                    audioFile: {
                      identifier: storedAudioFile.identifier as string,
                      mimeType: storedAudioFile.mimeType as string,
                      sizeBytes: storedAudioFile.sizeBytes,
                      durationMilliseconds: storedAudioFile.durationMilliseconds,
                    },
                    analysisRun: {
                      identifier: analysisRun.identifier as string,
                      mode: analysisRun.mode,
                      createdAt: analysisRun.createdAt.toISOString(),
                    },
                    analysisJobs: jobCreations.map((r) => ({
                      identifier: r.analysisJob.identifier as string,
                      engine: r.analysisJob.engine,
                      state: "queued" as const,
                    })),
                    events: allEvents,
                  } satisfies SubmitPracticeAttemptOutput;
                });
            })
            .orElse((dbError) => {
              // 6. DB 失敗時は保存済み音声を物理削除（補償）
              dependencies.logger.error(
                "submitPracticeAttempt: DB failed, compensating audio delete",
                dbError,
              );
              return dependencies.audioStorage
                .delete(savedAudio.storageKey)
                .andThen(() => errAsync(dbError))
                .orElse(() => errAsync(dbError));
            });
        });
    });
  };
