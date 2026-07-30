<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  DatasetCatalogEntry,
  ProfileCatalogEntry,
} from '../lib/types';
import ModalDialog from './ModalDialog.vue';

const props = defineProps<{
  profiles: ProfileCatalogEntry[];
  datasets: DatasetCatalogEntry[];
  existingRuntimeIds?: string[];
  creating: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  create: [profileId: string, datasetId: string];
}>();

const profileId = ref('');
const datasetId = ref('');
const existingRuntimeIds = computed(
  () => new Set(props.existingRuntimeIds ?? []),
);
const availableProfiles = computed(() =>
  props.profiles.filter((profile) =>
    props.datasets.some(
      (dataset) =>
        !existingRuntimeIds.value.has(`${profile.id}--${dataset.id}`),
    ),
  ),
);
const availableDatasets = computed(() =>
  props.datasets.filter(
    (dataset) =>
      profileId.value.length > 0 &&
      !existingRuntimeIds.value.has(`${profileId.value}--${dataset.id}`),
  ),
);
const selectedProfile = computed(() =>
  props.profiles.find((profile) => profile.id === profileId.value),
);
const selectedDataset = computed(() =>
  props.datasets.find((dataset) => dataset.id === datasetId.value),
);
const canSubmit = computed(
  () =>
    !props.creating &&
    profileId.value.length > 0 &&
    datasetId.value.length > 0 &&
    !existingRuntimeIds.value.has(
      `${profileId.value}--${datasetId.value}`,
    ),
);

watch(
  [availableProfiles, () => props.datasets],
  () => {
    if (
      !availableProfiles.value.some(
        (profile) => profile.id === profileId.value,
      )
    ) {
      profileId.value = availableProfiles.value[0]?.id ?? '';
    }
    if (
      !availableDatasets.value.some(
        (dataset) => dataset.id === datasetId.value,
      )
    ) {
      datasetId.value = availableDatasets.value[0]?.id ?? '';
    }
  },
  { immediate: true },
);

watch(
  profileId,
  () => {
    if (
      !availableDatasets.value.some(
        (dataset) => dataset.id === datasetId.value,
      )
    ) {
      datasetId.value = availableDatasets.value[0]?.id ?? '';
    }
  },
);

function submit(): void {
  if (!canSubmit.value) return;
  emit('create', profileId.value, datasetId.value);
}
</script>

<template>
  <ModalDialog
    labelled-by="create-runtime-title"
    described-by="create-runtime-description"
    :dismissible="!creating"
    @cancel="emit('cancel')"
  >
    <form @submit.prevent="submit">
      <h2 id="create-runtime-title">Create Runtime Project</h2>
      <p id="create-runtime-description" class="dialog-description">
        Choose one fixed Profile and Dataset. The Bridge will build an isolated,
        reproducible Runtime Project.
      </p>

      <label class="field-label" for="runtime-profile">Profile</label>
      <select
        id="runtime-profile"
        v-model="profileId"
        class="field-select"
        :disabled="creating"
        autofocus
      >
        <option
          v-for="profile in availableProfiles"
          :key="profile.id"
          :value="profile.id"
        >
          {{ profile.title }} · {{ profile.revision }}
        </option>
      </select>
      <p v-if="selectedProfile" class="field-help">
        {{ selectedProfile.description }}
      </p>

      <label class="field-label" for="runtime-dataset">Dataset</label>
      <select
        id="runtime-dataset"
        v-model="datasetId"
        class="field-select"
        :disabled="creating"
      >
        <option
          v-for="dataset in availableDatasets"
          :key="dataset.id"
          :value="dataset.id"
        >
          {{ dataset.title }}
        </option>
      </select>
      <p v-if="selectedDataset" class="field-help">
        {{ selectedDataset.description }}
      </p>

      <p v-if="error" class="dialog-error" role="alert">{{ error }}</p>
      <p
        v-if="profiles.length === 0 || datasets.length === 0"
        class="dialog-error"
        role="status"
      >
        At least one valid Profile and Dataset are required.
      </p>
      <p
        v-else-if="availableProfiles.length === 0"
        class="dialog-error"
        role="status"
      >
        Every Profile and Dataset combination already has a Runtime Project.
      </p>

      <div class="modal-actions">
        <button
          class="modal-button"
          type="button"
          :disabled="creating"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          class="modal-button primary"
          type="submit"
          :disabled="!canSubmit"
        >
          {{ creating ? 'Creating…' : 'Create Project' }}
        </button>
      </div>
    </form>
  </ModalDialog>
</template>

<style scoped>
.dialog-description {
  margin: 10px 0 18px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.field-label {
  display: block;
  margin: 15px 0 6px;
  color: var(--text);
  font-size: 12px;
  font-weight: 620;
}

.field-select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 9px 11px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.field-select:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 74%, white);
  outline-offset: 2px;
}

.field-help {
  margin: 6px 2px 0;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.dialog-error {
  margin: 14px 0 0;
  color: var(--danger);
  font-size: 12px;
}

.modal-button.primary {
  background: var(--text);
  color: white;
}
</style>
