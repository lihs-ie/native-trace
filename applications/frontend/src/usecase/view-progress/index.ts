/**
 * ViewProgress UseCase
 *
 * 設計の正: docs/specs/progress-screen.md (M-PG-3)
 *          docs/03-detailed-design/domain.md §14 (DD-205)
 *          adr/008-training-progress-timeseries-data-model.md (OQ-6)
 *
 * 固定 sentinel LearnerIdentifier の ProgressSnapshot を capturedAt 昇順で返す。
 * 空集合は valid (honest empty / training 未実装時は 0 件でも 500 にならない)。
 *
 * 返却構造:
 *   - snapshots: 時系列全件 (capturedAt 昇順)
 *   - now: 最新スナップショット (null = 0 件)
 *   - prev: 1 個前のスナップショット (null = 1 件以下 / honest empty)
 */

import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import { type LearnerIdentifier } from "../../domain/training";
import { type ProgressSnapshotRepository } from "../port/progress-snapshot-repository";

// ---- Output ----

export type ProgressSnapshotViewItem = Readonly<{
  identifier: string;
  section: string | null;
  sourceAssessment: string | null;
  taskKind: "rereading" | "drill";
  cefrSubscales: Readonly<{
    overall: number;
    segmental: number;
    prosodic: number;
  }>;
  focusScores: ReadonlyArray<Readonly<{ contrast: string; score: number }>>;
  cumulativeTrainingMinutes: number;
  capturedAt: string;
}>;

export type ViewProgressOutput = Readonly<{
  /** 時系列全件 (capturedAt 昇順) */
  snapshots: ReadonlyArray<ProgressSnapshotViewItem>;
  /** 最新スナップショット (null = スナップショットが 0 件) */
  now: ProgressSnapshotViewItem | null;
  /** 1 個前のスナップショット (null = 1 件以下 / OQ-6 honest empty) */
  prev: ProgressSnapshotViewItem | null;
}>;

// ---- Dependencies ----

export type ViewProgressDependencies = Readonly<{
  progressSnapshotRepository: ProgressSnapshotRepository;
}>;

// ---- Input ----

export type ViewProgressInput = Readonly<{
  learner: LearnerIdentifier;
}>;

// ---- Implementation ----

export const createViewProgress =
  (dependencies: ViewProgressDependencies) =>
  (input: ViewProgressInput): ResultAsync<ViewProgressOutput, DomainError> => {
    return dependencies.progressSnapshotRepository
      .findByLearnerOrderedByCapturedAt(input.learner)
      .map((snapshots) => {
        const items: ProgressSnapshotViewItem[] = snapshots.map((snapshot) => ({
          identifier: String(snapshot.identifier),
          section: snapshot.section !== null ? String(snapshot.section) : null,
          sourceAssessment:
            snapshot.sourceAssessment !== null ? String(snapshot.sourceAssessment) : null,
          taskKind: snapshot.taskKind,
          cefrSubscales: {
            overall: Number(snapshot.cefrScores.overall),
            segmental: Number(snapshot.cefrScores.segmental),
            prosodic: Number(snapshot.cefrScores.prosodic),
          },
          focusScores: snapshot.focusScores.map((fs) => ({
            contrast: String(fs.contrast),
            score: Number(fs.score),
          })),
          cumulativeTrainingMinutes: Number(snapshot.cumulativeTrainingMinutes),
          capturedAt: snapshot.capturedAt.toISOString(),
        }));

        // now = 最新、prev = 1 個前 (OQ-6: learner 直前 1 件)
        const now = items.length > 0 ? items[items.length - 1]! : null;
        const prev = items.length > 1 ? items[items.length - 2]! : null;

        return {
          snapshots: items,
          now,
          prev,
        } satisfies ViewProgressOutput;
      });
  };
