import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export async function packageVersion(): Promise<string> {
  const packagePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    version?: string;
  };
  if (!packageJson.version) throw new Error("Package version is missing.");
  return packageJson.version;
}
