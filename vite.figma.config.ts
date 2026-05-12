import { defineConfig, Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import Markdown from './plugins/md-loader.js';
import Binary from './plugins/binary-loader.js';
import { fileURLToPath, URL } from 'node:url';

// Figma 插件 UI 的 Vite 配置
export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    Markdown() as Plugin,
    Binary() as Plugin,
  ],
  base: './',
  build: {
    outDir: 'figma-plugin/dist-ui',
    emptyOutDir: true,
    rollupOptions: {
      // 使用 TS 入口（不是 HTML），Vite 会自动打包
      // 使用 Figma 专用 TS 入口（含错误边界 + 环境检测）
      input: {
        index: 'figma-plugin/entry-ui-figma.ts',
      },
      output: {
        // IIFE 格式：兼容 Figma iframe
        format: 'iife',
        name: 'PandaScrcpyApp',
        entryFileNames: '[name].js',
        // 禁止代码拆分 — Figma iframe 不支持动态加载 chunk
        chunkFileNames: '[name].js',
        assetFileNames: 'assets/[name].[ext]',
        // 强制单文件输出，不拆分 vendor
        manualChunks: undefined,
      },
    },
    target: 'es2020',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
