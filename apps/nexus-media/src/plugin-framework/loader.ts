import type { Component } from 'vue';
/**
 * PluginLoader - 插件前端加载器
 * 通过 DI（依赖注入）模式加载插件：plugins/{id}/frontend/index.mjs
 * 默认导出为一个函数，接收宿主能力对象，返回组件映射。
 *
 *   export default function(host) {
 *     const { h, ref } = host.Vue;
 *     const IconifyIcon = host.IconifyIcon;
 *     const rc = host.api;
 *     return { MyPage, DashboardWidget };
 *   }
 */
import type { RouteRecordRaw } from 'vue-router';

import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  isRef,
  markRaw,
  nextTick,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  provide,
  reactive,
  ref,
  shallowRef,
  toRaw,
  toRef,
  toRefs,
  triggerRef,
  unref,
  watch,
  watchEffect,
} from 'vue';

import { useAppConfig } from '@vben/hooks';
import { IconifyIcon } from '@vben/icons';

import * as NaiveUI from 'naive-ui';

import { message, modal } from '#/adapter/naive';
import { requestClient } from '#/api/request';
import EmptyState from '#/components/empty/EmptyState.vue';
import PathPickerModal from '#/components/media/PathPickerModal.vue';
import PageHeader from '#/components/page/PageHeader.vue';
import SubscribeDefaultSettingModal from '#/components/subscribe/SubscribeDefaultSettingModal.vue';
import SubscribeEditModal from '#/components/subscribe/SubscribeEditModal.vue';
import SubscriptionGroupCard from '#/components/subscribe/SubscriptionGroupCard.vue';
import SubscriptionHoverCard from '#/components/subscribe/SubscriptionHoverCard.vue';
import { router } from '#/router';
import HeroSection from '#/views/media/detail/components/HeroSection.vue';
import RenameFormatBuilder from '#/views/system/basic/components/RenameFormatBuilder.vue';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

// requestClient 已携带 baseURL（/api），API 调用不需要再加 /api 前缀
const PLUGIN_API_BASE = '/plugin-framework';
// import() 直接访问浏览器地址，需要拼上完整 /api 前缀
const PLUGIN_ASSET_BASE = `${apiURL}/plugin-framework`;

/** DI 宿主能力对象，注入给插件的 host 参数 */
const host = {
  Vue: {
    h,
    ref,
    reactive,
    computed,
    watch,
    watchEffect,
    onMounted,
    onUnmounted,
    onBeforeMount,
    onBeforeUnmount,
    getCurrentInstance,
    defineComponent,
    provide,
    inject,
    toRefs,
    shallowRef,
    triggerRef,
    nextTick,
    isRef,
    unref,
    toRef,
    toRaw,
    markRaw,
  },
  IconifyIcon,
  NaiveUI,
  EmptyState,
  HeroSection,
  PageHeader,
  RenameFormatBuilder,
  PathPickerModal,
  SubscribeDefaultSettingModal,
  SubscribeEditModal,
  SubscriptionGroupCard,
  SubscriptionHoverCard,
  message,
  modal,
  api: requestClient,
};

/** 已加载的插件组件映射: pluginId -> { componentName: Component } */
const loadedModules = new Map<string, Record<string, Component>>();

/** 插槽注册表: slotTarget -> { pluginId, componentName, name, icon, color }[] */
const slotRegistry = reactive<
  Record<
    string,
    Array<{
      color?: string;
      componentName: string;
      icon: string;
      name: string;
      pluginId: string;
    }>
  >
>({});

/** 插件路由注册表 */
const pluginRoutes = new Map<string, RouteRecordRaw[]>();

/** 菜单路径 -> 插件组件，供通用宿主页动态渲染 */
const pluginPathComponents = reactive<
  Record<string, { componentName: string; pluginId: string }>
>({});

export function getPluginComponentByPath(path: string): Component | null {
  const entry = pluginPathComponents[path];
  if (!entry) return null;
  return getPluginComponent(entry.pluginId, entry.componentName);
}

