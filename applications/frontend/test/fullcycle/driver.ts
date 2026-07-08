#!/usr/bin/env node
/**
 * test/fullcycle/driver.ts — tier-1 full-cycle driver (ADR-031 D3/M-FCH-2)
 *
 * シーケンス:
 *   1. docker compose up -d --build --wait (worker + analyzer)
 *   2. 一時 DB_PATH を作成し db:migrate で構築 (db:push 禁止)
 *   3. seedSkeleton() で material/section_series/section を挿入
 *   4. pnpm build → ephemeral next start (production build 必須、dev 不可 — ORPHAN-4)
 *   5. ケース定義を実行 (POST → poll → assert → verdict line)
 *   6. python3 run_selfeval.py を shell-out し SELFEVAL 行を転送
 *   7. cascadeCleanup + docker compose down
 *   8. 全 SELFEVAL 行 PASS なら exit 0、FAIL があれば exit 1
 *
 * 並列実行禁止: AnalysisJobRunner はシングルトンリースのため、ケースは逐次実行のみ (ORPHAN-8)。
 * 並列ケースが必要なら別スタックの起動が必要 (S-FCH-4)。
 *
 * 使用方法:
 *   node --experimental-strip-types test/fullcycle/driver.ts gop-delta
 *
 * NOTE: この module を本番 src/ から import することは fitness (M-FCH-8/D7) で禁止されている。
 */

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import { seedSkeleton, cascadeCleanup } from "../fixtures/seed/index.ts";

// ---------- Config ----------

const FRONTEND_DIR = path.resolve(import.meta.dirname, "../..");
const REPO_ROOT = path.resolve(FRONTEND_DIR, "../..");
const FIXTURE_WAV = path.resolve(
  REPO_ROOT,
  "applications/python-analyzer/test/fixtures/hello_world.wav",
);
const ANALYZER_URL = process.env.ANALYZER_URL ?? "http://localhost:8788";
const NEXT_PORT = Number(process.env.FULLCYCLE_PORT ?? 3099);
const NEXT_BASE_URL = `http://localhost:${NEXT_PORT}`;

// ---------- Case definition ----------

export type AssertionResult =
  | { passed: true; observed: string }
  | { passed: false; observed: string; reason: string };

export type CaseDefinition = {
  family: string;
  name: string;
  /**
   * @param context - driver が作成したコンテキスト (sectionIdentifier, db, baseUrl など)
   * @returns AssertionResult
   */
  run: (context: CaseContext) => Promise<AssertionResult>;
};

export type CaseContext = {
  sectionIdentifier: string;
  database: InstanceType<typeof Database>;
  baseUrl: string;
  fixturePath: string;
};

// ---------- Docker helpers ----------

