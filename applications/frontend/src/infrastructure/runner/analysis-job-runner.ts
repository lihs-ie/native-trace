/**
 * AnalysisJobRunner — infrastructure.md §10。
 * 2 秒ごとに tick を呼ぶ内部 Runner。
 * - maxConcurrency = 1: 前 tick 実行中なら次 tick をスキップする。
 * - dev hot reload 多重起動防止: globalThis singleton guard。
 * - Edge runtime では起動しない（呼び出し側 instrumentation で判定）。
 */

import { type Logger } from "../../usecase/port/logger";

// ---- Types ----

export type AnalysisJobRunnerHandle = Readonly<{
  start: () => void;
  stop: () => void;
}>;

export type AnalysisJobRunnerDependencies = Readonly<{
  tick: () => Promise<void>;
  intervalMs: number;
  logger: Logger;
}>;

// ---- Global singleton guard (dev hot reload 対策) ----

type NativeTraceGlobal = typeof globalThis & {
  __nativeTraceAnalysisJobRunner?: AnalysisJobRunnerHandle;
};

// ---- Factory ----

/**
 * createAnalysisJobRunner — infrastructure.md §10.1, §10.2。
 * globalThis singleton guard により、dev hot reload で多重起動しない。
 * すでに起動済みの Runner がある場合はそれを返す。
 */
export const createAnalysisJobRunner = (
  dependencies: AnalysisJobRunnerDependencies,
): AnalysisJobRunnerHandle => {
  const global = globalThis as NativeTraceGlobal;

  // dev hot reload 対策: 既存 Runner を再利用する
  if (global.__nativeTraceAnalysisJobRunner) {
    dependencies.logger.info("AnalysisJobRunner: reusing existing runner (hot reload guard)");
    return global.__nativeTraceAnalysisJobRunner;
  }

  let running = false;
  let stopped = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const scheduleTick = (): void => {
    if (stopped) return;

    timerId = setTimeout(() => {
      void executeTick();
    }, dependencies.intervalMs);
  };

  const executeTick = async (): Promise<void> => {
    if (stopped) return;

    // maxConcurrency = 1: 実行中なら次 tick をスキップ
    if (running) {
      dependencies.logger.debug("AnalysisJobRunner: tick skipped (previous tick still running)");
      scheduleTick();
      return;
    }

    running = true;
    try {
      await dependencies.tick();
    } catch (error) {
      dependencies.logger.error("AnalysisJobRunner: uncaught error in tick", error);
    } finally {
      running = false;
    }

    scheduleTick();
  };

  const handle: AnalysisJobRunnerHandle = {
    start: () => {
      if (stopped) {
        dependencies.logger.warn("AnalysisJobRunner: start() called after stop()");
        return;
      }
      dependencies.logger.info("AnalysisJobRunner: starting", {
        intervalMs: dependencies.intervalMs,
      });
      scheduleTick();
    },
    stop: () => {
      dependencies.logger.info("AnalysisJobRunner: stopping");
      stopped = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      // globalThis から削除して、次回の起動で新規 Runner を作れるようにする
      delete (globalThis as NativeTraceGlobal).__nativeTraceAnalysisJobRunner;
    },
  };

  // singleton として登録
  global.__nativeTraceAnalysisJobRunner = handle;

  return handle;
};
