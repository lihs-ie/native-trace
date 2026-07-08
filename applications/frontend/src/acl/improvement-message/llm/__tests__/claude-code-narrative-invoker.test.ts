/**
 * Tests for claude-code-narrative-invoker.ts (ADR-021 M-LLM-6)
 *
 * spawn is replaced via the injectable spawnFunction dep — no module-level mocking needed.
 * Test doubles (fake child processes, spy spawn) are confined to this __tests__ directory.
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

import {
  createClaudeCodeNarrativeInvoker,
  type SpawnFunction,
} from "../claude-code-narrative-invoker";

// ---- Fake child process factory ----

type FakeChildOptions = {
  stdoutData?: string;
  stderrData?: string;
  exitCode?: number;
  emitError?: Error;
};

const makeFakeChild = (options: FakeChildOptions): ChildProcessWithoutNullStreams => {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  const child = Object.assign(emitter, {
    stdout: stdout as unknown as NodeJS.ReadableStream,
    stderr: stderr as unknown as NodeJS.ReadableStream,
    kill: () => undefined,
    stdin: null,
    stdio: [] as unknown,
    pid: undefined,
    killed: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: "",
  }) as unknown as ChildProcessWithoutNullStreams;

  setTimeout(() => {
    if (options.emitError !== undefined) {
      emitter.emit("error", options.emitError);
      return;
    }
    if (options.stdoutData !== undefined) {
      stdout.emit("data", Buffer.from(options.stdoutData, "utf8"));
    }
    if (options.stderrData !== undefined) {
      stderr.emit("data", Buffer.from(options.stderrData, "utf8"));
    }
    emitter.emit("close", options.exitCode ?? 0);
  }, 0);

  return child;
};

// ---- Spy spawn factory ----

type SpawnCallRecord = {
  command: string;
  args: string[];
  options: SpawnOptionsWithoutStdio;
};

const makeSpySpawn = (
  childFactory: (
    command: string,
    args: string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams,
): { spawnFunction: SpawnFunction; calls: SpawnCallRecord[] } => {
  const calls: SpawnCallRecord[] = [];
  const spawnFunction: SpawnFunction = (command, args, options) => {
    calls.push({ command, args, options });
    return childFactory(command, args, options);
  };
  return { spawnFunction, calls };
};

// ---- Base deps ----

const safeChildEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PATH: "/usr/bin:/bin",
  HOME: "/home/user",
  // ANTHROPIC_API_KEY deliberately absent
};

const validResultJson = JSON.stringify({
  whatJa: "text here ok",
  whyJa: "why here ok",
  howJa: "how here ok",
});
const validStdout = JSON.stringify({ result: validResultJson });

// ---- M-LLM-6: spawn args and env assertions ----

describe("M-LLM-6: claude-code-narrative-invoker spawn args and env", () => {
  it("spawn args include -p, --output-format, json, --no-session-persistence, --system-prompt, --model", async () => {
    const { spawnFunction, calls } = makeSpySpawn(() => makeFakeChild({ stdoutData: validStdout }));

    const invoker = createClaudeCodeNarrativeInvoker({
      claudeExecutablePath: "claude",
      providerModel: "claude-sonnet-4-5",
      timeoutMs: 5000,
      childEnv: safeChildEnv,
      spawnFunction,
    });

    await invoker("system prompt text", "user prompt text");

    expect(calls).toHaveLength(1);
    const { args } = calls[0]!;
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-5");
  });

  it("spawn args do NOT include --bare", async () => {
    const { spawnFunction, calls } = makeSpySpawn(() => makeFakeChild({ stdoutData: validStdout }));

    const invoker = createClaudeCodeNarrativeInvoker({
      claudeExecutablePath: "claude",
      providerModel: "claude-sonnet-4-5",
      timeoutMs: 5000,
      childEnv: safeChildEnv,
      spawnFunction,
    });

    await invoker("system prompt text", "user prompt text");

    expect(calls[0]!.args).not.toContain("--bare");
  });

  it("spawn env does NOT contain ANTHROPIC_API_KEY key", async () => {
    const { spawnFunction, calls } = makeSpySpawn(() => makeFakeChild({ stdoutData: validStdout }));

    const invoker = createClaudeCodeNarrativeInvoker({
      claudeExecutablePath: "claude",
      providerModel: "claude-sonnet-4-5",
      timeoutMs: 5000,
      childEnv: safeChildEnv,
      spawnFunction,
    });

    await invoker("system prompt text", "user prompt text");

    const spawnEnv = calls[0]!.options.env as NodeJS.ProcessEnv | undefined;
    expect(spawnEnv).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(spawnEnv, "ANTHROPIC_API_KEY")).toBe(false);
  });

  it("system prompt text appears immediately after --system-prompt; userPrompt is last arg", async () => {
    const { spawnFunction, calls } = makeSpySpawn(() => makeFakeChild({ stdoutData: validStdout }));

    const systemPrompt = "You are a pronunciation coach";
    const userPrompt = "user input JSON here";

    const invoker = createClaudeCodeNarrativeInvoker({
      claudeExecutablePath: "claude",
      providerModel: "claude-sonnet-4-5",
      timeoutMs: 5000,
      childEnv: safeChildEnv,
      spawnFunction,
    });

    await invoker(systemPrompt, userPrompt);

    const { args } = calls[0]!;
    const sysPromptIndex = args.indexOf("--system-prompt");
    expect(sysPromptIndex).toBeGreaterThanOrEqual(0);
    expect(args[sysPromptIndex + 1]).toBe(systemPrompt);
    expect(args[args.length - 1]).toBe(userPrompt);
  });

  it("non-zero exit code rejects", async () => {
    const { spawnFunction } = makeSpySpawn(() =>
      makeFakeChild({ exitCode: 1, stderrData: "some error" }),
    );

    const invoker = createClaudeCodeNarrativeInvoker({
      claudeExecutablePath: "claude",
      providerModel: "claude-sonnet-4-5",
      timeoutMs: 5000,
      childEnv: safeChildEnv,
      spawnFunction,
    });

    await expect(invoker("system", "user")).rejects.toThrow();
  });

  it("stdout JSON missing 'result' field rejects", async () => {
    const badStdout = JSON.stringify({ something_else: "data" });
    const { spawnFunction } = makeSpySpawn(() => makeFakeChild({ stdoutData: badStdout }));

    const invoker = createClaudeCodeNarrativeInvoker({
      claudeExecutablePath: "claude",
      providerModel: "claude-sonnet-4-5",
      timeoutMs: 5000,
      childEnv: safeChildEnv,
      spawnFunction,
    });

    await expect(invoker("system", "user")).rejects.toThrow("'result'");
  });
});
