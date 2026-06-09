<template>
  <Teleport to="body">
    <!-- 悬浮球 -->
    <div
      class="debug-fab"
      :class="{
        'fab-edge-top': isEdgeTop,
        'fab-edge-bottom': isEdgeBottom,
        'fab-edge-left': isEdgeLeft,
        'fab-edge-right': isEdgeRight,
        'fab-hidden': isCollapsed
      }"
      :style="fabStyle"
      @pointerdown="onDragStart"
    >
      <div class="fab-indicator" :class="connectionStatusClass">
        <span class="fab-fps">{{ displayFps }}</span>
        <span class="fab-ms">{{ displayLatency }}ms</span>
      </div>
    </div>

    <!-- 调试面板 -->
    <Transition name="panel-slide">
      <div
        v-if="!isCollapsed && isPanelVisible"
        class="debug-panel"
        :style="panelStyle"
        @click.stop
      >
        <div class="panel-header">
          <div class="panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4m0 14v4m-9-9h4m14 0h-4m-1.8-6.2l2.8-2.8m-17 17l2.8-2.8m0-11.4L7.2 5.8m17 17l-2.8-2.8"/>
            </svg>
            <span>远程调试</span>
          </div>
          <button class="panel-close" @click="isPanelVisible = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- 连接状态 -->
        <div class="panel-section">
          <div class="status-grid">
            <div class="status-item" :class="connectionStatusClass">
              <span class="status-dot"></span>
              <span class="status-label">{{ connectionStatusText }}</span>
            </div>
            <div class="status-item" :class="connectionTypeClass">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>
              </svg>
              <span>{{ connectionTypeText }}</span>
            </div>
          </div>
        </div>

        <!-- 实时数据 -->
        <div class="panel-section">
          <div class="metrics-grid">
            <div class="metric-card">
              <span class="metric-label">延迟</span>
              <span class="metric-value latency" :class="{ warning: displayLatency > 100 }">
                {{ displayLatency }}<small>ms</small>
              </span>
            </div>
            <div class="metric-card">
              <span class="metric-label">帧率</span>
              <span class="metric-value fps">{{ displayFps }}<small>fps</small></span>
            </div>
            <div class="metric-card wide">
              <span class="metric-label">分辨率</span>
              <span class="metric-value resolution">{{ videoWidth }} × {{ videoHeight }}</span>
            </div>
          </div>
        </div>

        <!-- 画质设置 -->
        <div class="panel-section">
          <div class="section-title">画质设置</div>
          <div class="setting-row">
            <label>目标帧率</label>
            <div class="setting-buttons">
              <button
                v-for="fps in [5, 10, 15, 30]"
                :key="fps"
                :class="{ active: targetFps === fps }"
                @click="setTargetFps(fps)"
              >{{ fps }}</button>
            </div>
          </div>
          <div class="setting-row">
            <label>编码质量</label>
            <div class="quality-slider">
              <input
                type="range"
                min="30"
                max="100"
                step="10"
                v-model.number="qualityPercent"
                @change="setQuality"
              />
              <span class="quality-value">{{ qualityPercent }}%</span>
            </div>
          </div>
        </div>

        <!-- 远程控制开关 -->
        <div class="panel-section">
          <div class="section-title">控制模式</div>
          <button
            class="remote-toggle"
            :class="{ active: remoteControlEnabled }"
            @click="handleToggleRemoteControl"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M9 9l-5 5"/>
            </svg>
            <span>{{ remoteControlEnabled ? '远程控制中' : '开启远程控制' }}</span>
          </button>
          <div class="toggle-hint" v-if="remoteControlEnabled">
            拖动画面将控制设备，截图按钮仍可用
          </div>
          <div class="toggle-hint" v-else>
            拖动画面将捕获截图
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="panel-section actions">
          <button class="action-btn danger" @click="handleDisconnect">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18.36 6.64A9 9 0 0 1 20.77 15M6.16 6.16a9 9 0 1 0 12.68 12.68M12 2v4m0 12v4"/>
            </svg>
            断开连接
          </button>
          <button class="action-btn" @click="handleFullscreen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
            全屏
          </button>
        </div>

        <!-- 调试日志区域 -->
        <div class="panel-section debug-log" v-if="debugLogs.length > 0">
          <div class="section-title">日志</div>
          <div class="log-list">
            <div v-for="(log, i) in debugLogs.slice(-5)" :key="i" class="log-item" :class="log.type">
              {{ log.msg }}
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps<{
  isConnected: boolean;
  remoteStream?: MediaStream | null;
  remoteControlEnabled: boolean;
}>();

