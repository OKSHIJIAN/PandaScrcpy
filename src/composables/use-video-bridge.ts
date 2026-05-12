/**
 * use-video-bridge.ts
 * 从 <video> 元素定时截取帧，通过 postMessage 发送给父窗口（Figma 插件）
 * 用于 Figma 嵌入模式下提取纯视频画面
 * 
 * 性能优化版：减少内存分配 + 降低无谓计算
 */

import { ref, type Ref } from 'vue'

export interface VideoBridgeOptions {
  /** 目标帧率，默认 8fps */
  targetFps?: number
  /** JPEG 质量 0.1~1.0，默认 0.6 */
  quality?: number
  /** 最大输出宽度，0=不限制，默认 480 */
  maxWidth?: number
}

export function useVideoBridge(videoElement: Ref<HTMLVideoElement | null>, options: VideoBridgeOptions = {}) {
  const { targetFps = 8, quality = 0.6, maxWidth = 480 } = options

  // 隐藏的 canvas 用于截帧
  const captureCanvas = document.createElement('canvas')
  const ctx = captureCanvas.getContext('2d', { willReadFrequently: true })!

  let animId = 0
  let lastPostTime = 0
  const interval = 1000 / targetFps
  let isRunning = false

  // 缓存上一次 canvas 尺寸，避免重复分配
  let lastCanvasWidth = 0
  let lastCanvasHeight = 0

  function startBridge() {
    if (isRunning) return
    isRunning = true

    function capture() {
      if (!isRunning) return

      const video = videoElement.value
      if (!video || !video.srcObject || video.videoWidth === 0) {
        // 视频未就绪时用 setTimeout 重试（不用 rAF 浪费资源）
        animId = setTimeout(capture, 100)
        return
      }

      const vw = video.videoWidth
      const vh = video.videoHeight

      // 降采样
      const scale = maxWidth > 0 ? Math.min(1, maxWidth / vw) : 1
      const w = Math.round(vw * scale)
      const h = Math.round(vh * scale)

      // ✅ 只在尺寸变化时才重设 canvas（避免重复分配 GPU 缓冲区）
      if (w !== lastCanvasWidth || h !== lastCanvasHeight) {
        captureCanvas.width = w
        captureCanvas.height = h
        lastCanvasWidth = w
        lastCanvasHeight = h
      }

      ctx.drawImage(video, 0, 0, w, h)

      const now = performance.now()
      if (now - lastPostTime >= interval) {
        try {
          // ✅ 用 toBlob 替代 toDataURL（更省内存，异步非阻塞）
          captureCanvas.toBlob((blob) => {
            if (!blob || !isRunning) return
            // ✅ 用 ObjectURL 替代 base64 字符串（内存更小）
            const url = URL.createObjectURL(blob)
            window.parent.postMessage({ type: 'video-frame', frame: url }, '*')
            // ✅ 5秒后释放 ObjectURL（给接收方足够的加载时间）
            setTimeout(() => {
              if (url.startsWith('blob:')) URL.revokeObjectURL(url)
            }, 5000)
          }, 'image/jpeg', quality)
          lastPostTime = now
        } catch (e) {
          console.warn('[VideoBridge] 截帧失败:', e)
        }
      }

      // ✅ 用 setTimeout 替代 requestAnimationFrame（按需调度，而非 60fps 空转）
      animId = setTimeout(capture, Math.floor(1000 / targetFps))
    }

    capture()
    console.log(`[VideoBridge] 已启动 (fps=${targetFps}, quality=${quality}, maxWidth=${maxWidth})`)
  }

  function stopBridge() {
    isRunning = false
    clearTimeout(animId)
    console.log('[VideoBridge] 已停止')
  }

  return { startBridge, stopBridge, isRunning: ref(isRunning) }
}
