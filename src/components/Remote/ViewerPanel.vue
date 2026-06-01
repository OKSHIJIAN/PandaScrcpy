<template>
  <div class="viewer-panel">
    <div v-if="!isConnected" class="connection-form">
      <div class="connect-card">
        <div class="cc-header">
          <v-icon size="20" color="secondary" class="mr-2">mdi-cast-connected</v-icon>
          <span class="cc-title">远程观看</span>
        </div>
        <div class="cc-body">
          <v-text-field
            v-model="hostPeerId"
            label="分享 ID"
            placeholder="输入分享端的 Peer ID"
            :disabled="connectionState === 'connecting'"
            :error-messages="error || undefined"
            hide-details="auto"
            @keyup.enter="handleConnect"
          />
        </div>
        <div class="cc-actions">
          <v-spacer />
          <v-btn
            color="primary"
            size="small"
            :loading="connectionState === 'connecting'"
            :disabled="!hostPeerId.trim()"
            @click="handleConnect"
          >
            <v-icon start size="16">mdi-connection</v-icon>
            连接
          </v-btn>
        </div>
      </div>
    </div>

    <div v-else class="video-area">
      <div class="video-wrapper" ref="videoWrapper">
        <div
          class="touch-overlay"
          @pointerdown="touchController.onPointerDown"
          @pointermove="touchController.onPointerMove"
          @pointerup="touchController.onPointerUp"
          @pointercancel="touchController.onPointerCancel"
        >
          <video
            ref="videoElement"
            autoplay
            playsinline
            muted
            preload="auto"
            class="remote-video"
          />
        </div>
      </div>
    </div>

    <v-snackbar v-model="showError" color="error" timeout="5000">
      {{ error }}
      <template v-slot:actions>
        <v-btn variant="text" size="small" @click="showError = false">关闭</v-btn>
      </template>
    </v-snackbar>

    <v-snackbar v-model="showDisconnected" color="warning" timeout="3000">
      连接已断开
    </v-snackbar>

    <!-- 悬浮球调试面板 -->
    <DebugFloatingBall
      :is-connected="isConnected"
      :remote-stream="remoteStream"
      @disconnect="handleDisconnect"
      @send-settings="sendSettings"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useScreenViewer } from '@/composables/use-screen-viewer';
import { useTouchController } from '@/composables/use-touch-controller';
import { useVideoBridge } from '@/composables/use-video-bridge';
import DebugFloatingBall from './DebugFloatingBall.vue';

const props = defineProps<{
  initialPeerId?: string;
  isFigmaEmbed?: boolean;
}>();

const hostPeerId = ref('');
const showError = ref(false);
const showDisconnected = ref(false);
const videoElement = ref<HTMLVideoElement | null>(null);
const videoWrapper = ref<HTMLDivElement | null>(null);

const {
  isConnected,
  connectionState,
  error,
  remoteStream,
  connect,
  disconnect,
  sendCommand,
  sendSettings,
} = useScreenViewer();

const touchController = useTouchController(sendCommand, videoElement);

// Figma 嵌入模式：视频帧桥接
const { startBridge, stopBridge } = useVideoBridge(videoElement, {
  targetFps: 8,
  quality: 0.6,
  maxWidth: 480,
});

onMounted(() => {
  if (props.initialPeerId) {
    hostPeerId.value = props.initialPeerId;
    setTimeout(() => {
      handleConnect();
    }, 500);
  }
});

watch(error, (newError) => {
  if (newError) showError.value = true;
});

watch(connectionState, (newState, oldState) => {
  if (oldState === 'connected' && newState === 'disconnected') {
    showDisconnected.value = true;
  }
});

// Figma 嵌入模式：有连接时启动桥接，断开时停止
watch([remoteStream, () => props.isFigmaEmbed], ([stream, embed]) => {
  if (embed && stream) {
    startBridge();
  } else {
    stopBridge();
  }
});

onUnmounted(() => {
  stopBridge();
});

/**
 * 截图功能 - 供 UI-REL 插件调用
 */
function captureCurrentFrame() {
  const video = videoElement.value;
  if (!video || !video.srcObject) {
    console.warn('[ViewerPanel] 截图失败：视频未就绪');
    try {
      window.parent.postMessage({
        type: 'SCREEN_CAPTURE',
        payload: { error: 'NOT_READY', imageBase64: '', timestamp: Date.now(), width: 0, height: 0 }
      }, '*');
    } catch(e) {}
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || video.clientWidth;
    canvas.height = video.videoHeight || video.clientHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas context');
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL('image/png', 0.95);
    
    window.parent.postMessage({
      type: 'SCREEN_CAPTURE',
      payload: {
        imageBase64: dataURL,
        timestamp: Date.now(),
        width: canvas.width,
        height: canvas.height,
      }
    }, '*');
    
    console.log('[ViewerPanel] 截图已发送, 尺寸:', canvas.width, 'x', canvas.height);
  } catch (err) {
    console.error('[ViewerPanel] 截图失败:', err);
    try {
      window.parent.postMessage({
        type: 'SCREEN_CAPTURE',
        payload: { error: String(err), imageBase64: '', timestamp: Date.now(), width: 0, height: 0 }
      }, '*');
    } catch(e) {}
  }
}

// 暴露全局方法供 UI-REL 调用
(window as any).__pandaCapture = captureCurrentFrame;

// 监听来自 UI-REL 的截图请求
window.addEventListener('message', (event) => {
  if (event.data?.type === 'REQUEST_SCREEN_CAPTURE') {
    captureCurrentFrame();
  }
});

function bindStreamToVideo() {
  if (videoElement.value && remoteStream.value) {
    videoElement.value.srcObject = remoteStream.value;
    videoElement.value.play().catch((err) => {
      console.warn('[ViewerPanel] 视频自动播放失败:', err);
    });
    
    // 低延迟优化：设置视频解码偏好
    const videoTracks = remoteStream.value.getVideoTracks();
    if (videoTracks.length > 0) {
      console.log('[ViewerPanel] 视频轨道配置:', videoTracks[0].getSettings());
      
      // 尝试获取 PeerJS 的 RTCPeerConnection 并设置接收端低延迟
      setTimeout(() => {
        try {
          // 查找页面中的所有 peerConnection
          const pcs = (window as any).peerConnections || [];
          // 或者通过 PeerJS 内部访问
          console.log('[ViewerPanel] 等待 WebRTC 连接稳定...');
        } catch {}
      }, 500);
    }
  }
}

watch(remoteStream, bindStreamToVideo);
watch(videoElement, bindStreamToVideo);

async function handleConnect() {
  if (!hostPeerId.value.trim()) return;
  try {
    await connect(hostPeerId.value.trim());
  } catch (err) {
    console.error('连接失败:', err);
  }
}

function handleDisconnect() {
  disconnect();
  hostPeerId.value = '';
}
</script>

<style scoped>
.viewer-panel {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #000;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.connection-form {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 16px;
}

.connect-card {
  max-width: 400px;
  width: 100%;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.cc-header {
  display: flex;
  align-items: center;
  padding: 16px 16px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.cc-title {
  font-size: 15px;
  font-weight: 600;
}

.cc-body {
  padding: 16px 16px 8px;
}

.cc-actions {
  display: flex;
  align-items: center;
  padding: 8px 16px 16px;
}

.video-area {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.video-wrapper {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #000;
  overflow: hidden;
  touch-action: none;
  width: 100%;
  height: 100%;
}

.touch-overlay {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  touch-action: none;
}

.remote-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  touch-action: none;
}
</style>
