import { type MaterialIdentifier } from "./material";
import { type SectionSeriesIdentifier } from "./section-series";
import { type SectionIdentifier } from "./section";
import { type RecordingAttemptIdentifier } from "./recording-attempt";
import { type AnalysisRunIdentifier } from "./analysis-run";
import { type AnalysisJobIdentifier } from "./analysis-job";
import { type Pagination } from "./shared";

export type MaterialSort = "updatedAt_desc" | "createdAt_desc" | "title_asc";
export type SectionVersionSort = "version_desc";
export type PracticeHistorySort = "createdAt_desc";
export type SectionSort = "displayOrder_asc";
export type RecordingAttemptSort = "createdAt_desc";
export type AnalysisRunSort = "createdAt_desc";

export type MaterialSearchCriteria =
  | {
      readonly type: "activeMaterials";
      readonly pagination: Pagination;
      readonly sort: MaterialSort;
    }
  | {
      readonly type: "includingRetiredForHistory";
      readonly pagination: Pagination;
      readonly sort: MaterialSort;
    };

export type SectionSeriesSearchCriteria =
  | {
      readonly type: "activeSeriesInMaterial";
      readonly material: MaterialIdentifier;
      readonly pagination: Pagination;
      readonly sort: SectionSort;
    }
  | {
      readonly type: "seriesForHistory";
      readonly material: MaterialIdentifier;
      readonly pagination: Pagination;
    };

export type SectionSearchCriteria =
  | {
      readonly type: "activeLatestSectionsInMaterial";
      readonly material: MaterialIdentifier;
      readonly pagination: Pagination;
      readonly sort: SectionSort;
    }
  | {
      readonly type: "sectionVersionsInSeries";
      readonly sectionSeries: SectionSeriesIdentifier;
      readonly pagination: Pagination;
      readonly sort: SectionVersionSort;
    }
  | {
      readonly type: "practiceHistorySectionsInSeries";
      readonly sectionSeries: SectionSeriesIdentifier;
      readonly pagination: Pagination;
      readonly sort: PracticeHistorySort;
    };

export type RecordingAttemptSearchCriteria =
  | {
      readonly type: "attemptsInSection";
      readonly section: SectionIdentifier;
      readonly pagination: Pagination;
      readonly sort: RecordingAttemptSort;
    }
  | {
      readonly type: "attemptsForHistory";
      readonly sectionSeries: SectionSeriesIdentifier;
      readonly pagination: Pagination;
      readonly sort: RecordingAttemptSort;
    };

export type AnalysisRunSearchCriteria =
  | {
      readonly type: "runsByRecordingAttempt";
      readonly recordingAttempt: RecordingAttemptIdentifier;
      readonly pagination: Pagination;
      readonly sort: AnalysisRunSort;
    }
  | {
      readonly type: "runsForHistory";
      readonly sectionSeries: SectionSeriesIdentifier;
      readonly pagination: Pagination;
    };

export type AnalysisJobSearchCriteria =
  | {
      readonly type: "jobsByAnalysisRun";
      readonly analysisRun: AnalysisRunIdentifier;
    }
  | {
      readonly type: "runnableJobsForInspection";
      readonly limit: number;
    };

export type AssessmentResultSearchCriteria =
  | {
      readonly type: "resultsByAnalysisRun";
      readonly analysisRun: AnalysisRunIdentifier;
    }
  | {
      readonly type: "resultsByJobs";
      readonly jobs: ReadonlyArray<AnalysisJobIdentifier>;
    };
