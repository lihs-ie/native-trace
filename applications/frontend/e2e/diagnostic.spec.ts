/**
 * M-DG-5 受入: 診断画面 e2e spec
 *
 * 1. 結果画面: 完了済み DiagnosticSession + WeaknessProfile を seed →
 *    /diagnostic/{id}/result を開き、実 DB 値を反映した
 *    .stage-track / .subscale×3 / .focus-grid>.focus-tile が描画されることを assert。
 *    focus tile の priority 順・ラベルが seed 値と一致することを確認。
 *
 * 2. 診断中画面: pending DiagnosticSession を seed →
 *    /diagnostic/{id} を開き、
 *    .dg / .passage / .phen / .cov / .cov-row / .dg-prog / .rec-btn が描画されることを assert。
 *
 * 注: 実録音 (getUserMedia) / 実 analyzer は e2e では起動しない。
 *     録音→導出の実フロー検証は runtime-verifier(API レベル)が別途行う。
 *     e2e は UI 描画 + データ駆動の確認に限定。
 *
 * spec 参照: docs/specs/diagnostic-screen.md § M-DG-5
 */

import {
  type DiagnosticSeedIdentifiers,
  seedCompletedDiagnosticSession,
  seedPendingDiagnosticSession,
  cleanupDiagnosticSeed,
} from "./helpers/seed";
import { test, expect } from "@playwright/test";

// ---- 結果画面テスト ----

let completedIds: DiagnosticSeedIdentifiers;

test.beforeAll(() => {
  completedIds = seedCompletedDiagnosticSession();
});

test.afterAll(() => {
  if (completedIds) {
    cleanupDiagnosticSeed(completedIds);
  }
});

test("diagnostic result: stage-track / subscale×3 / focus-tile が実 DB 値で描画される", async ({
  page,
}) => {
  await page.goto(`/diagnostic/${completedIds.diagnosticSession}/result`);

  // Stage 判定トラック
  const stageTrack = page.locator(".stage-track");
  await expect(stageTrack).toBeVisible({ timeout: 15000 });

  // CEFR 3 下位尺度 — seed は overall/segmental/prosodic を全て持つ
  const subscales = page.locator(".subscale");
  await expect(subscales).toHaveCount(3, { timeout: 10000 });

  // focus-grid と focus-tile — seed は 3 件の focusSounds を持つ
  const focusGrid = page.locator(".focus-grid");
  await expect(focusGrid).toBeVisible({ timeout: 10000 });

  const focusTiles = page.locator(".focus-grid .focus-tile");
  await expect(focusTiles).toHaveCount(3, { timeout: 10000 });

  // 最高 priority タイルが is-now クラスを持つ (priority=0.74 → Now)
  const firstTile = focusTiles.nth(0);
  await expect(firstTile).toHaveClass(/is-now/);

  // focus-pair が seed の contrast 値を含む
  const firstFocusPair = firstTile.locator(".focus-pair").first();
  await expect(firstFocusPair).toContainText("/l/");

  // FL rank が seed の functionalLoadRank を反映
  const firstFlSpan = firstTile.locator(".fl[data-rank]").first();
  await expect(firstFlSpan).toHaveAttribute("data-rank", "max");

  // prio ラベルが priority 値に対応している
  const firstPrio = firstTile.locator(".prio").first();
  await expect(firstPrio).toContainText("Now");

  // 2 番目の tile は "Next" ラベル (priority=0.545)
  const secondTile = focusTiles.nth(1);
  const secondPrio = secondTile.locator(".prio").first();
  await expect(secondPrio).toContainText("Next");
});

// ---- 診断中画面テスト ----

let pendingIds: DiagnosticSeedIdentifiers;

// pending テストは独立した before/after を持つ
// Playwright の test.describe で分離する
test.describe("diagnostic in-progress", () => {
  test.beforeAll(() => {
    pendingIds = seedPendingDiagnosticSession();
  });

  test.afterAll(() => {
    if (pendingIds) {
      cleanupDiagnosticSeed(pendingIds);
    }
  });

  test("diagnostic in-progress: .dg / .passage / .phen / .cov-row / .dg-prog / .rec-btn が描画される", async ({
    page,
  }) => {
    // sessionStorage に診断セッション情報を書き込む (page.tsx が期待する形式)
    const promptSet = {
      prompts: [
        {
          identifier: "prompt-seg-01",
          text: "The right light was placed on the street corner.",
          targetCatalogId: "SUB-l-r",
          phenomenon: "segmental",
        },
        {
          identifier: "prompt-epe-01",
          text: "Please stop at the next station.",
          targetCatalogId: "EPN-sC",
          phenomenon: "epenthesis",
        },
        {
          identifier: "prompt-pro-01",
          text: "I believe the project will succeed.",
          targetCatalogId: null,
          phenomenon: "prosodic",
        },
      ],
    };
    const sessionData = {
      identifier: pendingIds.diagnosticSession,
      status: "pending",
      promptSet,
      startedAt: new Date().toISOString(),
      completedAt: null,
      weaknessProfileIdentifier: null,
    };

    // ページを開く前に sessionStorage を設定するため about:blank に遷移してから書き込む
    await page.goto("/");
    await page.evaluate(
      ([key, value]) => {
        sessionStorage.setItem(key, value);
      },
      [
        `diagnostic-session-${pendingIds.diagnosticSession}`,
        JSON.stringify(sessionData),
      ] as [string, string],
    );

    await page.goto(`/diagnostic/${pendingIds.diagnosticSession}`);

    // .dg コンテナ
    const dgContainer = page.locator(".dg");
    await expect(dgContainer).toBeVisible({ timeout: 15000 });

    // プロンプトテキスト (.passage)
    const passage = page.locator(".passage");
    await expect(passage).toBeVisible({ timeout: 10000 });
    await expect(passage).toContainText("The right light was placed on the street corner.");

    // phenomenon チップ (.phen)
    const phenChip = page.locator(".phen").first();
    await expect(phenChip).toBeVisible({ timeout: 10000 });

    // カバレッジ rail (.cov と .cov-row)
    const covContainer = page.locator(".cov");
    await expect(covContainer).toBeVisible({ timeout: 10000 });

    const covRows = page.locator(".cov-row");
    await expect(covRows).toHaveCount(3, { timeout: 10000 });

    // 進捗インジケータ (.dg-prog)
    const dgProg = page.locator(".dg-prog");
    await expect(dgProg).toBeVisible({ timeout: 10000 });
    await expect(dgProg).toContainText("1 / 3");

    // 録音ボタン (.rec-btn)
    const recButton = page.locator(".rec-btn");
    await expect(recButton).toBeVisible({ timeout: 10000 });
  });
});
