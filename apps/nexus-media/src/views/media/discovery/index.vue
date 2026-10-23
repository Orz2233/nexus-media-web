<script lang="ts" setup>
import type { DiscoveryApi } from '#/api/modules/media';

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { IconifyIcon } from '@vben/icons';

import { NButton, NSelect, NSpin } from 'naive-ui';

import { getDiscoveryItemsApi, getDiscoveryProvidersApi } from '#/api';
import EmptyState from '#/components/empty/EmptyState.vue';
import MediaCard from '#/components/media/MediaCard.vue';
import PageHeader from '#/components/page/PageHeader.vue';
import {
  getContentProfileDetailPath,
  getContentProfilePresentationType,
  PluginSlot,
} from '#/plugin-framework';

const route = useRoute();
const router = useRouter();

const sources = ref<DiscoveryApi.Source[]>([]);
const activeProvider = ref('');
const activeFeed = ref('');
const items = ref<DiscoveryApi.Item[]>([]);
const page = ref(1);
const hasMore = ref(false);
const loading = ref(false);
const loadingMore = ref(false);
const loadingSources = ref(true);
const selectedSeason = ref(currentSeason());
const selectedYear = ref('');
const sentinelRef = ref<HTMLElement | null>(null);
let loadMoreObserver: IntersectionObserver | null = null;
let scrollCheckFrame = 0;
const PREF_KEY = 'nexus.discovery.preference';

const pageTitleMap: Record<string, string> = {
  Ranking: '排行榜',
  Bangumi: 'Bangumi 新番',
  DoubanMovie: '豆瓣电影',
  DoubanTv: '豆瓣电视剧',
  TmdbMovie: 'TMDB 电影',
  TmdbTv: 'TMDB 电视剧',
  DiscoveryRecommend: '更多推荐',
};

const routePreset: Record<string, { feed?: string; provider?: string }> = {
  Ranking: { feed: 'movie_showing', provider: 'douban' },
  Bangumi: { feed: 'calendar', provider: 'bangumi' },
  DoubanMovie: { feed: 'movie_hot_gaia', provider: 'douban' },
  DoubanTv: { feed: 'tv_hot', provider: 'douban' },
  TmdbMovie: { feed: 'popular_movies', provider: 'tmdb' },
  TmdbTv: { feed: 'popular_tvs', provider: 'tmdb' },
};

const pageTitle = computed(() => pageTitleMap[String(route.name)] || '探索');
const activeSource = computed(() =>
  sources.value.find((item) => item.provider === activeProvider.value),
);
const orderedSources = computed(() =>
  [...sources.value].sort(
    (a, b) =>
      Number(a.visibility === 'private') - Number(b.visibility === 'private'),
  ),
);
const feeds = computed(() => activeSource.value?.feeds || []);
const feedsExpanded = ref(false);
const COLLAPSED_FEED_COUNT = 6;
const visibleFeeds = computed(() =>
  feedsExpanded.value
    ? feeds.value
    : feeds.value.slice(0, COLLAPSED_FEED_COUNT),
);
const hiddenFeedCount = computed(() =>
  Math.max(0, feeds.value.length - COLLAPSED_FEED_COUNT),
);
const activeFeedConfig = computed(() =>
  feeds.value.find((item) => item.key === activeFeed.value),
);
const supportsSeason = computed(() =>
  (activeFeedConfig.value?.facets || []).includes('season'),
);
const supportsYear = computed(() =>
  (activeFeedConfig.value?.facets || []).includes('year'),
);
const facetLabel = computed(() => {
  if (supportsYear.value && !supportsSeason.value) return '年份';
  if (supportsSeason.value && !supportsYear.value) return '季度';
  return '筛选';
});
const yearOptions = computed(() => {
  const current = new Date().getFullYear();
  const values = [{ label: '全部年份', value: '' }];
  for (let year = current + 1; year >= current - 10; year--) {
    values.push({ label: String(year), value: String(year) });
  }
  return values;
});
const yearsExpanded = ref(false);
const COLLAPSED_YEAR_COUNT = 7;
const visibleYearOptions = computed(() =>
  yearsExpanded.value
    ? yearOptions.value
    : yearOptions.value.slice(0, COLLAPSED_YEAR_COUNT),
);
const hiddenYearCount = computed(() =>
  Math.max(0, yearOptions.value.length - COLLAPSED_YEAR_COUNT),
);
const seasonOptions = computed(() => {
  const current = new Date();
  const values: { label: string; value: string }[] = [];
  for (
    let year = current.getFullYear() + 1;
    year >= current.getFullYear() - 1;
    year--
  ) {
    for (let quarter = 4; quarter >= 1; quarter--) {
      values.push({
        label: `${year} Q${quarter}`,
        value: `${year}-q${quarter}`,
      });
    }
  }
  return values;
});

