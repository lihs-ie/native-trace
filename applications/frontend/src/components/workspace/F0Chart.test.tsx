/**
 * F0Chart コンポーネントテスト (M-F0REF-c / M-F0REF-d)
 *
 * Done When:
 * (a) referenceF0Contour 有りで path.f0-ref が描画される
 * (b) blind トグルで .f0-ref が隠れる
 * (c) referenceF0Contour=null で学習者 .f0-learner のみ描画され退行しない
 */

import { render, fireEvent, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { ProsodyDto } from "@/lib/api-types";
import { F0Chart } from "./F0Chart";

const buildProsodyWithReference = (): ProsodyDto => ({
  f0Contour: {
    timesMs: [0, 10, 20, 30, 40],
    valuesHz: [120, 130, 125, 0, 115],
  },
  referenceF0Contour: {
    timesMs: [0, 10, 20, 30, 40],
    valuesHz: [110, 120, 118, 0, 108],
  },
  wordStress: null,
  rhythmNpvi: null,
  referenceNpvi: null,
  weakFormRate: null,
});

const buildProsodyWithoutReference = (): ProsodyDto => ({
  f0Contour: {
    timesMs: [0, 10, 20, 30],
    valuesHz: [120, 130, 125, 115],
  },
  referenceF0Contour: null,
  wordStress: null,
  rhythmNpvi: null,
  referenceNpvi: null,
  weakFormRate: null,
});

describe("F0Chart", () => {
  // (a) referenceF0Contour 有りで path.f0-ref が描画される
  it("(a) renders path.f0-ref when referenceF0Contour is provided", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithReference()} />);

    const refPath = container.querySelector("path.f0-ref");
    expect(refPath).not.toBeNull();
    expect(refPath?.getAttribute("d")).toBeTruthy();
  });

  // (a) 学習者 .f0-learner も同一 SVG 内に描画される
  it("(a) renders path.f0-learner in the same SVG as f0-ref", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithReference()} />);

    const learnerPath = container.querySelector("path.f0-learner");
    const refPath = container.querySelector("path.f0-ref");
    expect(learnerPath).not.toBeNull();
    expect(refPath).not.toBeNull();

    // 両 path が同一 SVG 内に存在すること
    const svg = container.querySelector("svg.f0-svg");
    expect(svg).not.toBeNull();
    expect(svg?.contains(learnerPath)).toBe(true);
    expect(svg?.contains(refPath)).toBe(true);
  });

  // (b) blind トグルで .f0-ref が隠れる
  it("(b) hides f0-ref path when blind toggle is activated", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithReference()} />);
    const scope = within(container);

    // 初期状態: f0-ref が表示されている
    expect(container.querySelector("path.f0-ref")).not.toBeNull();

    // トグルボタンを押す
    const toggleButton = scope.getByRole("button", { name: /お手本を隠す/ });
    fireEvent.click(toggleButton);

    // blind 状態: f0-ref が DOM から消える
    expect(container.querySelector("path.f0-ref")).toBeNull();
  });

  // (b) blind トグルで .f0-learner は残る
  it("(b) keeps f0-learner visible in blind mode", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithReference()} />);
    const scope = within(container);

    const toggleButton = scope.getByRole("button", { name: /お手本を隠す/ });
    fireEvent.click(toggleButton);

    // 学習者輪郭は消えない
    expect(container.querySelector("path.f0-learner")).not.toBeNull();
  });

  // (b) blind 解除で .f0-ref が再表示される
  it("(b) shows f0-ref again when blind toggle is deactivated", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithReference()} />);
    const scope = within(container);

    const toggleButton = scope.getByRole("button", { name: /お手本を隠す/ });
    fireEvent.click(toggleButton); // 隠す
    fireEvent.click(toggleButton); // 表示する

    expect(container.querySelector("path.f0-ref")).not.toBeNull();
  });

  // (b) data-blind 属性が blind 時に設定される
  it("(b) sets data-blind attribute on f0card when blind is active", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithReference()} />);
    const scope = within(container);

    const card = container.querySelector(".f0card");
    expect(card?.getAttribute("data-blind")).toBeNull();

    const toggleButton = scope.getByRole("button", { name: /お手本を隠す/ });
    fireEvent.click(toggleButton);

    expect(card?.getAttribute("data-blind")).toBe("true");
  });

  // (c) referenceF0Contour=null で学習者のみ描画され退行しない
  it("(c) renders only f0-learner when referenceF0Contour is null", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithoutReference()} />);

    // 学習者輪郭は描画される
    expect(container.querySelector("path.f0-learner")).not.toBeNull();
    // お手本輪郭は描画されない
    expect(container.querySelector("path.f0-ref")).toBeNull();
  });

  // (c) blind トグルボタンは referenceF0Contour=null のとき表示されない
  it("(c) does not render blind toggle when referenceF0Contour is null", () => {
    const { container } = render(<F0Chart prosody={buildProsodyWithoutReference()} />);
    const scope = within(container);

    const toggleButton = scope.queryByRole("button", { name: /お手本を隠す/ });
    expect(toggleButton).toBeNull();
  });

  // (c) prosody=null で「データなし」を表示（退行しない）
  it("(c) shows empty state when prosody is null", () => {
    const { container } = render(<F0Chart prosody={null} />);

    expect(container.querySelector(".f0card")).not.toBeNull();
    expect(container.querySelector("path.f0-learner")).toBeNull();
    expect(container.querySelector("path.f0-ref")).toBeNull();
  });

  // (c) f0Contour が空配列のときも「データなし」を表示（退行しない）
  it("(c) shows empty state when f0Contour is empty", () => {
    const prosody: ProsodyDto = {
      f0Contour: { timesMs: [], valuesHz: [] },
      referenceF0Contour: { timesMs: [0, 10], valuesHz: [120, 130] },
      wordStress: null,
      rhythmNpvi: null,
      referenceNpvi: null,
      weakFormRate: null,
    };
    const { container } = render(<F0Chart prosody={prosody} />);

    expect(container.querySelector("path.f0-learner")).toBeNull();
    expect(container.querySelector("path.f0-ref")).toBeNull();
  });
});
