import type { ProviderId, ProviderInfo } from "@forgeboard/shared";
import { claudeCodeProvider } from "./claude-code.js";
import { mockProvider } from "./mock.js";
import type { Provider } from "./types.js";

const providers: Record<ProviderId, Provider> = {
  "claude-code": claudeCodeProvider,
  mock: mockProvider,
};

export function getProvider(id: ProviderId): Provider {
  return providers[id];
}

export async function listProviders(): Promise<ProviderInfo[]> {
  return Promise.all(
    Object.values(providers).map(async (p) => ({ id: p.id, label: p.label, ...(await p.check()) })),
  );
}
