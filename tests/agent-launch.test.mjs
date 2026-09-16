import assert from "node:assert/strict";
import test from "node:test";

import { AgentService } from "../dist/services/agent.js";
import { getAgentById } from "../dist/services/registry.js";

test("Claude Code launch plan forwards only the model arg and injects no env", () => {
  const agent = getAgentById("claude-code");
  assert.ok(agent);

  const plan = new AgentService().createLaunchPlan(agent, {
    model: "claude-opus",
  });

  assert.equal(plan.command, "claude");
  assert.deepEqual(plan.args, ["--model", "claude-opus"]);
  assert.equal(plan.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(plan.env.ANTHROPIC_BASE_URL, undefined);
});

test("Codex launch plan forwards only the model and user args", () => {
  const agent = getAgentById("codex");
  assert.ok(agent);

  const plan = new AgentService().createLaunchPlan(agent, {
    model: "gpt-compatible",
  });

  assert.equal(plan.command, "codex");
  assert.deepEqual(plan.args, ["--model", "gpt-compatible"]);
  assert.equal(plan.env.CLI_HOP_API_KEY, undefined);
});

test("OpenCode launch plan uses the run subcommand and injects no env", () => {
  const agent = getAgentById("opencode");
  assert.ok(agent);

  const plan = new AgentService().createLaunchPlan(agent, {
    model: "gpt-5.6-terra",
    args: ["ตอบเพียง pong"],
  });

  assert.equal(plan.command, "opencode");
  assert.deepEqual(plan.args, ["run", "--model", "cli-hop/gpt-5.6-terra", "ตอบเพียง pong"]);
  assert.equal(plan.env.CLI_HOP_API_KEY, undefined);
});

test("Grok Build launch plan forwards only user args and keeps the key out of the environment", () => {
  const agent = getAgentById("grok");
  assert.ok(agent);

  const originalGrokHome = process.env.GROK_HOME;
  process.env.GROK_HOME = "/inherited/grok";
  try {
    const plan = new AgentService().createLaunchPlan(agent, {
      model: "grok-4.5",
      args: ["-p", "hello"],
    });

    assert.equal(plan.command, "grok");
    assert.deepEqual(plan.args, ["-p", "hello"]);
    assert.equal(plan.env.GROK_HOME, undefined);
    assert.equal(plan.env.CLI_HOP_API_KEY, undefined);
  } finally {
    if (originalGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = originalGrokHome;
  }
});

test("launch plan removes inherited credentials without injecting Settings values", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_API_KEY = "inherited-key";
  process.env.ANTHROPIC_BASE_URL = "https://inherited.example.com";
  try {
    const agent = getAgentById("claude-code");
    assert.ok(agent);
    const plan = new AgentService().createLaunchPlan(agent, {
      model: "claude-opus",
    });
    assert.equal(plan.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(plan.env.ANTHROPIC_BASE_URL, undefined);
  } finally {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBase;
  }
});

test("missing agent executable reports an actionable installation error", async () => {
  const service = new AgentService();
  await assert.rejects(
    service.run(
      {
        id: "missing",
        name: "Missing Agent",
        command: "cli-hop-command-that-does-not-exist",
        supportedProtocols: ["chat_completions"],
        installUrl: "https://example.com/install",
      },
      {}
    ),
    (error) =>
      error instanceof Error &&
      error.message.includes("Missing Agent is not installed") &&
      error.message.includes("https://example.com/install")
  );
});