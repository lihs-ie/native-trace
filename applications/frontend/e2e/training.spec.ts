/**
 * 訓練画面 (/training) の browser E2E — #33 (training の Playwright e2e / test-coverage debt)。
 *
 * golden.spec.ts のパターンを流用し、訓練 API (App Router route handlers) を page.route で mock して
 * real entrypoint (App Router /training 画面) の観測可能挙動を assert する。
 * 実 HVPT 刺激調達・実 worker 採点・実ラグ計測そのものは analyzer/worker 層の live 検証で別途確認済
 * (runtime-verify-hvpt.json / runtime-verify.json)。本 E2E は UI 配線とデータ駆動描画を固定する。
 *
 * spec 参照: docs/specs/training-screen.md
 *   - M-TR-6 (HVPT 識別課題が実刺激で動作 — forced-choice / 正誤 FB / 正解音再生 / trial 数・正答率が実データ)
 *   - M-TR-8 (training 画面が training.html / design-system-v2 §11 hvpt・§12 sched に合致 / 表示値が実データ駆動)
 *   - M-TR-7 (シャドーイング UI skeleton — .two-col / .passage / .player / .lag)
 *
 * worker/analyzer 非依存: 全訓練 API を mock するため Next.js dev server 単体で動作する。
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const PROFILE_ID = "E2E_WP_TRAINING_FIXED";

// 最小の有効な base64 WAV ヘッダ (atob 可能・<audio> が data URL として受理する)
const TINY_WAV = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

// ---- mock レスポンス (静的 HTML の固定値 12/40・78%・184min とは別の値を使い、データ駆動を立証する) ----

const buildScheduleResponse = (now: Date) => ({
  schedules: [
    {
      identifier: "sch-done",
      contrast: "/l/·/r/",
      state: "done",
      nextPresentationAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      recentAccuracy: 0.74,
    },
    {
      identifier: "sch-rest",
      contrast: "/æ/·/ʌ/",
      state: "rest",
      nextPresentationAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      recentAccuracy: null,
    },
    {
      identifier: "sch-due",
      contrast: "/l/·/r/",
      state: "due",
      nextPresentationAt: now.toISOString(),
      recentAccuracy: null,
    },
    {
      identifier: "sch-gate",
      contrast: "/æ/·/ʌ/",
      state: "gate",
      nextPresentationAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      recentAccuracy: 0.42,
    },
  ],
  // 137min → formatMinutes = "2h 17min" (静的 HTML の 184min="3h 4min" とは別値)
  cumulativeTrainingMinutes: 137,
});

const buildSessionResponse = () => ({
  trainingSessionIdentifier: "ts-e2e-1",
  contrast: "/l/·/r/",
  stimuli: [
    {
      stimulusIdentifier: "stim-1",
      wavBase64: TINY_WAV,
      metadata: {
        stimulusIdentifier: "stim-1",
        contrast: "/l/·/r/",
        word: "対立語1",
        speakerIdentifier: "S3",
        speakerSex: "female",
        context: "語頭",
        sourceCorpus: "VCTK",
        licenseIdentifier: "CC-BY-4.0",
      },
      // choices[0] が正解ラベル (page は correctChoice=choices[0] を送る)
      choices: [
        { type: "spelling", value: "light" },
        { type: "spelling", value: "right" },
      ],
    },
    {
      stimulusIdentifier: "stim-2",
      wavBase64: TINY_WAV,
      metadata: {
        stimulusIdentifier: "stim-2",
        contrast: "/l/·/r/",
        word: "対立語2",
        speakerIdentifier: "S5",
        speakerSex: "male",
        context: "語中",
        sourceCorpus: "LibriTTS",
        licenseIdentifier: "CC-BY-4.0",
      },
      choices: [
        { type: "spelling", value: "rake" },
        { type: "spelling", value: "lake" },
      ],
    },
    {
      stimulusIdentifier: "stim-3",
      wavBase64: TINY_WAV,
      metadata: {
        stimulusIdentifier: "stim-3",
        contrast: "/l/·/r/",
        word: "対立語3",
        speakerIdentifier: "S6",
        speakerSex: "female",
        context: "クラスター",
        sourceCorpus: "VCTK",
        licenseIdentifier: "CC-BY-4.0",
      },
      choices: [
        { type: "spelling", value: "glass" },
        { type: "spelling", value: "grass" },
      ],
    },
  ],
});

const buildDrillResponse = () => ({
  trainingSessionIdentifier: "ts-e2e-1",
  catalogId: "SUB-l-r",
  contrast: "/l/·/r/",
  targetPhonemes: ["l", "r"],
  minimalPairs: [
    {
      targetWord: "light",
      contrastWord: "right",
      targetPhonemeIpa: "/l/",
      contrastPhonemeIpa: "/r/",
    },
  ],
  exampleSentence: "The light on the right is bright.",
  exampleTargetPhonemeIpas: ["/l/"],
  hintJa: "舌先を上の歯茎につけて /l/ を発音します",
});

const fulfillJson = (route: Route, data: unknown): Promise<void> =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });

/**
 * 訓練 API を全て mock する。worker/analyzer に依存せず UI 配線を検証するため、
 * page.route でブラウザ fetch を route handler 到達前に横取りする。
 */