const emit = defineEmits<{
  (e: 'disconnect'): void;
  (e: 'send-settings', settings: { fps?: number; quality?: number }): void;
  (e: 'toggle-remote-control'): void;
}>();

// 位置状态
const fabX = ref(20);
const fabY = ref(100);

// 边缘检测
const isEdgeTop = computed(() => fabY.value < 60);
const isEdgeBottom = computed(() => fabY.value > (window.innerHeight - 80));
const isEdgeLeft = computed(() => fabX.value < 60);
const isEdgeRight = computed(() => fabX.value > (window.innerWidth - 60));

// 折叠状态
const isCollapsed = computed(() => isEdgeLeft.value || isEdgeRight.value);
const isPanelVisible = ref(false);

// 视频数据
const displayFps = ref(0);
const displayLatency = ref(0);
const videoWidth = ref(0);
const videoHeight = ref(0);
const connectionType = ref<'p2p' | 'relay' | 'unknown'>('unknown');

// 画质设置
const targetFps = ref(15);
const qualityPercent = ref(80);

// 调试日志
interface DebugLog {
  msg: string;
  type: 'info' | 'warn' | 'success' | 'error';
  time: number;
}
const debugLogs = ref<DebugLog[]>([]);

function addLog(msg: string, type: DebugLog['type'] = 'info') {
  const now = new Date();
  debugLogs.value.push({
    msg: `${now.toLocaleTimeString()}: ${msg}`,
    type,
    time: now.getTime(),
  });
  // 只保留最近20条
  if (debugLogs.value.length > 20) {
    debugLogs.value.shift();
  }
}

// FPS 统计 - 区分渲染帧率和视频帧率
let fpsInterval: ReturnType<typeof setInterval> | null = null;
let latencyInterval: ReturnType<typeof setInterval> | null = null;
let renderFrameCount = 0;
let lastRenderTime = performance.now();

// 统计真实视频帧率
function startRealFpsCounter() {
  let videoFrames = 0;
  let prevTime = 0;

  const onTimeUpdate = () => {
    const video = document.querySelector('.remote-video') as HTMLVideoElement;
    if (video && video.currentTime !== prevTime) {
      videoFrames++;
      prevTime = video.currentTime;
    }
  };

  // 监听 video timeupdate 事件
  window.addEventListener('timeupdate', onTimeUpdate, true);

  // 通过 requestAnimationFrame 计算渲染帧率
  const countRaf = () => {
    if (props.isConnected) {
      renderFrameCount++;
      requestAnimationFrame(countRaf);
    }
  };
  requestAnimationFrame(countRaf);

  // 每1秒更新显示
  fpsInterval = setInterval(() => {
    const video = document.querySelector('.remote-video') as HTMLVideoElement;

    // 更新尺寸
    if (video?.videoWidth && video?.videoHeight) {
      videoWidth.value = video.videoWidth;
      videoHeight.value = video.videoHeight;
    }

    // 计算渲染帧率
    const now = performance.now();
    const elapsed = Math.max(now - lastRenderTime, 1);
    const renderFps = Math.round((renderFrameCount * 1000) / elapsed);
    renderFrameCount = 0;
    lastRenderTime = now;

    // 显示视频帧数（如果为0说明没有新帧，用渲染帧率）
    displayFps.value = videoFrames || renderFps;

    addLog(`渲染:${renderFps}fps 视频:${videoFrames}fps`, 'info');
    videoFrames = 0; // 每秒重置
  }, 1000);
}

function stopRealFpsCounter() {
  if (fpsInterval) {
    clearInterval(fpsInterval);
    fpsInterval = null;
  }
}
const connectionStatusClass = computed(() => ({
  connected: props.isConnected,
  disconnected: !props.isConnected,
}));

const connectionStatusText = computed(() => 
  props.isConnected ? '已连接' : '未连接'
);

const connectionTypeClass = computed(() => ({
  'type-p2p': connectionType.value === 'p2p',
  'type-relay': connectionType.value === 'relay',
  'type-unknown': connectionType.value === 'unknown',
}));

const connectionTypeText = computed(() => {
  switch (connectionType.value) {
    case 'p2p': return 'P2P直连';
    case 'relay': return '中继服务器';
    default: return '检测中...';
  }
});

