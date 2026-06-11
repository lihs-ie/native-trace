/**
 * API-009: GET /api/v1/sections/{sectionIdentifier}/workspace — 練習ワークスペース取得
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../../registry";
import { domainErrorToResponse } from "../../../_shared/errors";

type RouteContext = { params: Promise<{ sectionIdentifier: string }> };

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { sectionIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.viewPracticeWorkspace({
    section: sectionIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  const serverTime = new Date().toISOString();

  const data = {
    section: {
      identifier: output.section.identifier,
      sectionSeries: output.section.sectionSeries,
      version: output.section.version,
      bodyText: output.section.bodyText,
      createdAt: output.section.createdAt,
    },
    sectionTokens: output.sectionTokens.map((t) => ({
      tokenIndex: t.tokenIndex,
      text: t.text,
      startChar: t.startChar,
      endChar: t.endChar,
    })),
    recordingAttempts: output.recordingAttempts.map((r) => ({
      identifier: r.identifier,
      status: r.state,
      createdAt: r.createdAt,
    })),
    latestAnalysisRun: output.latestAnalysisRun
      ? {
          identifier: output.latestAnalysisRun.identifier,
          mode: output.latestAnalysisRun.mode,
          status: output.latestAnalysisRun.status,
        }
      : null,
    highlightRangesByEngine: output.highlightRangesByEngine.map((byEngine) => ({
      engine: byEngine.engineKind,
      highlights: byEngine.highlights.map((h) => ({
        finding: h.finding,
        severity: h.severity,
        category: h.category,
        textRange: h.textRange,
        tokenRange: h.tokenRange,
        audioRange: h.audioRange,
        messageJa: null,
        messageEn: null,
        confidence: h.confidence,
      })),
    })),
    resultsByEngine: output.resultsByEngine.map((r) => ({
      result: r.result,
      engineKind: r.engineKind,
      engineName: r.engineName,
      modelName: r.modelName,
      scores: {
        overall: r.scores.overall,
        accuracy: r.scores.accuracy,
        nativeLikeness: r.scores.nativeLikeness,
        pronunciation: r.scores.pronunciation,
        connectedSpeech: r.scores.connectedSpeech,
        prosody: r.scores.prosody,
      },
      counts: {
        critical: r.counts.critical,
        major: r.counts.major,
        minor: r.counts.minor,
        suggestion: r.counts.suggestion,
      },
      findings: r.findings.map((f) => ({
        finding: f.finding,
        severity: f.severity,
        category: f.category,
        textRange: f.textRange,
        audioRange: f.audioRange,
        expected: f.expected,
        detected: f.detected,
        messageJa: f.messageJa,
        messageEn: f.messageEn,
        scoreImpact: f.scoreImpact,
        confidence: f.confidence,
      })),
    })),
  };

  const envelope = {
    data,
    meta: {
      requestIdentifier: `req_${globalThis.crypto.randomUUID().replace(/-/g, "")}`,
      serverTime,
    },
  };
  return Response.json(envelope, { status: 200 });
}
