import type {
  DeclarationInfo,
  FileAnalysis,
  FileConventions,
  ImportInfo,
} from "../types.js";

const pythonStdlib = new Set([
  "abc",
  "argparse",
  "asyncio",
  "collections",
  "contextlib",
  "csv",
  "dataclasses",
  "datetime",
  "decimal",
  "enum",
  "functools",
  "hashlib",
  "http",
  "importlib",
  "inspect",
  "io",
  "itertools",
  "json",
  "logging",
  "math",
  "os",
  "pathlib",
  "re",
  "shutil",
  "sqlite3",
  "statistics",
  "subprocess",
  "sys",
  "tempfile",
  "typing",
  "unittest",
  "uuid",
]);

export function analyzePythonFile(
  filePath: string,
  text: string,
): FileAnalysis {
  const declarations: DeclarationInfo[] = [];
  const imports: ImportInfo[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const trimmed = line.trim();

    const classMatch = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(trimmed);
    if (classMatch) {
      declarations.push(
        declaration(
          "class",
          classMatch[1],
          filePath,
          lineNumber,
          textBlock(lines, index),
        ),
      );
      continue;
    }

    const functionMatch =
      /^(async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(trimmed);
    if (functionMatch) {
      declarations.push({
        ...declaration(
          "function",
          functionMatch[2],
          filePath,
          lineNumber,
          textBlock(lines, index),
        ),
        async: functionMatch[1].startsWith("async"),
      });
      continue;
    }

    const importMatch = /^import\s+(.+)$/.exec(trimmed);
    if (importMatch) {
      for (const source of importMatch[1].split(",")) {
        const moduleName = source
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (!moduleName) continue;
        imports.push(
          importInfo(
            moduleName.split(".")[0] ?? moduleName,
            filePath,
            lineNumber,
          ),
        );
      }
      continue;
    }

    const fromMatch = /^from\s+([.\w]+)\s+import\s+/.exec(trimmed);
    if (fromMatch) {
      imports.push(importInfo(fromMatch[1], filePath, lineNumber));
    }
  }

  return {
    filePath,
    language: "python",
    declarations,
    imports,
    conventions: detectPythonConventions(text),
  };
}

function declaration(
  kind: "function" | "class",
  name: string,
  filePath: string,
  line: number,
  text: string,
): DeclarationInfo {
  return {
    kind,
    name,
    filePath,
    line,
    exported: !name.startsWith("_"),
    async: false,
    text,
    tokens: tokenizeDeclaration(name, text),
  };
}

function importInfo(
  source: string,
  filePath: string,
  line: number,
): ImportInfo {
  const topLevel = source.startsWith(".")
    ? source
    : (source.split(".")[0] ?? source);
  return {
    source: topLevel,
    filePath,
    line,
    isExternal: !topLevel.startsWith(".") && !pythonStdlib.has(topLevel),
  };
}

function textBlock(lines: string[], startIndex: number): string {
  const startLine = lines[startIndex] ?? "";
  const startIndent = indentation(startLine);
  const block = [startLine];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      block.push(line);
      continue;
    }

    if (indentation(line) <= startIndent) break;
    block.push(line);
  }

  return block.join("\n");
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function tokenizeDeclaration(name: string, text: string): string[] {
  return Array.from(
    new Set(
      `${name} ${text}`
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .match(/[a-z0-9]+/g) ?? [],
    ),
  ).filter((token) => token.length > 2);
}

function detectPythonConventions(text: string): FileConventions {
  const raiseErrorCount = (
    text.match(/\braise\s+[A-Za-z_][\w.]*(Error|Exception)\b/g) ?? []
  ).length;
  const raiseLiteralCount = (text.match(/\braise\s+["']/g) ?? []).length;

  return {
    quoteStyle: detectQuoteStyle(text),
    semicolons: false,
    functionStyle: "def",
    errorStyle:
      raiseErrorCount === 0 && raiseLiteralCount === 0
        ? "none"
        : raiseErrorCount >= raiseLiteralCount
          ? "throw-error"
          : "throw-literal",
  };
}

function detectQuoteStyle(text: string): "single" | "double" | undefined {
  const single = (text.match(/'[^'\n]*'/g) ?? []).length;
  const double = (text.match(/"[^"\n]*"/g) ?? []).length;
  if (single === 0 && double === 0) return undefined;
  return single >= double ? "single" : "double";
}
