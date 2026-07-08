/**
 * acl/improvement-message/shared.ts
 *
 * rule-based / llm の ImprovementMessageGenerator 実装で重複していた
 * 表示テキスト解決とカタログ lookup 前処理を共通化する（W29）。
 * 実行時の挙動は変えない（同一ロジックの抽出。zod と異なり関数だが、入出力は完全同一）。
 */

import { type ImprovementMessageGeneratorInput } from "../../usecase/port/improvement-message-generator";
import {
  findCatalogEntryById,
  findCatalogEntry,
  type ErrorCatalogEntry,
} from "../../domain/error-catalog";

/**
 * expected/detected から表示用テキストを取得する。
 * text が非 null なら text、null なら ipa、両方 null なら null。
 */
export const resolveDisplayText = (
  evidence: Readonly<{ text: string | null; ipa: string | null }>,
): string | null => evidence.text ?? evidence.ipa ?? null;

/**
 * カタログエントリを取得する（catalogId 優先、なければ phenomenon + detectedDisplay で検索）。
 */
export const resolveCatalogEntry = (
  catalogId: string | null | undefined,
  phenomenon: ImprovementMessageGeneratorInput["phenomenon"],
  detectedDisplay: string | null,
): ErrorCatalogEntry | null => {
  const catalogEntry = catalogId ? findCatalogEntryById(catalogId) : null;
  return catalogEntry ?? findCatalogEntry(phenomenon, detectedDisplay);
};