const mockTrainingApi = async (page: Page): Promise<void> => {
  const now = new Date();

  await page.route("**/api/v1/training/schedule", (route) =>
    fulfillJson(route, buildScheduleResponse(now)),
  );

  await page.route("**/api/v1/training/drills", (route) => fulfillJson(route, buildDrillResponse()));

  await page.route("**/api/v1/training/hvpt-sessions", (route) =>
    fulfillJson(route, buildSessionResponse()),
  );

  // 試行提出: request body の correctLabelValue / responseLabelValue から correct を honest に導出する
  await page.route("**/api/v1/training/hvpt-sessions/*/trials", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      correctLabelType?: string;
      correctLabelValue?: string;
      responseLabelValue?: string;
      correctStimulusWavBase64?: string;
    };
    return fulfillJson(route, {
      hvptTrialIdentifier: `tr-${body.responseLabelValue ?? "x"}`,
      correct: body.responseLabelValue === body.correctLabelValue,
      correctLabel: { type: body.correctLabelType ?? "spelling", value: body.correctLabelValue ?? "" },
      correctStimulusWavBase64: body.correctStimulusWavBase64 ?? TINY_WAV,
    });
  });

  // セッション完了: 静的 HTML の 78% とは別値 (67% / 142min) を返してデータ駆動を立証
  await page.route("**/api/v1/training/hvpt-sessions/*/completion", (route) =>
    fulfillJson(route, {
      trainingSessionIdentifier: "ts-e2e-1",
      sessionAccuracy: 0.67,
      spacingState: "gate",
      cumulativeTrainingMinutes: 142,
    }),
  );
};

const gotoTrainingWithProfile = async (page: Page): Promise<void> => {
  await page.addInitScript((id) => {
    window.sessionStorage.setItem("training-weakness-profile-id", id);
  }, PROFILE_ID);
  await page.goto("/training");
};

test.describe("training 画面 — HVPT 識別課題 (M-TR-6)", () => {
  test("forced-choice 試行で正誤フィードバック・正解音再生・実データ正答率を描画しセッション完了する", async ({
    page,
  }) => {
    await mockTrainingApi(page);
    await gotoTrainingWithProfile(page);

    // セッション開始で choice-grid が描画される (M-TR-6a forced-choice)
    const choiceGrid = page.locator(".choice-grid#choices");
    await expect(choiceGrid).toBeVisible({ timeout: 15000 });
    await expect(choiceGrid.locator(".choice")).toHaveCount(2);

    // --- 試行1: 誤答 ("right") をクリック → .trial-fb--ng + .is-correct/.is-wrong 発光 (M-TR-6b) ---
    await page.locator(".choice", { hasText: "right" }).click();

    const ngFb = page.locator(".trial-fb--ng");
    await expect(ngFb).toBeVisible({ timeout: 10000 });
    await expect(ngFb).toContainText("light"); // 正解ラベル表示
    // 正解音再生ボタン (M-TR-6b 正解音再生)
    await expect(ngFb.getByRole("button", { name: /正解音/ })).toBeVisible();
    // 発光演出 (訓練画面のみ許容): 正解選択肢 is-correct / 誤選択肢 is-wrong
    await expect(page.locator(".choice.is-correct")).toHaveCount(1);
    await expect(page.locator(".choice.is-wrong")).toHaveCount(1);
    // rail 正答率は実 trial 由来 (0/1 = 0%) — 静的 HTML の 78% でない (M-TR-8 データ駆動)
    await expect(page.locator("#accN")).toHaveText("0%");

    await page.getByRole("button", { name: /次へ/ }).click();

    // --- 試行2: 正答 ("rake") をクリック → .trial-fb--ok ---
    await page.locator(".choice", { hasText: "rake" }).click();
    await expect(page.locator(".trial-fb--ok")).toBeVisible({ timeout: 10000 });
    // 正答率 1/2 = 50% に更新 (データ駆動)
    await expect(page.locator("#accN")).toHaveText("50%");

    await page.getByRole("button", { name: /次へ/ }).click();

    // --- 試行3 (最終): 正答クリック → セッション完了画面へ遷移 ---
    await page.locator(".choice", { hasText: "grass" }).click();

    // session_complete: 完了 API の sessionAccuracy=0.67 → "67%" (静的値でない)
    await expect(page.getByText("セッション完了")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("67%")).toBeVisible();
    // 完了 API の cumulativeTrainingMinutes=142 → formatMinutes = "2h 22min"
    await expect(page.getByText("2h 22min")).toBeVisible();
  });
});

