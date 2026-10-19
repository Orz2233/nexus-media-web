<script lang="ts" setup>
import type { LibraryRenameApi } from '#/api/modules/library_rename';

import { computed, onBeforeUnmount, ref } from 'vue';

import { IconifyIcon } from '@vben/icons';

import { NButton, NModal } from 'naive-ui';

import {
  cancelRenameJobApi,
  executeRenamePlanApi,
  getRenameJobApi,
  getRenamePlanItemsApi,
  previewRenamePlanApi,
  rollbackRenameJobApi,
  setLibraryMetadataApi,
} from '#/api/modules/library_rename';
import MetadataModal from '#/components/library-rename/MetadataModal.vue';
import PlanResult from '#/components/library-rename/PlanResult.vue';
import ScopeForm from '#/components/library-rename/ScopeForm.vue';
import PageHeader from '#/components/page/PageHeader.vue';
import { useAppNotification } from '#/utils/notify';

const notification = useAppNotification();

function defaultScope(): LibraryRenameApi.RenameScope {
  return {
    media_types: ['movie', 'tv', 'anime'],
    roots: [],
    layout_mode: 'full',
    preserve_current_category: true,
    reorganize_category: false,
    use_mediaserver_metadata: true,
    allow_online_metadata: false,
    reidentify_no_metadata: false,
    limit: 5000,
  };
}

const scope = ref<LibraryRenameApi.RenameScope>(defaultScope());
const plan = ref<LibraryRenameApi.PlanJob | null>(null);
const items = ref<LibraryRenameApi.PlanItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const previewing = ref(false);
const itemsLoading = ref(false);
const operating = ref(false);
const metadataSaving = ref(false);
const metadataShow = ref(false);
const metadataItem = ref<LibraryRenameApi.PlanItem | null>(null);
const rollbackShow = ref(false);
const pollTimer = ref<null | number>(null);

const terminalStatuses = [
  'cancelled',
  'completed',
  'failed',
  'interrupted',
  'rolled_back',
] as const;

const isTerminal = computed(
  () => !!plan.value && terminalStatuses.includes(plan.value.status as any),
);

