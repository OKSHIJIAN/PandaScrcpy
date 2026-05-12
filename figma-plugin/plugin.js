// PandaScrcpy Figma Plugin - iframe 嵌入验证测试
figma.showUI(`<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: sans-serif; background: #1a1a2e; color: #fff; padding: 10px; }
    h2 { font-size: 14px; margin-bottom: 8px; color: #00ffc8; }
    input { width: 100%; padding: 6px; border: 1px solid #333; background: #0a0e14; color: #fff; border-radius: 4px; font-size: 12px; margin-bottom: 6px; }
    button { padding: 6px 12px; background: #00ffc8; color: #000; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
    button:hover { background: #00cc9f; }
    #status { font-size: 11px; margin: 6px 0; color: #888; }
    iframe { width: 100%; height: calc(100vh - 120px); border: 1px solid #333; border-radius: 4px; background: #000; }
    .row { display: flex; gap: 6px; align-items: center; }
  </style>
</head>
<body>
  <h2>PandaScrcpy Viewer - iframe 验证</h2>
  <div class="row">
    <input id="url" value="http://localhost:5173?figma=1" placeholder="粘贴分享链接或本地地址" />
    <button onclick="loadUrl()">加载</button>
  </div>
  <div id="status">就绪</div>
  <iframe id="frame" allow="clipboard-read; clipboard-write"></iframe>

  <script>
    const frame = document.getElementById('frame');
    const status = document.getElementById('status');

    function loadUrl() {
      const url = document.getElementById('url').value;
      status.textContent = '正在加载: ' + url;
      frame.onload = () => {
        status.textContent = '加载完成 ✓ (检查下方是否显示页面)';
        try {
          const innerDoc = frame.contentDocument || frame.contentWindow.document;
          if (innerDoc) status.textContent += ' | 可访问iframe内容 ✓';
        } catch(e) {
          status.textContent += ' | 跨域限制(正常): ' + e.message;
        }
      };
      frame.onerror = () => {
        status.textContent = '加载失败 ✗';
      };
      frame.src = url;
    }

    // 自动加载
    setTimeout(loadUrl, 500);
  </script>
</body>
</html>`, { width: 1000, height: 600 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  }
};
