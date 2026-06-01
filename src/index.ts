export { analyzeChanges } from "./driftcheck.js";
export { scanRepo } from "./scan.js";
export type {
  AnalyzeOptions,
  AnalyzeResult,
  ChangedFile,
  DeclarationInfo,
  FileAnalysis,
  FileConventions,
  Finding,
  FindingKind,
  ImportInfo,
  RepoMap,
  Severity,
} from "./types.js";
