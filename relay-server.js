/**
 * UI-REL Figma 插件投屏中继服务器
 * 
 * 用途：在「外部浏览器 PandaScrcpy Host」与「Figma 插件 iframe」之间传递分享链接
 * 
 * 工作流程：
 *   1. 用户点击 Figma 插件"投屏工具"按钮 → 外部浏览器打开 PandaScrcpy Host
 *   2. Host 连上设备并开始分享 → POST { shareUrl, peerId, fps } 到本服务器
 *   3. Figma 插件轮询 GET /share-url → 拿到分享链接 → 加载 viewer 到 iframe
 * 
 * 启动方式：
 *   node relay-server.js
 *   或添加到 PandaScrcpy 的 package.json scripts 中
 */

const http = require('http');

const PORT = 18793;
const HOST = '127.0.0.1'; // 只监听本地，不暴露到公网

// 存储当前有效的分享信息
let currentShare = {
  shareUrl: null,
  peerId: null,
  fps: 15,
  updatedAt: null,
};

/**
 * 设置 CORS 头部（允许 Figma 插件 iframe 和外部浏览器访问）
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * 发送 JSON 响应
 */
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/**
 * 读取请求体
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // OPTIONS 预检
  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ==================== GET /share-url ====================
  // Figma 插件轮询此端点，获取当前分享链接
  if (method === 'GET' && (url === '/share-url' || url === '/')) {
    if (currentShare.shareUrl) {
      sendJson(res, 200, {
        success: true,
        shareUrl: currentShare.shareUrl,
        peerId: currentShare.peerId,
        fps: currentShare.fps,
        updatedAt: currentShare.updatedAt,
      });
    } else {
      sendJson(res, 200, {
        success: false,
        shareUrl: null,
        message: '等待投屏工具启动分享...',
      });
    }
    return;
  }

  // ==================== POST /share-url ====================
  // PandaScrcpy Host 调用此端点，注册分享链接
  if (method === 'POST' && (url === '/share-url' || url === '/')) {
    try {
      const body = await readBody(req);

      if (body.action === 'stop' || body.shareUrl === null) {
        // 停止分享
        currentShare = { shareUrl: null, peerId: null, fps: 15, updatedAt: new Date().toISOString() };
        console.log('[Relay] 分享已停止');
        sendJson(res, 200, { success: true, message: '分享已清除' });
        return;
      }

      if (!body.shareUrl) {
        sendJson(res, 400, { success: false, message: '缺少 shareUrl 参数' });
        return;
      }

      currentShare = {
        shareUrl: body.shareUrl,
        peerId: body.peerId || null,
        fps: body.fps || 15,
        updatedAt: new Date().toISOString(),
      };

      console.log('[Relay] 收到分享链接:', body.shareUrl.substring(0, 80));
      sendJson(res, 200, { success: true, message: '分享链接已注册' });

    } catch (err) {
      sendJson(res, 400, { success: false, message: err.message });
    }
    return;
  }

  // 404
  sendJson(res, 404, { success: false, message: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   UI-REL 投屏中继服务器 v1.0                 ║');
  console.log('║                                              ║');
  console.log(`║   地址: http://${HOST}:${PORT}                     ║`);
  console.log('║   GET  /share-url  ← Figma 插件轮询分享链接  ║');
  console.log('║   POST /share-url  → Host 注册分享链接       ║');
  console.log('║                                              ║');
  console.log('║   按 Ctrl+C 停止服务器                       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[Relay] 服务器已停止');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Relay] 服务器已停止');
  process.exit(0);
});
