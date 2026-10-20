import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { makeRoots, tmpHome, type TestRoots } from "./helpers.js";

const exec = promisify(execFile);
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function init(tb: TestRoots, steering: boolean) {
  const project = tmpHome();
  cleanup.push(async () => fs.rmSync(project, { recursive: true, force: true }));
  return exec(process.execPath, [
    "--import", pathToFileURL(path.join(packageDir, "node_modules/tsx/dist/loader.mjs")).href,
    path.join(packageDir, "src/cli.ts"), "init",
    ...(steering ? ["--project", "demo", "--steering", "advisory"] : []),
  ], { cwd: project, env: { ...process.env, NEATROOTS_HOME: tb.roots.home, NEATROOTS_PORT: String(tb.roots.config.port) }, timeout: 15000 });
}

describe("init registration with a running server", () => {
  it.each([false, true])("keeps checkDirs in server memory and on disk (steering=%s)", async (steering) => {
    const tb = await makeRoots({ serve: true, noEngine: true });
    cleanup.push(tb.close);
    const existing = path.join(tb.roots.home, "existing-checks");
    fs.mkdirSync(existing);
    tb.roots.config.checkDirs.push(existing);
    tb.roots.config.retention.days = 27;
    tb.roots.saveConfig();
    await init(tb, steering);
    const persisted = YAML.parse(fs.readFileSync(path.join(tb.roots.home, "config.yaml"), "utf8"));
    expect(tb.roots.config.checkDirs).toHaveLength(2);
    expect(tb.roots.config.checkDirs).toContain(existing);
    expect(persisted.checkDirs).toEqual(tb.roots.config.checkDirs);
    expect(persisted.retention.days).toBe(27);
    if (steering) expect(persisted.projects.demo.steering).toBe("advisory");
  });

  it("still registers and persists steering while offline", async () => {
    const tb = await makeRoots({ noEngine: true });
    cleanup.push(tb.close);
    tb.roots.saveConfig();
    await init(tb, true);
    const persisted = YAML.parse(fs.readFileSync(path.join(tb.roots.home, "config.yaml"), "utf8"));
    expect(persisted.checkDirs).toHaveLength(1);
    expect(persisted.projects.demo.steering).toBe("advisory");
  });
});
