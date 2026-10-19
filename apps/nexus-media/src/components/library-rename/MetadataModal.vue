<script lang="ts" setup>
import type { LibraryRenameApi } from '#/api/modules/library_rename';

import { computed, reactive, watch } from 'vue';

import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
} from 'naive-ui';

const props = defineProps<{
  item: LibraryRenameApi.PlanItem | null;
  saving: boolean;
  show: boolean;
}>();

const emit = defineEmits<{
  (
    e: 'save',
    value: {
      episode?: number | string;
      media_type: LibraryRenameApi.MediaType;
      season?: number | string;
      title?: string;
      tmdbid?: number | string;
      year?: string;
    },
  ): void;
  (e: 'update:show', value: boolean): void;
}>();

const form = reactive({
  media_type: 'movie' as LibraryRenameApi.MediaType,
  title: '',
  year: '',
  tmdbid: '',
  season: undefined as number | undefined,
  episode: undefined as number | undefined,
});

const isTv = computed(() => form.media_type !== 'movie');

const typeOptions = [
  { label: '电影', value: 'movie' },
  { label: '电视剧', value: 'tv' },
  { label: '动漫', value: 'anime' },
];

watch(
  () => props.item,
  (item) => {
    if (!item) return;
    const meta = item.metadata || {};
    form.media_type =
      meta.type === 'tv' || meta.type === 'anime' ? meta.type : 'movie';
    form.title = meta.title || '';
    form.year = meta.year ? String(meta.year) : '';
    form.tmdbid = meta.tmdbid ? String(meta.tmdbid) : '';
    form.season = meta.season ? Number(meta.season) : undefined;
    form.episode = meta.episode ? Number(meta.episode) : undefined;
  },
  { immediate: true },
);

function close() {
  emit('update:show', false);
}

function handleSave() {
  emit('save', {
    media_type: form.media_type,
    title: form.title || undefined,
    year: form.year || undefined,
    tmdbid: form.tmdbid,
    season: isTv.value ? form.season : undefined,
    episode: isTv.value ? form.episode : undefined,
  });
}
</script>

<template>
  <NModal
    :show="show"
    :title="`补录元数据：${item?.old_path || ''}`"
    preset="card"
    style="width: 520px; max-width: 92vw"
    :bordered="false"
    :segmented="{ content: true }"
    @update:show="emit('update:show', $event)"
  >
    <NForm label-placement="top" size="small">
      <NFormItem label="媒体类型">
        <NSelect v-model:value="form.media_type" :options="typeOptions" />
      </NFormItem>
      <NFormItem label="TMDB ID">
        <NInput v-model:value="form.tmdbid" placeholder="例如 603" clearable />
      </NFormItem>
      <NFormItem label="标题">
        <NInput v-model:value="form.title" placeholder="展示标题" clearable />
      </NFormItem>
      <NFormItem label="年份">
        <NInput v-model:value="form.year" placeholder="例如 1999" clearable />
      </NFormItem>
      <template v-if="isTv">
        <NFormItem label="季">
          <NInputNumber
            v-model:value="form.season"
            :min="0"
            :show-button="false"
            style="width: 100%"
          />
        </NFormItem>
        <NFormItem label="集">
          <NInputNumber
            v-model:value="form.episode"
            :min="1"
            :show-button="false"
            style="width: 100%"
          />
        </NFormItem>
      </template>
    </NForm>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" :disabled="saving" @click="close">取消</NButton>
        <NButton
          type="primary"
          size="small"
          :loading="saving"
          @click="handleSave"
        >
          保存并重新生成预览
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
