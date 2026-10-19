<script lang="ts" setup>
import type { LibraryRenameApi } from '#/api/modules/library_rename';

import { computed, h } from 'vue';

import { IconifyIcon } from '@vben/icons';

import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NPagination,
  NProgress,
  NSpace,
  NSpin,
  NTag,
} from 'naive-ui';

type PlanAction = LibraryRenameApi.PlanAction;
type PlanItem = LibraryRenameApi.PlanItem;
type PlanJob = LibraryRenameApi.PlanJob;

const props = defineProps<{
  items: PlanItem[];
  itemsLoading: boolean;
  loading: boolean;
  page: number;
  pageSize: number;
  plan: null | PlanJob;
  total: number;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'execute'): void;
  (e: 'fillMetadata', item: PlanItem): void;
  (e: 'pageChange', page: number): void;
  (e: 'pageSizeChange', size: number): void;
  (e: 'rollback'): void;
}>();

const actionMeta: Record<
  PlanAction,
  {
    label: string;
    type: 'default' | 'error' | 'info' | 'primary' | 'success' | 'warning';
  }
> = {
  rename: { label: '改名', type: 'primary' },
  unchanged: { label: '无需修改', type: 'default' },
  skip: { label: '跳过', type: 'warning' },
  conflict: { label: '目标冲突', type: 'error' },
  needs_metadata: { label: '需补元数据', type: 'warning' },
};

const jobStatusMeta: Record<
  LibraryRenameApi.JobStatus,
  {
    label: string;
    type: 'default' | 'error' | 'info' | 'primary' | 'success' | 'warning';
  }
> = {
  planned: { label: '待执行', type: 'info' },
  running: { label: '执行中', type: 'primary' },
  cancelling: { label: '取消中', type: 'warning' },
  cancelled: { label: '已取消', type: 'default' },
  completed: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'error' },
  interrupted: { label: '已中断', type: 'warning' },
  rolled_back: { label: '已回滚', type: 'info' },
};

const itemStatusMeta: Record<
  LibraryRenameApi.ItemStatus,
  { label: string; type: 'default' | 'error' | 'info' | 'success' | 'warning' }
> = {
  planned: { label: '待执行', type: 'info' },
  running: { label: '执行中', type: 'warning' },
  done: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'error' },
  rolled_back: { label: '已回滚', type: 'info' },
  manual_intervention: { label: '需人工处理', type: 'warning' },
};

const statItems = computed(() => {
  const plan = props.plan;
  if (!plan) return [];
  return [
    { label: '总文件', value: plan.total, icon: 'lucide:files' },
    { label: '将改名', value: plan.changed, icon: 'lucide:file-pen-line' },
    { label: '无需修改', value: plan.unchanged, icon: 'lucide:check' },
    { label: '跳过', value: plan.skipped, icon: 'lucide:skip-forward' },
    { label: '冲突', value: plan.conflict, icon: 'lucide:triangle-alert' },
    {
      label: '需补元数据',
      value: plan.needs_metadata,
      icon: 'lucide:file-question',
    },
    { label: '失败', value: plan.failed, icon: 'lucide:octagon-x' },
  ];
});

const progressPercent = computed(() => {
  const plan = props.plan;
  if (!plan || !plan.changed) return 0;
  return Math.min(
    100,
    Math.round(((plan.done + plan.failed) / plan.changed) * 100),
  );
});

const showJob = computed(() => props.plan && props.plan.status !== 'planned');

const canExecute = computed(
  () => props.plan && props.plan.status === 'planned' && props.plan.changed > 0,
);

const canCancel = computed(
  () => props.plan && ['cancelling', 'running'].includes(props.plan.status),
);

const canRollback = computed(
  () =>
    props.plan &&
    ['completed', 'failed', 'interrupted'].includes(props.plan.status) &&
    props.plan.done > 0,
);

function pathSplit(path: string) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return {
    dir: index === -1 ? '' : path.slice(0, index + 1),
    name: index === -1 ? path : path.slice(index + 1),
  };
}

