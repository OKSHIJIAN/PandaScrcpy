<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue';
import client from '../Scrcpy/adb-client';
import { LinuxMirror } from '../Scrcpy/linux-mirror';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const status = ref('');
const error = ref('');

const fpsVal = ref(0);
const kbpsVal = ref(0);

const mirror = new LinuxMirror({
    onStatus: (s) => {
        status.value = s;
    },
    onError: (e) => {
        error.value = e;
    },
    onStats: (fps, kbps) => {
        fpsVal.value = fps;
        kbpsVal.value = kbps;
    },
});

function pickSingleFile(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
    });
}

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
const started = ref(false);
const tuning = ref(false);
const scaleVal = ref(1); // 默认 100%（原画）
const qualityVal = ref(14); // 实际 q:v：越小越清晰
// 画质滑块方向反转，保证「往右 = 更清晰」直观一致
const qualitySlider = computed({
    get: () => 29 - qualityVal.value,
    set: (v: number) => {
        qualityVal.value = 29 - v;
    },
});
let ffmpegBuf: Uint8Array | undefined;

/** 由按钮点击触发（必须在用户手势内弹文件框，否则浏览器会拒绝） */
async function startFlow() {
    if (!client.device) {
        error.value = '设备未连接';
        return;
    }
    error.value = '';
    started.value = true;
    // 心跳保活：选文件期间保持 ADB 连接活跃，防止空闲断开
    heartbeatTimer = setInterval(() => {
        client.heartbeat().catch(() => {});
    }, 2000);
    try {
        status.value = '请选择 ffmpeg 二进制文件（armhf 静态版）';
        const file = await pickSingleFile();
        if (!file) {
            status.value = '未选择文件，已取消';
            started.value = false;
            return;
        }
        // 选完文件后立即停止心跳，避免与推送/采集的连接并发抢占
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
        }
        status.value = '正在读取文件...';
        const buf = new Uint8Array(await file.arrayBuffer());
        ffmpegBuf = buf;
        mirror.setCanvas(canvasRef.value!);
        await mirror.start(client.device as any, buf, {
            scale: scaleVal.value,
            quality: qualityVal.value,
        });
    } catch (e: any) {
        error.value = e?.message || String(e);
    } finally {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
        }
    }
}

/** 一键预设 */
function applyPreset(s: number, q: number) {
    scaleVal.value = s;
    qualityVal.value = q;
    applyTuning();
}

/** 实时调参：用当前滑块值重启采集（ffmpeg 已在设备上，重启只需 1~2 秒） */
async function applyTuning() {
    if (!ffmpegBuf || !client.device) return;
    console.log(
        '[linux-mirror] 应用调参 scale=',
        scaleVal.value,
        'quality=',
        qualityVal.value,
    );
    tuning.value = true;
    try {
        await mirror.stop();
        await mirror.start(client.device as any, ffmpegBuf, {
            scale: scaleVal.value,
            quality: qualityVal.value,
        });
    } catch (e: any) {
        error.value = e?.message || String(e);
    } finally {
        tuning.value = false;
    }
}

onUnmounted(() => {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
    }
    mirror.stop();
});
</script>

<template>
    <div class="linux-mirror">
        <canvas ref="canvasRef" class="mirror-canvas" />
        <div v-if="started" class="mirror-tune">
            <button class="tune-btn" @click="applyPreset(0.3, 18)">流畅</button>
            <button class="tune-btn" @click="applyPreset(0.45, 14)">平衡</button>
            <button class="tune-btn" @click="applyPreset(1, 8)">原画100%</button>
            <span class="tune-item">
                分辨率
                <input type="range" min="0.2" max="1" step="0.05" v-model.number="scaleVal" />
                {{ Math.round(scaleVal * 100) }}%
            </span>
            <span class="tune-item">
                画质
                <input type="range" min="4" max="25" step="1" v-model.number="qualitySlider" />
                q:v{{ qualityVal }}
            </span>
            <span class="tune-tip">越右越清晰、越卡</span>
            <span class="tune-item tune-stat">{{ fpsVal }}fps · {{ kbpsVal }}KB/s</span>
            <v-btn size="small" color="primary" :loading="tuning" @click="applyTuning">
                应用
            </v-btn>
        </div>
        <div v-if="!started || status || error" class="mirror-overlay">
            <v-btn v-if="!started" color="primary" @click="startFlow">
                选择 ffmpeg 并开始投屏
            </v-btn>
            <div v-if="status" class="mirror-status">{{ status }}</div>
            <div v-if="error" class="mirror-error">{{ error }}</div>
        </div>
    </div>
</template>

<style scoped>
.linux-mirror {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
}

.mirror-canvas {
    display: block;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: calc(100% - 6px);
    max-height: calc(100% - 6px);
    border: 3px solid #303133;
    border-radius: 16px;
    box-sizing: border-box;
    background-color: #000;
}

.mirror-tune {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 8px;
    color: #fff;
    font-size: 12px;
    z-index: 2;
}

.mirror-tune .tune-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
}

.mirror-tune input[type='range'] {
    width: 100px;
}

.mirror-tune .tune-tip {
    color: rgba(255, 255, 255, 0.6);
}

.mirror-tune .tune-btn {
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    background: transparent;
    color: #fff;
    cursor: pointer;
    font-size: 12px;
}

.mirror-tune .tune-btn:hover {
    background: rgba(255, 255, 255, 0.15);
}

.mirror-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.45);
    pointer-events: none;
}

.mirror-overlay .v-btn {
    pointer-events: auto;
}

.mirror-status {
    color: #fff;
    font-size: 14px;
    text-align: center;
    padding: 0 16px;
}

.mirror-error {
    color: #ff6b6b;
    font-size: 13px;
    text-align: center;
    padding: 0 16px;
}
</style>
