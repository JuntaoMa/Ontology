<script setup lang="ts">
import { computed, watch } from 'vue';
import { useConfigStore } from '../stores/config';

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [agentName: string];
}>();

const configStore = useConfigStore();

const selectedAgent = defineModel<string>('selected', { default: '' });

const agents = computed(() => configStore.agentNames);
const hasAgents = computed(() => configStore.hasAgents);
const selectedProfile = computed(() =>
  selectedAgent.value ? configStore.getAgent(selectedAgent.value) : undefined
);

/** Build the display label for each agent once, instead of calling
 * `getAgentTransportKind` twice per option in the template. */
const agentLabels = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  for (const name of agents.value) {
    const profile = configStore.getAgent(name);
    const title = profile?.title || name;
    const revision = profile?.revision ? ` · ${profile.revision}` : '';
    const unavailable = profile?.status === 'unavailable' ? ' · unavailable' : '';
    out[name] = `${title}${revision}${unavailable}`;
  }
  return out;
});

// Auto-select first agent when agents are available and none selected
watch(agents, (newAgents) => {
  if (newAgents.length > 0 && !selectedAgent.value) {
    selectedAgent.value = newAgents[0];
    emit('select', newAgents[0]);
  }
}, { immediate: true });

function handleSelect(event: Event) {
  const target = event.target as HTMLSelectElement;
  selectedAgent.value = target.value;
  if (target.value) {
    emit('select', target.value);
  }
}
</script>

<template>
  <div class="agent-selector">
    <label for="agent-select">Agent:</label>
    <select
      id="agent-select"
      :value="selectedAgent"
      @change="handleSelect"
      :disabled="!hasAgents || disabled"
    >
      <option value="" disabled>
        {{ hasAgents ? 'Select an agent...' : 'No agents configured' }}
      </option>
      <option v-for="agent in agents" :key="agent" :value="agent">
        {{ agentLabels[agent] }}
      </option>
    </select>

    <p v-if="selectedProfile?.description" class="profile-description">
      {{ selectedProfile.description }}
    </p>

    <div v-if="!hasAgents" class="config-hint">
      <p>No Agent Profiles are available from the Bridge.</p>
    </div>
  </div>
</template>

<style scoped>
.agent-selector {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

label {
  font-weight: 600;
  color: var(--text-secondary, #666);
}

select {
  padding: 0.5rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  font-size: 1rem;
  background: var(--bg-input, #fff);
  color: var(--text-primary, #333);
}

select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.config-hint {
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: var(--bg-warning, #fff3cd);
  border-radius: 4px;
  font-size: 0.875rem;
}

.config-hint code {
  display: block;
  margin-top: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--bg-code, #f5f5f5);
  border-radius: 2px;
  font-family: monospace;
  word-break: break-all;
}

.profile-description {
  color: var(--text-muted, #777);
  font-size: 0.8rem;
  line-height: 1.4;
}
</style>
