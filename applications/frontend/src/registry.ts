/**
 * Composition Root — infrastructure.md §12。
 * 全依存を組み立てる単一モジュール。
 * Route Handler と instrumentation がここから Container を取得する。
 *
 * このモジュールは Node.js runtime 専用 (DB 接続を持つ)。
 * Route Handler のみが import する。UseCase / Domain / ACL からは import しない。
 */

import { createConfig, type AppConfig } from "./infrastructure/config/index";
import { createDrizzleDatabase, type DrizzleDatabase } from "./infrastructure/drizzle/client";
import { createDrizzleTransactionManager } from "./infrastructure/drizzle/transaction-manager";
import { createDrizzleMaterialRepository } from "./infrastructure/drizzle/repositories/material-repository";
import { createDrizzleSectionSeriesRepository } from "./infrastructure/drizzle/repositories/section-series-repository";
import { createDrizzleSectionRepository } from "./infrastructure/drizzle/repositories/section-repository";
import { createDrizzleRecordingAttemptRepository } from "./infrastructure/drizzle/repositories/recording-attempt-repository";
import { createDrizzleAudioFileRepository } from "./infrastructure/drizzle/repositories/audio-file-repository";
import { createDrizzleAnalysisRunRepository } from "./infrastructure/drizzle/repositories/analysis-run-repository";
import { createDrizzleAnalysisJobRepository } from "./infrastructure/drizzle/repositories/analysis-job-repository";
import { createDrizzleAssessmentResultRepository } from "./infrastructure/drizzle/repositories/assessment-result-repository";
import { createDrizzleFindingDismissalRepository } from "./infrastructure/drizzle/repositories/finding-dismissal-repository";
import { createDrizzleDiagnosticSessionRepository } from "./infrastructure/drizzle/repositories/diagnostic-session-repository";
import { createDrizzleWeaknessProfileRepository } from "./infrastructure/drizzle/repositories/weakness-profile-repository";
import { createDrizzleProgressSnapshotRepository } from "./infrastructure/drizzle/repositories/progress-snapshot-repository";
import { createDrizzleTrainingSessionRepository } from "./infrastructure/drizzle/repositories/training-session-repository";
import { createDrizzleHvptTrialRepository } from "./infrastructure/drizzle/repositories/hvpt-trial-repository";
import { createDrizzleSpacingScheduleRepository } from "./infrastructure/drizzle/repositories/spacing-schedule-repository";
import { createLocalAudioStorage } from "./infrastructure/local-audio-storage";
import { createSystemClock } from "./infrastructure/clock";
import { createEntropyProvider } from "./infrastructure/entropy-provider";
import { createStructuredLogger } from "./infrastructure/logger";
import { createOpenAiPronunciationAssessmentAdaptor } from "./acl/pronunciation-assessment/openai/create-open-ai-pronunciation-assessment-adaptor";
import { createOssWorkerPronunciationAssessmentAdaptor } from "./acl/pronunciation-assessment/oss-worker/create-oss-worker-pronunciation-assessment-adaptor";
import { createPronunciationAssessmentEngineRegistry } from "./acl/pronunciation-assessment/registry/create-pronunciation-assessment-engine-registry";
import { createRuleBasedImprovementMessageGenerator } from "./acl/improvement-message/rule-based/create-rule-based-improvement-message-generator";

import { createBrowsePracticeMaterials } from "./usecase/browse-practice-materials/index";
import { createCancelAssessmentRun } from "./usecase/cancel-assessment-run/index";
import { createDefinePracticeSection } from "./usecase/define-practice-section/index";
import { createDiscardAssessmentRun } from "./usecase/discard-assessment-run/index";
import { createDiscardRecordingAttempt } from "./usecase/discard-recording-attempt/index";
import { createOpenRecordingAudio } from "./usecase/open-recording-audio/index";
import { createPrepareMaterial } from "./usecase/prepare-material/index";
import { createReassessPracticeAttempt } from "./usecase/reassess-practice-attempt/index";
import { createRetireMaterial } from "./usecase/retire-material/index";
import { createRetirePracticeSectionSeries } from "./usecase/retire-practice-section-series/index";
import { createReviewPracticeHistory } from "./usecase/review-practice-history/index";
import { createReviseMaterial } from "./usecase/revise-material/index";
import { createRevisePracticeSection } from "./usecase/revise-practice-section/index";
import { createRunAssessmentJob } from "./usecase/run-assessment-job/index";
import { createSubmitPracticeAttempt } from "./usecase/submit-practice-attempt/index";
import { createViewMaterialPracticePlan } from "./usecase/view-material-practice-plan/index";
import { createViewPracticeWorkspace } from "./usecase/view-practice-workspace/index";
import { createDismissFinding } from "./usecase/dismiss-finding/index";
import { createRestoreFinding } from "./usecase/restore-finding/index";
import { createStartDiagnosticSession } from "./usecase/start-diagnostic-session/index";
import { createCompleteDiagnosticSession } from "./usecase/complete-diagnostic-session/index";
import { createViewDiagnosticResult } from "./usecase/view-diagnostic-result/index";
import { createCaptureProgressSnapshot } from "./usecase/capture-progress-snapshot/index";
import { createViewProgress } from "./usecase/view-progress/index";

