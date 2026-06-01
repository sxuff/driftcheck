import { sourceLanguage } from "../files.js";
import type { FileAnalysis } from "../types.js";
import { analyzePythonFile } from "./python.js";
import { analyzeRustFile } from "./rust.js";
import { analyzeTypeScriptFile } from "./typescript.js";

export function analyzeSourceFile(
  filePath: string,
  text: string,
): FileAnalysis | undefined {
  const language = sourceLanguage(filePath);
  if (language === "python") return analyzePythonFile(filePath, text);
  if (language === "rust") return analyzeRustFile(filePath, text);
  if (language === "typescript" || language === "javascript") {
    return analyzeTypeScriptFile(filePath, text);
  }
  return undefined;
}
