import type { ConversationContext, ConversationMessage } from "../types/index.js";

type StreamTextResult = {
  textStream: AsyncIterable<string>;
};

type StreamTextFn = (input: {
  model: unknown;
  messages: Array<{ role: string; content: string }>;
  tools?: unknown;
  abortSignal?: AbortSignal;
}) => StreamTextResult;

export interface VercelAIOrchestratorConfig {
  model: unknown;
  systemPrompt?: string;
  tools?: unknown;
  streamText?: StreamTextFn;
}

export const MAESTRO_ROLE = "maestro";

export class VercelAIOrchestrator {
  private config: VercelAIOrchestratorConfig;
  private streamTextFn: StreamTextFn;

  constructor(config: VercelAIOrchestratorConfig) {
    this.config = config;
    if (config.streamText) {
      this.streamTextFn = config.streamText;
    } else {
      this.streamTextFn = () => {
        throw new Error(
          "VercelAIOrchestrator requires a streamText function. Pass `streamText` from the `ai` SDK in config.",
        );
      };
    }
  }

  generate(
    transcript: string,
    context: ConversationContext,
    signal?: AbortSignal,
  ): ReadableStream<string> {

    const messages: ConversationMessage[] = [
      ...context.messages,
      { role: "user" as const, content: transcript },
    ];

    if (this.config.systemPrompt && messages[0]?.role !== "system") {
      messages.unshift({ role: "system", content: this.config.systemPrompt });
    }

    const result = this.streamTextFn({
      model: this.config.model,
      messages,
      tools: this.config.tools,
      abortSignal: signal,
    });

    const asyncIterable = result.textStream;
    let assistantText = "";

    return new ReadableStream<string>({
      start: async (controller) => {
        try {
          for await (const chunk of asyncIterable) {
            if (signal?.aborted) {
              controller.close();
              return;
            }
            assistantText += chunk;
            controller.enqueue(chunk);
          }
          context.messages.push({ role: "user", content: transcript });
          context.messages.push({ role: "assistant", content: assistantText });
          controller.close();
        } catch (err: any) {
          if (err.name !== "AbortError") {
            controller.error(err);
          } else {
            controller.close();
          }
        }
      },
    });
  }
}