function stopPolling() {
  if (pollTimer.value !== null) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

async function fetchItems(targetPage = page.value) {
  if (!plan.value) return;
  itemsLoading.value = true;
  try {
    const res = await getRenamePlanItemsApi(plan.value.plan_id, {
      page: targetPage,
      page_size: pageSize.value,
    });
    items.value = res.items || [];
    total.value = res.total || 0;
    page.value = res.page || targetPage;
  } catch (error: any) {
    notification.error('获取计划条目失败', {
      description: error?.message || '',
    });
  } finally {
    itemsLoading.value = false;
  }
}

async function handlePreview() {
  stopPolling();
  previewing.value = true;
  plan.value = null;
  items.value = [];
  total.value = 0;
  page.value = 1;
  try {
    plan.value = await previewRenamePlanApi(scope.value);
    notification.success('预览计划已生成', {
      description: `共 ${plan.value.total} 个文件，将改名 ${plan.value.changed} 个`,
    });
    await fetchItems(1);
  } catch (error: any) {
    notification.error('生成预览失败', { description: error?.message || '' });
  } finally {
    previewing.value = false;
  }
}

function handleReset() {
  stopPolling();
  plan.value = null;
  items.value = [];
  total.value = 0;
  page.value = 1;
  scope.value = defaultScope();
}

function handlePageSizeChange(size: number) {
  pageSize.value = size;
  fetchItems(1);
}

async function pollJob() {
  if (!plan.value) return;
  try {
    const job = await getRenameJobApi(plan.value.job_id);
    plan.value = job;
    await fetchItems(page.value);
    if (isTerminal.value) {
      stopPolling();
      notification.success('批量重命名任务已结束', {
        description: `完成 ${job.done} 个，失败 ${job.failed} 个`,
      });
    }
  } catch (error: any) {
    stopPolling();
    notification.error('获取任务进度失败', {
      description: error?.message || '',
    });
  }
}

function startPolling() {
  stopPolling();
  pollTimer.value = window.setInterval(pollJob, 1500);
}

async function handleExecute() {
  if (!plan.value) return;
  operating.value = true;
  try {
    await executeRenamePlanApi(plan.value.plan_id);
    notification.success('任务已启动');
    plan.value = await getRenameJobApi(plan.value.job_id);
    startPolling();
  } catch (error: any) {
    notification.error('启动失败', { description: error?.message || '' });
  } finally {
    operating.value = false;
  }
}

async function handleCancel() {
  if (!plan.value) return;
  try {
    plan.value = await cancelRenameJobApi(plan.value.job_id);
    notification.success('已请求取消任务');
    await pollJob();
  } catch (error: any) {
    notification.error('取消失败', { description: error?.message || '' });
  }
}

async function handleRollback() {
  if (!plan.value) return;
  operating.value = true;
  try {
    const job = await rollbackRenameJobApi(plan.value.job_id);
    plan.value = job;
    notification.success('回滚完成', {
      description: `已回滚 ${job.rolled_back} 个条目`,
    });
    await fetchItems(page.value);
  } catch (error: any) {
    notification.error('回滚失败', { description: error?.message || '' });
  } finally {
    rollbackShow.value = false;
    operating.value = false;
  }
}

function openMetadata(item: LibraryRenameApi.PlanItem) {
  metadataItem.value = item;
  metadataShow.value = true;
}

async function handleSaveMetadata(payload: {
  episode?: number | string;
  media_type: LibraryRenameApi.MediaType;
  season?: number | string;
  title?: string;
  tmdbid?: number | string;
  year?: string;
}) {
  if (!metadataItem.value) return;
  metadataSaving.value = true;
  try {
    await setLibraryMetadataApi({
      backend_id: metadataItem.value.backend_id,
      path: metadataItem.value.old_path,
      ...payload,
    });
    notification.success('元数据已保存，正在重新生成预览');
    metadataShow.value = false;
    await handlePreview();
  } catch (error: any) {
    notification.error('保存元数据失败', { description: error?.message || '' });
  } finally {
    metadataSaving.value = false;
  }
}

onBeforeUnmount(stopPolling);
</script>

<template>
  <div
    class="library-rename-page p-5"
    style="background: hsl(var(--background))"
  >
    <PageHeader
      title="批量重命名"
      subtitle="按当前命名规则整理媒体库：先预览，确认后执行，可随时回滚"
    >
      <template #actions>
        <NButton size="small" :disabled="previewing" @click="handleReset">
          重置
        </NButton>
        <NButton
          type="primary"
          size="small"
          :loading="previewing"
          @click="handlePreview"
        >
          <template #icon>
            <IconifyIcon icon="lucide:scan-search" class="size-4" />
          </template>
          生成预览
        </NButton>
      </template>
    </PageHeader>

    <div class="library-rename-grid">
      <ScopeForm
        v-model="scope"
        :loading="previewing"
        @reset="handleReset"
        @submit="handlePreview"
      />
      <PlanResult
        :items="items"
        :items-loading="itemsLoading"
        :loading="previewing || operating"
        :page="page"
        :page-size="pageSize"
        :plan="plan"
        :total="total"
        @cancel="handleCancel"
        @execute="handleExecute"
        @fill-metadata="openMetadata"
        @page-change="fetchItems"
        @page-size-change="handlePageSizeChange"
        @rollback="rollbackShow = true"
      />
    </div>

    <MetadataModal
      v-model:show="metadataShow"
      :item="metadataItem"
      :saving="metadataSaving"
      @save="handleSaveMetadata"
    />

    <NModal
      v-model:show="rollbackShow"
      preset="dialog"
      title="回滚批量重命名"
      type="warning"
      content="将把本次任务已改名的文件恢复到原路径，并同步还原历史与元数据。是否继续？"
      positive-text="回滚"
      negative-text="取消"
      :loading="operating"
      @positive-click="handleRollback"
      @negative-click="rollbackShow = false"
    />
  </div>
</template>

<style scoped>
.library-rename-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.library-rename-grid {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

@media (max-width: 1024px) {
  .library-rename-grid {
    grid-template-columns: 1fr;
  }
}
</style>
