export type Severity = "info" | "warning" | "error";

export type FindingKind =
  | "similar-declaration"
  | "new-dependency"
  | "convention-drift";

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  filePath: string;
  line?: number;
  title: string;
  message: string;
  suggestion: string;
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
  language: "javascript" | "typescript" | "python" | "rust";
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
}

export interface AnalyzeResult {
  findings: Finding[];
}
