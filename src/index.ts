export { defaultConfig, loadConfig } from "./config.js";
export { analyzeChanges } from "./driftcheck.js";
export { filterFindings, formatOutput, shouldFail } from "./reporters.js";
export { scanRepo } from "./scan.js";
export type {
  AnalyzeOptions,
  AnalyzeResult,
  ChangedFile,
  DeclarationInfo,
  DriftcheckConfig,
  DriftcheckConfigInput,
  FileAnalysis,
  FileConventions,
  Finding,
  FindingKind,
  ImportInfo,
  Language,
  OutputFormat,
  RepoMap,
  RuleCode,
  RuleConfig,
  Severity,
} from "./types.js";
