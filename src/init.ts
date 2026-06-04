import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig } from "./config.js";

export async function initializeConfig(cwd: string): Promise<{
  generated?: string;
  skipped?: string;
}> {
  const root = path.resolve(cwd);
  const relativePath = "driftcheck.config.json";
  const fullPath = path.join(root, relativePath);
  if (await exists(fullPath)) {
    return { skipped: `${relativePath} already exists` };
  }
  await writeFile(
    fullPath,
    `${JSON.stringify(defaultConfig, null, 2)}\n`,
    "utf8",
  );
  return { generated: relativePath };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