function currentSeason() {
  const now = new Date();
  return `${now.getFullYear()}-q${Math.floor(now.getMonth() / 3) + 1}`;
}

function unwrap<T>(res: any): T {
  return (res?.data ?? res) as T;
}

async function loadSources() {
  loadingSources.value = true;
  try {
    sources.value = unwrap<DiscoveryApi.Source[]>(
      await getDiscoveryProvidersApi(),
    );
    applyPreset();
  } finally {
    loadingSources.value = false;
  }
}

function applyPreset() {
  if (!sources.value.length) return;
  const preset = routePreset[String(route.name)] || {};
  let saved: { feed?: string; provider?: string };
  try {
    saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  } catch {
    saved = {};
  }
  const wantedProvider = preset.provider || saved.provider;
  const wantedFeed = preset.feed || saved.feed;
  const source =
    sources.value.find((item) => item.provider === wantedProvider) ||
    sources.value[0];
  if (!source) return;
  activeProvider.value = source.provider;
  const feed =
    source.feeds.find((item) => item.key === wantedFeed) || source.feeds[0];
  activeFeed.value = feed?.key || '';
}

async function loadItems(reset = false) {
  if (!activeProvider.value || !activeFeed.value) return;
  if (loading.value || loadingMore.value) return;
  if (!reset && !hasMore.value) return;

  if (reset) {
    page.value = 1;
    items.value = [];
    hasMore.value = true;
    loading.value = true;
  } else {
    loadingMore.value = true;
  }

  try {
    const result = unwrap<DiscoveryApi.Page>(
      await getDiscoveryItemsApi({
        provider: activeProvider.value,
        feed: activeFeed.value,
        page: page.value,
        filters: {
          ...(supportsSeason.value ? { season: selectedSeason.value } : {}),
          ...(supportsYear.value && selectedYear.value
            ? { year: selectedYear.value }
            : {}),
        },
      }),
    );
    const list = result?.items || [];
    items.value = reset ? list : [...items.value, ...list];
    hasMore.value = Boolean(result?.has_more);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function selectProvider(provider: string) {
  if (provider === activeProvider.value) return;
  activeProvider.value = provider;
  activeFeed.value =
    sources.value.find((item) => item.provider === provider)?.feeds[0]?.key ||
    '';
  savePreference();
  loadItems(true);
}

function selectFeed(feed: string) {
  if (feed === activeFeed.value) return;
  activeFeed.value = feed;
  savePreference();
  loadItems(true);
}

function itemId(item: DiscoveryApi.Item) {
  return item.anchor_ref?.external_id || item.ref.external_id;
}

function itemTmdbId(item: DiscoveryApi.Item) {
  return item.provider === 'tmdb' ? item.ref.external_id : undefined;
}

function itemType(item: DiscoveryApi.Item) {
  // 自定义画像可声明自己的 presentation_type（如 av），剧集类才走季/集流程
  const profileType = getContentProfilePresentationType(item.content_profile);
  if (profileType === 'tv' || profileType === 'anime') return 'tv';
  return item.ref.media_type || 'movie';
}

function itemMetadataRef(item: DiscoveryApi.Item) {
  return `${item.ref.provider}:${item.ref.external_id}`;
}

function itemDetailLink(item: DiscoveryApi.Item) {
  const path = getContentProfileDetailPath(item.content_profile);
  if (!path) return undefined;
  const params = new URLSearchParams({
    id: item.anchor_ref?.external_id || item.ref.external_id,
    profile: item.content_profile || '',
    ref: itemMetadataRef(item),
  });
  return `${path}?${params.toString()}`;
}

function itemVote(item: DiscoveryApi.Item) {
  const values = Object.values(item.rating || {});
  return values.length ? values[0] : undefined;
}

function handleSearchFromCard(item: Record<string, any>) {
  router.push({
    path: '/media/search',
    query: {
      s: item.title,
      from: item.contentProfile ? 'profile-search' : 'discovery',
      tmdbid: item.tmdbId || '',
      media_type: item.mediaType || item.type || '',
      anchor_provider: item.anchorProvider || '',
      anchor_external_id: item.anchorExternalId || '',
      content_profile: item.contentProfile || '',
      poster: item.poster || '',
      vote: item.vote || '',
      year: item.year || '',
    },
  });
}

function handleCardSearch(item: DiscoveryApi.Item) {
  const customProfile =
    item.content_profile && item.content_profile !== 'default';
  handleSearchFromCard({
    anchorExternalId: item.anchor_ref?.external_id,
    anchorProvider: item.anchor_ref?.provider,
    contentProfile: item.content_profile || '',
    id: itemId(item),
    mediaType: itemType(item),
    // 自定义画像（如 AV）用番号/内容 ID 搜索，而不是日文标题
    title: customProfile
      ? item.anchor_ref?.external_id || item.title
      : item.title,
    tmdbId: itemTmdbId(item),
    poster: item.poster || '',
    vote: itemVote(item),
    year: item.year || '',
    type: itemType(item),
  });
}

function savePreference() {
  localStorage.setItem(
    PREF_KEY,
    JSON.stringify({ provider: activeProvider.value, feed: activeFeed.value }),
  );
}

function selectSeason(value: string) {
  selectedSeason.value = value;
  loadItems(true);
}

function selectYear(value: string) {
  selectedYear.value = value;
  loadItems(true);
}

function loadMore() {
  if (!hasMore.value || loading.value || loadingMore.value) return;
  page.value += 1;
  loadItems(false);
}

function isNearPageBottom(target?: EventTarget | null) {
  const viewportHeight = window.innerHeight;
  const documentElement = document.documentElement;
  if (documentElement.scrollHeight - window.scrollY - viewportHeight < 600) {
    return true;
  }
  if (
    target instanceof HTMLElement &&
    target.scrollHeight > target.clientHeight + 100
  ) {
    return target.scrollHeight - target.scrollTop - target.clientHeight < 600;
  }
  return false;
}

function handleScrollForLoadMore(event: Event) {
  if (!hasMore.value || loading.value || loadingMore.value) return;
  if (scrollCheckFrame) return;
  scrollCheckFrame = requestAnimationFrame(() => {
    scrollCheckFrame = 0;
    if (isNearPageBottom(event.target)) loadMore();
  });
}

function setupLoadMoreObserver() {
  if (!('IntersectionObserver' in window)) return;
  loadMoreObserver?.disconnect();
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    },
    { rootMargin: '240px 0px' },
  );
  if (sentinelRef.value) loadMoreObserver.observe(sentinelRef.value);
}