/** 插件声明的自定义内容画像（key -> 展示名/媒体类型） */
const contentProfiles = reactive<
  Record<
    string,
    {
      defaultSearchSource: string;
      detailPath: string;
      label: string;
      presentationType: string;
      searchSources: Array<{ label: string; value: string }>;
    }
  >
>({});

const CORE_PROFILE_LABELS: Record<string, string> = {
  anime: '动漫',
};

export function getContentProfileLabel(key?: null | string): string {
  if (!key) return '';
  return contentProfiles[key]?.label || CORE_PROFILE_LABELS[key] || '';
}

export function getContentProfilePresentationType(key?: null | string): string {
  if (!key) return '';
  return contentProfiles[key]?.presentationType || '';
}

/** @deprecated 使用 getContentProfilePresentationType */
export function getContentProfileMediaType(key?: null | string): string {
  return getContentProfilePresentationType(key);
}

export function getContentProfileDetailPath(key?: null | string): string {
  if (!key) return '';
  return contentProfiles[key]?.detailPath || '';
}

export function getContentProfileSearchSources(
  key?: null | string,
): Array<{ label: string; value: string }> {
  if (!key) return [];
  return contentProfiles[key]?.searchSources || [];
}

export function getContentProfileDefaultSearchSource(
  key?: null | string,
): string {
  if (!key) return '';
  return contentProfiles[key]?.defaultSearchSource || '';
}

export function getContentProfileOptions(): Array<{
  label: string;
  value: string;
}> {
  return Object.entries(contentProfiles).map(([key, profile]) => ({
    label: profile.label,
    value: key,
  }));
}

function registerContentProfiles(plugin: PluginManifestFrontend) {
  for (const profile of plugin.frontend.content_profiles || []) {
    if (!profile.key) continue;
    contentProfiles[profile.key] = {
      defaultSearchSource:
        profile.default_search_source ||
        profile.search_sources?.[0]?.value ||
        '',
      detailPath: profile.detail_path || '',
      label: profile.label || profile.key,
      presentationType:
        profile.presentation_type || profile.media_type || 'movie',
      searchSources: Array.isArray(profile.search_sources)
        ? profile.search_sources.filter((item) => item?.label && item?.value)
        : [],
    };
  }
}

export interface PluginManifestFrontend {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  frontend: {
    content_profiles?: Array<{
      key: string;
      label: string;
      presentation_type?: string;
      /** @deprecated 旧 manifest 字段，读取时兼容 */
      media_type?: string;
      detail_path?: string;
      default_search_source?: string;
      search_sources?: Array<{ label: string; value: string }>;
    }>;
    routes: Array<{
      component: string;
      icon: string;
      menu: boolean;
      order?: number;
      parent?: string;
      path: string;
      permission?: string;
      title: string;
    }>;
    slots: Array<{
      component: string;
      position: string;
      target: string;
    }>;
  };
}

/**
 * 插件组件加载失败的占位页面
 */
const PluginErrorComponent = (props: {
  componentName?: string;
  pluginId?: string;
}) =>
  h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4rem 1rem',
        color: 'hsl(var(--muted-foreground))',
      },
    },
    [
      h(
        'div',
        {
          style: {
            fontSize: '1.25rem',
            marginBottom: '0.5rem',
            fontWeight: 600,
          },
        },
        '插件组件加载失败',
      ),
      h(
        'div',
        { style: { fontSize: '0.875rem' } },
        `插件 ${props.pluginId || ''} 的组件 ${props.componentName || ''} 加载失败，请检查插件是否已正确安装或 ESM 模块是否存在。`,
      ),
    ],
  );

/**
 * 从已加载的插件组件映射中获取组件
 */
function getPluginComponent(
  pluginId: string,
  componentName: string,
): Component | null {
  const mod = loadedModules.get(pluginId);
  if (!mod) return null;
  return mod[componentName] || null;
}

export function getComponent(
  pluginId: string,
  componentName: string,
): Component | null {
  return getPluginComponent(pluginId, componentName);
}

