export type Severity = "info" | "warning" | "error";

export type Language = "javascript" | "typescript" | "python" | "rust";

export type FindingKind =
  | "similar-declaration"
  | "new-dependency"
  | "convention-drift";

export type RuleCode = "DC001" | "DC002" | "DC003";

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
}

export interface DriftcheckConfigInput {
  ignorePaths?: string[];
  languages?: Language[];
  rules?: Partial<Record<RuleCode, RuleConfig>>;
}

export type OutputFormat = "text" | "json" | "github";
