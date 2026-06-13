/**
 * M-PG-4/5/6 受入: 進捗画面 e2e spec
 *
 * 実 DB 値駆動（seed helper 経由で progress_snapshots を直接 INSERT）で
 * /progress 画面が以下を満たすことを assert する:
 *
 * 1. scope-note 常時表示 (M-PG-6): スナップショット 0/1/複数いずれでも .scope-note が出る。
 * 2. スナップショット 0 件 (honest empty): 「進捗データがありません」表示。
 * 3. スナップショット 1 件 (M-PG-4/5):
 *    - .stage-track / .pg-grid / .radar-poly--now / .stats-row (.stat×4) / .cum-bar が描画される。
 *    - .radar-poly--prev が DOM に存在しない (M-PG-5a)。
 *    - focus 推移が 1 点 (sdot のみ / 偽の折れ線なし) (M-PG-5b)。
 *    - 訓練統計が「訓練データなし」(184min/26h/12日等の架空値が出ない) (M-PG-5c)。
 *    - 比較再生が「比較対象なし」表示 (M-PG-5d)。
 * 4. スナップショット 2 件 (prev あり):
 *    - .radar-poly--prev が描画される。
 *    - .ab-srcs + .player が描画される。
 *
 * 注意: sentinel learner を全テストで共有するため、各テストの beforeEach で
 *       cleanupAllProgressSnapshotsForSentinel() + seed を行い、
 *       テスト間の DB 干渉を防ぐ。
 *
 * spec 参照: docs/specs/progress-screen.md §M-PG-4/5/6
 */

import { test, expect } from "@playwright/test";
import {
  type ProgressSeedIdentifiers,
  seedProgressSnapshots,
  cleanupProgressSeed,
  cleanupAllProgressSnapshotsForSentinel,
} from "./helpers/seed";

// ---- スナップショット 0 件 ----

test.describe("progress: 0 件 (honest empty)", () => {
  let ids: ProgressSeedIdentifiers;

  test.beforeEach(() => {
    cleanupAllProgressSnapshotsForSentinel();
    ids = seedProgressSnapshots(0);
  });

  test.afterEach(() => {
    cleanupProgressSeed(ids);
  });

  test("scope-note が 0 件時も常時表示される (M-PG-6)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".scope-note")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".scope-note")).toContainText("読み上げ課題での改善");
  });

  test("0 件で honest empty が表示される", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.getByText("進捗データがありません")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".stage-track")).toHaveCount(0);
  });
});

// ---- スナップショット 1 件 ----

test.describe("progress: 1 件", () => {
  let ids: ProgressSeedIdentifiers;

  test.beforeEach(() => {
    cleanupAllProgressSnapshotsForSentinel();
    ids = seedProgressSnapshots(1);
  });

  test.afterEach(() => {
    cleanupProgressSeed(ids);
  });

  test("1 件で .stage-track / .pg-grid / .radar-poly--now / .stats-row / .cum-bar が描画される (M-PG-4)", async ({
    page,
  }) => {
    await page.goto("/progress");

    await expect(page.locator(".scope-note")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".scope-note")).toContainText("読み上げ課題での改善");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".pg-grid")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".radar-poly--now")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".stats-row")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".stat")).toHaveCount(4, { timeout: 10000 });
    await expect(page.locator(".cum-bar")).toBeVisible({ timeout: 10000 });
  });

  test("1 件で .radar-poly--prev が存在しない + 前回比なし注記 (M-PG-5a)", async ({
    page,
  }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    expect(await page.locator(".radar-poly--prev").count()).toBe(0);
    await expect(page.getByText("前回比なし")).toBeVisible({ timeout: 10000 });
  });

  test("1 件で focus 推移が単点のみ (M-PG-5b: 偽折れ線なし)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".spark-svg").first()).toBeVisible({ timeout: 10000 });
    expect(await page.locator(".spark-svg .sline").count()).toBe(0);
    expect(await page.locator(".spark-svg .sdot").count()).toBeGreaterThan(0);
  });

  test("1 件で訓練統計が honest empty (M-PG-5c: 架空値なし)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("訓練データなし").first()).toBeVisible({ timeout: 10000 });
    const statsText = await page.locator(".stats-row").textContent();
    expect(statsText).not.toContain("184");
    expect(statsText).not.toContain("26 h");
    expect(statsText).not.toContain("12 日");
  });

  test("1 件で比較再生が honest empty (M-PG-5d: 比較対象なし)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("比較対象なし")).toBeVisible({ timeout: 10000 });
    expect(await page.locator(".ab-srcs").count()).toBe(0);
  });
});

// ---- スナップショット 2 件 (prev あり) ----

test.describe("progress: 2 件 (prev あり)", () => {
  let ids: ProgressSeedIdentifiers;

  test.beforeEach(() => {
    cleanupAllProgressSnapshotsForSentinel();
    ids = seedProgressSnapshots(2);
  });

  test.afterEach(() => {
    cleanupProgressSeed(ids);
  });

  test("2 件で .radar-poly--prev が描画される (M-PG-5a prev あり)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".radar-poly--prev")).toBeVisible({ timeout: 10000 });
  });

  test("2 件で focus 推移に折れ線 (sline) が出る (M-PG-5b 複数点)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".spark-svg .sline").first()).toBeVisible({ timeout: 10000 });
  });

  test("2 件で .ab-srcs + .player が描画される (M-PG-5d 比較再生)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".ab-srcs")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".player")).toBeVisible({ timeout: 10000 });
  });

  test("2 件でも scope-note が常時表示される (M-PG-6)", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.locator(".stage-track")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".scope-note")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".scope-note")).toContainText("読み上げ課題での改善");
  });
});
