/**
 * Figma 插件 UI 入口（专用精简版）
 *
 * 关键设计决策：
 * - 不导入 App.vue 或任何业务组件（避免 @yume-chan/peerjs 等阻塞）
 * - 使用独立的 FigmaPreview.vue 组件展示 UI 预览
 * - 只依赖 Vue + Vuetify 核心
 */

import { createApp } from 'vue'
import FigmaPreview from './FigmaPreview.vue'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// 标记 Figma 环境
;(window as any).__FIGMA_PLUGIN__ = true

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        dark: true,
        colors: {
          primary: '#00ffc8',
          secondary: '#1a1f2e',
          surface: '#0a0e14',
          background: '#0a0e14',
          error: '#ff4757',
          success: '#00ffc8',
          info: '#3b82f6',
          warning: '#ffa502',
          accent: '#6366f1',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 0 },
    VCard: { flat: true, rounded: 0 },
    VTextField: { variant: 'outlined', density: 'compact', rounded: 0 },
    VChip: { rounded: 0 },
    VDialog: { rounded: 0 },
    VSheet: { rounded: 0 },
    VMenu: { rounded: 0 },
    VList: { rounded: 0 },
    VAlert: { rounded: 0 },
    VSnackbar: { rounded: 0 },
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
})

// 创建应用实例
const app = createApp(FigmaPreview)
app.use(vuetify)

// 全局错误处理
app.config.errorHandler = (err, instance, info) => {
  console.error('[PandaScrcpy] Vue error:', err, info)
  const appEl = document.getElementById('app')
  if (appEl) {
    appEl.innerHTML = `
      <div style="padding:20px;color:#ff4757;font-family:monospace;word-break:break-all">
        <h3 style="color:#ffa502;margin-bottom:10px">Error</h3>
        <pre style="font-size:11px;white-space:pre-wrap">${String(err.stack || err.message || err)}</pre>
      </div>
    `
  }
}

// 清理 loading hint
const existingHint = document.getElementById('loading-hint')
if (existingHint) existingHint.remove()

app.mount('#app')

console.log('[PandaScrcpy] Figma plugin UI mounted (preview mode)')
