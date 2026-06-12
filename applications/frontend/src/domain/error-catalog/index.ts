/**
 * 日本語話者 L1 誤りカタログ — domain モデル
 *
 * 設計の正: docs/specs/pronunciation-feedback-v2.md (M-101, C5)
 * domain 純粋性: I/O なし、JSON は import で読む
 * 命名規則: 略語禁止、XXXIdentifier
 */

import catalogData from "./data/japanese-l1-catalog.json";

// ---- 型定義 ----

export type FunctionalLoadRank = "max" | "high" | "mid" | "low";

export type IntelligibilityImpactRank = "high" | "mid" | "low";

export type EvidenceStrength = "high" | "mid" | "low";

export type ErrorCatalogEntryKind = "segmental" | "syllabic" | "prosodic";

export type RecommendedTrainingKind = "perception" | "articulation" | "prosody";

export type ArticulationGuide = Readonly<{
  mannerJa: string;
  stepsJa: ReadonlyArray<string>;
}>;

export type ErrorCatalogEntry = Readonly<{
  id: string;
  kind: ErrorCatalogEntryKind;
  targetPhoneme: string;
  contrast: string | null;
  confusionSet: ReadonlyArray<string>;
  l1MechanismJa: string;
  functionalLoad: FunctionalLoadRank;
  intelligibilityImpact: IntelligibilityImpactRank;
  recommendedTraining: ReadonlyArray<RecommendedTrainingKind>;
  evidenceStrength: EvidenceStrength;
  evidenceIds: ReadonlyArray<string>;
  articulation: ArticulationGuide | null;
}>;

// ---- バリデーション ----

const isFunctionalLoadRank = (value: unknown): value is FunctionalLoadRank =>
  value === "max" || value === "high" || value === "mid" || value === "low";

const isIntelligibilityImpactRank = (value: unknown): value is IntelligibilityImpactRank =>
  value === "high" || value === "mid" || value === "low";

const isEvidenceStrength = (value: unknown): value is EvidenceStrength =>
  value === "high" || value === "mid" || value === "low";

const isErrorCatalogEntryKind = (value: unknown): value is ErrorCatalogEntryKind =>
  value === "segmental" || value === "syllabic" || value === "prosodic";

const isRecommendedTrainingKind = (value: unknown): value is RecommendedTrainingKind =>
  value === "perception" || value === "articulation" || value === "prosody";

