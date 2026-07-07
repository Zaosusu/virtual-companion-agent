import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnv({ dir = process.cwd(), fileName = ".env" } = {}) {
  const envPath = path.join(dir, fileName);
  if (!existsSync(envPath)) return { loaded: false, path: envPath };

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = unquoteEnvValue(trimmed.slice(separator + 1).trim());
    if (!(key in process.env)) process.env[key] = value;
  }

  return { loaded: true, path: envPath };
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
