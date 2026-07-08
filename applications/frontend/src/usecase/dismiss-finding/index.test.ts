import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createDismissFinding, type DismissFindingDependencies } from "./index";
import { notFound } from "../../domain/shared";

/**
 * M-108 dismiss-finding usecase test。
 * section→recording→run→job→result の解決を経て finding を特定し、
 * FindingDismissalRepository.record を呼ぶこと（観測可能挙動）を assert する。
 */

const ready = {
  type: "ready" as const,
  identifier: "REC1" as never,
  section: "SEC1" as never,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const run = {
  identifier: "RUN1" as never,
  recordingAttempt: "REC1" as never,
  mode: "cloud_only",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const job = {
  type: "succeeded" as const,
  identifier: "JOB1" as never,
  analysisRun: "RUN1" as never,
  engine: "cloud" as const,
  engineConfigJson: "{}",
  completedAt: new Date("2026-01-01T00:00:00Z"),
  queuedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const resultWithFinding = {
  identifier: "AR1" as never,
  findings: [{ identifier: "FIND_X" as never }],
};

const makeDeps = (
  recordMock: ReturnType<typeof vi.fn>,
  activeDismissed: Set<string> = new Set(),
): DismissFindingDependencies =>
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
      record: recordMock as never,
      restore: () => okAsync(undefined),
      findActiveDismissedIdentifiers: () => okAsync(activeDismissed),
      findActiveDismissedIdentifiersByResults: () => okAsync(new Map()),
    },
    entropyProvider: {
      generateUlid: () => "DISM_X",
      generateUuidV4: () => "00000000-0000-4000-8000-000000000000",
    },
    clock: { now: () => new Date("2026-06-12T00:00:00Z") },
  }) as never;

describe("dismissFinding", () => {
  it("finding を特定し FindingDismissalRepository.record を呼ぶ", async () => {
    const recordMock = vi.fn(() => okAsync(undefined));
    const execute = createDismissFinding(makeDeps(recordMock));

    const result = await execute({ section: "SEC1", finding: "FIND_X", reason: "誤検出" });

    expect(result.isOk()).toBe(true);
    expect(recordMock).toHaveBeenCalledOnce();
    const calls = recordMock.mock.calls as unknown as Array<
      [{ findingIdentifier: string; reason: string | null }]
    >;
    const arg = calls[0][0];
    expect(arg.findingIdentifier).toBe("FIND_X");
    expect(arg.reason).toBe("誤検出");
    expect(result._unsafeUnwrap().findingIdentifier).toBe("FIND_X");
  });

  it("既に却下済みなら冪等に成功し record を再呼び出ししない", async () => {
    const recordMock = vi.fn(() => okAsync(undefined));
    const execute = createDismissFinding(makeDeps(recordMock, new Set(["FIND_X"])));

    const result = await execute({ section: "SEC1", finding: "FIND_X" });

    expect(result.isOk()).toBe(true);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("存在しない finding は validationFailed", async () => {
    const recordMock = vi.fn(() => okAsync(undefined));
    const execute = createDismissFinding(makeDeps(recordMock));

    const result = await execute({ section: "SEC1", finding: "NOPE" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
    expect(recordMock).not.toHaveBeenCalled();
  });
});
