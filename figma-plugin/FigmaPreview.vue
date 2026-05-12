<template>
  <v-app class="app-root">
    <!-- 顶部导航栏 -->
    <v-app-bar flat height="48" color="surface" class="app-toolbar">
      <div class="bar-inner">
        <v-img :src="logoUrl" max-width="22" max-height="22" class="flex-shrink-0" />
        <span class="brand-name">PANDASCRCPY</span>
        <v-spacer />
        <v-chip size="small" color="info" variant="flat" class="figma-chip">
          <v-icon start size="12">mdi-puzzle</v-icon>
          Figma Preview
        </v-chip>
      </div>
    </v-app-bar>

    <!-- 主内容区 -->
    <v-main class="main-area">
      <div class="preview-container">
        <!-- 设备连接区域 -->
        <div class="device-card">
          <div class="preview-screen">
            <div class="screen-frame">
              <div class="screen-content">
                <v-icon size="64" color="#333">mdi-cellphone</v-icon>
                <p class="screen-text">设备画面区域</p>
              </div>
            </div>
          </div>

          <!-- 空状态提示 -->
          <div class="empty-state">
            <div class="empty-icon-wrap">
              <v-icon size="40" color="primary mdi-fade-out-animation">mdi-power-plug-off</v-icon>
            </div>
            <p class="empty-title">Figma 预览模式</p>
            <p class="empty-desc">设备连接功能需要在浏览器中使用</p>

            <div class="action-buttons">
              <v-btn
                href="https://github.com/pandatestgrid/panda-web-scrcpy"
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                color="surface-variant"
                variant="flat"
                rounded="0"
                class="action-btn"
              >
                <v-icon start size="16">mdi-github</v-icon>
                查看源码
              </v-btn>
              <v-btn
                href="https://www.pandatest.net/device"
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                color="primary"
                variant="flat"
                rounded="0"
                class="action-btn"
              >
                <v-icon start size="16">mdi-launch</v-icon>
                在线体验
              </v-btn>
            </div>
          </div>
        </div>

        <!-- 右侧信息面板 -->
        <div class="info-panel">
          <div class="panel-header">
            <v-icon size="14" color="secondary">mdi-information-outline</v-icon>
            <span>功能概览</span>
          </div>
          <div class="feature-list">
            <div v-for="(feat, i) in features" :key="i" class="feature-item">
              <v-icon size="16" :color="feat.color" class="feature-icon">{{ feat.icon }}</v-icon>
              <div class="feature-text">
                <span class="feature-name">{{ feat.name }}</span>
                <span class="feature-desc">{{ feat.desc }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </v-main>

    <!-- 底部状态栏 -->
    <div class="status-bar">
      <span class="status-item">
        <v-icon size="12" color="success">mdi-check-circle</v-icon>
        UI 渲染正常
      </span>
      <span class="status-item">
        <v-icon size="12" color="warning">mdi-alert-circle</v-icon>
        ADB/WebRTC 不可用 (Figma沙箱限制)
      </span>
    </div>
  </v-app>
</template>

<script setup>
import { ref } from 'vue'

// 内联 logo SVG — 避免 import asset 在 figma 环境出问题
const logoUrl = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <circle cx="50" cy="50" r="45" fill="#00ffc8" opacity="0.15"/>
  <circle cx="50" cy="50" r="35" fill="#00ffc8" opacity="0.25"/>
  <path d="M35 30 L50 55 L65 30 M50 55 L50 75" stroke="#00ffc8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="50" cy="25" r="6" fill="#00ffc8"/>
</svg>
`)}`

const features = ref([
  { icon: 'mdi-cellphone-link', name: 'USB 投屏', desc: '通过 ADB 连接安卓设备', color: '#00ffc8' },
  { icon: 'mdi-cast', name: '远程观看', desc: 'WebRTC 实时视频流', color: '#6366f1' },
  { icon: 'mdi-tap', name: '触控映射', desc: '鼠标/触摸输入同步', color: '#f59e0b' },
  { icon: 'mdi-file-tree', name: '文件管理', desc: '设备文件浏览传输', color: '#3b82f6' },
  { icon: 'mdi-apps', name: '应用管理', desc: '安装/卸载应用包', color: '#ec4899' },
  { icon: 'mdi-terminal', name: 'ADB Shell', desc: '执行 shell 命令', color: '#22c55e' },
])
</script>

<style>
:root {
  --border: rgba(24, 24, 27, 0.08);
  --border-hover: rgba(24, 24, 27, 0.16);
  --muted: rgba(24, 24, 27, 0.5);
}

html, body, #app {
  height: 100%;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
}

.app-toolbar {
  border-bottom: 1px solid var(--border) !important;
}

.bar-inner {
  display: flex;
  align-items: center;
  flex-grow: 1;
  gap: 8px;
  padding: 0 12px;
  max-width: 100%;
}

.brand-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(24, 24, 27, 0.85);
  white-space: nowrap;
}

.figma-chip {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 0.05em;
}

.main-area {
  background: rgb(var(--v-theme-background)) !important;
  overflow-y: auto !important;
}

.preview-container {
  display: flex;
  gap: 4px;
  height: calc(100% - 28px);
  padding: 4px;
  box-sizing: border-box;
}

.device-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--border);
  overflow: hidden;
}

.preview-screen {
  flex-shrink: 0;
  padding: 12px;
  display: flex;
  justify-content: center;
}

.screen-frame {
  width: 200px;
  height: 360px;
  border-radius: 20px;
  border: 2px solid var(--border);
  background: linear-gradient(145deg, #111 0%, #1a1a2e 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255,255,255,0.05);
}

.screen-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: 0.4;
}

.screen-text {
  font-size: 11px;
  color: #888;
  margin: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
}

.empty-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: rgba(99, 102, 241, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.85);
  margin: 0;
}

.empty-desc {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  max-width: 220px;
  text-align: center;
}

.action-buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.action-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
}

.info-panel {
  width: 180px;
  flex-shrink: 0;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.feature-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.feature-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

.feature-item:hover {
  background: rgba(24, 24, 27, 0.03);
}

.feature-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.feature-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.feature-name {
  font-size: 12px;
  font-weight: 500;
  color: rgba(24, 24, 27, 0.85);
}

.feature-desc {
  font-size: 10px;
  color: var(--muted);
  line-height: 1.3;
}

.status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 12px;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid var(--border);
  font-size: 10px;
  color: var(--muted);
  z-index: 10;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
