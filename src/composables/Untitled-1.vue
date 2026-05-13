<!-- App.vue - 隐藏顶部导航栏 -->
<v-app-bar v-if="!isDeviceMode && !isFigmaEmbed" ...>

<!-- ViewerPanel.vue - 隐藏状态栏和底部导航 -->
<div v-if="!isFigmaEmbed" class="status-bar">...</div>

<div v-if="!isFigmaEmbed" class="nav-bar">
    <button>返回</button>
    <button>主页</button>
    <button>多任务</button>
</div>
