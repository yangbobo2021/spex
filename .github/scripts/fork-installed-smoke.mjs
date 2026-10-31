// Fork-only artifact installation check; not part of the upstream candidate.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

if (process.argv[2] === "verify") {
  const metadata = JSON.parse(readFileSync("download/installer-proof.json", "utf8"));
  const root = resolve("download");
  const installer = resolve(root, metadata.file);
  assert(installer.startsWith(root + sep), "Installer path is outside its artifact");
  assert.equal(metadata.platform, process.platform);
  assert.equal(metadata.arch, process.arch);
  const bytes = readFileSync(installer);
  assert.equal(bytes.length, metadata.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.sha256);
  mkdirSync("installer-smoke-evidence", { recursive: true });
  writeFileSync("installer-smoke-evidence/installer.json", JSON.stringify(metadata, null, 2));
  appendFileSync(process.env.GITHUB_ENV, `SPEX_INSTALLER_FILE=${installer}\n`);
  console.log(JSON.stringify({ verified: true, ...metadata }, null, 2));
  process.exit(0);
}

const executable = process.env.SPEX_INSTALLED_EXECUTABLE;
assert(executable && existsSync(executable), "Installed executable is missing");
assert(process.env.RUNNER_TEMP, "This check requires an isolated CI runner");
const profile = mkdtempSync(join(process.env.RUNNER_TEMP, "spex-installed-smoke-"));
const evidence = "installer-smoke-evidence";
mkdirSync(evidence, { recursive: true });
const shot = join(process.cwd(), evidence, "desktop.png");
const userData = join(profile, "userdata");
const child = spawn(executable, [], {
  env: {
    ...process.env,
    HOME: profile,
    USERPROFILE: profile,
    CODEX_HOME: join(profile, ".codex"),
    CLAUDE_CONFIG_DIR: join(profile, ".claude"),
    XDG_CONFIG_HOME: join(profile, "xdg-config"),
    XDG_CACHE_HOME: join(profile, "xdg-cache"),
    XDG_STATE_HOME: join(profile, "xdg-state"),
    SPEX_HOME: join(profile, "unused-environment-home"),
    SPEX_SMOKE_USERDATA: userData,
    SPEX_ACCEPTANCE: shot,
    SPEX_ACCEPTANCE_CLICKS: "Playbooks,Settings,Dashboard",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "", stderr = "";
child.stdout.on("data", (b) => { stdout += b; });
child.stderr.on("data", (b) => { stderr += b; });
const timeout = setTimeout(() => child.kill(), 180_000);
let code, signal;
try {
  [code, signal] = await once(child, "close");
} finally {
  clearTimeout(timeout);
  writeFileSync(join(evidence, "stdout.log"), stdout);
  writeFileSync(join(evidence, "stderr.log"), stderr);
  writeFileSync(join(evidence, "process.json"), JSON.stringify({ executable, profile, code, signal }, null, 2));
}
assert.equal(code, 0, stderr || stdout);
const start = stdout.lastIndexOf('{\n  "acceptance": ');
const end = stdout.indexOf("\n}", start);
assert(start >= 0 && end > start, "The installed app printed no renderer acceptance report");
const report = JSON.parse(stdout.slice(start, end + 2));
assert(report.acceptance.rootChildren > 0, "Installed app rendered an empty root");
assert.equal(report.acceptance.minimumWidth, 600);
assert.deepEqual(report.consoleErrors, []);
const png = readFileSync(shot);
assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
assert(png.length > 1000, "Screenshot is unexpectedly small");
assert(!existsSync(join(userData, "spex-home", ".lease")), "App did not release its state-root lease");
const proof = {
  status: "passed", commit: process.env.GITHUB_SHA, platform: process.platform,
  executable, code, clicks: ["Playbooks", "Settings", "Dashboard"],
  screenshotBytes: png.length, renderer: report.acceptance, consoleErrors: report.consoleErrors,
  realAgentsCalled: false,
};
writeFileSync(join(evidence, "proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
