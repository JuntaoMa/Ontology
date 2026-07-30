// Read-only Agent Profile catalog published by the loopback ACP Bridge.
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AgentsConfig, AgentConfig } from '../lib/types';
import { getProfiles } from '../lib/bridge-api';

export const useConfigStore = defineStore('config', () => {
  const config = ref<AgentsConfig>({ agents: {} });
  const loading = ref(false);
  const error = ref<string | null>(null);

  const agentNames = computed(() => Object.keys(config.value.agents));
  const hasAgents = computed(() => agentNames.value.length > 0);

  async function loadConfig(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      config.value = await getProfiles();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  function getAgent(name: string): AgentConfig | undefined {
    return config.value.agents[name];
  }

  /** Test-only-friendly synchronous catalog replacement. */
  function updateFromEvent(newConfig: AgentsConfig): void {
    config.value = newConfig;
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    config,
    loading,
    error,
    agentNames,
    hasAgents,
    loadConfig,
    getAgent,
    updateFromEvent,
    clearError,
  };
});