import type {
  BrowsePracticeMaterialsInput,
  BrowsePracticeMaterialsOutput,
} from "./usecase/browse-practice-materials/index";
import type {
  CancelAssessmentRunInput,
  CancelAssessmentRunOutput,
} from "./usecase/cancel-assessment-run/index";
import type {
  DefinePracticeSectionInput,
  DefinePracticeSectionOutput,
} from "./usecase/define-practice-section/index";
import type {
  DiscardAssessmentRunInput,
  DiscardAssessmentRunOutput,
} from "./usecase/discard-assessment-run/index";
import type {
  DiscardRecordingAttemptInput,
  DiscardRecordingAttemptOutput,
} from "./usecase/discard-recording-attempt/index";
import type {
  OpenRecordingAudioInput,
  OpenRecordingAudioOutput,
} from "./usecase/open-recording-audio/index";
import type { PrepareMaterialInput, PrepareMaterialOutput } from "./usecase/prepare-material/index";
import type {
  ReassessPracticeAttemptInput,
  ReassessPracticeAttemptOutput,
} from "./usecase/reassess-practice-attempt/index";
import type { RetireMaterialInput, RetireMaterialOutput } from "./usecase/retire-material/index";
import type {
  RetirePracticeSectionSeriesInput,
  RetirePracticeSectionSeriesOutput,
} from "./usecase/retire-practice-section-series/index";
import type {
  ReviewPracticeHistoryInput,
  ReviewPracticeHistoryOutput,
} from "./usecase/review-practice-history/index";
import type { ReviseMaterialInput, ReviseMaterialOutput } from "./usecase/revise-material/index";
import type {
  RevisePracticeSectionInput,
  RevisePracticeSectionOutput,
} from "./usecase/revise-practice-section/index";
import type {
  RunAssessmentJobInput,
  RunAssessmentJobOutput,
} from "./usecase/run-assessment-job/index";
import type {
  SubmitPracticeAttemptInput,
  SubmitPracticeAttemptOutput,
} from "./usecase/submit-practice-attempt/index";
import type {
  ViewMaterialPracticePlanInput,
  ViewMaterialPracticePlanOutput,
} from "./usecase/view-material-practice-plan/index";
import type {
  ViewPracticeWorkspaceInput,
  ViewPracticeWorkspaceOutput,
} from "./usecase/view-practice-workspace/index";
import type { DismissFindingInput, DismissFindingOutput } from "./usecase/dismiss-finding/index";
import type { RestoreFindingInput, RestoreFindingOutput } from "./usecase/restore-finding/index";
import type {
  StartDiagnosticSessionInput,
  StartDiagnosticSessionOutput,
} from "./usecase/start-diagnostic-session/index";
import type {
  CompleteDiagnosticSessionInput,
  CompleteDiagnosticSessionOutput,
} from "./usecase/complete-diagnostic-session/index";
import type {
  ViewDiagnosticResultInput,
  DiagnosticResultOutput,
} from "./usecase/view-diagnostic-result/index";
import type {
  CaptureProgressSnapshotInput,
  CaptureProgressSnapshotOutput,
} from "./usecase/capture-progress-snapshot/index";
import type { ViewProgressInput, ViewProgressOutput } from "./usecase/view-progress/index";

import type { ResultAsync } from "neverthrow";
import type { DomainError } from "./domain/shared";
import type { AudioStorage } from "./usecase/port/audio-storage";
import type { TrainingSessionRepository } from "./usecase/port/training-session-repository";
import type { HvptTrialRepository } from "./usecase/port/hvpt-trial-repository";
import type { SpacingScheduleRepository } from "./usecase/port/spacing-schedule-repository";

