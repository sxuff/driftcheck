import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ChangedFile } from "./types.js";

const execFileAsync = promisify(execFile);

export async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024 * 16,
    });
    return stdout.trimEnd();
  } catch (error) {
    if (isMaxBufferError(error)) {
      throw new Error(
        "Git output exceeded driftcheck's 16 MB safety limit. Analyze a smaller diff or split the change.",
      );
    }
    throw error;
  }
}

export async function repoRoot(cwd: string): Promise<string> {
  try {
    return await git(["rev-parse", "--show-toplevel"], cwd);
  } catch (error) {
    if (gitErrorText(error).includes("not a git repository")) {
      throw new Error(
        `driftcheck must run inside a Git repository. No repository was found from ${cwd}.`,
      );
    }
    throw error;
  }
}

export async function listTrackedFiles(cwd: string): Promise<string[]> {
  const output = await git(["ls-files"], cwd);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

export async function readHeadFile(
  cwd: string,
  filePath: string,
): Promise<string | undefined> {
  try {
    return await git(["show", `HEAD:${filePath}`], cwd);
  } catch {
    return undefined;
  }
}

export async function getChangedFiles(
  cwd: string,
  mode: "diff" | "staged",
): Promise<ChangedFile[]> {
  const diffArgs =
    mode === "staged"
      ? ["diff", "--cached", "--unified=0", "--diff-filter=ACMR"]
      : ["diff", "--unified=0", "--diff-filter=ACMR"];
  const diff = await git(diffArgs, cwd);
  const changedFiles = parseUnifiedDiff(diff);

  if (mode === "staged") return changedFiles;

  const untracked = await listUntrackedFiles(cwd);
  const knownFiles = new Set(changedFiles.map((file) => file.filePath));
  for (const filePath of untracked) {
    if (knownFiles.has(filePath)) continue;
    const text = await readFile(path.join(cwd, filePath), "utf8");
    changedFiles.push({
      filePath,
      addedLines: new Set(text.split(/\r?\n/).map((_, index) => index + 1)),
    });
  }

  return changedFiles;
}

async function listUntrackedFiles(cwd: string): Promise<string[]> {
  const output = await git(["ls-files", "--others", "--exclude-standard"], cwd);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const changed = new Map<string, Set<number>>();
  let currentFile: string | undefined;
  let newLine = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      if (!changed.has(currentFile)) changed.set(currentFile, new Set());
      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (!currentFile || line.startsWith("diff --git")) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      changed.get(currentFile)?.add(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) continue;

    if (!line.startsWith("\\")) newLine += 1;
  }

  return Array.from(changed.entries()).map(([filePath, addedLines]) => ({
    filePath,
    addedLines,
  }));
}

function isMaxBufferError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  );
}

function gitErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error).toLowerCase();
  const stderr =
    "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return `${error.message} ${stderr}`.toLowerCase();
}