/**
 * 注册插件路由
 */
function registerPluginRoutes(plugin: PluginManifestFrontend) {
  const routes: Array<{ parentName: string; route: RouteRecordRaw }> = [];

  for (const route of plugin.frontend.routes) {
    const absolute = route.path.startsWith('/');
    const fullPath = absolute
      ? route.path
      : `/plugin/${plugin.id}/${route.path}`;
    pluginPathComponents[fullPath] = {
      pluginId: plugin.id,
      componentName: route.component,
    };
    if (route.menu) continue;

    const routeName = `Plugin_${plugin.id}_${route.path.replaceAll('/', '_')}`;
    routes.push({
      parentName: absolute ? 'Root' : 'Plugin',
      route: {
        name: routeName,
        path: absolute ? route.path.slice(1) : `${plugin.id}/${route.path}`,
        component: () => loadPluginComponent(plugin.id, route.component),
        meta: {
          icon: route.icon || 'lucide:puzzle',
          title: route.title || plugin.name,
          hideInMenu: true,
        },
      },
    });
  }

  if (routes.length === 0) return;

  if (routes.some((item) => item.parentName === 'Plugin')) {
    const pluginParent = router.getRoutes().find((r) => r.name === 'Plugin');
    if (!pluginParent) {
      router.addRoute('Root', {
        name: 'Plugin',
        path: '/plugin',
        component: () => import('#/views/plugin/installed/index.vue'),
        meta: {
          icon: 'lucide:puzzle',
          title: '插件',
        },
        children: [],
      });
    }
  }

  for (const item of routes) {
    router.removeRoute(item.route.name as string);
    router.addRoute(item.parentName, item.route);
  }
  pluginRoutes.set(
    plugin.id,
    routes.map((item) => item.route),
  );
  console.warn(
    `[PluginLoader] 插件 ${plugin.id} 隐藏路由已注册:`,
    routes.map((item) => item.route.path),
  );
}

/**
 * 动态加载插件组件（用于路由懒加载）
 */
async function loadPluginComponent(
  pluginId: string,
  componentName: string,
): Promise<Component> {
  const comp = getComponent(pluginId, componentName);
  if (comp) return comp;

  try {
    const mjsUrl = `${PLUGIN_ASSET_BASE}/plugins/${pluginId}/assets/frontend/index.mjs`;
    const module = await import(/* @vite-ignore */ mjsUrl);
    const components =
      typeof module.default === 'function'
        ? module.default(host)
        : module.default || {};
    loadedModules.set(pluginId, components || {});

    const loaded = getPluginComponent(pluginId, componentName);
    if (loaded) return loaded;
  } catch (error) {
    console.error(
      `[PluginLoader] 加载插件组件失败 ${pluginId}/${componentName}:`,
      error,
    );
  }

  // 返回占位组件，避免 Vue Router 报 missing component
  return function PluginErrorFallback() {
    return h(PluginErrorComponent, { pluginId, componentName });
  };
}

/**
 * 注册插件插槽
 */
function registerPluginSlots(plugin: PluginManifestFrontend) {
  for (const slot of plugin.frontend.slots || []) {
    if (!slot.target || !slot.component) continue;
    const list = slotRegistry[slot.target] || [];
    if (!list.some((s) => s.pluginId === plugin.id)) {
      list.push({
        pluginId: plugin.id,
        componentName: slot.component,
        name: plugin.name,
        // @ts-expect-error plugin manifest may have optional icon
        icon: plugin.icon || 'lucide:puzzle',
        // @ts-expect-error plugin manifest may have optional color
        color: plugin.color,
      });
      slotRegistry[slot.target] = list;
    }
  }
}

/**
 * 加载单个插件的前端资源
 */
