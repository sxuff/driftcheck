import ts from "typescript";
import {
  DeclarationInfo,
  FileAnalysis,
  FileConventions,
  ImportInfo,
} from "../types.js";
import { isExternalImport } from "../files.js";

export function analyzeTypeScriptFile(
  filePath: string,
  text: string,
): FileAnalysis {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );

  const declarations: DeclarationInfo[] = [];
  const imports: ImportInfo[] = [];
  const functionStyles = new Set<"declaration" | "arrow">();
  const exportStyles = new Set<"named" | "default">();
  let throwErrorCount = 0;
  let throwLiteralCount = 0;

  function lineOf(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function exported(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return Boolean(
      modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
  }

  function isAsync(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return Boolean(
      modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
    );
  }

  function addDeclaration(
    node: ts.Node,
    kind: "function" | "class",
    name: string,
    style?: "declaration" | "arrow",
  ): void {
    if (style) functionStyles.add(style);
    declarations.push({
      kind,
      name,
      filePath,
      line: lineOf(node),
      exported: exported(node),
      async: isAsync(node),
      text: node.getText(sourceFile),
      tokens: tokenizeDeclaration(name, node.getText(sourceFile)),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        source: node.moduleSpecifier.text,
        filePath,
        line: lineOf(node),
        isExternal: isExternalImport(node.moduleSpecifier.text),
      });
    }

    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      exportStyles.add(ts.isExportAssignment(node) ? "default" : "named");
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      if (exported(node)) exportStyles.add("named");
      addDeclaration(node, "function", node.name.text, "declaration");
    }

    if (ts.isClassDeclaration(node) && node.name) {
      if (exported(node)) exportStyles.add("named");
      addDeclaration(node, "class", node.name.text);
    }

    if (ts.isVariableStatement(node)) {
      if (exported(node)) exportStyles.add("named");
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          addDeclaration(
            declaration,
            "function",
            declaration.name.text,
            ts.isArrowFunction(declaration.initializer) ? "arrow" : "declaration",
          );
        }
      }
    }

    if (ts.isThrowStatement(node) && node.expression) {
      if (ts.isNewExpression(node.expression)) throwErrorCount += 1;
      else throwLiteralCount += 1;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    filePath,
    language: filePath.endsWith(".js") ||
      filePath.endsWith(".jsx") ||
      filePath.endsWith(".mjs") ||
      filePath.endsWith(".cjs")
      ? "javascript"
      : "typescript",
    declarations,
    imports,
    conventions: {
      quoteStyle: detectQuoteStyle(text),
      semicolons: detectSemicolons(text),
      exportStyle: toStyle(exportStyles),
      functionStyle: toStyle(functionStyles),
      errorStyle:
        throwErrorCount === 0 && throwLiteralCount === 0
          ? "none"
          : throwErrorCount >= throwLiteralCount
            ? "throw-error"
            : "throw-literal",
    },
  };
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function tokenizeDeclaration(name: string, text: string): string[] {
  return Array.from(
    new Set(
      `${name} ${text}`
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .match(/[a-z0-9]+/g) ?? [],
    ),
  ).filter((token) => token.length > 2);
}

function detectQuoteStyle(text: string): "single" | "double" | undefined {
  const single = (text.match(/'[^'\n]*'/g) ?? []).length;
  const double = (text.match(/"[^"\n]*"/g) ?? []).length;
  if (single === 0 && double === 0) return undefined;
  return single >= double ? "single" : "double";
}

function detectSemicolons(text: string): boolean | undefined {
  const statements = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(const|let|var|return|import|export|throw)\b/.test(line));
  if (statements.length === 0) return undefined;
  const semicolonCount = statements.filter((line) => line.endsWith(";")).length;
  return semicolonCount / statements.length >= 0.5;
}

function toStyle<T extends string>(styles: Set<T>): T | "mixed" | undefined {
  if (styles.size === 0) return undefined;
  if (styles.size === 1) return Array.from(styles)[0];
  return "mixed";
}
