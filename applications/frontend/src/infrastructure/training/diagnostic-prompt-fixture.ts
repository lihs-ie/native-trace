/**
 * Diagnostic Prompt Fixture — 診断専用読み上げ課題セット（本番データ）
 *
 * 設計の正: docs/specs/diagnostic-screen.md (DD-290, OQ-2 解決)
 *          docs/03-detailed-design/domain.md §14 (DD-232)
 *
 * カタログ (japanese-l1-catalog.json) の高FL対立・母音挿入・韻律を網羅する
 * 固定課題セット。モックではなく本番の診断教材として使用する。
 *
 * 網羅対象:
 *   segmental  : l-r (max), r-l (max), v-b (high), ae-ʌ (high), iː-ɪ (high),
 *                final-consonant (high), schwa (high), epenthesis (high), s-ʃ (mid)
 *   prosodic   : lexical-stress (high), weak-form (high), rhythm-npvi (high)
 *   syllabic   : epenthesis (vowel insertion) は segmental 系の文に混在
 *
 * 1 prompt につき複数のカタログ対立を含む場合があるが、targetCatalogId は
 * 最も焦点となる対立を1つ設定する。
 * phenomenon フィールドは診断時の採点で検出されるカテゴリを示すガイドであり、
 * findingsの phenomenon とは必ずしも一致しない（採点側が決定する）。
 */

import {
  type DiagnosticPrompt,
  type DiagnosticPromptSet,
  type CatalogId,
} from "../../domain/training";
import { createNonEmptyList } from "../../domain/shared";

const catalogId = (value: string): CatalogId => value as CatalogId;

/**
 * DIAGNOSTIC_PROMPTS — カタログ網羅診断文セット (12文)
 * DD-290: カタログ高FL対立・母音挿入・韻律を最小セットで網羅する。
 */
const DIAGNOSTIC_PROMPTS: ReadonlyArray<DiagnosticPrompt> = [
  // --- /l/ vs /r/ (max FL) ---
  {
    identifier: "dp-lr-01",
    text: "The road leads really long and red.",
    targetCatalogId: catalogId("l-r-substitution"),
    phenomenon: "segmental",
  },
  {
    identifier: "dp-lr-02",
    text: "Please collect the library rules.",
    targetCatalogId: catalogId("r-substitution"),
    phenomenon: "segmental",
  },

  // --- /v/ vs /b/ (high FL) ---
  {
    identifier: "dp-vb-01",
    text: "Very brave volunteers visited the village.",
    targetCatalogId: catalogId("v-b-substitution"),
    phenomenon: "segmental",
  },

  // --- /æ/ vs /ʌ/ (high FL) ---
  {
    identifier: "dp-ae-01",
    text: "The cat sat on the rug by the bus.",
    targetCatalogId: catalogId("ae-a-substitution"),
    phenomenon: "segmental",
  },

  // --- /iː/ vs /ɪ/ (high FL) ---
  {
    identifier: "dp-ii-01",
    text: "She feels it is really interesting.",
    targetCatalogId: catalogId("iː-ɪ-substitution"),
    phenomenon: "segmental",
  },

  // --- final consonant deletion (high FL) ---
  {
    identifier: "dp-fc-01",
    text: "He left his desk and walked fast.",
    targetCatalogId: catalogId("final-consonant-omission"),
    phenomenon: "segmental",
  },

  // --- schwa substitution (high FL) ---
  {
    identifier: "dp-schwa-01",
    text: "A banana is a delicious yellow fruit.",
    targetCatalogId: catalogId("schwa-substitution"),
    phenomenon: "segmental",
  },

  // --- epenthesis / vowel insertion (high FL, syllabic) ---
  {
    identifier: "dp-ep-01",
    text: "Please bring a strong drink and bread.",
    targetCatalogId: catalogId("epenthesis"),
    phenomenon: "epenthesis",
  },

  // --- /s/ vs /ʃ/ (mid FL) ---
  {
    identifier: "dp-ssh-01",
    text: "She sells sea shells at the shore.",
    targetCatalogId: catalogId("s-sh-substitution"),
    phenomenon: "segmental",
  },

  // --- lexical stress (high FL, prosodic) ---
  {
    identifier: "dp-ls-01",
    text: "The record shows that he can record the music himself.",
    targetCatalogId: catalogId("lexical-stress-error"),
    phenomenon: "prosodic",
  },

  // --- weak form realization (high FL, prosodic) ---
  {
    identifier: "dp-wf-01",
    text: "Can you tell me what the plan for the day is?",
    targetCatalogId: catalogId("weak-form-realization"),
    phenomenon: "prosodic",
  },

  // --- rhythm / connected speech (high FL, prosodic) ---
  {
    identifier: "dp-rh-01",
    text: "I want to go to the store and pick up some things.",
    targetCatalogId: catalogId("rhythm-npvi"),
    phenomenon: "prosodic",
  },
];

/**
 * getDiagnosticPromptSet — 診断専用課題セットを返す。
 * 課題セットは固定だが、NonEmptyList 制約を満たしていることを実行時に保証する。
 * （配列定義が空になった場合に throw することで不変条件違反を早期検出する）
 */
export const getDiagnosticPromptSet = (): DiagnosticPromptSet => {
  const nonEmpty = createNonEmptyList(DIAGNOSTIC_PROMPTS);
  if (!nonEmpty) {
    throw new Error("DIAGNOSTIC_PROMPTS が空です。課題セットを定義してください。");
  }
  return { prompts: nonEmpty };
};
