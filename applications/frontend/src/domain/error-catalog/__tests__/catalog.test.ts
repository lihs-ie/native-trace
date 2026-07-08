import { describe, it, expect } from "vitest";
import {
  getAllCatalogEntries,
  findCatalogEntry,
  findCatalogEntryById,
  findStepsForSubstitute,
  type ErrorCatalogEntry,
  type FunctionalLoadRank,
} from "../index";
import { canonicalizePhoneme } from "../phoneme-canonicalization";
// Read-only import from parallel D5 track — only HIGH_PRIORITY_PHONEME_SET is used
import { HIGH_PRIORITY_PHONEME_SET } from "../../../lib/articulation-data";

const MINIMUM_CATALOG_ENTRY_COUNT = 17;

const VALID_FUNCTIONAL_LOAD_RANKS: ReadonlyArray<FunctionalLoadRank> = [
  "max",
  "high",
  "mid",
  "low",
];

const VALID_KINDS = ["segmental", "syllabic", "prosodic"] as const;

const VALID_EVIDENCE_STRENGTHS = ["high", "mid", "low"] as const;

const VALID_INTELLIGIBILITY_IMPACTS = ["high", "mid", "low"] as const;

const VALID_RECOMMENDED_TRAINING_KINDS = ["perception", "articulation", "prosody"] as const;

