/**
 * 分享端 Hook - 优化版
 * 特性：
 * 1. 动态帧率控制 - 静态画面时降低帧率到 2fps
 * 2. 帧变化检测 - 只在画面变化时推送
 * 3. 内存优化 - 及时释放未使用的帧数据
 * 
 * 通信方式（v2）：通过本地 HTTP 中继服务器 relay-server.js (端口 18793)
 *   Host → POST /share-url → 中继服务器 → GET /share-url → Figma 插件
 *   外部浏览器和 Figma 插件是独立窗口，postMessage 无法跨越窗口通信
 */

/** 本地中继服务器地址（与 relay-server.js 端口一致） */
const RELAY_SERVER = 'http://127.0.0.1:18793/share-url';

import { ref, shallowRef, computed, onUnmounted } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import Peer from 'peerjs';
import type { MediaConnection, DataConnection } from 'peerjs';
import { PEER_CONFIG, generateShareId } from '@/services/peer-config';
import { deserializeCommand, isTouchCommand, isKeyCommand, isSettingsCommand } from '@/services/command-types';
import { normalizedToDevice } from '@/services/coord-utils';
import scrcpyState from '@/components/Scrcpy/scrcpy-state';
import {
    AndroidMotionEventAction,
    AndroidMotionEventButton,
    ScrcpyPointerId,
} from '@yume-chan/scrcpy';

export type ConnectionState = 'idle' | 'initializing' | 'ready' | 'error';

export interface ViewerConnection {
  id: string;
  mediaConnection: MediaConnection;
  dataConnection: DataConnection | null;
  connectedAt: Date;
}

export interface UseScreenShareReturn {
  isSharing: Ref<boolean>;
  peerId: Ref<string | null>;
  viewerCount: Ref<number>;
  connectionState: Ref<ConnectionState>;
  error: Ref<string | null>;
  fps: Ref<number>;
  isStatic: Ref<boolean>;
  targetFps: Ref<number>;
  encodingQuality: Ref<number>;
  startSharing: (canvas: HTMLCanvasElement | HTMLVideoElement, frameRate?: number) => Promise<void>;
  stopSharing: () => void;
  viewers: ShallowRef<ViewerConnection[]>;
}

// ============ 帧监控配置 ============
const FRAME_CONFIG = {
  // 正常帧率（动态画面）- 降低到 15fps 减少延迟
  DEFAULT_FPS: 15,
  // 静态画面帧率
  STATIC_FPS: 1,
  // 静态判定阈值：连续 N 帧无变化判定为静态
  STATIC_THRESHOLD: 4,
  // 像素采样步长（跳过像素以提升性能）
  SAMPLE_STEP: 8,
  // 变化检测阈值
  CHANGE_THRESHOLD: 0.05, // 5% 像素变化
  // 默认编码质量
  DEFAULT_QUALITY: 80,
  // 触摸时临时帧率倍数
  TOUCH_FPS_MULTIPLIER: 2,
};

