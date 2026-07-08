/**
 * ShadowingLagClient — シャドーイングラグ計測 ACL ポート
 * ADR-013: worker `POST /v1/pronunciation-assessments/shadowing` を呼び出し ShadowingLagResult を返す。
 * UseCase → ACL の依存方向を守る (acl 側が実装を持ち、usecase はこの port 型だけを参照する)。
 */

import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

export type ShadowingLagInput = Readonly<{
  referenceAudioBytes: Uint8Array;
  referenceAudioMimeType: string;
  learnerAudioBytes: Uint8Array;
  learnerAudioMimeType: string;
  referenceText: string;
  durationMilliseconds: number;
}>;

export type ShadowingLagResult = Readonly<{
  lagMilliseconds: number;
  perSegmentLag: ReadonlyArray<Readonly<{ phoneme: string; lagMilliseconds: number }>>;
  speechRateRatio: number | null;
  pauseCountLearner: number | null;
  pauseCountReference: number | null;
  recommendSlowPlayback: boolean;
  thresholdMilliseconds: number;
}>;

export type ShadowingLagClient = Readonly<{
  computeLag: (input: ShadowingLagInput) => ResultAsync<ShadowingLagResult, DomainError>;
}>;
