/**
 * use-video-bridge.ts
 * 从 <video> 元素定时截取帧，通过 postMessage 发送给父窗口（Figma 插件）
 * 用于 Figma 嵌入模式下提取纯视频画面
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

  function startBridge() {
    if (isRunning) return
    isRunning = true

    function capture() {
      if (!isRunning) return

      const video = videoElement.value
      if (!video || !video.srcObject || video.videoWidth === 0) {
        animId = requestAnimationFrame(capture)
        return
      }

      const vw = video.videoWidth
      const vh = video.videoHeight

      // 降采样
      const scale = maxWidth > 0 ? Math.min(1, maxWidth / vw) : 1
      captureCanvas.width = Math.round(vw * scale)
      captureCanvas.height = Math.round(vh * scale)

      ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)

      const now = performance.now()
      if (now - lastPostTime >= interval) {
        try {
          const jpeg = captureCanvas.toDataURL('image/jpeg', quality)
          window.parent.postMessage({ type: 'video-frame', frame: jpeg }, '*')
          lastPostTime = now
        } catch (e) {
          console.warn('[VideoBridge] 截帧失败:', e)
        }
      }

      animId = requestAnimationFrame(capture)
    }

    capture()
    console.log(`[VideoBridge] 已启动 (fps=${targetFps}, quality=${quality}, maxWidth=${maxWidth})`)
  }

  function stopBridge() {
    isRunning = false
    cancelAnimationFrame(animId)
    console.log('[VideoBridge] 已停止')
  }

  return { startBridge, stopBridge, isRunning: ref(isRunning) }
}