function actionTag(item: PlanItem) {
  const action = actionMeta[item.action];
  return h(
    NTag,
    { size: 'small', type: action.type, round: true },
    () => action.label,
  );
}

function statusTag(item: PlanItem) {
  if (item.action !== 'rename' || item.status === 'planned') return null;
  const status = itemStatusMeta[item.status];
  return h(
    NTag,
    { size: 'small', type: status.type, round: true, bordered: false },
    () => status.label,
  );
}

const columns = computed(() => [
  {
    title: '状态',
    key: 'action',
    width: 140,
    render: (row: PlanItem) =>
      h(
        'div',
        { class: 'rename-tags' },
        [actionTag(row), statusTag(row)].filter(Boolean),
      ),
  },
  {
    title: '原路径',
    key: 'old_path',
    render: (row: PlanItem) => {
      const parts = pathSplit(row.old_path);
      return h('div', { class: 'path-cell' }, [
        h('div', { class: 'path-name', title: row.old_path }, parts.name),
        h('div', { class: 'path-dir', title: row.old_path }, parts.dir),
      ]);
    },
  },
  {
    title: '新路径',
    key: 'new_path',
    render: (row: PlanItem) => {
      if (!row.new_path) {
        return h('span', { class: 'path-empty' }, '—');
      }
      const parts = pathSplit(row.new_path);
      return h('div', { class: 'path-cell' }, [
        h('div', { class: 'path-name', title: row.new_path }, parts.name),
        h('div', { class: 'path-dir', title: row.new_path }, parts.dir),
      ]);
    },
  },
  {
    title: '元数据',
    key: 'metadata',
    width: 180,
    render: (row: PlanItem) => {
      const meta = row.metadata || {};
      return h('div', { class: 'meta-cell' }, [
        h(
          'div',
          { class: 'meta-title', title: meta.title || '' },
          meta.title || '—',
        ),
        h(
          'div',
          { class: 'meta-sub' },
          [meta.type, meta.year, row.metadata_source]
            .filter(Boolean)
            .join(' · ') || '—',
        ),
      ]);
    },
  },
  {
    title: '原因',
    key: 'reason',
    width: 180,
    render: (row: PlanItem) => row.reason || row.error || '—',
  },
  {
    title: '操作',
    key: 'ops',
    width: 120,
    render: (row: PlanItem) => {
      if (row.action !== 'needs_metadata') return null;
      return h(
        NButton,
        {
          size: 'tiny',
          tertiary: true,
          onClick: () => emit('fillMetadata', row),
        },
        { default: () => '补录元数据' },
      );
    },
  },
]);
</script>

