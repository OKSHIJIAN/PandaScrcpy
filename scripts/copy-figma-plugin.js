/**
 * PandaScrcpy Figma Plugin Build Script
 * 
 * 修复版：
 * - HTML 模板包含 CSS <link> 引用
 * - 注入 WebRTC/WebUSB/API stub（Figma 沙箱不支持这些 API）
 * - 自动检测并引用 Vite 构建产物中的 CSS 文件
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIGMA_PLUGIN_DIR = path.join(ROOT, 'figma-plugin');
const DIST_UI_DIR = path.join(FIGMA_PLUGIN_DIR, 'dist-ui');
const OUTPUT_DIR = path.join(ROOT, 'dist', 'panda-scrcpy-figma');

console.log('=== PandaScrcpy Figma Plugin Build (Fixed) ===\n');

// 检查构建产物
if (!fs.existsSync(DIST_UI_DIR)) {
  console.error('❌ Error: dist-ui not found.');
  console.error('   Run first: vite build --config vite.figma.config.ts');
  process.exit(1);
}

const indexPath = path.join(DIST_UI_DIR, 'index.js');
if (!fs.existsSync(indexPath)) {
  console.error('❌ Error: dist-ui/index.js not found.');
  process.exit(1);
}

// 扫描 CSS 文件
function findCssFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCssFiles(fullPath));
    } else if (entry.name.endsWith('.css')) {
      // 返回相对于 dist-ui 的路径
      results.push(path.relative(DIST_UI_DIR, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

const cssFiles = findCssFiles(DIST_UI_DIR);
console.log(`📋 Found ${cssFiles.length} CSS file(s):`, cssFiles);

// 创建输出目录
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 1. 复制 manifest.json
fs.copyFileSync(
  path.join(FIGMA_PLUGIN_DIR, 'manifest.json'),
  path.join(OUTPUT_DIR, 'manifest.json')
);
console.log('✓ manifest.json');

// 2. 构建 CSS link 标签
const cssLinks = cssFiles.map(f => `  <link rel="stylesheet" href="./${f}">`).join('\n');

// 3. 生成 HTML（包含 CSS 引用 + API stub）
// 注意：CSS 必须在 JS 之前加载，否则样式闪烁
const uiHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>PandaScrcpy</title>
${cssLinks}
  <style>
    /* 加载中占位样式 */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #app { height: 100%; overflow: hidden; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      background: #0a0e14;
      color: #e0e0e0;
    }
    #loading-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-size: 14px;
      color: #00ffc8;
    }
  </style>
</head>
<body>
  <div id="app"><div id="loading-hint">⏳ Loading PandaScrcpy...</div></div>
  <!-- Figma 沙箱 API stub — 在主应用之前注入 -->
  <script>
    // === Figma Environment Compatibility Layer ===
    // Figma 插件 iframe 不支持以下 API，提供 mock 防止崩溃
    
    // WebRTC mock — PeerJS 依赖此 API
    if (typeof RTCPeerConnection === 'undefined') {
      window.RTCPeerConnection = function() {
        this.localDescription = null;
        this.remoteDescription = null;
        this.iceConnectionState = 'failed';
        this.signalingState = 'stable';
        this.onicecandidate = null;
        this.ontrack = null;
        this.ondatachannel = null;
        this.onconnectionstatechange = null;
        this.close = function() {};
        this.createOffer = async () => ({ type: 'offer', sdp: '' });
        this.createAnswer = async () => ({ type: 'answer', sdp: '' });
        this.setLocalDescription = async () => {};
        this.setRemoteDescription = async () => {};
        this.addIceCandidate = async () => {};
        this.getTransceivers = () => [];
        this.getSenders = () => [];
        this.getReceivers = () => [];
        this.addTrack = () => ({});
        this.removeTrack = () => {};
        this.createDataChannel = () => ({
          send: function() {},
          close: function() {},
          binaryType: 'arraybuffer',
          onmessage: null,
          onopen: null,
          onclose: null,
          bufferedAmount: 0,
          readyState: 'closed'
        });
      };
      window.RTCSessionDescription = function(desc) { return desc || {}; };
      window.RTCIceCandidate = function(candidate) { return candidate || {}; };
    }

    // WebSocket mock（如果 Figma 限制 WebSocket）
    // 通常 Figma 允许 ws:// 连接，这里只做防御性处理
    
    // USB mock（WebUSB API）
    if (typeof navigator !== 'undefined' && !navigator.usb) {
      navigator.usb = {
        getDevices: async () => [],
        requestDevice: async () => { throw new Error('WebUSB not available in Figma'); },
        addEventListener: function() {}
      };
    }

    // Serial mock（Web Serial API）— adb 连接可能用到
    if (typeof navigator !== 'undefined' && !navigator.serial) {
      navigator.serial = {
        getPorts: async () => [],
        requestPort: async () => { throw new Error('WebSerial not available in Figma'); },
        addEventListener: function() {}
      };
    }

    console.log('[PandaScrcpy] Figma compatibility layer loaded ✓');
  </script>
  <!-- 主应用 IIFE bundle -->
  <script src="./index.js"></script>
</body>
</html>`;

// 4. 生成 plugin.js（内联 HTML）
const pluginJs = `// PandaScrcpy Figma Plugin - Auto-generated
// Generated by scripts/copy-figma-plugin.js (fixed version)
// Includes: CSS references + Figma API stub

figma.showUI(${JSON.stringify(uiHtml)}, { width: 480, height: 720 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  }
};
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'plugin.js'), pluginJs);
console.log('✓ plugin.js (HTML inlined with CSS + stub)');

// 同时更新 figma-plugin/plugin.js（Figma 直接读取这个目录）
fs.writeFileSync(path.join(FIGMA_PLUGIN_DIR, 'plugin.js'), pluginJs);
console.log('✓ figma-plugin/plugin.js updated (in-place)');

// 4.5 生成独立的 index.html — 供 manifest.json "ui" 字段使用
// Figma 插件有两种 UI 加载方式:
//   A) manifest.json "ui"字段 → Figma自动加载该HTML作为iframe
//   B) plugin.js 中 figma.showUI(html) → 动态显示
// 两种方式都需要正确的 HTML，这里同时生成 index.html 确保兼容
fs.writeFileSync(path.join(FIGMA_PLUGIN_DIR, 'index.html'), uiHtml);
fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), uiHtml);
console.log('✓ index.html generated (for manifest.json "ui" field)');

// 5. 将 dist-ui 资源复制到目标目录
function copyDist(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDist(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDist(DIST_UI_DIR, OUTPUT_DIR);
console.log(`✓ Copied to ${path.relative(ROOT, OUTPUT_DIR)}`);

copyDist(DIST_UI_DIR, FIGMA_PLUGIN_DIR);
console.log('✓ Copied to figma-plugin/ root');

// 统计文件数
function countFiles(dir) {
  let c = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) c += countFiles(path.join(dir, entry.name));
      else c++;
    }
  } catch(e) {}
  return c;
}

console.log(`\n✅ Done! ${countFiles(OUTPUT_DIR)} files`);
console.log(`   CSS files included: ${cssFiles.length}`);
