import type {
  DeclarationInfo,
  FileAnalysis,
  FileConventions,
  ImportInfo,
} from "../types.js";

const rustStdCrates = new Set(["alloc", "core", "std", "test"]);

const rustKeywords = new Set(["crate", "self", "super"]);

export function analyzeRustFile(filePath: string, text: string): FileAnalysis {
  const declarations: DeclarationInfo[] = [];
  const imports: ImportInfo[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const trimmed = line.trim();

    const functionMatch =
      /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
        trimmed,
      );
    if (functionMatch) {
      declarations.push({
        ...declaration(
          "function",
          functionMatch[1],
          filePath,
          lineNumber,
          textBlock(lines, index),
        ),
        async: /\basync\s+fn\b/.test(trimmed),
        exported: /^pub\b/.test(trimmed),
      });
      continue;
    }

    const typeMatch =
      /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
        trimmed,
      );
    if (typeMatch) {
      declarations.push({
        ...declaration(
          "type",
          typeMatch[1],
          filePath,
          lineNumber,
          textBlock(lines, index),
        ),
        exported: /^pub\b/.test(trimmed),
      });
      continue;
    }

    const implMatch =
      /^impl(?:<[^>]+>)?\s+(?:[A-Za-z_][A-Za-z0-9_:<>]*\s+for\s+)?([A-Za-z_][A-Za-z0-9_:<>]*)/.exec(
        trimmed,
      );
    if (implMatch) {
      declarations.push(
        declaration(
          "type",
          `impl_${lastPathPart(implMatch[1])}`,
          filePath,
          lineNumber,
          textBlock(lines, index),
        ),
      );
      continue;
    }

    const useMatch = /^(?:pub\s+)?use\s+(.+);$/.exec(trimmed);
    if (useMatch) {
      for (const source of rustUseRoots(useMatch[1])) {
        imports.push(importInfo(source, filePath, lineNumber));
      }
    }
  }

  return {
    filePath,
    language: "rust",
    declarations,
    imports,
    conventions: detectRustConventions(text),
  };
}

function declaration(
  kind: "function" | "type",
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
    exported: false,
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
  return {
    source,
    filePath,
    line,
    isExternal: !rustStdCrates.has(source) && !rustKeywords.has(source),
  };
}

function rustUseRoots(useText: string): string[] {
  const roots = new Set<string>();
  const normalized = useText.replace(/\s+/g, "");
  const root = normalized.split("::")[0];
  if (root) roots.add(root.replace(/^\{/, ""));

  for (const match of normalized.matchAll(
    /(?:^|,|\{)([A-Za-z_][A-Za-z0-9_]*)::/g,
  )) {
    roots.add(match[1]);
  }

  return Array.from(roots).filter(Boolean);
}

function textBlock(lines: string[], startIndex: number): string {
  const block: string[] = [];
  let depth = 0;
  let sawBrace = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    block.push(line);
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      }
      if (char === "}") depth -= 1;
    }

    if (sawBrace && depth <= 0) break;
    if (!sawBrace && line.trim().endsWith(";")) break;
  }

  return block.join("\n");
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

function detectRustConventions(text: string): FileConventions {
  const panicCount = (text.match(/\bpanic!\s*\(/g) ?? []).length;
  const resultCount = (text.match(/\bResult\s*</g) ?? []).length;

  return {
    quoteStyle: "double",
    semicolons: true,
    functionStyle: "declaration",
    errorStyle:
      panicCount === 0 && resultCount === 0
        ? "none"
        : resultCount >= panicCount
          ? "throw-error"
          : "throw-literal",
  };
}

function lastPathPart(value: string): string {
  return (
    value
      .split("::")
      .at(-1)
      ?.replace(/[^A-Za-z0-9_]/g, "") ?? value
  );
}