// ---- Container type ----

export type Container = Readonly<{
  config: AppConfig;
  audioStorage: AudioStorage;
  database: DrizzleDatabase;
  /** repositories — sub-1 の training 集約 repo を後続 usecase から参照できるよう公開。 */
  repositories: Readonly<{
    trainingSession: TrainingSessionRepository;
    hvptTrial: HvptTrialRepository;
    spacingSchedule: SpacingScheduleRepository;
  }>;
  usecases: Readonly<{
    browsePracticeMaterials: (
      input: BrowsePracticeMaterialsInput,
    ) => ResultAsync<BrowsePracticeMaterialsOutput, DomainError>;
    cancelAssessmentRun: (
      input: CancelAssessmentRunInput,
    ) => ResultAsync<CancelAssessmentRunOutput, DomainError>;
    definePracticeSection: (
      input: DefinePracticeSectionInput,
    ) => ResultAsync<DefinePracticeSectionOutput, DomainError>;
    discardAssessmentRun: (
      input: DiscardAssessmentRunInput,
    ) => ResultAsync<DiscardAssessmentRunOutput, DomainError>;
    discardRecordingAttempt: (
      input: DiscardRecordingAttemptInput,
    ) => ResultAsync<DiscardRecordingAttemptOutput, DomainError>;
    openRecordingAudio: (
      input: OpenRecordingAudioInput,
    ) => ResultAsync<OpenRecordingAudioOutput, DomainError>;
    prepareMaterial: (
      input: PrepareMaterialInput,
    ) => ResultAsync<PrepareMaterialOutput, DomainError>;
    reassessPracticeAttempt: (
      input: ReassessPracticeAttemptInput,
    ) => ResultAsync<ReassessPracticeAttemptOutput, DomainError>;
    retireMaterial: (input: RetireMaterialInput) => ResultAsync<RetireMaterialOutput, DomainError>;
    retirePracticeSectionSeries: (
      input: RetirePracticeSectionSeriesInput,
    ) => ResultAsync<RetirePracticeSectionSeriesOutput, DomainError>;
    reviewPracticeHistory: (
      input: ReviewPracticeHistoryInput,
    ) => ResultAsync<ReviewPracticeHistoryOutput, DomainError>;
    reviseMaterial: (input: ReviseMaterialInput) => ResultAsync<ReviseMaterialOutput, DomainError>;
    revisePracticeSection: (
      input: RevisePracticeSectionInput,
    ) => ResultAsync<RevisePracticeSectionOutput, DomainError>;
    runAssessmentJob: (
      input: RunAssessmentJobInput,
    ) => ResultAsync<RunAssessmentJobOutput, DomainError>;
    submitPracticeAttempt: (
      input: SubmitPracticeAttemptInput,
    ) => ResultAsync<SubmitPracticeAttemptOutput, DomainError>;
    viewMaterialPracticePlan: (
      input: ViewMaterialPracticePlanInput,
    ) => ResultAsync<ViewMaterialPracticePlanOutput, DomainError>;
    viewPracticeWorkspace: (
      input: ViewPracticeWorkspaceInput,
    ) => ResultAsync<ViewPracticeWorkspaceOutput, DomainError>;
    dismissFinding: (input: DismissFindingInput) => ResultAsync<DismissFindingOutput, DomainError>;
    restoreFinding: (input: RestoreFindingInput) => ResultAsync<RestoreFindingOutput, DomainError>;
    startDiagnosticSession: (
      input: StartDiagnosticSessionInput,
    ) => ResultAsync<StartDiagnosticSessionOutput, DomainError>;
    completeDiagnosticSession: (
      input: CompleteDiagnosticSessionInput,
    ) => ResultAsync<CompleteDiagnosticSessionOutput, DomainError>;
    viewDiagnosticResult: (
      input: ViewDiagnosticResultInput,
    ) => ResultAsync<DiagnosticResultOutput, DomainError>;
    captureProgressSnapshot: (
      input: CaptureProgressSnapshotInput,
    ) => ResultAsync<CaptureProgressSnapshotOutput, DomainError>;
    viewProgress: (input: ViewProgressInput) => ResultAsync<ViewProgressOutput, DomainError>;
  }>;
}>;

// ---- Global singleton guard (dev hot reload 対策) ----

type NativeTraceRegistryGlobal = typeof globalThis & {
  __nativeTraceContainer?: Container;
};

// ---- Internal builder ----

