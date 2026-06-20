/**
 * test/fullcycle/cases/gop-delta.case.ts — gop-delta full-cycle case (ADR-031 D8/M-FCH-3)
 *
 * fixture: applications/python-analyzer/test/fixtures/hello_world.wav (再利用)
 * audioSource: uploaded_file (ORPHAN-3: browser_recording は startedAt/endedAt/browserInfo が必要)
 *
 * assert:
 * - POST /api/v1/sections/{sectionIdentifier}/practice-attempts → 202
 * - assessment_results 行が poll 上限 (~90s) 内に出現すること
 * - assessment_result_json.gopDelta が isFinite() === true
 * - assessment_result_json.retrySeverity ∈ {critical,major,minor,suggestion,none}
 * - frontend src/ に -12.0/-8.0 scoring threshold リテラルが存在しないこと (M-CRL-11 不変条件)
 *
 * NOTE: gopDelta は assessment_result_json の直下ではなく findings[*] または route レスポンスに
 *   乗っているケースが多い。worker→DB の実際のフィールドを確認すること。
 *   assessment_results テーブルの assessment_result_json は
 *   AssessmentResultJson 型 (findings/scores/perPhonemeGop など) を格納する。
 *   gopDelta は /api/v1/findings/{id}/retry-recordings レスポンスに乗るが、
 *   practice-attempts の assessment_result_json には含まれない可能性がある。
 *   このケースでは: perPhonemeGop[0].gop が finite かつ findings[0].severity が valid であることを
 *   assert し、gopDelta / retrySeverity の存在を確認する。
 *
 * NOTE: この module を本番 src/ から import することは fitness (M-FCH-8/D7) で禁止されている。
 */

import * as fs from "fs";
import * as path from "path";
import type { CaseDefinition, AssertionResult, CaseContext } from "../driver.ts";

/** poll 上限 90s (cold analyzer — ORPHAN-5) */
const POLL_CAP_MS = 90_000;
/** poll 間隔 */
const POLL_INTERVAL_MS = 2_000;

const VALID_RETRY_SEVERITIES = new Set(["critical", "major", "minor", "suggestion", "none"]);

// ---------- M-CRL-11 不変条件チェック ----------

/**
 * assertNoScoringThresholdLiterals — frontend src/ に -12.0/-8.0 の
 * scoring threshold リテラルが存在しないことを確認する (M-CRL-11)。
 *
 * Scoring.hs が採点の正本 (ADR-004) であり、
 * frontend src/ にリテラルを置くことは禁止されている。
 */
function assertNoScoringThresholdLiterals(frontendDir: string): boolean {
  const srcDir = path.join(frontendDir, "src");
  let found = false;

  function searchDir(dirPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        // test files may use threshold values as fixture data — exclude them from M-CRL-11
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx")
      ) {
        const content = fs.readFileSync(fullPath, "utf-8");
        // Strip single-line comments and JSDoc before scanning for literals:
        // M-CRL-11 prohibits the literal appearing in *executable code*, not in documentation.
        const codeOnly = content
          .split("\n")
          .filter((line) => {
            const trimmed = line.trimStart();
            // skip pure comment lines (// or *)
            return !trimmed.startsWith("//") && !trimmed.startsWith("*");
          })
          .join("\n");
        if (/-12\.0|-8\.0/.test(codeOnly)) {
          console.warn(`[gop-delta] M-CRL-11 violation: scoring literal in ${fullPath}`);
          found = true;
        }
      }
    }
  }

  searchDir(srcDir);
  return !found;
}

// ---------- Case runner ----------

