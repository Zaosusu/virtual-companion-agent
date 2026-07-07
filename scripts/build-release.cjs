const { spawnSync } = require("node:child_process");

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

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env
});

if (result.status !== 0) process.exit(result.status || 1);
