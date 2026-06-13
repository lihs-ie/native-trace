import { describe, it, expect } from "vitest";
import { okAsync } from "neverthrow";
import {
  createStartDiagnosticSession,
  type StartDiagnosticSessionDependencies,
} from "./index";
import { getDiagnosticPromptSet } from "../../infrastructure/training/diagnostic-prompt-fixture";

/**
 * M-DG-1/2: startDiagnosticSession usecase contract test
 *
 * Port を fake 注入し、DiagnosticSession(pending) が生成・永続化されることを assert する。
 */

const makeDeps = (
  persistMock: ReturnType<typeof import("vitest")["vi"]["fn"]>,
): StartDiagnosticSessionDependencies => ({
  diagnosticSessionRepository: {
    find: () => { throw new Error("not expected in this test"); },
    findLatestByLearner: () => okAsync(null),
    persist: persistMock as never,
  },
  entropyProvider: {
    generateUlid: () => "01JX0000000000000000000001",
    generateUuidV4: () => "00000000-0000-0000-0000-000000000001",
  },
  clock: {
    now: () => new Date("2026-06-13T00:00:00Z"),
  },
});

describe("createStartDiagnosticSession", () => {
  it("DiagnosticSession(pending) を生成して永続化する", async () => {
    const { vi } = await import("vitest");
    const persistMock = vi.fn(() => okAsync(undefined));
    const executor = createStartDiagnosticSession(makeDeps(persistMock));

    const promptSet = getDiagnosticPromptSet();
    const result = await executor({
      learnerIdentifier: "01JWZLEARNER0000000000001",
      promptSet,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const { diagnosticSession } = result.value;
      expect(diagnosticSession.type).toBe("pending");
      expect(diagnosticSession.identifier).toBe("01JX0000000000000000000001");
      expect(String(diagnosticSession.learner)).toBe("01JWZLEARNER0000000000001");
      expect(diagnosticSession.promptSet.prompts.length).toBeGreaterThan(0);
      expect(diagnosticSession.startedAt).toEqual(new Date("2026-06-13T00:00:00Z"));
    }

    expect(persistMock).toHaveBeenCalledOnce();
  });

  it("不正な learnerIdentifier はエラーを返す", async () => {
    const { vi } = await import("vitest");
    const persistMock = vi.fn(() => okAsync(undefined));
    const executor = createStartDiagnosticSession(makeDeps(persistMock));

    const promptSet = getDiagnosticPromptSet();
    const result = await executor({
      learnerIdentifier: "  ",
      promptSet,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("validationFailed");
    }
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("DiagnosticPromptSet がカタログ対立を網羅している（最小 12 課題）", () => {
    const promptSet = getDiagnosticPromptSet();
    expect(promptSet.prompts.length).toBeGreaterThanOrEqual(12);

    // phenomenon 種別の網羅確認
    const phenomenons = new Set(promptSet.prompts.map((p) => p.phenomenon));
    expect(phenomenons.has("segmental")).toBe(true);
    expect(phenomenons.has("epenthesis")).toBe(true);
    expect(phenomenons.has("prosodic")).toBe(true);
  });
});
