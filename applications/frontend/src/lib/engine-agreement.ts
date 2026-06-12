/**
 * engine-agreement.ts — 純粋関数。副作用なし。
 * 2 エンジンの findings を textRange.overlap で bucket に振り分ける。
 * api-types の型のみ依存。
 */

import type { EngineFindingDto, EngineResultDto } from "./api-types";

/** overlap 判定: startChar/endChar が重なるか（隣接 endChar==startChar は非重複）*/
function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type AgreementItem = {
  /** 対象語（detected.text ?? expected.text ?? 範囲文字列 fallback） */
  word: string;
  textRange: { startChar: number; endChar: number };
  /** cloud エンジンの severity（both bucket のみ存在） */
  cloudSeverity: EngineFindingDto["severity"] | null;
  /** oss_worker エンジンの severity（both bucket のみ存在） */
  ossSeverity: EngineFindingDto["severity"] | null;
  /** bucket が cloudOnly / ossWorkerOnly のときはこちらに severity */
  severity: EngineFindingDto["severity"] | null;
};

export type EngineAgreement = {
  both: AgreementItem[];
  cloudOnly: AgreementItem[];
  ossWorkerOnly: AgreementItem[];
};

function extractWord(finding: EngineFindingDto): string {
  return (
    finding.detected?.text ??
    finding.expected?.text ??
    `[${finding.textRange.startChar}-${finding.textRange.endChar}]`
  );
}

/**
 * cloud と oss_worker の findings を重なり（overlap）で比較し
 * both / cloudOnly / ossWorkerOnly の 3 bucket に振り分ける。
 *
 * - 隣接（endChar == startChar）は非重複とみなす。
 * - cloud finding は最初に対応する oss finding を探す（1 対多は考慮しない）。
 * - oss finding のうち cloud に対応済みでないものは ossWorkerOnly。
 */
export const deriveEngineAgreement = (
  cloudResult: EngineResultDto | undefined,
  ossResult: EngineResultDto | undefined,
): EngineAgreement => {
  const cloudFindings: EngineFindingDto[] = cloudResult?.findings ?? [];
  const ossFindings: EngineFindingDto[] = ossResult?.findings ?? [];

  const matchedOssIndices = new Set<number>();
  const both: AgreementItem[] = [];
  const cloudOnly: AgreementItem[] = [];

  for (const cloudFinding of cloudFindings) {
    const ossIndex = ossFindings.findIndex(
      (ossFinding, index) =>
        !matchedOssIndices.has(index) &&
        rangesOverlap(
          cloudFinding.textRange.startChar,
          cloudFinding.textRange.endChar,
          ossFinding.textRange.startChar,
          ossFinding.textRange.endChar,
        ),
    );

    if (ossIndex !== -1) {
      matchedOssIndices.add(ossIndex);
      const ossFinding = ossFindings[ossIndex];
      both.push({
        word: extractWord(cloudFinding),
        textRange: cloudFinding.textRange,
        cloudSeverity: cloudFinding.severity,
        ossSeverity: ossFinding.severity,
        severity: null,
      });
    } else {
      cloudOnly.push({
        word: extractWord(cloudFinding),
        textRange: cloudFinding.textRange,
        cloudSeverity: null,
        ossSeverity: null,
        severity: cloudFinding.severity,
      });
    }
  }

  const ossWorkerOnly: AgreementItem[] = ossFindings
    .filter((_, index) => !matchedOssIndices.has(index))
    .map((ossFinding) => ({
      word: extractWord(ossFinding),
      textRange: ossFinding.textRange,
      cloudSeverity: null,
      ossSeverity: null,
      severity: ossFinding.severity,
    }));

  return { both, cloudOnly, ossWorkerOnly };
};
