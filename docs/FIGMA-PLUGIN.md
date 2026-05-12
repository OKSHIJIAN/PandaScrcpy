# PandaScrcpy Figma 插件

将 PandaScrcpy 安卓投屏工具作为 Figma 插件运行。

## 文件结构

```
figma-plugin/
├── manifest.json      # Figma 插件配置
├── plugin.js          # Figma 主进程脚本（沙箱环境）
├── index.html         # UI 入口 HTML（iframe）
└── entry-ui.ts        # Vue 应用入口（复用 src/App.vue）

vite.figma.config.ts   # Vite 构建配置（Figma 专用）
scripts/
└── copy-figma-plugin.js  # 构建后复制脚本

dist/
└── panda-scrcpy-figma/   # 构建输出目录（导入 Figma 的文件夹）
```

## 构建 & 使用

### 1. 安装依赖
```bash
npm install
```

### 2. 构建 Figma 插件
```bash
npm run build:figma
```
这会：
1. 用 `vite.figma.config.ts` 配置构建 Vue 应用到 `figma-plugin/dist-ui/`
2. 复制所有文件到 `dist/panda-scrcpy-figma/`，生成完整的插件包

### 3. 在 Figma 中导入
1. 打开 **Figma**
2. 菜单：**Plugins → Development → Import plugin...**
3. 选择文件夹：`dist/panda-scrcpy-figma/`
4. 在 Plugins 列表中找到 **PandaScrcpy**，点击运行

## 工作原理

| 组件 | 说明 |
|------|------|
| `plugin.js` | 运行在 Figma 沙箱主线程，负责显示 UI 面板 |
| `index.html` | 运行在 iframe 中，加载 Vue + Vuetify 应用 |
| `entry-ui.ts` | 复用现有的 `App.vue`，包含设备连接/远程观看功能 |

## 注意事项

1. **WebUSB 支持**：Figma 插件中的 WebUSB API 受限，可能无法直接使用 WebUSB 连接设备。如需完整功能，建议配合本地 server.js 使用 WebSocket 连接方式。
2. **网络权限**：已在 manifest.json 中设置 `networkAccess.allowedDomains: ["*"]` 允许所有网络请求。
3. **尺寸**：默认面板大小 480x720px，可在插件中通过消息动态调整。

## 开发调试

如果需要修改插件 UI，直接编辑 `src/` 目录下的 Vue 组件，然后重新运行 `npm run build:figma`。在 Figma 中右键插件选择 **Reload** 即可看到更新。
