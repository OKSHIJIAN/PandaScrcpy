/**
 * capture-api.js — 轻量级截图 HTTP API 服务
 * 
 * 为 Figma 插件 UI-REL 提供跨域截图接口：
 *   GET  /api/screenshot.png  → 返回最新设备截图（PNG，带 CORS 头）
 *   POST /api/capture        → 触发一次新的 adb screencap 截图
 *   GET  /api/health         → 健康检查
 * 
 * 启动: node capture-api.js [port]
 * 默认端口: 5174
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.argv[2] || 5174;
const SCREENSHOT_DIR = path.join(__dirname, '.screenshots');
const SCREENSHOT_FILE = path.join(SCREENSHOT_DIR, 'latest.png');

// 确保截图目录存在
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

let lastCaptureTime = 0;
let isCapturing = false;

/**
 * 使用 adb screencap 截取设备屏幕
 * 无设备/失败时降级为 1x1 透明 PNG 占位图
 */
function captureScreen() {
    return new Promise((resolve, reject) => {
        if (isCapturing) {
            resolve({ size: 0, path: SCREENSHOT_FILE, placeholder: true });
            return;
        }
        isCapturing = true;

        console.log('[CAPTURE-API] 执行 adb screencap...');

        const proc = exec(
            'adb exec-out screencap -p',
            { maxBuffer: 50 * 1024 * 1024, timeout: 10000 },
            (error, stdout, stderr) => {
                isCapturing = false;

                if (error) {
                    console.warn('[CAPTURE-API] screencap 不可用:', error.message.substring(0, 100));
                    generatePlaceholderPNG();
                    resolve({ size: 0, path: SCREENSHOT_FILE, placeholder: true });
                    return;
                }

                if (!stdout || stdout.length < 100) {
                    console.warn('[CAPTURE-API] 截图为空');
                    generatePlaceholderPNG();
                    resolve({ size: 0, path: SCREENSHOT_FILE, placeholder: true });
                    return;
                }

                try {
                    fs.writeFileSync(SCREENSHOT_FILE, stdout);
                    lastCaptureTime = Date.now();
                    const size = Math.round(stdout.length / 1024);
                    console.log('[CAPTURE-API] 截图成功:', size, 'KB');
                    resolve({ size, path: SCREENSHOT_FILE, placeholder: false });
                } catch (e) {
                    console.error('[CAPTURE-API] 写入文件失败:', e.message);
                    generatePlaceholderPNG();
                    resolve({ size: 0, path: SCREENSHOT_FILE, placeholder: true });
                }
            }
        );

        proc.stdin && proc.stdin.end();
    });
}

/**
 * 生成 1x1 透明 PNG（无设备时的降级方案）
 */
function generatePlaceholderPNG() {
    try {
        const png = Buffer.from([
            0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
            0x00,0x00,0x00,0x13,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            0x08,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x58,0x41,0x54,
            0x78,0x9C,0x62,0xF8,0x0D,0x00,0x00,0x01,0x01,0x00,0x05,0x00,0x01,0x0D,0x0A,0x60,0x60,0x60,
            0x00,0x00,0x00,0x49,0x45,0x4E
        ]);
        fs.writeFileSync(SCREENSHOT_FILE, png);
        console.log('[CAPTURE-API] 已生成占位 PNG');
    } catch(e) {
        console.error('[CAPTURE-API] 生成占位图失败:', e.message);
    }
}


// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
    // CORS 头 — 关键！允许任何来源访问（包括 Figma 的 data: URI）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    // 预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    // ===== 健康检查 =====
    if (url.pathname === '/api/health' || url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            port: PORT,
            lastCapture: lastCaptureTime,
            uptime: process.uptime(),
        }));
        return;
    }
    
    // ===== POST /api/capture → 触发截图 =====
    if (url.pathname === '/api/capture' && req.method === 'POST') {
        try {
            const result = await captureScreen();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, ...result, ts: Date.now() }));
        } catch (err) {
            res.writeHead(err.message === 'BUSY' ? 429 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }
    
    // ===== GET /api/screenshot.png → 返回截图文件 =====
    if (url.pathname === '/api/screenshot.png' || url.pathname === '/screenshot.png') {
        try {
            if (!fs.existsSync(SCREENSHOT_FILE)) {
                // 文件不存在，先触发一次截图
                await captureScreen();
            }
            
            const buf = fs.readFileSync(SCREENSHOT_FILE);
            const etag = `"${buf.length}-${lastCaptureTime}"`;
            
            // 缓存控制：每次都重新获取最新截图
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('ETag', etag);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Length', buf.length);
            
            // 如果客户端发送了 If-None-Match 且匹配，返回 304
            const ifNoneMatch = req.headers['if-none-match'];
            if (ifNoneMatch && ifNoneMatch === etag) {
                res.writeHead(304);
                res.end();
                return;
            }
            
            res.writeHead(200);
            res.end(buf);
        } catch (err) {
            console.error('[CAPTURE-API] 返回截图失败:', err.message);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Screenshot failed: ' + err.message);
        }
        return;
    }
    
    // ===== GET / → 简单的状态页面 =====
    if (url.pathname === '/' || url.pathname === '') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html><head><title>Capture API</title></head>
<body>
<pre>
📸 PandaScrcpy Screenshot Capture API
======================================

Endpoints:
  GET  /api/screenshot.png  → 返回设备截图 (PNG)
  POST /api/capture         → 触发新截图
  GET  /api/health          → 健康检查

Port: ${PORT}
Status: <span id="status">checking...</span>
Last capture: <span id="time">never</span>

<script>
fetch('/api/health').then(r=>r.json()).then(d=>{
  document.getElementById('status').textContent=d.status;
  document.getElementById('time').textContent=d.lastCapture?new Date(d.lastCapture).toLocaleString():'never';
});
</script>
</pre>
</body></html>`);
        return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found: ' + url.pathname);
});

server.listen(PORT, () => {
    console.log('');
    console.log('=========================================');
    console.log(`  📸 Capture API Server running on port ${PORT}`);
    console.log(`  Screenshot endpoint: http://localhost:${PORT}/api/screenshot.png`);
    console.log('=========================================');
    console.log('');
});

// 优雅退出
process.on('SIGINT', () => { console.log('\n[CAPI] Shutting down.'); process.exit(); });
process.on('SIGTERM', () => { process.exit(); });
