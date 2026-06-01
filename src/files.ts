import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Language } from "./types.js";

export const supportedExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
  ".rs",
]);

export function isSupportedSourceFile(filePath: string): boolean {
  return supportedExtensions.has(path.extname(filePath));
}

export async function readTextFile(
  root: string,
  filePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(path.join(root, filePath), "utf8");
  } catch {
    return undefined;
  }
}

export function isExternalImport(source: string): boolean {
  return (
    !source.startsWith(".") && !source.startsWith("/") && !source.includes(":")
  );
}

export function sourceLanguage(filePath: string): Language | undefined {
  const extension = path.extname(filePath);
  if (extension === ".py") return "python";
  if (extension === ".rs") return "rust";
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
  return undefined;
}
