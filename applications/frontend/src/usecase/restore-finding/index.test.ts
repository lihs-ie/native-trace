import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createRestoreFinding, type RestoreFindingDependencies } from "./index";
import { notFound } from "../../domain/shared";

/**
 * M-108 restore-finding usecase test。
 * finding を特定し FindingDismissalRepository.restore を呼ぶこと（却下取消の観測可能挙動）。
 */

const ready = {
  type: "ready" as const,
  identifier: "REC1" as never,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const run = { identifier: "RUN1" as never, createdAt: new Date("2026-01-01T00:00:00Z") };
const job = {
  type: "succeeded" as const,
  identifier: "JOB1" as never,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const resultWithFinding = {
  identifier: "AR1" as never,
  findings: [{ identifier: "FIND_X" as never }],
};

const makeDeps = (restoreMock: ReturnType<typeof vi.fn>): RestoreFindingDependencies =>
  ({
    sectionRepository: {
      find: () => okAsync({ identifier: "SEC1", bodyText: "x" } as never),
      findLatestInSeries: () => errAsync(notFound("section", "x")),
      findLatestVersionNumber: () => errAsync(notFound("section", "x")),
      search: () => okAsync({ items: [], total: 0 }),
      persist: () => okAsync(undefined),
    },
    recordingAttemptRepository: {
      find: () => okAsync(ready as never),
      findSaving: () => errAsync(notFound("recordingAttempt", "x")),
      search: () => okAsync({ items: [ready], total: 1 } as never),
      persist: () => okAsync(undefined),
    },
    analysisRunRepository: {
      find: () => okAsync(run as never),
      search: () => okAsync({ items: [run], total: 1 } as never),
      persist: () => okAsync(undefined),
      updateStatus: () => okAsync(undefined),
    },
    analysisJobRepository: {
      find: () => errAsync(notFound("analysisJob", "x")),
      search: () => okAsync({ items: [job] } as never),
      persist: () => okAsync(undefined),
      acquireLease: () => okAsync(null),
    },
    assessmentResultRepository: {
      find: () => errAsync(notFound("assessmentResult", "x")),
      search: () => okAsync({ items: [resultWithFinding] } as never),
      persist: () => okAsync(undefined),
    },
    findingDismissalRepository: {
      record: () => okAsync(undefined),
      restore: restoreMock as never,
      findActiveDismissedIdentifiers: () => okAsync(new Set<string>()),
      findActiveDismissedIdentifiersByResults: () => okAsync(new Map()),
    },
    clock: { now: () => new Date("2026-06-12T00:00:00Z") },
  }) as never;

describe("restoreFinding", () => {
  it("finding を特定し FindingDismissalRepository.restore を呼ぶ", async () => {
    const restoreMock = vi.fn(() => okAsync(undefined));
    const execute = createRestoreFinding(makeDeps(restoreMock));

    const result = await execute({ section: "SEC1", finding: "FIND_X" });

    expect(result.isOk()).toBe(true);
    expect(restoreMock).toHaveBeenCalledOnce();
    expect(result._unsafeUnwrap().findingIdentifier).toBe("FIND_X");
  });

  it("不正入力は validationFailed", async () => {
    const restoreMock = vi.fn(() => okAsync(undefined));
    const execute = createRestoreFinding(makeDeps(restoreMock));

    const result = await execute({ section: "", finding: "FIND_X" });

    expect(result.isErr()).toBe(true);
    expect(restoreMock).not.toHaveBeenCalled();
  });
});