watch(selectedYear, (value) => {
  if (!value) return;
  const index = yearOptions.value.findIndex((item) => item.value === value);
  if (index >= COLLAPSED_YEAR_COUNT) yearsExpanded.value = true;
});

watch(
  [feeds, activeFeed],
  () => {
    const index = feeds.value.findIndex(
      (item) => item.key === activeFeed.value,
    );
    feedsExpanded.value = index >= COLLAPSED_FEED_COUNT;
  },
  { immediate: true },
);

watch(
  () => route.name,
  () => {
    applyPreset();
    loadItems(true);
  },
);

watch(
  [hasMore, loading, loadingMore],
  async () => {
    await nextTick();
    if (hasMore.value && sentinelRef.value) {
      if (!loadMoreObserver) setupLoadMoreObserver();
      else loadMoreObserver.observe(sentinelRef.value);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await loadSources();
  await loadItems(true);
  await nextTick();
  setupLoadMoreObserver();
  window.addEventListener('scroll', handleScrollForLoadMore, true);
});

onUnmounted(() => {
  loadMoreObserver?.disconnect();
  loadMoreObserver = null;
  window.removeEventListener('scroll', handleScrollForLoadMore, true);
  if (scrollCheckFrame) cancelAnimationFrame(scrollCheckFrame);
});
</script>

<template>
  <div class="p-4">
    <PageHeader :title="pageTitle" subtitle="按来源浏览榜单、季度新番与新剧">
      <template #actions>
        <NButton :loading="loading" @click="loadItems(true)">刷新</NButton>
      </template>
    </PageHeader>

    <NSpin :show="loadingSources">
      <section class="discovery-filter" aria-label="内容筛选">
        <div class="filter-row">
          <span class="filter-label">来源</span>
          <div class="filter-scroll source-list" role="tablist">
            <button
              v-for="source in orderedSources"
              :key="source.provider"
              type="button"
              class="source-tab"
              :class="{ active: activeProvider === source.provider }"
              :aria-pressed="activeProvider === source.provider"
              @click="selectProvider(source.provider)"
            >
              {{ source.name }}
            </button>
          </div>
        </div>

        <div class="filter-divider"></div>

        <div class="filter-row filter-row--wrap">
          <span class="filter-label">榜单</span>
          <div class="filter-scroll feed-list" role="tablist">
            <button
              v-for="feed in visibleFeeds"
              :key="feed.key"
              type="button"
              class="feed-tab"
              :class="{ active: activeFeed === feed.key }"
              :aria-pressed="activeFeed === feed.key"
              @click="selectFeed(feed.key)"
            >
              {{ feed.title }}
            </button>
            <button
              v-if="hiddenFeedCount > 0 || feedsExpanded"
              type="button"
              class="feed-toggle"
              @click="feedsExpanded = !feedsExpanded"
            >
              <IconifyIcon
                :icon="
                  feedsExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'
                "
                class="feed-toggle-icon"
              />
              {{ feedsExpanded ? '收起' : '更多' }}
            </button>
          </div>
        </div>

        <div v-if="supportsSeason || supportsYear" class="filter-divider"></div>

        <div
          v-if="supportsSeason || supportsYear"
          class="filter-row filter-row--facets"
        >
          <span class="filter-label">{{ facetLabel }}</span>
          <div class="facet-group">
            <label v-if="supportsSeason" class="facet">
              <span v-if="facetLabel !== '季度'">季度</span>
              <NSelect
                :value="selectedSeason"
                :options="seasonOptions"
                style="width: 132px"
                size="small"
                @update:value="selectSeason"
              />
            </label>
            <div v-if="supportsYear" class="facet facet--years">
              <span v-if="facetLabel !== '年份'">年份</span>
              <div class="year-list">
                <button
                  v-for="year in visibleYearOptions"
                  :key="year.value || 'all'"
                  type="button"
                  class="year-tab"
                  :class="{ active: selectedYear === year.value }"
                  :aria-pressed="selectedYear === year.value"
                  @click="selectYear(year.value)"
                >
                  {{ year.label === '全部年份' ? '全部' : year.label }}
                </button>
                <button
                  v-if="hiddenYearCount > 0 || yearsExpanded"
                  type="button"
                  class="feed-toggle"
                  @click="yearsExpanded = !yearsExpanded"
                >
                  <IconifyIcon
                    :icon="
                      yearsExpanded
                        ? 'lucide:chevron-up'
                        : 'lucide:chevron-down'
                    "
                    class="feed-toggle-icon"
                  />
                  {{ yearsExpanded ? '收起' : '更多' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <NSpin :show="loading">
        <div
          v-if="items.length > 0"
          class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4"
        >
          <MediaCard
            v-for="item in items"
            :key="`${item.provider}:${item.ref.external_id}`"
            :id="itemId(item)"
            :tmdb-id="itemTmdbId(item)"
            :title="item.title"
            :poster="item.poster"
            :type="itemType(item)"
            :media-type="itemType(item)"
            :vote="itemVote(item)"
            :year="item.year"
            :genres="item.tags?.slice(0, 4)"
            :anchor-provider="item.anchor_ref?.provider"
            :anchor-external-id="item.anchor_ref?.external_id"
            :content-profile="item.content_profile"
            :metadata-ref="itemMetadataRef(item)"
            :detail-link="itemDetailLink(item)"
            @search="() => handleCardSearch(item)"
          />
        </div>
        <EmptyState
          v-else-if="!loading"
          title="没有找到内容"
          subtitle="切换来源、榜单或筛选条件后再试"
        />
      </NSpin>

      <div
        v-if="hasMore"
        ref="sentinelRef"
        class="flex flex-col items-center justify-center gap-2 mt-6 min-h-12"
      >
        <NSpin v-if="loadingMore" size="small" />
        <span v-else class="text-xs text-muted-foreground">
          已加载 {{ items.length }} 条，继续滚动加载
        </span>
      </div>
      <div
        v-else-if="items.length > 0"
        class="text-center text-sm text-muted-foreground mt-6"
      >
        已加载全部
      </div>

      <PluginSlot target="discovery.panels" />
    </NSpin>
  </div>
</template>

<style scoped>
.discovery-filter {
  padding: 0 0.9rem;
  margin-bottom: 1rem;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 0.75rem;
}

.filter-row {
  display: flex;
  gap: 0.9rem;
  align-items: center;
  min-height: 3rem;
}

.filter-row--wrap {
  flex-wrap: wrap;
  padding: 0.55rem 0;
}

.filter-label {
  flex: none;
  width: 2.25rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.filter-divider {
  height: 1px;
  margin: 0 -0.9rem;
  background: hsl(var(--border));
}

.filter-scroll {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.25rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.filter-scroll::-webkit-scrollbar {
  display: none;
}

.source-list {
  align-items: center;
}

.source-tab {
  flex: none;
  padding: 0.45rem 0.65rem;
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 0.4rem;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.source-tab:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--accent));
}

.source-tab.active {
  font-weight: 600;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 10%);
}

.feed-list {
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  overflow: visible;
}

.feed-tab {
  flex: none;
  padding: 0.3rem 0.7rem;
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.feed-tab:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--accent));
}

.feed-tab.active {
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
}

.year-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.year-tab {
  flex: none;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 0.35rem;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.year-tab:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--accent));
}

.year-tab.active {
  font-weight: 600;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 10%);
  border-color: hsl(var(--primary) / 30%);
}

.facet--years {
  flex-wrap: wrap;
}

.feed-toggle {
  display: inline-flex;
  flex: none;
  gap: 0.15rem;
  align-items: center;
  padding: 0.3rem 0.55rem;
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 999px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.feed-toggle:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--accent));
}

.feed-toggle-icon {
  width: 0.875rem;
  height: 0.875rem;
}

.filter-row--facets {
  padding: 0.55rem 0;
}

.facet-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.facet {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

@media (max-width: 640px) {
  .discovery-filter {
    padding: 0 0.75rem;
  }

  .filter-row {
    flex-direction: column;
    gap: 0.35rem;
    align-items: flex-start;
    padding: 0.55rem 0;
  }

  .filter-label {
    width: auto;
  }

  .feed-list {
    flex: none;
    width: 100%;
  }
}
</style>