export function useScreenShare(): UseScreenShareReturn {
  const isSharing = ref(false);
  const peerId = ref<string | null>(null);
  const connectionState = ref<ConnectionState>('idle');
  const error = ref<string | null>(null);
  const viewers = shallowRef<ViewerConnection[]>([]);
  
  // 帧率统计
  const fps = ref(0);
  const isStatic = ref(false);
  
  // 画质设置（可由观看端调整）
  const targetFps = ref(FRAME_CONFIG.DEFAULT_FPS);
  const encodingQuality = ref(FRAME_CONFIG.DEFAULT_QUALITY);
  
  let peer: Peer | null = null;
  let mediaStream: MediaStream | null = null;
  const mediaConnections: MediaConnection[] = [];
  const dataConnections: DataConnection[] = [];

  // ============ 动态帧率控制 ============
  let canvas: HTMLCanvasElement | null = null;
  let lastFrameHash: number = 0;
  let staticFrameCount = 0;
  let currentFps = targetFps.value;
  let frameCount = 0;
  let lastFpsUpdate = 0;
  let lastFrameTime = 0;
  let rafId: number | null = null;
  let videoTrack: MediaStreamTrack | null = null;

  const viewerCount = computed(() => viewers.value.length);

  /**
   * 计算帧的简单哈希值（用于快速检测变化）
   * 采样部分像素计算校验和，速度比全像素比较快 8 倍
   */
  function computeFrameHash(imageData: ImageData): number {
    const { data, width, height } = imageData;
    const step = FRAME_CONFIG.SAMPLE_STEP;
    let hash = 0;
    
    // 采样关键区域的像素
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        // RGB 值混合
        hash = ((hash << 5) - hash + data[i]) ^ (data[i + 1] * 3) ^ (data[i + 2] * 7);
      }
    }
    
    return hash;
  }

  /**
   * 获取当前帧
   */
  function captureFrame(): ImageData | null {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      return null;
    }
  }

  /**
   * 主循环：智能帧率控制
   */
  function frameLoop(timestamp: number) {
    if (!isSharing.value || !canvas) {
      rafId = null;
      return;
    }

    const now = performance.now();
    
    // 根据当前帧率计算帧间隔
    const frameInterval = 1000 / currentFps;
    const elapsed = now - lastFrameTime;

    // 更新 FPS 统计
    if (now - lastFpsUpdate >= 1000) {
      fps.value = frameCount;
      frameCount = 0;
      lastFpsUpdate = now;
    }

    // 节流控制
    if (elapsed >= frameInterval) {
      lastFrameTime = now - (elapsed % frameInterval);
      frameCount++;

      // 获取当前帧
      const currentFrame = captureFrame();
      if (currentFrame) {
        const currentHash = computeFrameHash(currentFrame);
        
        // 检测画面变化
        const hasChange = lastFrameHash === 0 || currentHash !== lastFrameHash;
        
        if (hasChange) {
          staticFrameCount = 0;
          currentFps = targetFps.value;
          isStatic.value = false;
          lastFrameHash = currentHash;
        } else {
          staticFrameCount++;
          // 连续多帧无变化，降低帧率
          if (staticFrameCount >= FRAME_CONFIG.STATIC_THRESHOLD) {
            currentFps = FRAME_CONFIG.STATIC_FPS;
            isStatic.value = true;
          }
        }
      }
    }

    rafId = requestAnimationFrame(frameLoop);
  }

  /**
   * 处理来自观看者的控制命令
   */
  function handleCommand(data: unknown): void {
    console.log('[Host] 收到原始数据:', data);
    const command = typeof data === 'string' ? deserializeCommand(data) : data as any;
    if (!command) {
      console.warn('[Host] 收到无效的控制命令:', data);
      return;
    }

    console.log('[Host] 收到控制命令:', command);

    if (isTouchCommand(command)) {
      if (!scrcpyState.running || !scrcpyState.width || !scrcpyState.height) {
        console.warn('[Host] Scrcpy 未运行或尺寸未知，跳过触摸注入');
        return;
      }

      const deviceCoords = normalizedToDevice(
        command.x,
        command.y,
        scrcpyState.width,
        scrcpyState.height,
        scrcpyState.rotation
      );

      const controller = scrcpyState.scrcpy?.controller;
      if (controller) {
        const pointerId: bigint = ScrcpyPointerId.Finger;

        const actionMap: Record<string, AndroidMotionEventAction> = {
          'down': AndroidMotionEventAction.Down,
          'move': AndroidMotionEventAction.Move,
          'up': AndroidMotionEventAction.Up,
        };

        controller.injectTouch({
          action: actionMap[command.action],
          pointerId,
          videoWidth: scrcpyState.width,
          videoHeight: scrcpyState.height,
          pointerX: deviceCoords.x,
          pointerY: deviceCoords.y,
          pressure: command.action === 'up' ? 0 : 1,
          actionButton: AndroidMotionEventButton.Primary,
          buttons: command.action === 'up' ? 0 : 1,
        });
        
        // 触摸操作时临时提升帧率
        currentFps = targetFps.value * FRAME_CONFIG.TOUCH_FPS_MULTIPLIER;
        staticFrameCount = 0;
        isStatic.value = false;
        setTimeout(() => {
          currentFps = targetFps.value;
        }, 500);
      }
    } else if (isKeyCommand(command)) {
      const keyMap: Record<string, string> = {
        'back': 'Back',
        'home': 'AndroidHome',
        'recents': 'AppSwitch',
      };
      
      const keyName = keyMap[command.key];
      if (keyName && scrcpyState.keyboard) {
        scrcpyState.keyboard.down(keyName);
        setTimeout(() => {
          scrcpyState.keyboard?.up(keyName);
        }, 50);
      }
    } else if (isSettingsCommand(command)) {
      // 处理画质设置命令
      console.log('[Host] 收到设置命令:', command);
      
      if (command.fps !== undefined) {
        targetFps.value = command.fps;
        currentFps = command.fps;
        console.log('[Host] 观看端设置帧率:', command.fps);
        
        // 更新视频轨道帧率
        if (videoTrack) {
          try {
            videoTrack.applyConstraints({
              frameRate: { ideal: command.fps, max: Math.min(command.fps + 10, 60) },
            } as MediaTrackConstraints);
            console.log('[Host] 视频轨道帧率已更新');
          } catch (e) {
            console.warn('[Host] 无法更新视频轨道帧率:', e);
          }
        }
      }
      
      if (command.quality !== undefined) {
        encodingQuality.value = command.quality;
        console.log('[Host] 观看端设置编码质量:', command.quality);
        // 注意：Canvas captureStream 不支持直接调整 JPEG 质量
        // 质量控制需要在源头 (scrcpy) 处理
      }
    }
  }

  /**
   * 开始分享屏幕
   */
  async function startSharing(
    sourceCanvas: HTMLCanvasElement | HTMLVideoElement,
    _frameRate: number = FRAME_CONFIG.DEFAULT_FPS
  ): Promise<void> {
    if (isSharing.value) {
      console.warn('[Host] 已经在分享中');
      return;
    }

    try {
      connectionState.value = 'initializing';
      error.value = null;

      if (!(sourceCanvas instanceof HTMLCanvasElement)) {
        throw new Error('不支持的元素类型，请确保使用 Canvas 渲染器');
      }

      console.log('[Host] 从 Canvas 捕获视频流，尺寸:', sourceCanvas.width, 'x', sourceCanvas.height);

      // 清理旧连接
      if (peer && !peer.destroyed) {
        peer.destroy();
      }

      const customId = generateShareId();
      
      await new Promise<void>((resolve, reject) => {
        peer = new Peer(customId, PEER_CONFIG);

        // ========== 信令事件 1: Peer 连接成功 ==========
        peer.on('open', async (id) => {
          console.log('[Host] 已连接信令服务器，分享码:', id);
          peerId.value = id;
          isSharing.value = true;
          connectionState.value = 'ready';
          
          // 创建视频流 - 低延迟优化配置
          canvas = sourceCanvas;
          
          // 计算合适的分辨率（限制最大宽度减少编码延迟）
          const maxCaptureWidth = 720;  // 降低分辨率以减少延迟
          let captureFps = targetFps.value;
          
          mediaStream = sourceCanvas.captureStream(captureFps);
          
          // 获取视频轨道并应用低延迟设置
          videoTrack = mediaStream.getVideoTracks()[0];
          if (videoTrack) {
            try {
              // 应用低延迟约束
              videoTrack.applyConstraints({
                width: { max: maxCaptureWidth, ideal: sourceCanvas.width > maxCaptureWidth ? maxCaptureWidth : sourceCanvas.width },
                height: { max: Math.round(maxCaptureWidth * sourceCanvas.height / sourceCanvas.width) },
                frameRate: { ideal: captureFps, max: captureFps + 5 },
                latencyMode: 'ultra-low-latency' as any,
              } as MediaTrackConstraints & { latencyMode?: string });
              
              console.log('[Host] 视频轨道已配置:', videoTrack.getSettings());
            } catch (e) {
              console.warn('[Host] 无法应用低延迟约束:', e);
              // 降级：只设置基本约束
              try {
                videoTrack.applyConstraints({
                  frameRate: { ideal: captureFps, max: 30 },
                } as MediaTrackConstraints);
              } catch {}
            }
          }
          
          if (!mediaStream) {
            reject(new Error('无法创建视频流'));
            return;
          }
          
          resolve();
        });

        // ========== 信令事件 2: 收到视频请求 ==========
        peer.on('call', (call: MediaConnection) => {
          console.log('[Host] 收到视频请求，来自:', call.peer);
          
          if (!mediaStream) {
            call.close();
            return;
          }

          // 回答并应用低延迟配置
          call.answer(mediaStream);
          mediaConnections.push(call);
          
          // 获取 RTCPeerConnection 进行低延迟配置
          setTimeout(() => {
            try {
              const pc = (call as any).peerConnection as RTCPeerConnection;
              if (pc) {
                // 设置发送端的编码参数，降低延迟
                const senders = pc.getSenders();
                senders.forEach(sender => {
                  if (sender.track?.kind === 'video') {
                    sender.getParameters().then((params) => {
                      if (!params.encodings) params.encodings = [{}];
                      params.encodings[0].maxBitrate = 1500000; // 1.5Mbps 上限
                      params.encodings[0].scaleResolutionDownBy = sourceCanvas.width > 720 ? Math.ceil(sourceCanvas.width / 720) : 1;
                      return sender.setParameters(params);
                    }).catch(e => console.warn('[Host] 编码参数设置失败:', e));
                  }
                });
              }
            } catch (e) {
              console.warn('[Host] 低延迟配置跳过:', e);
            }
          }, 1000); // 等待连接建立后

          const viewerConnection: ViewerConnection = {
            id: call.peer,
            mediaConnection: call,
            dataConnection: null,
            connectedAt: new Date(),
          };
          viewers.value = [...viewers.value, viewerConnection];

          call.on('close', () => {
            console.log('[Host] 媒体连接关闭:', call.peer);
            const idx = mediaConnections.indexOf(call);
            if (idx > -1) mediaConnections.splice(idx, 1);
            viewers.value = viewers.value.filter(v => v.id !== call.peer);
          });

          call.on('error', (err) => {
            console.error('[Host] 媒体连接错误:', err);
            const idx = mediaConnections.indexOf(call);
            if (idx > -1) mediaConnections.splice(idx, 1);
            viewers.value = viewers.value.filter(v => v.id !== call.peer);
          });
        });

        // ========== 信令事件 3: 收到数据连接 ==========
        peer.on('connection', (dataConn: DataConnection) => {
          console.log('[Host] 收到数据连接，来自:', dataConn.peer);
          dataConnections.push(dataConn);

          const viewer = viewers.value.find(v => v.id === dataConn.peer);
          if (viewer) {
            viewer.dataConnection = dataConn;
          }

          dataConn.on('data', (data) => {
            handleCommand(data);
          });

          dataConn.on('close', () => {
            console.log('[Host] 数据连接关闭:', dataConn.peer);
            const idx = dataConnections.indexOf(dataConn);
            if (idx > -1) dataConnections.splice(idx, 1);
          });

          dataConn.on('error', (err) => {
            console.error('[Host] 数据连接错误:', err);
            const idx = dataConnections.indexOf(dataConn);
            if (idx > -1) dataConnections.splice(idx, 1);
          });
        });

        // ========== 信令事件 4: 连接错误 ==========
        peer.on('error', (err) => {
          console.error('[Host] Peer 错误:', err);
          
          if (err.type === 'unavailable-id') {
            peer?.destroy();
            peer = new Peer(PEER_CONFIG);
            peer.on('open', (id) => {
              peerId.value = id;
              isSharing.value = true;
              connectionState.value = 'ready';
              resolve();
            });
          } else {
            error.value = err.message;
            connectionState.value = 'error';
            reject(err);
          }
        });

        peer.on('disconnected', () => {
          console.warn('[Host] Peer 断开连接，尝试重连...');
          peer?.reconnect();
        });
      });

      // 启动帧监控循环（用于统计和动态帧率控制）
      if (!rafId) {
        lastFpsUpdate = performance.now();
        frameCount = 0;
        rafId = requestAnimationFrame(frameLoop);
      }

      console.log('[Host] 开始分享，分享码:', peerId.value);

      // 通过本地 HTTP 中继服务器通知 Figma 插件（外部浏览器无法用 postMessage 跨窗口通信）
      notifyRelayServer(peerId.value, targetFps.value);

    } catch (err) {
      console.error('[Host] 启动分享失败:', err);
      error.value = err instanceof Error ? err.message : '未知错误';
      connectionState.value = 'error';
      stopSharing();
      throw err;
    }
  }

  /**
   * 停止分享
   */
  function stopSharing(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    mediaConnections.forEach(c => c.close());
    mediaConnections.length = 0;
    
    dataConnections.forEach(c => c.close());
    dataConnections.length = 0;

    mediaStream?.getTracks().forEach(t => t.stop());
    mediaStream = null;
    videoTrack = null;

    // 重置帧控制状态
    lastFrameHash = 0;
    staticFrameCount = 0;
    currentFps = targetFps.value;
    fps.value = 0;
    isStatic.value = false;
    targetFps.value = FRAME_CONFIG.DEFAULT_FPS;
    encodingQuality.value = FRAME_CONFIG.DEFAULT_QUALITY;
    canvas = null;

    peer?.destroy();
    peer = null;

    isSharing.value = false;
    peerId.value = null;
    connectionState.value = 'idle';
    error.value = null;
    viewers.value = [];

    console.log('[Host] 停止分享');

    // 通知中继服务器：分享已停止
    notifyRelayServer(null, 0);
  }

  /**
   * 通过本地 HTTP 中继服务器通知 Figma 插件
   * 
   * 架构：外部浏览器 PandaScrcpy Host → POST → relay-server.js (localhost:18793) → GET ← Figma 插件轮询
   * 因为 Figma 插件和外部浏览器是独立窗口，postMessage 无法跨窗口通信
   * 
   * @param sharePeerId - peerId，传 null 表示停止分享
   * @param fps - 帧率
   */
  function notifyRelayServer(sharePeerId: string | null, fps: number) {
    const viewerBaseUrl = window.location.origin + window.location.pathname;
    
    const body = sharePeerId
      ? {
          shareUrl: `${viewerBaseUrl}?peerId=${sharePeerId}&role=viewer&fps=${fps}`,
          peerId: sharePeerId,
          fps,
        }
      : {
          action: 'stop',
          shareUrl: null,
        };

    fetch(RELAY_SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(res => res.json())
      .then(data => {
        console.log('[Host] 中继服务器响应:', data);
      })
      .catch(err => {
        // 中继服务器未启动是正常情况（用户可能还没启动 relay-server.js）
        console.warn('[Host] 无法连接中继服务器 (relay-server.js 可能未启动):', err.message);
      });
  }

  onUnmounted(() => {
    stopSharing();
  });

  return {
    isSharing,
    peerId,
    viewerCount,
    connectionState,
    error,
    fps,
    isStatic,
    targetFps,
    encodingQuality,
    startSharing,
    stopSharing,
    viewers,
  };
}