const buildContainer = (): Container => {
  const config = createConfig();

  const database: DrizzleDatabase = createDrizzleDatabase(config.dbPath);

  // Repositories
  const materialRepository = createDrizzleMaterialRepository(database);
  const sectionSeriesRepository = createDrizzleSectionSeriesRepository(database);
  const sectionRepository = createDrizzleSectionRepository(database);
  const recordingAttemptRepository = createDrizzleRecordingAttemptRepository(database);
  const audioFileRepository = createDrizzleAudioFileRepository(database);
  const analysisRunRepository = createDrizzleAnalysisRunRepository(database);
  const analysisJobRepository = createDrizzleAnalysisJobRepository(database);
  const assessmentResultRepository = createDrizzleAssessmentResultRepository(database);
  const findingDismissalRepository = createDrizzleFindingDismissalRepository(database);
  const diagnosticSessionRepository = createDrizzleDiagnosticSessionRepository(database);
  const weaknessProfileRepository = createDrizzleWeaknessProfileRepository(database);
  const progressSnapshotRepository = createDrizzleProgressSnapshotRepository(database);
  const trainingSessionRepository = createDrizzleTrainingSessionRepository(database);
  const hvptTrialRepository = createDrizzleHvptTrialRepository(database);
  const spacingScheduleRepository = createDrizzleSpacingScheduleRepository(database);

  // Infrastructure services
  const audioStorage = createLocalAudioStorage(config.audioStorageRoot);
  const transactionManager = createDrizzleTransactionManager();
  const clock = createSystemClock();
  const entropyProvider = createEntropyProvider();
  const logger = createStructuredLogger(config.nodeEnv);

  // ACL: pronunciation assessment engines
  const cloudEngine = createOpenAiPronunciationAssessmentAdaptor({
    apiKey: config.openaiApiKey,
    model: config.openaiAssessmentModel,
    clock,
    logger,
  });
  const ossWorkerEngine = createOssWorkerPronunciationAssessmentAdaptor({
    workerApiEndpoint: config.workerApiEndpoint,
    timeoutMilliseconds: config.ossWorkerTimeoutMilliseconds,
    clock,
    logger,
  });
  const engineRegistry = createPronunciationAssessmentEngineRegistry({
    cloudEngine,
    ossWorkerEngine,
  });

  // ACL: improvement message generator
  const improvementMessageGenerator = createRuleBasedImprovementMessageGenerator();

  // Shared deps bundle for convenience
  const sharedRepositories = {
    materialRepository,
    sectionSeriesRepository,
    sectionRepository,
    recordingAttemptRepository,
    audioFileRepository,
    analysisRunRepository,
    analysisJobRepository,
    assessmentResultRepository,
  };

  // UseCase executors (all 17)
  const usecases: Container["usecases"] = {
    browsePracticeMaterials: createBrowsePracticeMaterials({
      materialRepository,
    }),

    cancelAssessmentRun: createCancelAssessmentRun({
      analysisRunRepository,
      analysisJobRepository,
      transactionManager,
      clock,
      logger,
    }),

    definePracticeSection: createDefinePracticeSection({
      materialRepository,
      sectionSeriesRepository,
      sectionRepository,
      transactionManager,
      entropyProvider,
      clock,
      logger,
    }),

    discardAssessmentRun: createDiscardAssessmentRun({
      analysisRunRepository,
      analysisJobRepository,
      assessmentResultRepository,
      transactionManager,
      clock,
      logger,
    }),

    discardRecordingAttempt: createDiscardRecordingAttempt({
      recordingAttemptRepository,
      audioFileRepository,
      audioStorage,
      analysisRunRepository,
      assessmentResultRepository,
      transactionManager,
      clock,
      logger,
    }),

    openRecordingAudio: createOpenRecordingAudio({
      recordingAttemptRepository,
      audioFileRepository,
    }),

    prepareMaterial: createPrepareMaterial({
      materialRepository,
      transactionManager,
      entropyProvider,
      clock,
      logger,
    }),

    reassessPracticeAttempt: createReassessPracticeAttempt({
      recordingAttemptRepository,
      analysisRunRepository,
      analysisJobRepository,
      transactionManager,
      entropyProvider,
      clock,
      logger,
    }),

    retireMaterial: createRetireMaterial({
      materialRepository,
      sectionSeriesRepository,
      transactionManager,
      clock,
      logger,
    }),

    retirePracticeSectionSeries: createRetirePracticeSectionSeries({
      sectionSeriesRepository,
      transactionManager,
      clock,
      logger,
    }),

    reviewPracticeHistory: createReviewPracticeHistory({
      sectionSeriesRepository,
      sectionRepository,
      recordingAttemptRepository,
      analysisRunRepository,
      assessmentResultRepository,
    }),

    reviseMaterial: createReviseMaterial({
      materialRepository,
      transactionManager,
      clock,
      logger,
    }),

    revisePracticeSection: createRevisePracticeSection({
      sectionSeriesRepository,
      sectionRepository,
      transactionManager,
      entropyProvider,
      clock,
      logger,
    }),

    runAssessmentJob: createRunAssessmentJob({
      ...sharedRepositories,
      audioStorage,
      engineRegistry,
      transactionManager,
      entropyProvider,
      clock,
      logger,
      improvementMessageGenerator,
    }),

    submitPracticeAttempt: createSubmitPracticeAttempt({
      sectionRepository,
      recordingAttemptRepository,
      audioFileRepository,
      analysisRunRepository,
      analysisJobRepository,
      audioStorage,
      transactionManager,
      entropyProvider,
      clock,
      logger,
    }),

    viewMaterialPracticePlan: createViewMaterialPracticePlan({
      materialRepository,
      sectionSeriesRepository,
      sectionRepository,
    }),

    viewPracticeWorkspace: createViewPracticeWorkspace({
      sectionRepository,
      recordingAttemptRepository,
      analysisRunRepository,
      analysisJobRepository,
      assessmentResultRepository,
      audioFileRepository,
      findingDismissalRepository,
    }),

    dismissFinding: createDismissFinding({
      sectionRepository,
      recordingAttemptRepository,
      analysisRunRepository,
      analysisJobRepository,
      assessmentResultRepository,
      findingDismissalRepository,
      entropyProvider,
      clock,
    }),

    restoreFinding: createRestoreFinding({
      sectionRepository,
      recordingAttemptRepository,
      analysisRunRepository,
      analysisJobRepository,
      assessmentResultRepository,
      findingDismissalRepository,
      clock,
    }),

    startDiagnosticSession: createStartDiagnosticSession({
      diagnosticSessionRepository,
      entropyProvider,
      clock,
    }),

    completeDiagnosticSession: createCompleteDiagnosticSession({
      diagnosticSessionRepository,
      weaknessProfileRepository,
      assessmentResultRepository,
      entropyProvider,
      clock,
    }),

    viewDiagnosticResult: createViewDiagnosticResult({
      diagnosticSessionRepository,
      weaknessProfileRepository,
      assessmentResultRepository,
    }),

    captureProgressSnapshot: createCaptureProgressSnapshot({
      progressSnapshotRepository,
      entropyProvider,
      clock,
    }),

    viewProgress: createViewProgress({
      progressSnapshotRepository,
    }),
  };

  const repositories: Container["repositories"] = {
    trainingSession: trainingSessionRepository,
    hvptTrial: hvptTrialRepository,
    spacingSchedule: spacingScheduleRepository,
  };

  return { config, audioStorage, database, repositories, usecases };
};

