# Incident: acousticEvidence (ADR-018) orphaned at workspace findings panel

Date: 2026-06-19 (discovered during ADR-019 topology mapping)

## What
ADR-018 `acousticEvidence` is present in `EngineFindingDto` (api-types.ts:280),
Zod schema, response-mapper, AssessmentFindingDraft, and run-assessment-job
persistence, and is consumed by the rule-based improvement-message generator
(commit 099f69d). BUT it is OMITTED from the two explicit field-by-field findings
maps that build the workspace response:
- `usecase/view-practice-workspace/index.ts` (~line 444-481)
- `app/api/v1/sections/[sectionIdentifier]/workspace/route.ts` (lines 93-119)

So `acousticEvidence` never reaches the DetailPanelV2/ArticulationCard findings
panel — only the improvement-message path receives it.

## Why it matters
Explicit field-by-field object maps silently drop fields that are not listed.
TypeScript did not catch it because the maps build inline object literals (not
annotated as EngineFindingDto), so structural inference allowed the omission.
Same failure class as ADR-017 insertionPositionMs.

## ADR-019 handling
articulatoryEstimate is wired through the FULL chain including both findings maps
so it reaches ArticulationCard (M-AAI-18 runtime assert). acousticEvidence's own
workspace-display gap is ADR-018 scope and is NOT fixed in this slice.

## Promotion candidate (/self-improve)
- eval/rule: detect when a new EngineFindingDto field added to api-types.ts is not
  also added to view-practice-workspace + workspace/route.ts explicit findings maps
  (and run-assessment-job persist). Could be an ast-grep/lint or a wiring check that
  enumerates EngineFindingDto keys vs the route map keys.