// 样式
const fabStyle = computed(() => ({
  left: `${fabX.value}px`,
  top: `${fabY.value}px`,
}));

const panelStyle = computed(() => {
  const x = fabX.value + 50;
  const y = Math.min(Math.max(fabY.value, 20), window.innerHeight - 400);
  return {
    left: `${x}px`,
    top: `${y}px`,
  };
});

// 拖拽
function onDragStart(e: PointerEvent) {
  let dragOffsetX = e.clientX - fabX.value;
  let dragOffsetY = e.clientY - fabY.value;
  
  const onMove = (ev: PointerEvent) => {
    let newX = ev.clientX - dragOffsetX;
    let newY = ev.clientY - dragOffsetY;
    newX = Math.max(10, Math.min(window.innerWidth - 50, newX));
    newY = Math.max(10, Math.min(window.innerHeight - 50, newY));
    fabX.value = newX;
    fabY.value = newY;
  };
  
  const onEnd = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    isPanelVisible.value = !isPanelVisible.value;
  };
  
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
}

// 延迟模拟
function startLatencySimulation() {
  latencyInterval = setInterval(() => {
    if (props.isConnected) {
      // 根据连接状态模拟延迟
      displayLatency.value = Math.round(Math.random() * 40 + 15);
      connectionType.value = 'p2p';
    } else {
      displayLatency.value = 0;
    }
  }, 1000);
}

// 设置方法 - 发送设置命令
function setTargetFps(fps: number) {
  targetFps.value = fps;
  addLog(`请求设置帧率: ${fps}fps`, 'info');
  emit('send-settings', { fps });
  
  // 延迟重试一次（防止 DataChannel 未就绪）
  setTimeout(() => {
    addLog(`重发帧率设置: ${fps}fps`, 'warn');
    emit('send-settings', { fps });
  }, 500);
}

function setQuality() {
  addLog(`请求设置质量: ${qualityPercent.value}%`, 'info');
  emit('send-settings', { quality: qualityPercent.value });
  
  // 延迟重试
  setTimeout(() => {
    addLog(`重发质量设置: ${qualityPercent.value}%`, 'warn');
    emit('send-settings', { quality: qualityPercent.value });
  }, 500);
}

function handleDisconnect() {
  addLog('断开连接', 'warn');
  emit('disconnect');
  isPanelVisible.value = false;
}

function handleFullscreen() {
  const video = document.querySelector('.remote-video') as HTMLVideoElement;
  if (video) {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      video.requestFullscreen?.();
    }
  }
}

function handleToggleRemoteControl() {
  emit('toggle-remote-control');
}

// 监听连接状态
watch(() => props.isConnected, (connected) => {
  if (connected) {
    addLog('已连接，启动监控', 'success');
    nextTick(() => {
      startRealFpsCounter();
      startLatencySimulation();
    });
  } else {
    stopRealFpsCounter();
    if (latencyInterval) {
      clearInterval(latencyInterval);
      latencyInterval = null;
    }
    displayFps.value = 0;
    displayLatency.value = 0;
    addLog('连接已断开', 'error');
  }
});

onMounted(() => {
  window.addEventListener('resize', () => {
    fabY.value = Math.min(fabY.value, window.innerHeight - 50);
  });
  addLog('悬浮球已初始化', 'info');
});

onUnmounted(() => {
  stopRealFpsCounter();
  if (latencyInterval) {
    clearInterval(latencyInterval);
  }
});
</script>

<style scoped>
/* 悬浮球 */
.debug-fab {
  position: fixed;
  z-index: 9999;
  cursor: grab;
  user-select: none;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.debug-fab:active {
  cursor: grabbing;
}

.debug-fab.fab-hidden {
  opacity: 0.3;
}

.debug-fab.fab-hidden:hover {
  opacity: 1;
}

.fab-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(99, 102, 241, 0.4);
  border-radius: 12px;
  box-shadow: 
    0 4px 20px rgba(0, 0, 0, 0.4),
    0 0 30px rgba(99, 102, 241, 0.15);
  transition: all 0.3s ease;
}

.fab-indicator:hover {
  border-color: rgba(99, 102, 241, 0.8);
  box-shadow: 
    0 4px 24px rgba(0, 0, 0, 0.5),
    0 0 40px rgba(99, 102, 241, 0.25);
  transform: scale(1.05);
}

