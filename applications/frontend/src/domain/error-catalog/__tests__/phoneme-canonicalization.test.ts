/**
 * phoneme-canonicalization unit tests — ADR-020 D6 (M-HOW-11)
 *
 * fixture 規則: BARE IPA 形式のみ（"ɾ"）。"[ɾ]" 形式の fixture は使わない
 * （unit-fixtures-must-mirror-real-worker-shape: worker は bare IPA を出す）。
 */

import { describe, it, expect } from "vitest";
import {
  normalizeIpaSymbol,
  canonicalizePhoneme,
  PHONEME_ALIASES,
} from "../phoneme-canonicalization";

describe("normalizeIpaSymbol", () => {
  it("brackets stripped: [ɾ] → ɾ", () => {
    expect(normalizeIpaSymbol("[ɾ]")).toBe("ɾ");
  });

  it("slashes stripped: /l/ → l", () => {
    expect(normalizeIpaSymbol("/l/")).toBe("l");
  });

  it("bare symbol unchanged: ɾ → ɾ", () => {
    expect(normalizeIpaSymbol("ɾ")).toBe("ɾ");
  });

  it("trims whitespace", () => {
    expect(normalizeIpaSymbol("  ɾ  ")).toBe("ɾ");
  });
});

describe("PHONEME_ALIASES", () => {
  it("ɹ maps to ɾ", () => {
    expect(PHONEME_ALIASES["ɹ"]).toBe("ɾ");
  });

  it("r maps to ɾ", () => {
    expect(PHONEME_ALIASES["r"]).toBe("ɾ");
  });
});

describe("canonicalizePhoneme — M-HOW-5 acceptance (bare fixtures only)", () => {
  it('bare ɾ → ɾ (no-op, already canonical)', () => {
    expect(canonicalizePhoneme("ɾ")).toBe("ɾ");
  });

  it('[ɾ] → ɾ (bracket removal, then no alias)', () => {
    // "[ɾ]" stripped to "ɾ", no alias → stays "ɾ"
    expect(canonicalizePhoneme("[ɾ]")).toBe("ɾ");
  });

  it('ɹ → ɾ (alias: retroflex approximant → flap)', () => {
    expect(canonicalizePhoneme("ɹ")).toBe("ɾ");
  });

  it('r → ɾ (alias: latin r → flap)', () => {
    expect(canonicalizePhoneme("r")).toBe("ɾ");
  });

  it('l is not aliased', () => {
    expect(canonicalizePhoneme("l")).toBe("l");
  });

  it('/l/ slash-form → l', () => {
    expect(canonicalizePhoneme("/l/")).toBe("l");
  });
});
