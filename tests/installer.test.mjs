import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  currentPlatformKey,
  displayInstallCommand,
  isInstalled,
  runInstallCommand,
} from "../dist/services/installer.js";
import {
  CUSTOMIZABLE_AGENTS,
  getAgentById,
  installSpecFor,
} from "../dist/services/registry.js";

test("every registered agent has an install spec for all three platforms", () => {
  for (const agent of CUSTOMIZABLE_AGENTS) {
    const spec = agent.installSpec;
    assert.ok(spec, `${agent.id} missing its installSpec`);
  for (const platform of ["macos", "linux", "windows"]) {
      const command = spec[platform];
      assert.ok(command, `${agent.id} has no ${platform} install command`);
      assert.ok(command.steps.length > 0, `${agent.id}/${platform} has empty steps`);
      const display = displayInstallCommand(command);
      assert.ok(display.length > 0, `${agent.id}/${platform} renders empty`);
    }
  }
});

test("install specs use the official commands from each agent's docs", () => {
  const official = {
    "claude-code": "https://claude.ai/install.sh",
    omp: "https://omp.sh/install",
    codex: "https://chatgpt.com/codex/install.sh",
    grok: "https://x.ai/cli/install.sh",
  };
  for (const [agentId, url] of Object.entries(official)) {
    const display = displayInstallCommand(getAgentById(agentId).installSpec.macos);
    assert.ok(
      display.includes(`curl -fsSL ${url}`),
      `${agentId} macOS should curl ${url}, got: ${display}`
    );
  }
  // OpenCode is installed from its npm package on every supported platform,
  // and its postinstall script must run to download the native binary.
  for (const platform of ["macos", "linux", "windows"]) {
    const display = displayInstallCommand(getAgentById("opencode").installSpec[platform]);
    assert.match(display, /npm install -g opencode-ai/);
    assert.match(
      display,
      /cd "\$\(npm root -g\)\/opencode-ai" && node postinstall\.mjs/
    );
  }
  // Windows routes go through PowerShell one-liners; pi routes through npm
  // with the officially documented --ignore-scripts flag.
  assert.match(
    displayInstallCommand(getAgentById("claude-code").installSpec.windows),
    /irm https:\/\/claude\.ai\/install\.ps1 \| iex/
  );
  assert.match(
    displayInstallCommand(getAgentById("pi").installSpec.macos),
    /npm install -g --ignore-scripts @earendil-works\/pi-coding-agent/
  );
  // xAI has no npm package — never offer the third-party grok-cli.
  assert.ok(
    !JSON.stringify(getAgentById("grok").installSpec).includes("grok-cli"),
    "grok spec must not reference the third-party grok-cli package"
  );
});

test("installSpecFor returns undefined for unknown agents and platforms", () => {
  assert.equal(installSpecFor("not-an-agent"), undefined);
  assert.equal(installSpecFor("claude-code", "solaris" /* not a PlatformKey */), undefined);
  const spec = installSpecFor("claude-code", "macos");
  assert.ok(spec);
  assert.equal(spec.docsUrl, "https://code.claude.com/docs/en/setup");
});

test("isInstalled finds a stub executable placed on PATH", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "cli-hop-path-"));
  const stub = join(binDir, "cli-hop-stub-cmd");
  await writeFile(stub, "#!/bin/sh\nexit 0\n");
  await chmod(stub, 0o755);

  const originalPath = process.env.PATH;
  try {
    process.env.PATH = binDir;
    assert.equal(await isInstalled("cli-hop-stub-cmd"), true);
    assert.equal(await isInstalled("cli-hop-missing-cmd"), false);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("isInstalled ignores the cmux grok wrapper when Grok Build is absent", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "cli-hop-grok-wrapper-"));
  const wrapper = join(binDir, "grok");
  await writeFile(wrapper, "#!/usr/bin/env bash\n# cmux grok wrapper - installs cmux hooks\n");
  await chmod(wrapper, 0o755);

  const originalPath = process.env.PATH;
  try {
    process.env.PATH = binDir;
    assert.equal(await isInstalled("grok"), false);
  } finally {
    process.env.PATH = originalPath;
  }
});
test("runInstallCommand executes a simple command and reports failure output", async () => {
  const ok = await runInstallCommand({
    steps: [{ kind: "script", shell: "sh", command: "echo hello-install" }],
  });
  assert.equal(ok.ok, true);

  const failed = await runInstallCommand({
    steps: [{ kind: "script", shell: "sh", command: "echo boom >&2; exit 3" }],
  });
  assert.equal(failed.ok, false);
  assert.match(failed.output, /boom/);
});

test("sequential install steps stop at the first failing step", async () => {
  const ran = [];
  const result = await runInstallCommand(
    {
      steps: [{
        kind: "sequential",
        steps: [
          { kind: "script", shell: "sh", command: "exit 1" },
          { kind: "script", shell: "sh", command: "echo should-not-run" },
        ],
      }],
    },
    { onProgress: (msg) => ran.push(msg) }
  );
  assert.equal(result.ok, false);
  assert.equal(
    ran.filter((m) => m.includes("exit 1")).length,
    2,
    "outer sequential describes all steps, inner runProgress runs the failing one"
  );
  assert.ok(
    !ran.some((m, i) => i > 0 && m.includes("should-not-run")),
    "second step must not run after the first fails"
  );
});

test("currentPlatformKey maps this test platform", () => {
  const expected = process.platform === "darwin" ? "macos"
    : process.platform === "linux" ? "linux"
    : process.platform === "win32" ? "windows"
    : undefined;
  assert.equal(currentPlatformKey(), expected);
});
