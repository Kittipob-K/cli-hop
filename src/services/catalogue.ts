import type { RemoteModel } from "../types.js";

/**
 * The OpenAI Chat Completions catalogue for one agent: models the wire
 * serves (metadata-less models stay eligible per ADR 0002), with the
 * selected model written first.
 */
export function chatCapableCatalogue(
  models: RemoteModel[],
  selected: string
): RemoteModel[] {
  const chatModels = models.filter(
    (model) => !model.apis?.length || model.apis.includes("chat_completions")
  );
  const chosen = chatModels.find((model) => model.id === selected);
  return chosen
    ? [chosen, ...chatModels.filter((model) => model.id !== chosen.id)]
    : chatModels;
}

/** The OpenAI-compatible base URL: endpoint root with /v1 appended. */
export function endpointV1(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/v1`;
}

/** The wire api name omp and pi use for CLI Hop's Chat Completions models. */
export const OPENAI_COMPLETIONS_API = "openai-completions";