// ---- Public API ----

/**
 * getContainer — module-level singleton。
 * dev hot reload に耐えるよう globalThis guard を使う。
 */
export const getContainer = (): Container => {
  const global = globalThis as NativeTraceRegistryGlobal;

  if (!global.__nativeTraceContainer) {
    global.__nativeTraceContainer = buildContainer();
  }

  return global.__nativeTraceContainer;
};

/**
 * createAssessmentTick — instrumentation が Runner に渡す tick 関数。
 * runAssessmentJob executor を leaseOwner / config 値で包む。
 * エラーは logger で握る（throw しない）。
 */
export const createAssessmentTick =
  (container: Container): (() => Promise<void>) =>
  async (): Promise<void> => {
    const { config, usecases } = container;

    const result = await usecases.runAssessmentJob({
      leaseOwner: "runner-singleton",
      leaseDurationSeconds: Math.floor(config.analysisJobLeaseDurationMilliseconds / 1000),
      maxAttempts: config.analysisJobMaxAttempts,
    });

    if (result.isErr()) {
      // logger は container 内にないため直接 console を使う（tick の外側エラーは infrastructure レベル）
      console.error(
        JSON.stringify({
          level: "error",
          message: "createAssessmentTick: runAssessmentJob failed",
          errorType: result.error.type,
        }),
      );
    }
  };