export async function loadPluginFrontend(
  plugin: PluginManifestFrontend,
): Promise<void> {
  if (!plugin.enabled) return;

  try {
    // 如果有前端组件，先 import ESM 模块
    const hasComponents =
      plugin.frontend.routes?.length > 0 || plugin.frontend.slots?.length > 0;

    if (hasComponents) {
      const mjsUrl = `${PLUGIN_ASSET_BASE}/plugins/${plugin.id}/assets/frontend/index.mjs`;
      // 原生 import() 无超时，后端挂起时 Promise 永不 resolve，需手动兜底
      const module = await Promise.race([
        import(/* @vite-ignore */ mjsUrl),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`插件 ${plugin.id} 前端资源加载超时`)),
            PLUGIN_IMPORT_TIMEOUT,
          ),
        ),
      ]);
      const components =
        typeof module.default === 'function'
          ? module.default(host)
          : module.default || {};
      loadedModules.set(plugin.id, components || {});

      console.warn(
        `[PluginLoader] 插件 ${plugin.id} 加载成功，暴露的组件:`,
        Object.keys(components || {}),
      );
    }

    registerContentProfiles(plugin);

    // 注册路由
    if (plugin.frontend.routes?.length > 0) {
      registerPluginRoutes(plugin);
    }

    // 注册插槽
    if (plugin.frontend.slots?.length > 0) {
      registerPluginSlots(plugin);
      console.warn(
        `[PluginLoader] 插件 ${plugin.id} 插槽已注册:`,
        plugin.frontend.slots.map((s) => s.target),
      );
    }
  } catch (error) {
    console.error(`[PluginLoader] 加载插件前端失败 ${plugin.id}:`, error);
  }
}

let _pluginsLoaded = false;
let _lastLoadAttempt = 0;

const PLUGIN_IMPORT_TIMEOUT = 15_000;
/** 加载失败后的退避窗口，避免每次导航都同步重试 */
const LOAD_RETRY_BACKOFF = 30_000;

export function resetPluginLoadedFlag(): void {
  _pluginsLoaded = false;
  _lastLoadAttempt = 0;
}

/**
 * 加载所有已启用插件的前端资源
 */
export async function loadAllPluginFrontends(): Promise<void> {
  if (_pluginsLoaded) return;
  if (Date.now() - _lastLoadAttempt < LOAD_RETRY_BACKOFF) return;
  _lastLoadAttempt = Date.now();
  try {
    const plugins: PluginManifestFrontend[] = await requestClient.get(
      `${PLUGIN_API_BASE}/plugins`,
    );
    for (const plugin of plugins) {
      if (plugin.enabled) {
        await loadPluginFrontend(plugin);
      }
    }
    _pluginsLoaded = true;
  } catch (error) {
    console.error('[PluginLoader] 获取插件列表失败:', error);
  }
}

/**
 * 获取指定插槽的组件列表
 */
export interface SlotComponent {
  pluginId: string;
  component: Component | null;
  name: string;
  icon: string;
  color?: string;
}

export function getSlotComponents(target: string): SlotComponent[] {
  const list = slotRegistry[target] || [];
  return list.map((item) => ({
    pluginId: item.pluginId,
    component: getComponent(item.pluginId, item.componentName),
    name: item.name,
    icon: item.icon,
    color: item.color,
  }));
}

/**
 * 卸载插件前端资源
 */
export function unloadPluginFrontend(pluginId: string): void {
  // 移除路由
  const routes = pluginRoutes.get(pluginId);
  if (routes) {
    for (const r of routes) {
      router.removeRoute(r.name as string);
    }
    pluginRoutes.delete(pluginId);
  }

  // 移除插槽
  for (const target of Object.keys(slotRegistry)) {
    const list = slotRegistry[target];
    if (!list) continue;
    const filtered = list.filter((s) => s.pluginId !== pluginId);
    if (filtered.length !== list.length) {
      slotRegistry[target] = filtered;
    }
  }

  // 清除 ESM 模块缓存
  loadedModules.delete(pluginId);
}

export default {
  loadPluginFrontend,
  loadAllPluginFrontends,
  unloadPluginFrontend,
  getComponent,
  getSlotComponents,
};
