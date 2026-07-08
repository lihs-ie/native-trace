/**
 * M-SMOKE-a: workspace-v2 結果画面の v2 セレクタ描画確認
 *
 * seed で OSS Worker finding 付き（v2 フィールド入り）の解析結果を投入し、
 * workspace 結果画面で v2 固有セレクタが描画されることを確認する。
 *
 * spec 参照: docs/specs/pronunciation-feedback-v2-residuals.md § M-SMOKE-a
 */

import { type SeedIdentifiers, seedWorkspaceV2, cleanupSeed } from "./helpers/seed";
import { test, expect } from "@playwright/test";

let seedIds: SeedIdentifiers;

test.beforeAll(() => {
  seedIds = seedWorkspaceV2();
});

test.afterAll(() => {
  if (seedIds) {
    cleanupSeed(seedIds);
  }
});

test("workspace-v2: v2 selectors visible in result view", async ({ page }) => {
  // 結果画面への遷移
  // URL: /materials/{materialIdentifier}/sections/{sectionIdentifier}
  await page.goto(`/materials/${seedIds.material}/sections/${seedIds.section}`);

  // ページが「result」状態になるまで待機
  // WorkspaceResultV2 は resultsByEngine が 1 件以上あるときに描画される
  // ページが「解析結果」を表示するまで待つ (エンジン名 span が出る)
  // seedで投入したエンジンサマリーが表示されるまで待つ
  const engineSummary = page.locator(".eng-summary");
  await expect(engineSummary).toBeVisible({ timeout: 15000 });

  // ---- 3層フィードバック ----
  // finding がある状態で highlight を click → DetailPanelV2 が開く
  // まず「指摘ハイライト」ビューで mark をクリック
  const firstMark = page.locator(".mk").first();
  await expect(firstMark).toBeVisible({ timeout: 10000 });
  await firstMark.click();

  // 3層フィードバック行
  await expect(page.locator(".fb3-row--what")).toBeVisible();
  await expect(page.locator(".fb3-row--why")).toBeVisible();
  await expect(page.locator(".fb3-row--fix")).toBeVisible();

  // NBest 上位行
  await expect(page.locator(".nbest-row.is-top")).toBeVisible();

  // 信頼度インジケータ
  await expect(page.locator(".conf[data-level]")).toBeVisible();

  // ---- GOP ヒートマップ ----
  // view-toggle で "GOP ヒートマップ" を選択
  const gopToggle = page.locator(".sp-chip", { hasText: "GOP ヒートマップ" });
  await expect(gopToggle).toBeVisible();
  await gopToggle.click();

  // gopmap と gp セルが表示される
  await expect(page.locator(".gopmap .gp").first()).toBeVisible();

  // ---- サイドレール ----
  // mini-axis: 明瞭性/ネイティブ性スコア軸
  await expect(page.locator(".mini-axis .ma").first()).toBeVisible();

  // subscale: CEFR 3 下位尺度（cefrOverall/cefrSegmental/cefrProsodic が全て入っている）
  await expect(page.locator(".subscale").first()).toBeVisible();
});
