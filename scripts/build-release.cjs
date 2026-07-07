const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const targets = process.argv.slice(2);
const builderBin = require.resolve("electron-builder/cli.js");
const args = [builderBin, "--win"];
if (targets.includes("dir")) {
  args.push("--dir");
} else {
  args.push(...(targets.length ? targets : ["nsis", "portable"]));
  args.push("--publish", "never");
}
const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
  ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || "https://npmmirror.com/mirrors/electron-builder-binaries/"
};

const releaseEnvPath = path.join(__dirname, "..", "src", "releaseEnv.js");
const originalReleaseEnv = fs.existsSync(releaseEnvPath) ? fs.readFileSync(releaseEnvPath, "utf8") : "";

try {
  const officialBaseUrl = env.COMPANION_OFFICIAL_BASE_URL || readDotEnvValue("COMPANION_OFFICIAL_BASE_URL") || "";
  fs.writeFileSync(
    releaseEnvPath,
    `export const RELEASE_OFFICIAL_BASE_URL = ${JSON.stringify(officialBaseUrl)};\n`,
    "utf8"
  );

  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env
  });

  if (result.status !== 0) process.exit(result.status || 1);
} finally {
  fs.writeFileSync(releaseEnvPath, originalReleaseEnv || 'export const RELEASE_OFFICIAL_BASE_URL = "";\n', "utf8");
}

function readDotEnvValue(key) {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return "";
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const name = trimmed.slice(0, index).trim();
    if (name !== key) continue;
    return trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return "";
}
