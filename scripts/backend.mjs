#!/usr/bin/env node
// Cross-platform launcher for the FastAPI backend (macOS, Linux, Windows).
//
//   node scripts/backend.mjs setup   create .venv and install backend/requirements-dev.txt
//   node scripts/backend.mjs dev     run uvicorn with reload on port 8000
//   node scripts/backend.mjs test    run the backend pytest suite
//
// Extra arguments are passed through, e.g. `npm run backend:dev -- --port 8001`.
// Variables from .env and .env.local are loaded for the backend without overriding
// variables already set in the shell.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIN_PYTHON = [3, 12];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const venvDir = path.join(root, ".venv");
const venvPython = isWindows ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");

function fail(message) {
  console.error(`[backend] ${message}`);
  process.exit(1);
}

function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    const quoted = /^(['"])(.*?)\1(?:\s+#.*)?$/.exec(value);
    values[match[1]] = quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
  }
  return values;
}

function backendEnv() {
  const fileValues = { ...parseEnvFile(path.join(root, ".env")), ...parseEnvFile(path.join(root, ".env.local")) };
  const env = { ...fileValues, ...process.env };
  const backendPath = path.join(root, "backend");
  env.PYTHONPATH = env.PYTHONPATH ? `${backendPath}${path.delimiter}${env.PYTHONPATH}` : backendPath;
  return env;
}

/** Finds a system Python >= 3.12 to create the virtual environment. */
function findSystemPython() {
  const candidates = isWindows ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  const found = [];
  for (const [command, ...prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8", timeout: 15_000 });
    const version = probe.status === 0 ? probe.stdout.trim() : "";
    if (!/^\d+\.\d+$/.test(version)) continue;
    const [major, minor] = version.split(".").map(Number);
    if (major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1])) return { command, prefix, version };
    found.push(`${[command, ...prefix].join(" ")} (${version})`);
  }
  const seen = found.length ? ` Found only: ${found.join(", ")}.` : "";
  fail(`Python ${MIN_PYTHON.join(".")}+ was not found on PATH.${seen} Install it from https://www.python.org/downloads/ and retry.`);
}

function runSync(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) fail(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function requireVenv() {
  if (!existsSync(venvPython)) fail("No backend virtual environment found. Run `npm run backend:setup` first.");
}

/** Runs the venv Python as a child that exits with the parent, forwarding its exit code. */
function runPython(args) {
  requireVenv();
  const child = spawn(venvPython, args, { cwd: root, stdio: "inherit", env: backendEnv() });
  const forward = (signal) => { if (!child.killed) child.kill(signal); };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  child.on("error", (error) => fail(`Could not start Python: ${error.message}`));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

const [command, ...extra] = process.argv.slice(2);

switch (command) {
  case "setup": {
    if (!existsSync(venvPython)) {
      const python = findSystemPython();
      console.log(`[backend] Creating .venv with ${[python.command, ...python.prefix].join(" ")} (Python ${python.version})`);
      runSync(python.command, [...python.prefix, "-m", "venv", venvDir]);
    }
    runSync(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", path.join("backend", "requirements-dev.txt"), ...extra]);
    console.log("[backend] Ready. Start it with `npm run backend:dev`.");
    break;
  }
  case "dev":
    runPython(["-m", "uvicorn", "app.main:app", "--reload", "--reload-dir", "backend", "--port", "8000", ...extra]);
    break;
  case "test":
    runPython(["-m", "pytest", "-q", "backend/tests", ...extra]);
    break;
  default:
    fail(`Unknown command "${command ?? ""}". Use one of: setup, dev, test.`);
}