<template>
  <NCard class="rename-result" :bordered="false" title="预览与执行">
    <NSpin :show="loading">
      <div v-if="!plan" class="result-empty">
        <NEmpty description="先配置左侧范围并生成预览">
          <template #icon>
            <IconifyIcon icon="lucide:scan-search" class="size-10" />
          </template>
        </NEmpty>
      </div>

      <template v-else>
        <div class="rename-stats">
          <div v-for="stat in statItems" :key="stat.label" class="rename-stat">
            <div class="rename-stat-icon">
              <IconifyIcon :icon="stat.icon" class="size-4" />
            </div>
            <div class="rename-stat-body">
              <div class="rename-stat-value">{{ stat.value }}</div>
              <div class="rename-stat-label">{{ stat.label }}</div>
            </div>
          </div>
        </div>

        <NAlert
          v-if="plan.conflict > 0 || plan.needs_metadata > 0"
          type="warning"
          class="rename-alert"
          :bordered="false"
        >
          <template #icon>
            <IconifyIcon icon="lucide:triangle-alert" class="size-4" />
          </template>
          存在 {{ plan.conflict }} 个目标冲突、{{ plan.needs_metadata }}
          个需要补录元数据的条目， 请先处理后再执行。
        </NAlert>

        <div class="rename-toolbar">
          <div class="rename-job">
            <NTag :type="jobStatusMeta[plan.status].type" round>
              {{ jobStatusMeta[plan.status].label }}
            </NTag>
            <div v-if="showJob" class="rename-job-progress">
              <NProgress
                v-if="plan.changed > 0"
                :percentage="progressPercent"
                :show-indicator="false"
                class="rename-progress"
              />
              <span class="rename-job-meta"
                >完成 {{ plan.done }} / {{ plan.changed }}</span
              >
            </div>
          </div>
          <NSpace>
            <NButton
              type="primary"
              size="small"
              :disabled="!canExecute"
              :loading="loading"
              @click="emit('execute')"
            >
              <template #icon>
                <IconifyIcon icon="lucide:play" class="size-4" />
              </template>
              确认执行
            </NButton>
            <NButton
              v-if="canCancel"
              size="small"
              type="warning"
              @click="emit('cancel')"
            >
              <template #icon>
                <IconifyIcon icon="lucide:square" class="size-4" />
              </template>
              取消任务
            </NButton>
            <NButton
              v-if="canRollback"
              size="small"
              type="error"
              :loading="loading"
              @click="emit('rollback')"
            >
              <template #icon>
                <IconifyIcon icon="lucide:undo-2" class="size-4" />
              </template>
              回滚任务
            </NButton>
          </NSpace>
        </div>

        <NDataTable
          :columns="columns"
          :data="items"
          :loading="itemsLoading"
          :max-height="560"
          :pagination="false"
          :row-key="(row: PlanItem) => row.id"
          :scroll-x="1100"
          :single-line="false"
          size="small"
          striped
        />

        <div class="rename-pagination">
          <NPagination
            :page="page"
            :page-count="Math.max(1, Math.ceil(total / pageSize))"
            :page-size="pageSize"
            :page-sizes="[30, 50, 100, 200]"
            show-size-picker
            @update:page="(value: number) => emit('pageChange', value)"
            @update:page-size="(value: number) => emit('pageSizeChange', value)"
          />
        </div>
      </template>
    </NSpin>
  </NCard>
</template>

<style scoped>
.rename-result {
  background: hsl(var(--card));
  border-radius: var(--radius);
}

.result-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 0;
}

.rename-stats {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.rename-stat {
  display: flex;
  gap: 0.625rem;
  align-items: center;
  min-width: 0;
  padding: 0.5rem 0.625rem;
  background: hsl(var(--accent) / 25%);
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
}

.rename-stat-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 12%);
  border-radius: 999px;
}

.rename-stat-body {
  min-width: 0;
}

.rename-stat-value {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.2;
  color: hsl(var(--card-foreground));
}

.rename-stat-label {
  margin-top: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}

.rename-alert {
  margin-bottom: 0.75rem;
}

.rename-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 0.75rem;
  margin-bottom: 0.75rem;
  background: hsl(var(--accent) / 20%);
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
}

.rename-job {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  align-items: center;
  min-width: 0;
}

.rename-job-progress {
  display: flex;
  flex: 1;
  gap: 0.625rem;
  align-items: center;
  min-width: 200px;
}

.rename-progress {
  --n-fill-color: hsl(var(--primary));

  flex: 1;
  min-width: 160px;
}

.rename-job-meta {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}

.rename-tags {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
}

.path-cell {
  min-width: 0;
}

.path-name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: hsl(var(--card-foreground));
  white-space: nowrap;
}

.path-dir {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}

.path-empty {
  color: hsl(var(--muted-foreground));
}

.meta-cell {
  min-width: 0;
}

.meta-title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: hsl(var(--card-foreground));
  white-space: nowrap;
}

.meta-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}

.rename-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.75rem;
}

@media (max-width: 1280px) {
  .rename-stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .rename-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rename-toolbar .n-space {
    width: 100%;
  }

  .rename-toolbar .n-button {
    flex: 1;
  }
}
</style>
