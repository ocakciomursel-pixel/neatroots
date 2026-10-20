import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { afterEach, expect, it } from "vitest";
import { defaultConfig, saveConfig } from "../src/config.js";
import { Roots } from "../src/core.js";
import { freePort, tmpHome } from "./helpers.js";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
let child: ChildProcess | undefined;
let home: string | undefined;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exit = once(child, "exit");
    child.kill();
    await exit;
  }
  child = undefined;
  if (home) fs.rmSync(home, { recursive: true, force: true });
  home = undefined;
});

it("actual start flags stay temporary across normal and explicit preference saves", async () => {
  home = tmpHome();
  const cfg = defaultConfig();
  cfg.port = await freePort();
  cfg.grpcPort = 4327;
  cfg.classifier.laya.enabled = true;
  saveConfig(cfg, path.join(home, "config.yaml"));
  const runtimePort = await freePort();
  const env = { ...process.env, NEATROOTS_HOME: home };
  delete env.NEATROOTS_PORT;
  child = spawn(process.execPath, ["--import", pathToFileURL(path.join(packageDir, "node_modules/tsx/dist/loader.mjs")).href,
    path.join(packageDir, "src/cli.ts"), "start", "--port", String(runtimePort), "--grpc-port", "0", "--no-laya", "--no-engine"],
  { cwd: packageDir, env, stdio: "ignore" });
  const url = `http://127.0.0.1:${runtimePort}`;
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    healthy = await fetch(`${url}/health`).then(r => r.ok).catch(() => false);
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  expect(healthy).toBe(true);
  const save = (body: unknown) => fetch(`${url}/api/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await save({ retention_days: 29 })).ok).toBe(true);
  let disk = YAML.parse(fs.readFileSync(path.join(home, "config.yaml"), "utf8"));
  expect(disk.port).toBe(cfg.port);
  expect(disk.grpcPort).toBe(4327);
  expect(disk.classifier.laya.enabled).toBe(true);
  expect(disk.retention.days).toBe(29);
  // Explicitly saving false must persist, although --no-laya already made runtime false.
  expect((await save({ laya_enabled: false })).ok).toBe(true);
  disk = YAML.parse(fs.readFileSync(path.join(home, "config.yaml"), "utf8"));
  expect(disk.classifier.laya.enabled).toBe(false);
  expect(disk.port).toBe(cfg.port);
  expect((await fetch(`${url}/health`)).ok).toBe(true);
});

it("preserves zero persisted values and ordinary saves without start flags", () => {
  home = tmpHome();
  const cfg = defaultConfig();
  cfg.grpcPort = 0;
  cfg.classifier.laya.enabled = false;
  const roots = new Roots({ home, config: cfg, noEngine: true });
  try {
    roots.config.port = 4998;
    roots.saveConfig();
    const disk = YAML.parse(fs.readFileSync(path.join(home, "config.yaml"), "utf8"));
    expect(disk.port).toBe(4998);
    expect(disk.grpcPort).toBe(0);
    expect(disk.classifier.laya.enabled).toBe(false);
  } finally { roots.close(); }
});
