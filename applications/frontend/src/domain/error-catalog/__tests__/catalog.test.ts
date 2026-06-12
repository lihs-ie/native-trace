import { describe, it, expect } from "vitest";
import {
  getAllCatalogEntries,
  findCatalogEntry,
  findCatalogEntryById,
  type ErrorCatalogEntry,
  type FunctionalLoadRank,
} from "../index";

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
