import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function makeFixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "driftcheck-fixture-"));
  await mkdir(path.join(root, "src", "utils"), { recursive: true });
  await mkdir(path.join(root, "src", "features"), { recursive: true });

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        type: "module",
        dependencies: {
          "date-fns": "^4.1.0",
          zod: "^3.23.8",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, "src", "utils", "date.ts"),
    [
      "export function formatDateForDisplay(value: Date): string {",
      "  if (Number.isNaN(value.getTime())) {",
      "    throw new Error('Invalid date')",
      "  }",
      "  return value.toISOString().slice(0, 10)",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "features", "user.ts"),
    [
      "export const normalizeUserName = (name: string): string => {",
      "  return name.trim().toLowerCase()",
      "}",
      "",
    ].join("\n"),
  );

  await git(root, ["init"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);

  return root;
}

export async function makePythonFixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "driftcheck-python-fixture-"));
  await mkdir(path.join(root, "app", "utils"), { recursive: true });
  await mkdir(path.join(root, "app", "features"), { recursive: true });

  await writeFile(
    path.join(root, "pyproject.toml"),
    [
      "[project]",
      'name = "python-fixture"',
      'dependencies = ["pydantic>=2"]',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "app", "utils", "dates.py"),
    [
      "def format_date_for_display(value):",
      "    if value is None:",
      "        raise ValueError('invalid date')",
      "    return value.isoformat()[:10]",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "app", "features", "users.py"),
    [
      "def normalize_user_name(name):",
      "    return name.strip().lower()",
      "",
    ].join("\n"),
  );

  await git(root, ["init"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);

  return root;
}

export async function makeRustFixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "driftcheck-rust-fixture-"));
  await mkdir(path.join(root, "src", "utils"), { recursive: true });
  await mkdir(path.join(root, "src", "features"), { recursive: true });

  await writeFile(
    path.join(root, "Cargo.toml"),
    [
      "[package]",
      'name = "rust-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'serde = "1"',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "utils", "dates.rs"),
    [
      "pub fn format_date_for_display(value: &str) -> String {",
      "    value.to_string()",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "features", "users.rs"),
    [
      "pub fn normalize_user_name(name: &str) -> String {",
      "    name.trim().to_lowercase()",
      "}",
      "",
    ].join("\n"),
  );

  await git(root, ["init"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);

  return root;
}

export async function makeAgentReadyFixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "driftcheck-agents-fixture-"));
  await mkdir(path.join(root, "src", "utils"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "agent-ready-fixture",
        type: "module",
        scripts: {
          test: "vitest run",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          dayjs: "^1.11.13",
        },
        devDependencies: {
          vitest: "^4.1.7",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(
    path.join(root, "src", "utils", "date.ts"),
    [
      "import dayjs from 'dayjs'",
      "",
      "export function formatDate(value: Date): string {",
      "  return dayjs(value).format('YYYY-MM-DD')",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "tests", "date.test.ts"),
    [
      "import { describe, expect, it } from 'vitest'",
      "import { formatDate } from '../src/utils/date.js'",
      "",
      "describe('formatDate', () => {",
      "  it('formats dates', () => {",
      "    expect(formatDate(new Date(0))).toBe('1970-01-01')",
      "  })",
      "})",
      "",
    ].join("\n"),
  );

  await git(root, ["init"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);

  return root;
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trimEnd();
}
