// Fork-only checks of components rebuilt or laid out differently in CI.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.versions.electron, "44.0.0");
const modules = process.env.SPEX_INSTALLED_ARCHIVE + ".unpacked/node_modules";
const require = createRequire(join(modules, "@sublang/spex-core/package.json"));
const scratch = mkdtempSync(join(tmpdir(), "spex-runtime-probe-"));
const proof = { platform: process.platform, arch: process.arch, versions: process.versions, checks: {} };
const evidence = "native-probe-evidence";
mkdirSync(evidence, { recursive: true });
const pass = (name, detail = true) => { proof.checks[name] = detail; console.log("passed " + name); };
try {
  const cliRoot = join(modules, "@sublang/spex");
  const cliVersion = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")).version;
  const scaffold = join(scratch, "scaffold");
  mkdirSync(scaffold);
  const cli = spawnSync(process.execPath, [join(cliRoot, "dist/cli.js"), "scaffold", "--lang", "en", "--agents", "codex", scaffold], {
    encoding: "utf8", env: process.env, timeout: 20_000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert(existsSync(join(scaffold, "specs/meta.md")), cli.stdout);
  pass("bundled-cli-through-app-node", cliVersion);

  const esbuild = require("esbuild");
  const transformed = esbuild.transformSync("const count: number = 7;", { loader: "ts" });
  assert(transformed.code.includes("count = 7"));
  esbuild.stop();
  pass("bundled-esbuild-typescript-transform");

  if (process.platform === "darwin") {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    assert.equal(db.prepare("SELECT 7 AS result").get().result, 7);
    db.close();
    pass("electron-native-sqlite-addon");
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    assert.equal(db.prepare("SELECT 7 AS result").get().result, 7);
    db.close();
    pass("bundled-node-sqlite");
    const { getProcessTree } = require("@vscode/windows-process-tree");
    const tree = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Native process tree timed out")), 10_000);
      getProcessTree(process.pid, value => { clearTimeout(timer); resolve(value); });
    });
    assert.equal(tree?.pid, process.pid);
    pass("electron-native-windows-process-tree");
  }

  const dugite = require("dugite");
  const preparedGit = dugite.setupEnvironment({});
  Object.assign(process.env, preparedGit.env);
  const gitRoot = dirname(require.resolve("dugite/package.json"));
  const gitExe = process.platform === "win32" ? join(gitRoot, "git/cmd/git.exe") : join(gitRoot, "git/bin/git");
  const gitVersion = execFileSync(gitExe, ["--version"], { encoding: "utf8" }).trim();
  process.env.PATH = [dirname(gitExe), join(gitRoot, "git/usr/bin"), process.env.PATH].join(delimiter);
  pass("bundled-git-executable", gitVersion);

  const bin = join(modules, "@sublang/playbook/reference/sdlc/code.playbook/bin");
  const { createCaptainSessionStore } = await import(pathToFileURL(join(bin, "session-store.js")));
  const store = createCaptainSessionStore({ sessionsDir: join(scratch, "sessions"), hostname: "machine-id:v1:" + randomUUID() });
  const id = randomUUID();
  const lease = await store.acquire(id);
  try {
    await lease.assertOwner();
    assert.equal(lease.streamStatus().incomplete, false);
    await lease.append({ type: "installer-runtime-probe", timestamp: Date.now(), text: "retained evidence" });
  } finally { await lease.release(); }
  const history = await store.readStream(id);
  assert(history.entries.some(entry => entry.record.type === "installer-runtime-probe"));
  const again = await store.acquire(id);
  await again.release();
  pass("playbook-session-lease-replay-and-reacquire");

  const repo = join(scratch, "repository");
  mkdirSync(repo);
  const git = (...args) => execFileSync(gitExe, args, { cwd: repo, encoding: "utf8" });
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, "fixture.txt"), "owned repository fixture\n");
  git("add", "fixture.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixture");
  const { createRepositoryEffectCoordinator, resolveCanonicalGitWorktree, _internal } = await import(pathToFileURL(join(bin, "repository-effects.js")));
  const coordinator = createRepositoryEffectCoordinator({ hostname: "machine-id:v1:" + randomUUID() });
  const claim = await coordinator.acquire(repo);
  try {
    await claim.assertOwner();
    if (process.platform === "win32") {
      const identity = await resolveCanonicalGitWorktree(repo);
      const active = join(identity.gitDir, _internal.claimRootName, "active");
      execFileSync("icacls.exe", [active, "/grant", "*S-1-1-0:(OI)(CI)(R)"], { windowsHide: true });
      try {
        await assert.rejects(coordinator.acquire(repo, { signal: AbortSignal.timeout(5_000) }), /private|permission|unsafe/i);
      } finally {
        execFileSync("icacls.exe", [active, "/remove:g", "*S-1-1-0"], { windowsHide: true });
      }
      pass("overbroad-repository-claim-dacl-refused");
    }
  } finally { await claim.release(); }
  const successor = await coordinator.acquire(repo);
  await successor.release();
  pass("repository-claim-and-reacquire");

  if (process.platform === "win32") {
    // Keep the shipped storage integration case unchanged. The separate
    // mirror flow below retains its Git fixture: deleting read-only Git
    // objects under Electron's Windows rmSync masked the prior assertions.
    const tests = ["windows-storage.integration.test.js"];
    const result = spawnSync(process.execPath, ["--test", ...tests.map(name => join(modules, "@sublang/spex-core/dist", name))], {
      encoding: "utf8", env: process.env, timeout: 120_000,
    });
    writeFileSync(join(evidence, "windows-storage-tests.log"), result.stdout + result.stderr);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    pass("packaged-core-private-storage");

    const { gitSource, defaultRunGit } = await import(pathToFileURL(join(modules, "@sublang/spex/dist/lib/environment/git-source.js")));
    const mirrorFixture = mkdtempSync(join(tmpdir(), "spex-git-longpaths-"));
    proof.retainedGitFixture = mirrorFixture;
    const origin = join(mirrorFixture, "origin");
    mkdirSync(origin);
    const originGit = (...args) => execFileSync(gitExe, args, { cwd: origin, encoding: "utf8" }).trim();
    originGit("init", "--quiet", "--initial-branch=main");
    writeFileSync(join(origin, "README.md"), "Real file-transport source\n".repeat(64));
    originGit("add", "README.md");
    originGit("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Source");
    const head = originGit("rev-parse", "HEAD");
    const config = readFileSync(join(origin, ".git/config"));
    const mirrorName = "a".repeat(64) + "." + "b".repeat(36);
    const componentLength = 201 - join(mirrorFixture, "cache", "git", mirrorName).length - 1;
    assert(componentLength > 0 && componentLength <= 255);
    const cache = join(mirrorFixture, "cache", "c".repeat(componentLength));
    assert.equal(join(cache, "git", mirrorName).length, 201);
    assert(join(cache, "git", mirrorName, "objects/pack", "pack-" + "c".repeat(40) + ".keep").length > 260);
    const source = gitSource(cache, { runGit: (args, options) => defaultRunGit(["-c", "core.autocrlf=true", ...args], options) });
    const fetched = await source.fetch(pathToFileURL(origin).href, "main");
    assert.equal(fetched.commit, head);
    assert.deepEqual(readFileSync(join(fetched.dir, "README.md")), readFileSync(join(origin, "README.md")));
    assert.deepEqual(await source.fetch(pathToFileURL(origin).href, head), fetched);
    assert.deepEqual(readFileSync(join(origin, ".git/config")), config);
    pass("packaged-git-long-mirror-fetch-and-cache-reuse");
  }
  process.env.SPEX_PROBE_CORE = join(modules, "@sublang/spex-core");
  process.env.SPEX_PROBE_OUTPUT = join(evidence, "github-install-proof.json");
  await import("./github-install-probe.mjs");
  pass("github-package-catalog-session-and-codex-skill-export");
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.error = error.stack;
  throw error;
} finally {
  // These owned fixtures are evidence on a disposable CI VM. Retain them
  // instead of changing ACLs or deleting evidence merely to green cleanup.
  proof.retainedFixture = scratch;
  writeFileSync(join(evidence, "proof.json"), JSON.stringify(proof, null, 2));
}
