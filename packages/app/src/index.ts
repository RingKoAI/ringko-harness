import { createRingKo, type RingKoConfig } from "@ringko-ai/sdk";

export interface AppOptions extends RingKoConfig {
  workspace: string;
}

export interface RingKoApp {
  readonly workspace: string;
  run(prompt: string): Promise<string>;
}

export function createApp(options: AppOptions): RingKoApp {
  const ringko = createRingKo(options);
  return {
    workspace: options.workspace,
    async run(prompt) {
      return (await ringko.run(prompt)).content;
    },
  };
}
