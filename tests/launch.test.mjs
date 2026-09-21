import assert from "node:assert/strict";
import test from "node:test";

import { LaunchCoordinator } from "../dist/services/launch.js";
import { getAgentById } from "../dist/services/registry.js";

test("LaunchCoordinator centralizes compatible pool filtering", () => {
  const coordinator = new LaunchCoordinator();
  const agent = getAgentById("codex");
  assert.ok(agent);
  const pools = [
    { id: "messages", name: "Messages", model: "m", agents: [getAgentById("claude-code")] },
    { id: "responses", name: "Responses", model: "r", agents: [agent] },
  ];
  assert.deepEqual(coordinator.compatiblePools(pools, agent).map((pool) => pool.id), ["responses"]);
});

test("LaunchCoordinator reports protocol mismatch even without model metadata", () => {
  const coordinator = new LaunchCoordinator();
  const agent = getAgentById("codex");
  const pool = { id: "messages", name: "Messages", model: "m", agents: [getAgentById("claude-code")] };
  const problem = coordinator.compatibilityProblem(agent, pool, "m");
  assert.match(problem, /does not support/);
});

test("LaunchCoordinator checks catalogue presence and capabilities when metadata exists", () => {
  const coordinator = new LaunchCoordinator();
  const agent = getAgentById("codex");
  const pool = { id: "responses", name: "Responses", model: "r", agents: [agent] };
  assert.equal(coordinator.compatibilityProblem(agent, pool, "r"), null);
  assert.match(
    coordinator.compatibilityProblem(agent, pool, "unknown", [{ id: "other", apis: ["responses"] }]),
    /not in the CLI Hop catalogue/
  );
  assert.match(
    coordinator.compatibilityProblem(agent, pool, "claude-1", [{ id: "claude-1", apis: ["messages"] }]),
    /does not support/
  );
});

test("LaunchCoordinator skips catalogue checks when the Models API is down", () => {
  const coordinator = new LaunchCoordinator();
  const agent = getAgentById("codex");
  const pool = { id: "responses", name: "Responses", model: "r", agents: [agent] };
  assert.equal(coordinator.compatibilityProblem(agent, pool, "r", undefined), null);
});

test("LaunchCoordinator prepares one consistent launch contract", async () => {
  const calls = [];
  const agentService = {
    async prepare(agent, input) {
      calls.push({ agent: agent.id, input });
      return ["config.toml"];
    },
    async run() { return 0; },
  };
  const coordinator = new LaunchCoordinator(undefined, agentService);
  const agent = getAgentById("opencode");
  assert.ok(agent);
  const result = await coordinator.prepare({
    agent,
    poolId: "remote:model",
    model: "model",
    settings: { apiKey: "key", baseUrl: "https://gateway.example.com/v1" },
    args: ["--yes"],
    models: [{ id: "model", apis: ["chat_completions"] }],
  });
  assert.equal(result.endpoint, "https://gateway.example.com");
  assert.deepEqual(result.changedFiles, ["config.toml"]);
  assert.deepEqual(result.options, {
    pool: "remote:model",
    model: "model",
    args: ["--yes"],
  });
  assert.equal(calls[0].input.endpoint, "https://gateway.example.com");
});

test("LaunchCoordinator runs a prepared launch without preparing twice", async () => {
  const calls = [];
  const agentService = {
    async prepare() {
      calls.push("prepare");
      return [];
    },
    async run() {
      calls.push("run");
      return 7;
    },
  };
  const coordinator = new LaunchCoordinator(undefined, agentService);
  const agent = getAgentById("opencode");
  assert.ok(agent);
  const prepared = await coordinator.prepare({
    agent,
    poolId: "local:opencode",
    model: "model",
    settings: { apiKey: "key", baseUrl: "https://gateway.example.com/v1" },
  });
  assert.equal(await coordinator.runPrepared(agent, prepared), 7);
  assert.deepEqual(calls, ["prepare", "run"]);
});
