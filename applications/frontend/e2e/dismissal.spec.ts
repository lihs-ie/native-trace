/**
 * M-SMOKE-b: dismissal HTTP round-trip 確認
 *
 * seed → POST /api/v1/sections/{sectionId}/findings/{findingId}/dismissal
 *   → GET /api/v1/sections/{sectionId}/workspace で dismissed: true を確認する。
 *
 * 実 endpoint 経由（mock 禁止）。
 *
 * spec 参照: docs/specs/pronunciation-feedback-v2-residuals.md § M-SMOKE-b
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

test("dismissal round-trip: POST dismissal → GET workspace returns dismissed: true", async ({
  request,
}) => {
  const { section, findingIdentifier } = seedIds;

  // 1. finding を却下する
  const dismissResponse = await request.post(
    `/api/v1/sections/${section}/findings/${findingIdentifier}/dismissal`,
    {
      data: {},
      headers: { "Content-Type": "application/json" },
    },
  );
  expect(dismissResponse.status()).toBe(201);

  const dismissBody = (await dismissResponse.json()) as {
    data: {
      findingIdentifier: string;
      dismissalIdentifier: string;
      assessmentResult: string;
      dismissedAt: number;
    };
  };
  expect(dismissBody.data).toMatchObject({
    findingIdentifier,
  });

  // 2. workspace を再取得して dismissed: true を確認
  const workspaceResponse = await request.get(`/api/v1/sections/${section}/workspace`);
  expect(workspaceResponse.status()).toBe(200);

  const workspaceBody = (await workspaceResponse.json()) as {
    data: {
      resultsByEngine: Array<{
        findings: Array<{ finding: string; dismissed: boolean }>;
      }>;
    };
  };

  const allFindings = workspaceBody.data.resultsByEngine.flatMap((r) => r.findings);
  const targetFinding = allFindings.find((f) => f.finding === findingIdentifier);

  expect(targetFinding).toBeDefined();
  expect(targetFinding?.dismissed).toBe(true);
});