test.describe("training 画面 — design-system-v2 合致 + データ駆動 (M-TR-8)", () => {
  test("HVPT 窓・rail・dock・シャドーイング窓の部品クラスが実データで描画される", async ({ page }) => {
    await mockTrainingApi(page);
    await gotoTrainingWithProfile(page);

    await expect(page.locator(".choice-grid#choices")).toBeVisible({ timeout: 15000 });

    // 窓1 HVPT セッション骨格 (.tr-body = .tr-main + .tr-rail)
    await expect(page.locator(".tr-body")).toBeVisible();
    await expect(page.locator(".tr-main")).toBeVisible();
    await expect(page.locator(".tr-rail")).toBeVisible();
    await expect(page.locator(".tr-main .tr-q .qq")).toContainText("聞こえたのはどちら");
    await expect(page.locator(".play-big")).toBeVisible();
    await expect(page.locator(".tr-fbslot")).toHaveCount(1);

    // .spk-chip — 刺激メタ (話者/文脈/コーパス) が実データから描画 (M-TR-6c / M-TR-8)
    const spkChips = page.locator(".spk-chip");
    await expect(spkChips.first()).toBeVisible();
    await expect(page.locator(".spk-chip", { hasText: "S3" })).toBeVisible();
    await expect(page.locator(".spk-chip", { hasText: "VCTK" })).toBeVisible();

    // rail: 累計訓練 cum-bar + plateau。137min → "2h 17min" (静的 184min でない = データ駆動)
    await expect(page.locator(".cum-bar")).toBeVisible();
    await expect(page.locator(".cum-bar .plateau")).toBeVisible();
    await expect(page.locator(".tr-rail")).toContainText("2h 17min");

    // §12 sched: 4 状態のセル + gate-note (S-TR-2 実 state 駆動)
    await expect(page.locator(".sched")).toBeVisible();
    await expect(page.locator(".sched-cell--done")).toHaveCount(1);
    await expect(page.locator(".sched-cell--rest")).toHaveCount(1);
    await expect(page.locator(".sched-cell--due")).toHaveCount(1);
    await expect(page.locator(".sched-cell--gate")).toHaveCount(1);
    await expect(page.locator(".gate-note")).toBeVisible();

    // .tr-dock 産出ドリルプレビュー: .drill-pair + .rec-btn (phase ② / REQ-123)
    await expect(page.locator(".tr-dock .drill-pair")).toBeVisible();
    await expect(page.locator(".tr-dock .rec-btn")).toBeVisible();

    // 窓2 シャドーイング: .two-col / .passage / .player / .lag (M-TR-7 / M-TR-8)
    await expect(page.locator(".two-col")).toBeVisible();
    await expect(page.locator(".passage")).toContainText("The red ball is big");
    await expect(page.locator("button.player")).toBeVisible();
    await expect(page.locator(".lag .lag-scale")).toBeVisible();
    await expect(page.locator(".lag .lag-scale .z")).toHaveCount(4);
    await expect(page.locator(".lag-lbls")).toContainText("1200+");

    // phase インジケータ (① 知覚 HVPT → ② 産出ドリル)
    await expect(page.getByText("① 知覚 HVPT")).toBeVisible();
    await expect(page.getByText("② 産出ドリル")).toBeVisible();
  });
});

test.describe("training 画面 — 診断前ガード", () => {
  test("weakness profile が無い場合は診断導線を出し HVPT を開始しない", async ({ page }) => {
    await mockTrainingApi(page);
    // sessionStorage を設定せずに遷移 (no_weakness_profile 状態)
    await page.goto("/training");

    await expect(page.getByText("訓練を開始するには診断が必要です")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: /診断を始める/ })).toBeVisible();
    // 診断前は forced-choice が描画されない
    await expect(page.locator(".choice-grid#choices")).toHaveCount(0);
  });
});
