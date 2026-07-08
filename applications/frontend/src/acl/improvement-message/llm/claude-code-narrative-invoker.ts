/**
 * claude-code-narrative-invoker.ts — claude -p subprocess invoker (ADR-021 D3 / M-LLM-6)
 *
 * Spawns `claude -p` as a child process using the subscription/keychain auth path.
 * MUST NOT pass ANTHROPIC_API_KEY in child env (prevents metered-route bleed-in).
 * MUST NOT use --bare (breaks keychain/OAuth subscription route).
 *
 * S-LLM-2 cold start note:
 *   Measured: cold ~8.8s / warm ~4.1s per invocation.
 *   CLAUDE.md / .ast-grep/ hook loading adds ~200-500ms overhead per call (no --bare means
 *   claude reads project config on every invocation; this is intentional for auth correctness).
 *
 * process.env is BANNED in this directory (M-LLM-18 / no-process-env-in-llm-acl.yml).
 * Executable path, base env, and the spawn function are all passed via deps from registry.
 * The spawnFunction dep makes the invoker testable without vi.mock (tests inject a fake).
 */

import {
  spawn,
  type SpawnOptionsWithoutStdio,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import { type LlmNarrativeInvoker } from "./create-llm-improvement-message-generator";

// ---- Public types ----

export type SpawnFunction = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export type ClaudeCodeNarrativeInvokerDeps = {
  /**
   * Absolute path to the claude executable (or "claude" for PATH lookup).
   * Sourced from config.claudeCodeExecutablePath via registry — never read process.env here.
   */
  claudeExecutablePath: string;
  /**
   * Model identifier string passed as --model arg (e.g. "claude-sonnet-4-5").
   * Sourced from config.claudeCodeModel via registry.
   */
  providerModel: string;
  /**
   * Timeout in milliseconds. Child receives SIGTERM on expiry.
   * Sourced from config.llmNarrativeTimeoutMilliseconds (default 30000).
   */
  timeoutMs: number;
  /**
   * Child process environment. MUST NOT contain ANTHROPIC_API_KEY.
   * Registry builds this from process.env with ANTHROPIC_API_KEY stripped.
   * The acl layer itself never reads process.env (M-LLM-18).
   */
  childEnv: NodeJS.ProcessEnv;
  /**
   * Injectable spawn function. Defaults to node:child_process.spawn.
   * Accepting this as a dep keeps test doubles scoped to *.test.ts files
   * without requiring module-level hoisting in tests.
   */
  spawnFunction?: SpawnFunction;
};

/**
 * createClaudeCodeNarrativeInvoker — returns a LlmNarrativeInvoker that spawns
 * `claude -p` to generate a narrative response.
 *
 * Exact arg vector (M-LLM-6):
 *   ["-p", "--output-format", "json", "--no-session-persistence",
 *    "--system-prompt", systemPromptText, "--model", providerModel, userPromptText]
 *
 * stdout is collected as a Buffer, JSON.parsed, and the `result` field is extracted
 * (D4: system prompt forces JSON-only output). total_cost_usd is ignored.
 *
 * Failure modes → reject (factory degrades to fallback):
 *   - AbortController timeout (SIGTERM sent to child)
 *   - Non-zero exit code
 *   - stdout JSON parse failure
 *   - Missing `result` field
 *   - Inner JSON parse failure ({whatJa,whyJa,howJa} extraction)
 */
export const createClaudeCodeNarrativeInvoker = (
  deps: ClaudeCodeNarrativeInvokerDeps,
): LlmNarrativeInvoker => {
  const { claudeExecutablePath, providerModel, timeoutMs, childEnv, spawnFunction = spawn } = deps;

  return (systemPromptText: string, userPromptText: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      const args: string[] = [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--system-prompt",
        systemPromptText,
        "--model",
        providerModel,
        userPromptText,
      ];

      const child = spawnFunction(claudeExecutablePath, args, {
        env: childEnv,
        signal: abortController.signal,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on("error", (error: Error) => {
        clearTimeout(timeoutHandle);
        if (abortController.signal.aborted) {
          reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
        } else {
          reject(new Error(`claude -p spawn error: ${error.message}`));
        }
      });

      child.on("close", (exitCode: number | null) => {
        clearTimeout(timeoutHandle);

        if (abortController.signal.aborted) {
          reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
          return;
        }

        if (exitCode !== 0) {
          const stderrOutput = Buffer.concat(stderrChunks).toString("utf8");
          reject(
            new Error(
              `claude -p exited with code ${exitCode ?? "null"}. stderr: ${stderrOutput.slice(0, 200)}`,
            ),
          );
          return;
        }

        const stdoutText = Buffer.concat(stdoutChunks).toString("utf8");

        let outerParsed: unknown;
        try {
          outerParsed = JSON.parse(stdoutText) as unknown;
        } catch {
          reject(new Error(`claude -p stdout JSON parse failed: ${stdoutText.slice(0, 200)}`));
          return;
        }

        if (typeof outerParsed !== "object" || outerParsed === null || !("result" in outerParsed)) {
          reject(new Error("claude -p output missing 'result' field"));
          return;
        }

        const resultField = (outerParsed as Record<string, unknown>)["result"];

        if (typeof resultField !== "string") {
          reject(new Error("claude -p 'result' field is not a string"));
          return;
        }

        // Return the raw result string — validation happens in the factory (M-LLM-9)
        resolve(resultField);
      });
    });
  };
};
