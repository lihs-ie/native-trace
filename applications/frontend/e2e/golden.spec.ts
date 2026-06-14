/**
 * M-GRV-7 / M-GRV-8 / M-GRV-9: workspace A/B golden source の browser E2E。
 *
 * golden 変換 API (worker /golden-speaker/convert) を page.route で mock し、
 * 画面の golden ボタン → 再生/フォールバック挙動を real entrypoint (App Router workspace) で assert する。
 * 実 RVC 変換そのものは golden/worker 層の live 検証で別途確認済 (runtime-verify.json)。
 *
 * spec 参照: docs/specs/golden-rvc.md § M-GRV-7 / M-GRV-8 / M-GRV-9
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

// 学習者音声取得 API を mock する (golden 変換の前段)
const mockLearnerAudio = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.route("**/api/v1/recording-attempts/*/audio", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/webm",
      body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    }),
  );
};

const gotoWorkspace = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto(`/materials/${seedIds.material}/sections/${seedIds.section}`);
  await expect(page.locator(".eng-summary")).toBeVisible({ timeout: 15000 });
};

test("M-GRV-7/8: golden 変換成功で再生し ab_usage_logs に記録する", async ({ page }) => {
  await mockLearnerAudio(page);

  // 品質ゲート通過 + 変換音声を返す worker convert を mock
  await page.route("**/api/v1/golden-speaker/convert", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          // 最小の有効な base64 WAV ヘッダ (atob 可能)
          audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
          qualityGatePassed: true,
          withholdReason: null,
          targetVoice: "p231",
        },
      }),
    }),
  );

  // M-GRV-8: golden 再生で ab_usage_logs に source=golden が記録されることを捕捉
  const usageLogPromise = page.waitForRequest(
    (req) =>
      req.url().includes("/api/v1/ab-usage-logs") &&
      req.method() === "POST" &&
      (req.postData() ?? "").includes("golden"),
    { timeout: 10000 },
  );

  await gotoWorkspace(page);

  // golden A/B ソースを選択 → 再生ボタン
  await page.locator(".ab-src", { hasText: "Golden" }).click();
  await page.locator("button.pp[aria-label]").click();

  const usageRequest = await usageLogPromise;
  expect(usageRequest.postData() ?? "").toContain("golden");

  // 品質ゲート通過時は .gs-gate (withhold) を出さない
  await expect(page.locator(".gs-gate")).toHaveCount(0);
});

test("M-GRV-7/9: 品質ゲート不通過で .gs-gate を出し self/model は無退行", async ({ page }) => {
  await mockLearnerAudio(page);

  // 品質ゲート不通過 (withhold) を返す worker convert を mock
  await page.route("**/api/v1/golden-speaker/convert", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          audioBase64: null,
          qualityGatePassed: false,
          withholdReason: "quality_gate_failed",
          targetVoice: "p231",
        },
      }),
    }),
  );

  await gotoWorkspace(page);

  // golden 選択 → 再生 → withhold メッセージが .gs-gate に出る (ORPHAN-4: 壊れた音声を再生しない)
  await page.locator(".ab-src", { hasText: "Golden" }).click();
  await page.locator("button.pp[aria-label]").click();

  const gate = page.locator(".gs-gate");
  await expect(gate).toBeVisible({ timeout: 10000 });
  await expect(gate).toContainText("quality_gate_failed");

  // M-GRV-9 無退行: golden 失敗後も self/model ソースに切替でき画面が壊れない
  await page.locator(".ab-src", { hasText: "自分" }).click();
  await expect(page.locator(".ab-src.is-active", { hasText: "自分" })).toBeVisible();
  await expect(page.locator(".eng-summary")).toBeVisible();
  await page.locator(".ab-src", { hasText: "お手本" }).click();
  await expect(page.locator(".ab-src.is-active", { hasText: "お手本" })).toBeVisible();
});
