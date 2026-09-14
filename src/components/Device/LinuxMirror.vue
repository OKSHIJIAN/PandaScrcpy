<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import client from '../Scrcpy/adb-client';
import { LinuxMirror } from '../Scrcpy/linux-mirror';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const status = ref('');
const error = ref('');

const fpsVal = ref(0);
const kbpsVal = ref(0);

// 左下角 toast（自动加载/推送进度）
const toastVisible = ref(false);
const progressVal = ref(-1); // -1 = 不确定进度
const manualNeeded = ref(false); // 自动加载失败时允许手动选择文件
const capturing = ref(false); // 采集正常运行中（此时隐藏画面遮罩）

let toastHideTimer: ReturnType<typeof setTimeout> | undefined;

const mirror = new LinuxMirror({
    onStatus: (s) => {
        status.value = s;
        capturing.value = s === '采集中';
        if (s === '采集中') {
            // 成功后短暂展示再淡出
            if (toastHideTimer) clearTimeout(toastHideTimer);
            toastHideTimer = setTimeout(() => {
                toastVisible.value = false;
            }, 1500);
        } else if (s && s !== 'idle') {
            toastVisible.value = true;
        }
    },
    onError: (e) => {
        error.value = e;
    },
    onStats: (fps, kbps) => {
        fpsVal.value = fps;
        kbpsVal.value = kbps;
    },
    onProgress: (pct) => {
        progressVal.value = pct;
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

// ---------- ffmpeg 二进制的本地缓存（IndexedDB） ----------
const FFMPEG_IDB_NAME = 'pandascrcpy-cache';
const FFMPEG_IDB_STORE = 'files';
const FFMPEG_IDB_KEY = 'ffmpeg-armhf';

function idbOpen(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(FFMPEG_IDB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(FFMPEG_IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key: string): Promise<Blob | undefined> {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FFMPEG_IDB_STORE, 'readonly');
        const req = tx.objectStore(FFMPEG_IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result as Blob | undefined);
        req.onerror = () => reject(req.error);
    });
}

async function idbPut(key: string, value: Blob): Promise<void> {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FFMPEG_IDB_STORE, 'readwrite');
        tx.objectStore(FFMPEG_IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 从站点资源下载 ffmpeg（gzip 压缩包，带下载进度，浏览器端解压） */
async function loadFfmpegBinary(onPct?: (pct: number) => void): Promise<Uint8Array> {
    const base = import.meta.env.BASE_URL || '/';
    const resp = await fetch(`${base}ffmpeg-armhf.bin`);
    if (!resp.ok) throw new Error(`ffmpeg 资源加载失败 (HTTP ${resp.status})`);
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('当前浏览器不支持 DecompressionStream，无法解压 ffmpeg 资源');
    }
    const total = Number(resp.headers.get('Content-Length') || 0);
    let raw: ArrayBuffer;
    if (resp.body && total > 0 && onPct) {
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                received += value.length;
                onPct(Math.min(99, Math.round((received / total) * 100)));
            }
        }
        const merged = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) {
            merged.set(c, off);
            off += c.length;
        }
        raw = merged.buffer;
    } else {
        raw = await resp.arrayBuffer();
    }
    const stream = new Blob([raw as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
    const out = await new Response(stream).arrayBuffer();
    return new Uint8Array(out);
}

/** 识别到 Linux 车机后自动加载并开始投屏（无需手动选文件）。
 * 加载优先级：本地缓存(IndexedDB) → 站点资源 → 手动选择兜底 */
async function autoStart() {
    if (!client.device) return;
    error.value = '';
    started.value = true;
    manualNeeded.value = false;
    toastVisible.value = true;
    progressVal.value = -1;
    try {
        let buf: Uint8Array | undefined;
        // 1) 本地缓存
        try {
            const cached = await idbGet(FFMPEG_IDB_KEY);
            if (cached) {
                status.value = '正在读取本地缓存的 ffmpeg...';
                buf = new Uint8Array(await cached.arrayBuffer());
            }
        } catch {
            /* 缓存读取失败，继续尝试网络 */
        }
        // 2) 站点资源
        if (!buf) {
            status.value = '正在下载 ffmpeg 资源...';
            progressVal.value = 0;
            buf = await loadFfmpegBinary((pct) => {
                progressVal.value = pct;
            });
            // 下载成功后缓存，下次秒加载
            try {
                await idbPut(FFMPEG_IDB_KEY, new Blob([buf as unknown as BlobPart]));
            } catch {
                /* ignore */
            }
        }
        if (!buf) throw new Error('ffmpeg 资源加载失败');
        ffmpegBuf = buf;
        mirror.setCanvas(canvasRef.value!);
        await mirror.start(client.device as any, buf, {
            scale: scaleVal.value,
            quality: qualityVal.value,
        });
    } catch (e: any) {
        error.value = e?.message || String(e);
        manualNeeded.value = true;
        toastVisible.value = false;
    }
}

// 挂载时：识别到 Linux 车机就自动开始
onMounted(() => {
    if (client.device && client.isLinux) {
        autoStart();
    }
});

/** 由按钮点击触发（必须在用户手势内弹文件框，否则浏览器会拒绝） */
async function startFlow() {
    if (!client.device) {
        error.value = '设备未连接';
        return;
    }
    error.value = '';
    started.value = true;
    manualNeeded.value = false;
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
        // 缓存到本地，下次自动加载无需再选
        try {
            await idbPut(FFMPEG_IDB_KEY, new Blob([buf as unknown as BlobPart]));
        } catch {
            /* ignore */
        }
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
        <div
            v-if="error || (status && !capturing) || (!started && !capturing)"
            class="mirror-overlay"
        >
            <v-btn v-if="!started || manualNeeded" color="primary" @click="startFlow">
                选择 ffmpeg 并开始投屏
            </v-btn>
            <div v-if="status" class="mirror-status">{{ status }}</div>
            <div v-if="error" class="mirror-error">{{ error }}</div>
        </div>
        <transition name="toast-fade">
            <div v-if="toastVisible" class="mirror-toast">
                <div class="toast-text">{{ status || '处理中...' }}</div>
                <v-progress-linear
                    class="toast-bar"
                    :indeterminate="progressVal < 0"
                    :model-value="progressVal < 0 ? 0 : progressVal"
                    color="primary"
                    height="4"
                    rounded
                />
            </div>
        </transition>
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

.mirror-toast {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 3000;
    width: 280px;
    background: rgba(33, 33, 33, 0.95);
    color: #fff;
    padding: 12px 14px;
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.mirror-toast .toast-text {
    font-size: 13px;
    line-height: 1.5;
    word-break: break-all;
}

.mirror-toast .toast-bar {
    margin-top: 8px;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
    transition: opacity 0.3s, transform 0.3s;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
</style>
