/**
 * Must-4 (FC-4): low_quality 状態でエンジン選択後に「録音し直す」を押すと
 * POST /api/v1/sections/:s/practice-attempts の multipart analysisMode が
 * ossWorkerOnly になることを page.route 横取りで assert する。
 *
 * spec 参照: docs/specs/<feature>.md § Must-4
 */

import { test, expect } from "@playwright/test";
import type { WorkspaceDto } from "../src/lib/api-types";

// fake media は chromium 専用
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
});

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "fake media is chromium-only",
);

const MATERIAL_ID = "M-test";
const SECTION_ID = "S-test";

/** low_quality 状態の WorkspaceDto。resultsByEngine が空なので deriveWorkspaceState → "low_quality" になる */
const LOW_QUALITY_WORKSPACE: WorkspaceDto = {
  section: {
    identifier: SECTION_ID,
    sectionSeries: "SS-test",
    version: 1,
    bodyText: "Hello world.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  sectionTokens: [],
  recordingAttempts: [],
  latestAnalysisRun: {
    identifier: "AR-test",
    status: "failed",
    errorCode: "low_quality_audio",
  },
  resultsByEngine: [],
  highlightRangesByEngine: [],
};

test("low_quality dock: OSS Worker 選択後に録音し直すと analysisMode が ossWorkerOnly で POST される", async ({
  page,
}) => {
  let capturedAnalysisMode: string | null = null;

  // workspace GET → low_quality 状態を返す
  await page.route(`**/api/v1/sections/${SECTION_ID}/workspace`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: LOW_QUALITY_WORKSPACE,
        meta: { requestIdentifier: "test-req-1" },
      }),
    });
  });

  // practice-attempts POST → 横取りして analysisMode を抽出
  await page.route(`**/api/v1/sections/${SECTION_ID}/practice-attempts`, (route) => {
    const postData = route.request().postData() ?? "";
    // multipart の name="analysisMode"\r\n\r\n<value>\r\n を正規表現で抽出
    const match = /name="analysisMode"\r\n\r\n([^\r\n]+)/.exec(postData);
    capturedAnalysisMode = match?.[1] ?? null;

    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          identifier: "PA-test",
          section: SECTION_ID,
          status: "ready",
          createdAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1000,
        },
        meta: { requestIdentifier: "test-req-2" },
      }),
    });
  });

  // ページ遷移
  await page.goto(`/materials/${MATERIAL_ID}/sections/${SECTION_ID}`);

  // low_quality dock が描画されるまで待機
  // dock-low-quality が CSS で visible になるのは data-state="low_quality" のとき
  const lowQualityDock = page.locator(".dock-low-quality");
  await expect(lowQualityDock).toBeVisible({ timeout: 15_000 });

  // dock 内の EngineSegSelector が描画されていることを確認
  const segItems = lowQualityDock.locator(".seg-item");
  await expect(segItems).toHaveCount(3, { timeout: 10_000 });

  // OSS Worker ボタン（data-eng="rust"）をクリック
  const ossWorkerButton = lowQualityDock.locator('.seg-item[data-eng="rust"]');
  await ossWorkerButton.click();

  // is-active クラスが付いたことを確認
  await expect(ossWorkerButton).toHaveClass(/is-active/);

  // 「録音し直す」ボタンをクリック → recording 状態へ
  const rerecordButton = lowQualityDock.locator('button:has-text("録音し直す")');
  await rerecordButton.click();

  // dock-rec が visible になるまで待機（recording 状態）
  const recDock = page.locator(".dock-rec");
  await expect(recDock).toBeVisible({ timeout: 10_000 });

  // 停止ボタンをクリック → onstop → submitRecording → POST
  const stopButton = recDock.locator(".stop-go");
  await expect(stopButton).toBeVisible({ timeout: 5_000 });
  await stopButton.click();

  // POST の analysisMode が ossWorkerOnly であることを assert
  await expect
    .poll(() => capturedAnalysisMode, { timeout: 15_000 })
    .toBe("ossWorkerOnly");
});