.fab-fps {
  font-size: 14px;
  font-weight: 700;
  color: #22c55e;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 10px rgba(34, 197, 94, 0.5);
}

.fab-ms {
  font-size: 9px;
  font-weight: 500;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
}

.fab-indicator.disconnected .fab-fps {
  color: #a1a1aa;
  text-shadow: none;
}

/* 边缘折叠效果 */
.fab-edge-top .fab-indicator,
.fab-edge-bottom .fab-indicator {
  border-radius: 12px 12px 4px 4px;
  height: 24px;
}

.fab-edge-left .fab-indicator,
.fab-edge-right .fab-indicator {
  border-radius: 4px 12px 12px 4px;
  width: 24px;
  height: 48px;
}

/* 调试面板 */
.debug-panel {
  position: fixed;
  z-index: 9998;
  width: 280px;
  background: rgba(10, 10, 15, 0.92);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 16px;
  box-shadow: 
    0 20px 60px rgba(0, 0, 0, 0.5),
    0 0 40px rgba(99, 102, 241, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: rgba(99, 102, 241, 0.1);
  border-bottom: 1px solid rgba(99, 102, 241, 0.2);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.panel-title svg {
  color: #6366f1;
}

.panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #71717a;
  cursor: pointer;
  transition: all 0.2s ease;
}

.panel-close:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.panel-section {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-section:last-child {
  border-bottom: none;
}

/* 状态网格 */
.status-grid {
  display: flex;
  gap: 12px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #a1a1aa;
}

.status-item.connected .status-dot {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}

.status-item.disconnected .status-dot {
  background: #71717a;
}

.status-item.type-p2p svg {
  color: #22c55e;
}

.status-item.type-relay svg {
  color: #f59e0b;
}

.status-item.type-unknown svg {
  color: #71717a;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* 数据指标 */
.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.metric-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
}

.metric-card.wide {
  grid-column: span 2;
}

.metric-label {
  display: block;
  font-size: 10px;
  color: #71717a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.metric-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.metric-value small {
  font-size: 10px;
  font-weight: 500;
  color: #71717a;
  margin-left: 2px;
}

.metric-value.latency {
  color: #22c55e;
}

.metric-value.latency.warning {
  color: #f59e0b;
}

.metric-value.fps {
  color: #60a5fa;
}

.metric-value.resolution {
  font-size: 14px;
  color: #a1a1aa;
}

/* 设置区域 */
.section-title {
  font-size: 10px;
  color: #71717a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.setting-row:last-child {
  margin-bottom: 0;
}

.setting-row label {
  font-size: 12px;
  color: #a1a1aa;
}

.setting-buttons {
  display: flex;
  gap: 4px;
}

.setting-buttons button {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.setting-buttons button:hover {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.4);
  color: #fff;
}

.setting-buttons button.active {
  background: rgba(99, 102, 241, 0.3);
  border-color: #6366f1;
  color: #fff;
}

.quality-slider {
  display: flex;
  align-items: center;
  gap: 10px;
}

.quality-slider input[type="range"] {
  width: 100px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  appearance: none;
  cursor: pointer;
}

.quality-slider input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  background: #6366f1;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
}

.quality-value {
  font-size: 12px;
  font-weight: 600;
  color: #6366f1;
  min-width: 32px;
  text-align: right;
}

/* 远程控制开关 */
.remote-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #a1a1aa;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.remote-toggle:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.3);
  color: #fff;
}

.remote-toggle.active {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.4);
  color: #22c55e;
  box-shadow: 0 0 16px rgba(34, 197, 94, 0.2);
}

.remote-toggle.active svg {
  color: #22c55e;
}

.toggle-hint {
  font-size: 10px;
  color: #55556a;
  margin-top: 8px;
  text-align: center;
}

/* 操作按钮 */
.panel-section.actions {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #a1a1aa;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.action-btn.danger {
  border-color: rgba(239, 68, 68, 0.3);
}

.action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: #ef4444;
}

/* 调试日志 */
.debug-log {
  max-height: 120px;
  overflow-y: auto;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-item {
  font-size: 10px;
  font-family: monospace;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  word-break: break-all;
}

.log-item.info { color: #a1a1aa; }
.log-item.warn { color: #fbbf24; }
.log-item.success { color: #22c55e; }
.log-item.error { color: #ef4444; }

/* 过渡动画 */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateX(-20px) scale(0.95);
}
</style>