const parseEntry = (raw: unknown): ErrorCatalogEntry => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("ErrorCatalogEntry: invalid entry (not an object)");
  }
  const entry = raw as Record<string, unknown>;

  if (typeof entry["id"] !== "string" || entry["id"].trim() === "") {
    throw new Error("ErrorCatalogEntry: id is required and must be non-empty");
  }
  if (!isErrorCatalogEntryKind(entry["kind"])) {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): kind must be segmental|syllabic|prosodic`);
  }
  if (typeof entry["targetPhoneme"] !== "string" || entry["targetPhoneme"].trim() === "") {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): targetPhoneme is required`);
  }
  if (entry["contrast"] !== null && typeof entry["contrast"] !== "string") {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): contrast must be string or null`);
  }
  if (!Array.isArray(entry["confusionSet"])) {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): confusionSet must be array`);
  }
  if (typeof entry["l1MechanismJa"] !== "string" || entry["l1MechanismJa"].trim() === "") {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): l1MechanismJa is required`);
  }
  if (!isFunctionalLoadRank(entry["functionalLoad"])) {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): functionalLoad must be max|high|mid|low`);
  }
  if (!isIntelligibilityImpactRank(entry["intelligibilityImpact"])) {
    throw new Error(
      `ErrorCatalogEntry(${entry["id"]}): intelligibilityImpact must be high|mid|low`,
    );
  }
  if (!Array.isArray(entry["recommendedTraining"])) {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): recommendedTraining must be array`);
  }
  const recommendedTraining = entry["recommendedTraining"] as unknown[];
  if (!recommendedTraining.every(isRecommendedTrainingKind)) {
    throw new Error(
      `ErrorCatalogEntry(${entry["id"]}): recommendedTraining items must be perception|articulation|prosody`,
    );
  }
  if (!isEvidenceStrength(entry["evidenceStrength"])) {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): evidenceStrength must be high|mid|low`);
  }
  if (!Array.isArray(entry["evidenceIds"]) || (entry["evidenceIds"] as unknown[]).length === 0) {
    throw new Error(`ErrorCatalogEntry(${entry["id"]}): evidenceIds must be non-empty array`);
  }

  let articulation: ArticulationGuide | null = null;
  if (entry["articulation"] !== null && entry["articulation"] !== undefined) {
    const articulationRaw = entry["articulation"] as Record<string, unknown>;
    if (
      typeof articulationRaw["mannerJa"] !== "string" ||
      articulationRaw["mannerJa"].trim() === ""
    ) {
      throw new Error(`ErrorCatalogEntry(${entry["id"]}): articulation.mannerJa is required`);
    }
    if (!Array.isArray(articulationRaw["stepsJa"])) {
      throw new Error(`ErrorCatalogEntry(${entry["id"]}): articulation.stepsJa must be array`);
    }
    articulation = {
      mannerJa: articulationRaw["mannerJa"],
      stepsJa: articulationRaw["stepsJa"] as string[],
    };
  }

  return {
    id: entry["id"] as string,
    kind: entry["kind"] as ErrorCatalogEntryKind,
    targetPhoneme: entry["targetPhoneme"] as string,
    contrast: entry["contrast"] as string | null,
    confusionSet: entry["confusionSet"] as string[],
    l1MechanismJa: entry["l1MechanismJa"] as string,
    functionalLoad: entry["functionalLoad"] as FunctionalLoadRank,
    intelligibilityImpact: entry["intelligibilityImpact"] as IntelligibilityImpactRank,
    recommendedTraining: recommendedTraining as RecommendedTrainingKind[],
    evidenceStrength: entry["evidenceStrength"] as EvidenceStrength,
    evidenceIds: entry["evidenceIds"] as string[],
    articulation,
  };
};

// ---- カタログロード (モジュールレベルで1回だけ実行) ----

const loadedCatalog: ReadonlyArray<ErrorCatalogEntry> = (catalogData as unknown[]).map(parseEntry);

/**
 * 日本語話者 L1 誤りカタログの全エントリを返す。
 * モジュールロード時にパース・バリデーション済み。
 */
export const getAllCatalogEntries = (): ReadonlyArray<ErrorCatalogEntry> => loadedCatalog;

/**
 * phenomenon と contrast でカタログエントリを検索する。
 * マッチするエントリが複数ある場合は最初のものを返す。
 * 見つからない場合は null を返す。
 */
export const findCatalogEntry = (
  phenomenon: string,
  contrast: string | null,
): ErrorCatalogEntry | null => {
  if (contrast !== null) {
    const byContrast = loadedCatalog.find(
      (entry) =>
        entry.contrast === contrast ||
        (entry.id.includes(phenomenon.toLowerCase()) &&
          entry.contrast !== null &&
          entry.contrast.includes(contrast)),
    );
    if (byContrast !== undefined) {
      return byContrast;
    }
  }
  const byPhenomenon = loadedCatalog.find(
    (entry) =>
      entry.id.includes(phenomenon.toLowerCase()) ||
      entry.targetPhoneme.toLowerCase() === phenomenon.toLowerCase(),
  );
  return byPhenomenon ?? null;
};

/**
 * catalog identifier (id フィールド) でエントリを取得する。
 * 見つからない場合は null を返す。
 */
export const findCatalogEntryById = (catalogIdentifier: string): ErrorCatalogEntry | null =>
  loadedCatalog.find((entry) => entry.id === catalogIdentifier) ?? null;
