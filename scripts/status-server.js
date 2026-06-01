/**
 * 本地状态服务器 — 桥接 PandaScrcpy 和 Figma 插件
 *
 * 端口: 18792
 * 用途: PandaScrcpy 启动分享时报告 shareUrl → Figma 插件轮询获取
 *
 * API:
 *   GET  /api/status  → { ready: true|false, shareUrl?: string }
 *   POST /api/status  → body: { ready, shareUrl }
 */

const http = require('http');

const PORT = 18792;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let status = {
  ready: false,
  shareUrl: '',
  startedAt: null,
};

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/status
  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJSON(res, 200, status);
    return;
  }

  // POST /api/status
  if (req.method === 'POST' && url.pathname === '/api/status') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof body.ready === 'boolean') {
          status.ready = body.ready;
          status.shareUrl = body.shareUrl || '';
          status.startedAt = body.ready ? new Date().toISOString() : null;
          console.log(`[status-server] 状态更新: ready=${status.ready}, shareUrl=${status.shareUrl || '(无)'}`);
        }
        sendJSON(res, 200, { ok: true, ...status });
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJSON(res, 200, { ok: true, uptime: process.uptime() });
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[status-server] 运行在 http://127.0.0.1:${PORT}`);
  console.log('[status-server] 等待 PandaScrcpy 报告分享状态...');
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[status-server] 正在关闭...');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
