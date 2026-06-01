<template>
  <v-app class="app-root">
    <v-app-bar
      v-if="!isDeviceMode && !isFigmaEmbed && !isStandalone && !isEmbed"
      flat
      height="48"
      color="surface"
      class="app-toolbar"
    >
      <v-btn icon variant="text" size="small" @click="goBackToDevice">
        <v-icon size="20">mdi-arrow-left</v-icon>
      </v-btn>
      <v-app-bar-title class="text-body-2 font-weight-medium text-secondary">
        远程观看
      </v-app-bar-title>
    </v-app-bar>

    <DeviceView v-if="isDeviceMode">
      <template #remote-button>
        <v-btn
          variant="text"
          size="small"
          class="ml-1 text-none text-secondary"
          @click="isDeviceMode = false"
        >
          <v-icon start size="16">mdi-cast-connected</v-icon>
          远程观看
        </v-btn>
      </template>
    </DeviceView>

    <RemoteView v-else :initial-peer-id="initialPeerId" :is-figma-embed="isFigmaEmbed" :is-embed="isEmbed" />
  </v-app>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useTheme } from 'vuetify';
import { VApp, VIcon, VBtn, VAppBar, VAppBarTitle } from 'vuetify/components';
import DeviceView from './views/DeviceView.vue';
import RemoteView from './views/RemoteView.vue';

const theme = useTheme();
const isDeviceMode = ref(true);
const initialPeerId = ref('');
const isFigmaEmbed = ref(false);
const isStandalone = ref(false);
const isEmbed = ref(false);

const isDark = computed(() => theme.global.name.value === 'dark');

function toggleTheme() {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark';
}

onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const remotePeerId = urlParams.get('remote');
  // 检测是否在 Figma 插件 iframe 中运行
  isFigmaEmbed.value = urlParams.has('figma') || window.parent !== window;
  // 检测是否独立模式（纯净界面，无顶部栏）
  isStandalone.value = urlParams.has('standalone') || urlParams.has('clean');
  // 检测是否 embed 模式（嵌入 Figma 插件，隐藏所有 UI chrome）
  isEmbed.value = urlParams.has('embed');
  if (remotePeerId) {
    initialPeerId.value = remotePeerId;
    isDeviceMode.value = false;
    // 通过分享链接进入时也隐藏顶部栏
    isStandalone.value = true;
  }
  // embed 模式整合 standalone 行为
  if (isEmbed.value) {
    isStandalone.value = true;
  }
});

function goBackToDevice() {
  isDeviceMode.value = true;
  initialPeerId.value = '';
  const url = new URL(window.location.href);
  url.searchParams.delete('remote');
  window.history.replaceState({}, '', url.toString());
}
</script>

<style>
:root {
  --border: rgba(24, 24, 27, 0.08);
  --border-hover: rgba(24, 24, 27, 0.16);
  --muted: rgba(24, 24, 27, 0.5);
  --text-primary: rgba(24, 24, 27, 0.85);
  --text-secondary: rgba(24, 24, 27, 0.65);
  --text-tertiary: rgba(24, 24, 27, 0.4);
  --text-hover: rgba(24, 24, 27, 0.85);
  --scrollbar-thumb: rgba(24, 24, 27, 0.12);
  --scrollbar-thumb-hover: rgba(24, 24, 27, 0.2);
  --tab-hover-bg: rgba(24, 24, 27, 0.03);
  --bg-hover: rgba(24, 24, 27, 0.04);
  --bg-subtle: rgba(24, 24, 27, 0.02);
  --key-bg: rgba(24, 24, 27, 0.02);
  --key-text: rgba(24, 24, 27, 0.55);
  --icon-opacity: 0.5;
  --shadow: rgba(24, 24, 27, 0.12);
  --cta-bg: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  --cta-hover: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
}

/* 深色模式变量 */
.v-theme--dark {
  --border: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.16);
  --muted: rgba(255, 255, 255, 0.5);
  --text-primary: rgba(255, 255, 255, 0.85);
  --text-secondary: rgba(255, 255, 255, 0.65);
  --text-tertiary: rgba(255, 255, 255, 0.4);
  --text-hover: rgba(255, 255, 255, 0.85);
  --scrollbar-thumb: rgba(255, 255, 255, 0.12);
  --scrollbar-thumb-hover: rgba(255, 255, 255, 0.2);
  --tab-hover-bg: rgba(255, 255, 255, 0.03);
  --bg-hover: rgba(255, 255, 255, 0.04);
  --bg-subtle: rgba(255, 255, 255, 0.02);
  --key-bg: rgba(255, 255, 255, 0.06);
  --key-text: rgba(255, 255, 255, 0.55);
  --icon-opacity: 0.6;
  --shadow: rgba(0, 0, 0, 0.3);
}

html,
body,
#app {
  height: 100%;
}

body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html {
  overflow: hidden;
}

.app-root :deep(.v-main) {
  padding: 0 !important;
}

.app-root :deep(.v-main__wrap) {
  padding: 0 !important;
}

.app-root :deep(.v-application--wrap) {
  min-height: 100vh !important;
  max-height: 100vh !important;
}

.app-root :deep(.v-container) {
  padding: 0 !important;
}

.app-toolbar {
  border-bottom: 1px solid var(--border) !important;
}

*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
</style>
