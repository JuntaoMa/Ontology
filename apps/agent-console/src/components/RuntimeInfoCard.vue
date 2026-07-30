<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties,
} from 'vue';
import type { RuntimeProject } from '../lib/types';
import UiIcon from './UiIcon.vue';

const props = defineProps<{
  project: RuntimeProject;
  profileTitle: string;
  profileDescription: string;
  datasetTitle: string;
  statusLabel: string;
  anchor: HTMLElement;
}>();

const emit = defineEmits<{
  close: [];
  delete: [];
}>();

const card = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const position = ref<CSSProperties>({ top: '12px', left: '12px' });
let closing = false;

function positionCard(): void {
  const anchorRect = props.anchor.getBoundingClientRect();
  const cardWidth = card.value?.offsetWidth ?? 326;
  const cardHeight = card.value?.offsetHeight ?? 420;
  const left = Math.min(
    window.innerWidth - cardWidth - 12,
    Math.max(12, anchorRect.right - cardWidth),
  );
  const top = Math.min(
    window.innerHeight - cardHeight - 12,
    anchorRect.bottom + 6,
  );
  position.value = {
    top: `${Math.max(12, top)}px`,
    left: `${Math.max(12, left)}px`,
  };
}

function restoreFocus(): void {
  void nextTick(() => {
    if (props.anchor.isConnected) props.anchor.focus();
  });
}

function close(): void {
  if (closing) return;
  closing = true;
  const element = card.value;
  if (
    element &&
    typeof element.hidePopover === 'function' &&
    element.matches(':popover-open')
  ) {
    element.hidePopover();
  }
  emit('close');
  restoreFocus();
}

function handleToggle(event: Event): void {
  const state = (event as Event & { newState?: string }).newState;
  if (state !== 'closed' || closing) return;
  closing = true;
  emit('close');
  restoreFocus();
}

function requestDelete(): void {
  closing = true;
  emit('delete');
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…${digest.slice(-8)}`;
}

function createdAtLabel(createdAt?: string): string {
  if (!createdAt) return '—';
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(timestamp))
    : createdAt;
}

onMounted(async () => {
  await nextTick();
  if (card.value && typeof card.value.showPopover === 'function') {
    card.value.showPopover();
  }
  positionCard();
  closeButton.value?.focus();
  window.addEventListener('resize', positionCard);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', positionCard);
});
</script>

<template>
  <Teleport to="body">
    <section
      id="runtime-info-card"
      ref="card"
      class="floating-card project-card"
      :style="position"
      popover="auto"
      role="dialog"
      :aria-label="`${profileTitle} Project information`"
      @toggle="handleToggle"
    >
      <div class="project-card-head">
        <div class="project-card-title">
          <UiIcon name="folder" />
          <span>{{ profileTitle }}</span>
        </div>
        <button
          ref="closeButton"
          class="icon-button"
          type="button"
          aria-label="Close Project information"
          title="Close"
          @click="close"
        >
          <UiIcon name="close" />
        </button>
      </div>
      <p class="project-card-description">
        {{
          profileDescription ||
          'Runtime Project created from a fixed Profile and Dataset snapshot.'
        }}
      </p>
      <dl class="project-facts">
        <div class="project-fact">
          <dt>Status</dt>
          <dd>{{ statusLabel }}</dd>
        </div>
        <div class="project-fact">
          <dt>Profile</dt>
          <dd :title="project.profile.id">
            {{ project.profile.id }} · {{ project.profile.revision }}
          </dd>
        </div>
        <div class="project-fact">
          <dt>Dataset</dt>
          <dd :title="project.dataset.id">{{ datasetTitle }}</dd>
        </div>
        <div class="project-fact">
          <dt>Ontology</dt>
          <dd :title="project.dataset.ontologySha256">
            {{ shortDigest(project.dataset.ontologySha256) }}
          </dd>
        </div>
        <div class="project-fact">
          <dt>Created</dt>
          <dd :title="project.createdAt">
            {{ createdAtLabel(project.createdAt) }}
          </dd>
        </div>
      </dl>
      <p v-if="project.lastError" class="runtime-error" role="status">
        <strong>{{ project.lastError.code || 'Runtime error' }}</strong>
        {{ project.lastError.message }}
      </p>
      <div class="danger-zone">
        <div>
          <strong>Delete this Project</strong>
          <span>Removes its isolated Runtime and all Sessions.</span>
        </div>
        <button
          class="danger-button"
          type="button"
          @click="requestDelete"
        >
          {{
            project.status === 'delete_failed'
              ? 'Retry delete'
              : 'Delete Project'
          }}
        </button>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.floating-card {
  position: fixed;
  z-index: 30;
  inset: auto;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.project-card {
  width: min(326px, calc(100vw - 24px));
  padding: 13px;
}

.project-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.project-card-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 630;
}

.project-card-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card-title > :deep(svg) {
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
}

.project-card-description {
  margin: 11px 1px 13px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.project-facts {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
}

.project-fact {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
}

.project-fact + .project-fact {
  border-top: 1px solid var(--line-soft);
}

.project-fact dt {
  color: var(--text-muted);
}

.project-fact dd {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-error {
  margin: 11px 0 0;
  border-radius: 8px;
  padding: 8px 9px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
  line-height: 1.45;
}

.runtime-error strong {
  display: block;
}

.danger-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 13px;
  border-top: 1px solid var(--line-soft);
  padding-top: 12px;
}

.danger-zone div {
  display: grid;
  min-width: 0;
  gap: 2px;
  font-size: 11.5px;
}

.danger-zone span {
  color: var(--text-muted);
  font-size: 10px;
}

.danger-button {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--line));
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--danger-soft);
  color: var(--danger);
  cursor: pointer;
  font-size: 10.5px;
  font-weight: 650;
}
</style>
