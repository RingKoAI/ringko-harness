import type { SubagentProvider, SubagentProviderDescriptor } from "./types.ts";

const NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** A named, immutable set of subagent backends. Registration never revokes live runs. */
export class SubagentProviderRegistry {
  private readonly providers = new Map<string, SubagentProvider>();

  register(provider: SubagentProvider): void {
    if (!provider || typeof provider.name !== "string" || !NAME.test(provider.name)) {
      throw new TypeError("Subagent provider name must be a lowercase slug.");
    }
    if (typeof provider.description !== "string" || provider.description.length === 0 || provider.description.length > 512) {
      throw new TypeError(`Subagent provider "${provider.name}" needs a description.`);
    }
    if (typeof provider.start !== "function" && typeof provider.resume !== "function") {
      throw new TypeError(`Subagent provider "${provider.name}" must implement start or resume.`);
    }
    if (this.providers.has(provider.name)) throw new TypeError(`Subagent provider "${provider.name}" is already registered.`);
    this.providers.set(provider.name, provider);
  }

  get(name: string): SubagentProvider | undefined { return this.providers.get(name); }
  has(name: string): boolean { return this.providers.has(name); }

  descriptors(): SubagentProviderDescriptor[] {
    return [...this.providers.values()].map(provider => ({
      name: provider.name,
      kind: provider.kind,
      description: provider.description,
      capabilities: Object.freeze({ ...provider.capabilities }),
    }));
  }

  close(): void { this.providers.clear(); }
}
