export type Severity = "info" | "warning" | "error";

export type Language = "javascript" | "typescript" | "python" | "rust";

export type FindingKind =
  | "similar-declaration"
  | "new-dependency"
  | "convention-drift"
  | "inferred-rule-drift";

export type RuleCode =
  | "DC001"
  | "DC002"
  | "DC003"
  | "DC004"
  | "DC005"
  | "DC006"
  | "DC007";

export interface Finding {
  code: RuleCode;
  kind: FindingKind;
  severity: Severity;
  filePath: string;
  line?: number;
  title: string;
  message: string;
  suggestion: string;
  docsUrl?: string;
}

export interface DeclarationInfo {
  kind: "function" | "class" | "type";
  name: string;
  filePath: string;
  line: number;
  exported: boolean;
  async: boolean;
  text: string;
  tokens: string[];
}

export interface ImportInfo {
  source: string;
  filePath: string;
  line: number;
  isExternal: boolean;
}

export interface FileAnalysis {
  filePath: string;
  language: Language;
  declarations: DeclarationInfo[];
  imports: ImportInfo[];
  conventions: FileConventions;
}

export interface FileConventions {
  quoteStyle?: "single" | "double";
  semicolons?: boolean;
  exportStyle?: "named" | "default" | "mixed";
  functionStyle?: "declaration" | "arrow" | "def" | "mixed";
  errorStyle?: "throw-error" | "throw-literal" | "none";
}

export interface RepoMap {
  root: string;
  files: FileAnalysis[];
  packageDependencies: Record<string, string>;
}

export interface ChangedFile {
  filePath: string;
  addedLines: Set<number>;
}

export interface AnalyzeOptions {
  cwd: string;
  mode: "diff" | "staged";
  config?: DriftcheckConfig;
  configPath?: string;
  noConfig?: boolean;
  suppressions?: boolean;
}

export interface AnalyzeResult {
  findings: Finding[];
}

export interface RuleConfig {
  enabled?: boolean;
  severity?: Severity;
  threshold?: number;
}

export interface DriftcheckConfig {
  ignorePaths: string[];
  languages: Language[];
  rules: Record<RuleCode, RuleConfig>;
  inferredRules: InferredRule[];
  baselinePath?: string;
}

export interface DriftcheckConfigInput {
  ignorePaths?: string[];
  languages?: Language[];
  rules?: Partial<Record<RuleCode, RuleConfig>>;
  inferredRules?: InferredRule[];
  baselinePath?: string;
}

export type OutputFormat = "text" | "json" | "github" | "sarif";

export interface BaselineFile {
  version: 1;
  findings: Array<{
    fingerprint: string;
    code: RuleCode;
    filePath: string;
    title: string;
  }>;
}

export type RuleConfidence = "high" | "medium" | "low";

export type InferredRuleKind =
  | "package-manager"
  | "test-framework"
  | "dependency-preference"
  | "common-utility"
  | "architecture-boundary"
  | "generated-files"
  | "command";

export interface RuleEvidence {
  path: string;
  reason: string;
}

export interface InferredRule {
  id: string;
  kind: InferredRuleKind;
  title: string;
  description: string;
  evidence: RuleEvidence[];
  confidence: RuleConfidence;
  severity: Severity;
  data?: Record<string, string | string[]>;
}