describe("japanese-l1-catalog", () => {
  describe("getAllCatalogEntries", () => {
    it("カタログが17項目以上含まれること", () => {
      const entries = getAllCatalogEntries();
      expect(entries.length).toBeGreaterThanOrEqual(MINIMUM_CATALOG_ENTRY_COUNT);
    });

    it("各エントリが8必須フィールドを全て持ち非空であること", () => {
      const entries = getAllCatalogEntries();
      for (const entry of entries) {
        // id
        expect(typeof entry.id).toBe("string");
        expect(entry.id.trim().length).toBeGreaterThan(0);

        // kind
        expect(VALID_KINDS).toContain(entry.kind);

        // targetPhoneme
        expect(typeof entry.targetPhoneme).toBe("string");
        expect(entry.targetPhoneme.trim().length).toBeGreaterThan(0);

        // l1MechanismJa
        expect(typeof entry.l1MechanismJa).toBe("string");
        expect(entry.l1MechanismJa.trim().length).toBeGreaterThan(0);

        // functionalLoad
        expect(VALID_FUNCTIONAL_LOAD_RANKS).toContain(entry.functionalLoad);

        // intelligibilityImpact
        expect(VALID_INTELLIGIBILITY_IMPACTS).toContain(entry.intelligibilityImpact);

        // evidenceStrength
        expect(VALID_EVIDENCE_STRENGTHS).toContain(entry.evidenceStrength);

        // evidenceIds (非空配列)
        expect(Array.isArray(entry.evidenceIds)).toBe(true);
        expect(entry.evidenceIds.length).toBeGreaterThan(0);
        for (const evidenceId of entry.evidenceIds) {
          expect(typeof evidenceId).toBe("string");
          expect(evidenceId.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("recommendedTraining が有効な値のみで構成されること", () => {
      const entries = getAllCatalogEntries();
      for (const entry of entries) {
        expect(Array.isArray(entry.recommendedTraining)).toBe(true);
        for (const trainingKind of entry.recommendedTraining) {
          expect(VALID_RECOMMENDED_TRAINING_KINDS).toContain(trainingKind);
        }
      }
    });

    it("functionalLoad が有効なランク値であること", () => {
      const entries = getAllCatalogEntries();
      for (const entry of entries) {
        expect(VALID_FUNCTIONAL_LOAD_RANKS).toContain(entry.functionalLoad);
      }
    });

    it("カタログに子音7種が含まれること", () => {
      const entries = getAllCatalogEntries();
      const segmentalEntries = entries.filter((entry) => entry.kind === "segmental");
      expect(segmentalEntries.length).toBeGreaterThanOrEqual(7);
    });

    it("カタログに母音5種が含まれること", () => {
      const entries = getAllCatalogEntries();
      // 母音系エントリ: æ, iː, ə, 長短, schwa等
      const vowelEntries = entries.filter(
        (entry) =>
          entry.kind === "segmental" &&
          (entry.targetPhoneme.includes("æ") ||
            entry.targetPhoneme.includes("iː") ||
            entry.targetPhoneme.includes("ə") ||
            entry.targetPhoneme.includes("ɑ") ||
            entry.targetPhoneme.includes("V")),
      );
      expect(vowelEntries.length).toBeGreaterThanOrEqual(5);
    });

    it("カタログに母音挿入(epenthesis)エントリが含まれること", () => {
      const entries = getAllCatalogEntries();
      const epenthesisEntry = entries.find((entry) => entry.kind === "syllabic");
      expect(epenthesisEntry).toBeDefined();
    });

    it("カタログに韻律4種が含まれること", () => {
      const entries = getAllCatalogEntries();
      const prosodicEntries = entries.filter((entry) => entry.kind === "prosodic");
      expect(prosodicEntries.length).toBeGreaterThanOrEqual(4);
    });

    it("articulation フィールドが存在する場合は mannerJa と stepsJa を持つこと", () => {
      const entries = getAllCatalogEntries();
      for (const entry of entries) {
        if (entry.articulation !== null) {
          expect(typeof entry.articulation.mannerJa).toBe("string");
          expect(entry.articulation.mannerJa.trim().length).toBeGreaterThan(0);
          expect(Array.isArray(entry.articulation.stepsJa)).toBe(true);
          expect(entry.articulation.stepsJa.length).toBeGreaterThan(0);
        }
      }
    });

    it("id が全エントリでユニークであること", () => {
      const entries = getAllCatalogEntries();
      const identifiers = entries.map((entry) => entry.id);
      const uniqueIdentifiers = new Set(identifiers);
      expect(uniqueIdentifiers.size).toBe(identifiers.length);
    });
  });

  describe("findCatalogEntryById", () => {
    it("存在するIDでエントリを取得できること", () => {
      const entry = findCatalogEntryById("l-r-substitution");
      expect(entry).not.toBeNull();
      expect(entry?.id).toBe("l-r-substitution");
    });

    it("存在しないIDでは null を返すこと", () => {
      const entry = findCatalogEntryById("non-existent-id-xyz");
      expect(entry).toBeNull();
    });

    it("epenthesis エントリが取得できること", () => {
      const entry = findCatalogEntryById("epenthesis");
      expect(entry).not.toBeNull();
      expect(entry?.kind).toBe("syllabic");
    });

    it("lexical-stress-error エントリが取得できること", () => {
      const entry = findCatalogEntryById("lexical-stress-error");
      expect(entry).not.toBeNull();
      expect(entry?.kind).toBe("prosodic");
    });
  });

  describe("findCatalogEntry", () => {
    it("contrast で検索できること", () => {
      const entry = findCatalogEntry("substitution", "/l/-/r/");
      expect(entry).not.toBeNull();
      expect(entry?.contrast).toBe("/l/-/r/");
    });

    it("contrast null でも検索できること", () => {
      const entry = findCatalogEntry("epenthesis", null);
      expect(entry).not.toBeNull();
    });

    it("存在しない phenomenon では null を返すこと", () => {
      const entry = findCatalogEntry("non-existent-phenomenon-xyz", "/x/-/y/");
      expect(entry).toBeNull();
    });
  });

  describe("カタログ内容の整合性", () => {
    it("l-r-substitution が functionalLoad=max かつ intelligibilityImpact=high であること (E-9)", () => {
      const entry = findCatalogEntryById("l-r-substitution");
      expect(entry).not.toBeNull();
      expect(entry?.functionalLoad).toBe("max");
      expect(entry?.intelligibilityImpact).toBe("high");
    });

    it("theta-s-substitution が functionalLoad=low であること (E-9: /θ/ は低FL)", () => {
      const entry = findCatalogEntryById("theta-s-substitution");
      expect(entry).not.toBeNull();
      expect(entry?.functionalLoad).toBe("low");
    });

    it("epenthesis が evidenceIds に E-11 を含むこと", () => {
      const entry = findCatalogEntryById("epenthesis");
      expect(entry).not.toBeNull();
      expect(entry?.evidenceIds).toContain("E-11");
    });

    it("l-r-substitution が evidenceIds に E-8 と E-9 を含むこと", () => {
      const entry = findCatalogEntryById("l-r-substitution");
      expect(entry).not.toBeNull();
      expect(entry?.evidenceIds).toContain("E-8");
      expect(entry?.evidenceIds).toContain("E-9");
    });

    it("l-r-substitution が articulation.stepsJa に舌先の調音手順を含むこと (B-2 ELSA水準)", () => {
      const entry = findCatalogEntryById("l-r-substitution");
      expect(entry).not.toBeNull();
      expect(entry?.articulation).not.toBeNull();
      // ELSA水準: 舌先を歯茎に当てる手順が含まれること
      const steps = entry?.articulation?.stepsJa.join(" ") ?? "";
      expect(steps).toContain("舌先");
    });
  });

  describe("型安全性", () => {
    it("getAllCatalogEntries の戻り値が ErrorCatalogEntry[] と互換であること", () => {
      const entries: ReadonlyArray<ErrorCatalogEntry> = getAllCatalogEntries();
      expect(entries).toBeDefined();
    });
  });
});

/**
 * findStepsForSubstitute unit tests — ADR-020 D6 (M-HOW-5)
 * fixture 規則: BARE IPA 形式のみ（"ɾ"）。"[ɾ]" は使わない。
 */
describe("findStepsForSubstitute", () => {
  // 最小限の fixture: substituteVariants を持つエントリ
  const variantSteps = ["バリアントステップ1", "バリアントステップ2", "バリアントステップ3"];
  const genericSteps = ["汎用ステップ1", "汎用ステップ2"];
  const entryWithVariant: ErrorCatalogEntry = {
    id: "test-substitution",
    kind: "segmental",
    targetPhoneme: "/l/",
    contrast: "/l/-/r/",
    confusionSet: ["[ɾ]"],
    l1MechanismJa: "テスト用",
    functionalLoad: "max",
    intelligibilityImpact: "high",
    recommendedTraining: ["articulation"],
    evidenceStrength: "high",
    evidenceIds: ["E-8"],
    articulation: {
      mannerJa: "テスト調音",
      stepsJa: genericSteps,
      substituteVariants: {
        ɾ: variantSteps, // BARE IPA キー
      },
    },
  };

  const entryWithoutVariants: ErrorCatalogEntry = {
    ...entryWithVariant,
    id: "test-no-variants",
    articulation: {
      mannerJa: "テスト調音",
      stepsJa: genericSteps,
    },
  };

  const entryWithNullArticulation: ErrorCatalogEntry = {
    ...entryWithVariant,
    id: "test-null-articulation",
    articulation: null,
  };

  it("bare ɾ detectedTopCandidate → variant steps (≠ stepsJa)", () => {
    const result = findStepsForSubstitute(entryWithVariant, "ɾ");
    expect(result).toEqual(variantSteps);
    expect(result).not.toEqual(genericSteps);
  });

  it("null detectedTopCandidate → stepsJa (後方互換)", () => {
    const result = findStepsForSubstitute(entryWithVariant, null);
    expect(result).toEqual(genericSteps);
  });

  it("unmatched detectedTopCandidate ('p') → stepsJa", () => {
    const result = findStepsForSubstitute(entryWithVariant, "p");
    expect(result).toEqual(genericSteps);
  });

  it("entry without substituteVariants + ɾ → stepsJa", () => {
    const result = findStepsForSubstitute(entryWithoutVariants, "ɾ");
    expect(result).toEqual(genericSteps);
  });

  it("entry with null articulation + ɾ → empty array", () => {
    const result = findStepsForSubstitute(entryWithNullArticulation, "ɾ");
    expect(result).toEqual([]);
  });

  it("ɹ alias is resolved to ɾ → variant steps hit", () => {
    // ɹ は PHONEME_ALIASES で ɾ に正規化される
    const result = findStepsForSubstitute(entryWithVariant, "ɹ");
    expect(result).toEqual(variantSteps);
  });

  it("r alias is resolved to ɾ → variant steps hit", () => {
    // ラテン文字 r も ɾ に正規化される
    const result = findStepsForSubstitute(entryWithVariant, "r");
    expect(result).toEqual(variantSteps);
  });
});

/**
 * catalog coverage tests — ADR-020 D6 (M-HOW-11a)
 * HIGH_PRIORITY_PHONEME_SET の各音素に対応する catalog エントリが存在することを assert。
 *
 * "カバー" の定義: targetPhoneme に完全一致、または contrast 文字列に含まれる。
 * /ʌ/ は ae-a-substitution の contrast "/æ/-/ʌ/" に含まれ、
 * /ɪ/ は iː-ɪ-substitution の contrast "/iː/-/ɪ/" に含まれる（targetPhoneme 単独エントリなし）。
 * 主目的: /f/ のように catalog に一切存在しない音素の write-time 検出（D3 で追加済み）。
 */
describe("catalog coverage (HIGH_PRIORITY_PHONEME_SET)", () => {
  /** phoneme がカタログのいずれかのエントリでカバーされているか判定する */
  const isCoveredByCatalog = (
    entries: ReadonlyArray<ErrorCatalogEntry>,
    phoneme: string,
  ): boolean =>
    entries.some(
      (entry) =>
        entry.targetPhoneme === phoneme ||
        (entry.contrast !== null && entry.contrast.includes(phoneme)),
    );

  it("HIGH_PRIORITY_PHONEME_SET の全音素がカタログ内のいずれかのエントリでカバーされていること", () => {
    const entries = getAllCatalogEntries();
    for (const phoneme of HIGH_PRIORITY_PHONEME_SET) {
      const covered = isCoveredByCatalog(entries, phoneme);
      expect(covered, `catalog missing coverage for phoneme="${phoneme}"`).toBe(true);
    }
  });

  it("/f/ に対応する targetPhoneme エントリが存在すること（D3 f-h-substitution 追加確認）", () => {
    const entries = getAllCatalogEntries();
    const fEntry = entries.find((entry) => entry.targetPhoneme === "/f/");
    expect(fEntry).toBeDefined();
    expect(fEntry?.id).toBe("f-h-substitution");
  });
});

/**
 * substituteVariants 整合テスト — ADR-020 D6 (M-HOW-11b)
 * 各エントリの substituteVariants キー（canonicalize 済み）が confusionSet（canonicalize 済み）の
 * 部分集合であることを assert（孤児バリアント + 括弧揺れ防止）。
 */
describe("substituteVariants integrity", () => {
  it("各エントリの substituteVariants キー（canonical）が confusionSet（canonical）の部分集合であること", () => {
    const entries = getAllCatalogEntries();
    for (const entry of entries) {
      if (entry.articulation?.substituteVariants === undefined) continue;

      const canonicalConfusionSet = new Set(
        entry.confusionSet.map((symbol) => canonicalizePhoneme(symbol)),
      );
      const variantKeys = Object.keys(entry.articulation.substituteVariants);

      for (const key of variantKeys) {
        const canonicalKey = canonicalizePhoneme(key);
        expect(
          canonicalConfusionSet.has(canonicalKey),
          `entry "${entry.id}": substituteVariants key "${key}" (canonical: "${canonicalKey}") is not in confusionSet (canonical: ${JSON.stringify([...canonicalConfusionSet])})`,
        ).toBe(true);
      }
    }
  });
});