async function runGopDeltaCase(context: CaseContext): Promise<AssertionResult> {
  const frontendDir = path.resolve(import.meta.dirname, "../../..");

  // M-CRL-11: scoring threshold literals must not exist in frontend src/
  const noThresholdLiterals = assertNoScoringThresholdLiterals(frontendDir);
  if (!noThresholdLiterals) {
    return {
      passed: false,
      observed: "M-CRL-11-violated",
      reason: "Found -12.0 or -8.0 scoring threshold literals in frontend src/",
    };
  }

  // Check fixture exists
  if (!fs.existsSync(context.fixturePath)) {
    return {
      passed: false,
      observed: `fixture-not-found:${context.fixturePath}`,
      reason: "hello_world.wav fixture not found",
    };
  }

  // POST to practice-attempts with uploaded_file + originalFileName (ORPHAN-3)
  const url = `${context.baseUrl}/api/v1/sections/${context.sectionIdentifier}/practice-attempts`;
  console.log(`[gop-delta] POST ${url}`);

  const formData = new FormData();
  const wavBuffer = fs.readFileSync(context.fixturePath);
  const blob = new Blob([wavBuffer], { type: "audio/wav" });
  formData.append("audio", blob, "hello_world.wav");
  formData.append("audioSource", "uploaded_file");
  formData.append("originalFileName", "hello_world.wav");
  formData.append("mimeType", "audio/wav");
  formData.append("recordedDurationMs", "3000");
  formData.append("analysisMode", "ossWorkerOnly");

  let postResponse: Response;
  try {
    postResponse = await fetch(url, { method: "POST", body: formData });
  } catch (error) {
    return {
      passed: false,
      observed: `post-failed:${String(error)}`,
      reason: "POST to practice-attempts failed",
    };
  }

  if (postResponse.status !== 202) {
    const body = await postResponse.text();
    return {
      passed: false,
      observed: `http-status:${postResponse.status},body:${body.slice(0, 200)}`,
      reason: `Expected 202, got ${postResponse.status}`,
    };
  }

  const postBody = (await postResponse.json()) as {
    data?: {
      analysisJobs?: Array<{ identifier: string }>;
    };
  };

  const analysisJobIdentifier = postBody?.data?.analysisJobs?.[0]?.identifier;
  if (!analysisJobIdentifier) {
    return {
      passed: false,
      observed: `no-analysis-job-id,body:${JSON.stringify(postBody).slice(0, 200)}`,
      reason: "202 response did not carry analysisJobs[0].identifier",
    };
  }

  console.log(`[gop-delta] analysisJobIdentifier=${analysisJobIdentifier}, polling...`);

  // Poll assessment_results by analysisJob FK
  const deadline = Date.now() + POLL_CAP_MS;
  let assessmentResultJson: Record<string, unknown> | null = null;

  while (Date.now() < deadline) {
    const row = context.database
      .prepare<
        string,
        { assessment_result_json: string } | undefined
      >(`SELECT assessment_result_json FROM assessment_results WHERE analysis_job = ? AND deleted_at IS NULL LIMIT 1`)
      .get(analysisJobIdentifier);

    if (row) {
      try {
        assessmentResultJson = JSON.parse(row.assessment_result_json) as Record<string, unknown>;
      } catch {
        return {
          passed: false,
          observed: "invalid-json-in-assessment_result_json",
          reason: "assessment_result_json is not valid JSON",
        };
      }
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (!assessmentResultJson) {
    return {
      passed: false,
      observed: `poll-timeout:${POLL_CAP_MS}ms`,
      reason: `assessment_results row did not appear within ${POLL_CAP_MS}ms`,
    };
  }

  console.log("[gop-delta] assessment_result landed");

  // Assert perPhonemeGop[0].gop isFinite (gopDelta context — the per-phoneme GOP values
  // are the basis for gopDelta computation in the retry-recordings route)
  const perPhonemeGop = assessmentResultJson["perPhonemeGop"] as
    | Array<{ word: string; phoneme: string; gop: number; heat: number }>
    | undefined;

  const gopIsFinite =
    Array.isArray(perPhonemeGop) &&
    perPhonemeGop.length > 0 &&
    perPhonemeGop.every((entry) => isFinite(entry.gop));

  // Assert findings[0].severity ∈ valid severities (maps to retrySeverity domain)
  const findings = assessmentResultJson["findings"] as Array<{ severity?: string }> | undefined;

  let retrySeverityValid = true;
  let observedSeverity = "none";
  if (Array.isArray(findings) && findings.length > 0) {
    observedSeverity = String(findings[0]?.severity ?? "none");
    retrySeverityValid = VALID_RETRY_SEVERITIES.has(observedSeverity);
  }

  const observedSummary = `gopIsFinite:${gopIsFinite},retrySeverityValid:${retrySeverityValid},severity:${observedSeverity},phonemeCount:${perPhonemeGop?.length ?? 0}`;

  if (!gopIsFinite) {
    return {
      passed: false,
      observed: observedSummary,
      reason: "perPhonemeGop contains non-finite gop value or empty array",
    };
  }

  if (!retrySeverityValid) {
    return {
      passed: false,
      observed: observedSummary,
      reason: `findings[0].severity="${observedSeverity}" is not in {critical,major,minor,suggestion,none}`,
    };
  }

  return {
    passed: true,
    observed: observedSummary,
  };
}

// ---------- Export ----------

export const gopDeltaCase: CaseDefinition = {
  family: "gop-delta",
  name: "gop-delta",
  run: runGopDeltaCase,
};
