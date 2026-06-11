/**
 * Next.js instrumentation hook — infrastructure.md §10, use-case.md §7.1。
 * Node.js runtime のときだけ AnalysisJobRunner を起動する。
 * Edge runtime では何もしない。
 * migration は自動実行しない (infrastructure.md §6.3: 開発コマンドで明示適用)。
 */

export const register = async (): Promise<void> => {
  // Edge runtime では DB 接続・Runner を起動しない。
  // process.env は config 層に閉じ込める規約のため isNodejsRuntime() を使う。
  const { isNodejsRuntime } = await import("./infrastructure/config/index");
  if (!isNodejsRuntime()) {
    return;
  }

  // dynamic import で Node.js モジュール (better-sqlite3 等) を Edge bundle から隔離する
  const { getContainer, createAssessmentTick } = await import("./registry");
  const { createAnalysisJobRunner } = await import(
    "./infrastructure/runner/analysis-job-runner"
  );

  const container = getContainer();
  const tick = createAssessmentTick(container);

  const runner = createAnalysisJobRunner({
    tick,
    intervalMs: container.config.analysisJobPollIntervalMilliseconds,
    logger: {
      debug: (message, context) =>
        console.debug(JSON.stringify({ level: "debug", message, ...context })),
      info: (message, context) =>
        console.info(JSON.stringify({ level: "info", message, ...context })),
      warn: (message, context) =>
        console.warn(JSON.stringify({ level: "warn", message, ...context })),
      error: (message, error, context) => {
        const sanitizedError =
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) };
        console.error(
          JSON.stringify({ level: "error", message, error: sanitizedError, ...context }),
        );
      },
    },
  });

  runner.start();
};