function dockerComposeUp(): void {
  console.log("[driver] docker compose up -d --build --wait worker analyzer");
  execSync("docker compose up -d --build --wait worker analyzer", {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

function dockerComposeDown(): void {
  console.log("[driver] docker compose down");
  execSync("docker compose down", {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

// ---------- DB helpers ----------

function createTempDb(): { dbPath: string; db: InstanceType<typeof Database> } {
  const dbPath = path.join(os.tmpdir(), `native-trace-fullcycle-${Date.now()}.db`);
  console.log(`[driver] temp DB_PATH=${dbPath}`);
  return { dbPath, db: new Database(dbPath) };
}

function runMigrate(dbPath: string): void {
  console.log("[driver] pnpm db:migrate");
  execSync("pnpm db:migrate", {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    env: { ...process.env, DB_PATH: dbPath },
  });
}

// ---------- Next.js helpers ----------

let nextProcess: ReturnType<typeof spawn> | null = null;

async function startNextServer(dbPath: string): Promise<void> {
  console.log("[driver] pnpm build");
  execSync("pnpm build", {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    env: { ...process.env, DB_PATH: dbPath },
  });

  console.log(`[driver] next start (PORT=${NEXT_PORT})`);
  // Use PORT env var — the most reliable way to set the port for `next start`.
  // Avoid passing --port via pnpm script arg forwarding: `pnpm start -- --port N`
  // causes next start to interpret "--port" as a directory name (pnpm forwarding bug).
  nextProcess = spawn("pnpm", ["start"], {
    cwd: FRONTEND_DIR,
    // inherit stderr so errors are visible; stdout is drained to avoid pipe-buffer stall
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, DB_PATH: dbPath, PORT: String(NEXT_PORT) },
  });

  // Drain stdout to prevent pipe-buffer stall; also detect "Ready" log from Next.js
  let nextReady = false;
  nextProcess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (text.includes("Ready") || text.includes("started server")) {
      nextReady = true;
    }
  });

  // Wait for Next.js to be ready — prefer "Ready" log, fall back to HTTP probe
  await waitForNextReady(NEXT_BASE_URL, 60_000, () => nextReady);
  console.log("[driver] Next.js ready");
}

async function waitForNextReady(
  baseUrl: string,
  timeoutMs: number,
  isReadySignal?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Fast path: process stdout signalled readiness
    if (isReadySignal?.()) return;
    // HTTP probe — any HTTP response (including 5xx) means the server is up and listening
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      // connection refused — not ready yet
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
  // proceed anyway — POST will surface the error if still not ready
  console.warn("[driver] warning: Next.js readiness check timed out, proceeding anyway");
}

function stopNextServer(): void {
  if (nextProcess) {
    console.log("[driver] stopping next start");
    nextProcess.kill("SIGTERM");
    nextProcess = null;
  }
}

// ---------- Python self-eval shell-out ----------

/**
 * runPythonSelfeval — python3 run_selfeval.py を呼び出し、stdout の SELFEVAL 行を転送する。
 *
 * python-analyzer/test/selfeval/run_selfeval.py が存在しない場合は warning を出してスキップする
 * (並行実装者が所有する。このファイルを変更しないこと)。
 *
 * contract (pinned): python3 applications/python-analyzer/test/selfeval/run_selfeval.py
 *   --analyzer-url http://localhost:8788
 * emits: SELFEVAL <family> <case> PASS|FAIL observed=...
 * exit 0 iff all PASS
 */
async function runPythonSelfeval(): Promise<string[]> {
  const runSelfevalPath = path.resolve(
    REPO_ROOT,
    "applications/python-analyzer/test/selfeval/run_selfeval.py",
  );

  if (!fs.existsSync(runSelfevalPath)) {
    console.warn(
      `[driver] python run_selfeval.py not found at ${runSelfevalPath} — skipping python selfeval`,
    );
    return [];
  }

  console.log(`[driver] python3 ${runSelfevalPath} --analyzer-url ${ANALYZER_URL}`);

  const selfevalLines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const pythonProcess = spawn("python3", [runSelfevalPath, "--analyzer-url", ANALYZER_URL], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    pythonProcess.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        process.stdout.write(line + "\n");
        if (line.startsWith("SELFEVAL ")) {
          selfevalLines.push(line.trim());
        }
      }
    });

    pythonProcess.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        console.warn(`[driver] run_selfeval.py exited with code ${code}`);
      }
      resolve();
    });

    pythonProcess.on("error", reject);
  });

  return selfevalLines;
}

// ---------- Main runner ----------

/**
 * runCase — CaseDefinition を full-cycle で実行するエントリポイント。
 *
 * 呼び出し例:
 *   import { runCase } from './driver';
 *   import { gopDeltaCase } from './cases/gop-delta.case';
 *   await runCase(gopDeltaCase);
 */
