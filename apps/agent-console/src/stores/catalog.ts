import { ref } from 'vue';
import { defineStore } from 'pinia';
import {
  getDatasetCatalog,
  getProfileCatalog,
} from '../lib/runtime-api';
import type {
  DatasetCatalogEntry,
  ProfileCatalogEntry,
} from '../lib/types';

export const useCatalogStore = defineStore('catalog', () => {
  const profiles = ref<ProfileCatalogEntry[]>([]);
  const datasets = ref<DatasetCatalogEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function getProfile(profileId: string): ProfileCatalogEntry | undefined {
    return profiles.value.find((profile) => profile.id === profileId);
  }

  function getDataset(datasetId: string): DatasetCatalogEntry | undefined {
    return datasets.value.find((dataset) => dataset.id === datasetId);
  }

  async function loadCatalogs(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const [nextProfiles, nextDatasets] = await Promise.all([
        getProfileCatalog(),
        getDatasetCatalog(),
      ]);
      profiles.value = nextProfiles;
      datasets.value = nextDatasets;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  /** Synchronous replacement keeps component and store tests network-free. */
  function updateFromEvent(value: {
    profiles: ProfileCatalogEntry[];
    datasets: DatasetCatalogEntry[];
  }): void {
    profiles.value = value.profiles;
    datasets.value = value.datasets;
  }

  return {
    profiles,
    datasets,
    loading,
    error,
    getProfile,
    getDataset,
    loadCatalogs,
    clearError,
    updateFromEvent,
  };
});
