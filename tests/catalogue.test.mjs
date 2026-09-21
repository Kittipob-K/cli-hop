import assert from "node:assert/strict";
import test from "node:test";

import { chatCapableCatalogue, endpointV1, OPENAI_COMPLETIONS_API } from "../dist/services/catalogue.js";

test("chatCapableCatalogue keeps metadata-less and chat_completions models", () => {
  const models = [
    { id: "claude-1", apis: ["messages"] },
    { id: "gpt-1", apis: ["chat_completions"] },
    { id: "legacy-1" },
    { id: "gpt-2", apis: ["responses"] },
  ];
  const catalogue = chatCapableCatalogue(models, "gpt-1");
  assert.deepEqual(catalogue.map((m) => m.id), ["gpt-1", "legacy-1"]);
});

test("chatCapableCatalogue writes the selected model first", () => {
  const models = [
    { id: "a", apis: ["chat_completions"] },
    { id: "b", apis: ["chat_completions"] },
  ];
  assert.deepEqual(chatCapableCatalogue(models, "b").map((m) => m.id), ["b", "a"]);
});

test("chatCapableCatalogue returns the plain catalogue when the selection is absent", () => {
  const models = [{ id: "a", apis: ["chat_completions"] }];
  assert.deepEqual(chatCapableCatalogue(models, "missing").map((m) => m.id), ["a"]);
});

test("endpointV1 joins /v1 once and normalizes trailing slashes", () => {
  assert.equal(endpointV1("https://api.cli-hop.cc"), "https://api.cli-hop.cc/v1");
  assert.equal(endpointV1("https://api.cli-hop.cc/"), "https://api.cli-hop.cc/v1");
  assert.equal(endpointV1("https://api.cli-hop.cc///"), "https://api.cli-hop.cc/v1");
});

test("the shared wire api constant is the omp/pi completions name", () => {
  assert.equal(OPENAI_COMPLETIONS_API, "openai-completions");
});