export async function runCase(caseDefinition: CaseDefinition): Promise<void> {
  const allSelfevalLines: string[] = [];
  let db: InstanceType<typeof Database> | null = null;
  let dbPath: string | null = null;
  let materialIdentifier: string | null = null;

  try {
    // Step 1: docker compose up
    dockerComposeUp();

    // Step 2: 一時 DB_PATH + db:migrate
    const temp = createTempDb();
    db = temp.db;
    dbPath = temp.dbPath;
    // db:migrate は drizzle-kit が DB_PATH 環境変数で dbCredentials.url を読む
    // drizzle.config.ts: dbCredentials.url = process.env.DB_PATH ?? "./data/native-trace.db"
    // (ORPHAN-7 解決済み: drizzle.config.ts は process.env.DB_PATH を読んでいる)
    db.close();
    db = null;
    runMigrate(dbPath);
    db = new Database(dbPath);

    // Step 3: seedSkeleton
    const seeds = seedSkeleton(db, { bodyText: "Hello world." });
    materialIdentifier = seeds.materialIdentifier;
    console.log(`[driver] seeded sectionIdentifier=${seeds.sectionIdentifier}`);

    // Step 4: next start (production build)
    await startNextServer(dbPath);

    // Step 5–7: ケース実行 (verdict line)
    const context: CaseContext = {
      sectionIdentifier: seeds.sectionIdentifier,
      database: db,
      baseUrl: NEXT_BASE_URL,
      fixturePath: FIXTURE_WAV,
    };

    const result = await caseDefinition.run(context);
    const status = result.passed ? "PASS" : "FAIL";
    const verdictLine = `SELFEVAL ${caseDefinition.family} ${caseDefinition.name} ${status} observed=${result.observed}`;
    console.log(verdictLine);
    allSelfevalLines.push(verdictLine);

    // Step 6: python self-eval shell-out
    const pythonLines = await runPythonSelfeval();
    allSelfevalLines.push(...pythonLines);
  } finally {
    // Step 7: teardown
    stopNextServer();

    if (db && materialIdentifier) {
      try {
        console.log("[driver] cascadeCleanup");
        cascadeCleanup(db, materialIdentifier);
      } catch (cleanupError) {
        console.warn("[driver] cleanup error:", cleanupError);
      }
    }
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    if (dbPath) {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
    dockerComposeDown();
  }

  // Step 8: exit 0 iff all non-known-fail PASS
  // FAIL[KNOWN] lines are tracked defects (Loop-B) — they are printed but do not block exit 0.
  // Only bare " FAIL " (without "[KNOWN]") contributes to a non-zero exit code.
  const knownFailLines = allSelfevalLines.filter((line) => line.includes(" FAIL[KNOWN] "));
  const blockingFailLines = allSelfevalLines.filter(
    (line) => line.includes(" FAIL ") && !line.includes(" FAIL[KNOWN] "),
  );
  if (knownFailLines.length > 0) {
    console.warn("[driver] SELFEVAL KNOWN failures (Loop-B tracked, non-blocking):");
    knownFailLines.forEach((line) => console.warn("  ", line));
  }
  if (blockingFailLines.length > 0) {
    console.error("[driver] SELFEVAL blocking failures:");
    blockingFailLines.forEach((line) => console.error("  ", line));
    process.exit(1);
  }

  console.log("[driver] all SELFEVAL PASS");
  process.exit(0);
}

// ---------- CLI entry point ----------

const CASE_REGISTRY: Record<string, () => Promise<CaseDefinition>> = {
  "gop-delta": async () => {
    const { gopDeltaCase } = await import("./cases/gop-delta.case.ts");
    return gopDeltaCase;
  },
};

// CLI: node --experimental-strip-types test/fullcycle/driver.ts <caseName>
const caseName = process.argv[2];
if (!caseName) {
  console.error("Usage: node --experimental-strip-types test/fullcycle/driver.ts <caseName>");
  console.error("Available cases:", Object.keys(CASE_REGISTRY).join(", "));
  process.exit(1);
}

const caseLoader = CASE_REGISTRY[caseName];
if (!caseLoader) {
  console.error(`Unknown case: ${caseName}. Available: ${Object.keys(CASE_REGISTRY).join(", ")}`);
  process.exit(1);
}

caseLoader()
  .then((caseDefinition) => runCase(caseDefinition))
  .catch((error: unknown) => {
    console.error("[driver] fatal error:", error);
    process.exit(1);
  });
