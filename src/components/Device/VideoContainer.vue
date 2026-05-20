<script setup lang="ts">
import { ref, onMounted, onUnmounted, provide, nextTick } from 'vue';
import {
    AndroidMotionEventAction,
    AndroidMotionEventButton,
    ScrcpyPointerId,
    type ScrcpySetClipboardControlMessage,
} from '@yume-chan/scrcpy';
import client from '../Scrcpy/adb-client';
import state from '../Scrcpy/scrcpy-state';

const videoContainer = ref<HTMLDivElement | null>(null);
const videoWrapper = ref<HTMLDivElement | null>(null);
const isVideoContainerFocused = ref(false);
const isCanvasReady = ref(false);
const isFullyRendered = ref(false);
/** 视频流已就绪（有尺寸且 running），用于占位/铺满切换与淡入 */
const pictureReady = ref(false);
const videoFadedIn = ref(false);
const placeholderAspect = ref('9 / 16');
let layoutFadeRaf = 0;

const MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON = [
    AndroidMotionEventButton.Primary,
    AndroidMotionEventButton.Tertiary,
    AndroidMotionEventButton.Secondary,
    AndroidMotionEventButton.Back,
    AndroidMotionEventButton.Forward,
];

const activePointers = new Set<number>();

/** 键盘/滚轮等需要焦点，避免误触 */
const isReady = () => (
    !!state.scrcpy &&
    !!state.canvas &&
    isVideoContainerFocused.value &&
    isCanvasReady.value &&
    isFullyRendered.value
);

/** 触摸轨迹：不要求焦点，避免移出画布后因 blur/失焦导致收不到 up 而卡在按下状态 */
const touchPipelineReady = () => (
    !!state.scrcpy &&
    !!state.canvas &&
    isCanvasReady.value &&
    isFullyRendered.value
);

const isPointInCanvas = (clientX: number, clientY: number): boolean => {
    if (!state.canvas) return false;
    const rect = state.canvas.getBoundingClientRect();
    return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
    );
};

const handleWheel = (e: WheelEvent) => {
    if (!isReady() || !isPointInCanvas(e.clientX, e.clientY)) return;
    videoContainer.value?.focus();
    e.preventDefault();
    e.stopPropagation();

    const { x, y } = state.clientPositionToDevicePosition(e.clientX, e.clientY);
    state.scrcpy?.controller!.injectScroll({
        videoWidth: state.width!,
        videoHeight: state.height!,
        pointerX: x,
        pointerY: y,
        scrollX: -e.deltaX / 100,
        scrollY: -e.deltaY / 100,
        buttons: 0,
    });
};

const injectTouch = (action: AndroidMotionEventAction, e: PointerEvent) => {
    if (!touchPipelineReady()) return;

    const { pointerType } = e;
    const pointerId: bigint =
        pointerType === 'mouse' ? ScrcpyPointerId.Finger : BigInt(e.pointerId);

    const { x, y } = state.clientPositionToDevicePosition(e.clientX, e.clientY);

    state.scrcpy?.controller?.injectTouch({
        action,
        pointerId,
        videoWidth: state.width!,
        videoHeight: state.height!,
        pointerX: x,
        pointerY: y,
        pressure: e.pressure,
        actionButton: MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON[e.button],
        buttons: e.buttons,
    });
};

const handlePointerDown = (e: PointerEvent) => {
    if (!touchPipelineReady() || !isPointInCanvas(e.clientX, e.clientY)) return;

    isVideoContainerFocused.value = true;
    state.fullScreenContainer?.focus();
    e.preventDefault();
    e.stopPropagation();

    (e.currentTarget as HTMLDivElement)?.setPointerCapture(e.pointerId);
    activePointers.add(e.pointerId);
    injectTouch(AndroidMotionEventAction.Down, e);
};

const handlePointerMove = (e: PointerEvent) => {
    const isDragging = activePointers.has(e.pointerId);
    if (isDragging) {
        if (!touchPipelineReady()) return;
    } else {
        if (!isReady() || !isPointInCanvas(e.clientX, e.clientY)) return;
    }

    e.preventDefault();
    e.stopPropagation();

    const action = isDragging && e.buttons !== 0
        ? AndroidMotionEventAction.Move
        : AndroidMotionEventAction.HoverMove;

    injectTouch(action, e);
};

const handlePointerUp = (e: PointerEvent) => {
    if (!touchPipelineReady()) return;

    const wasDragging = activePointers.has(e.pointerId);
    if (!wasDragging && !isPointInCanvas(e.clientX, e.clientY)) return;

    e.preventDefault();
    e.stopPropagation();

    activePointers.delete(e.pointerId);

    try {
        (e.currentTarget as HTMLDivElement)?.releasePointerCapture(e.pointerId);
    } catch {
        // pointer capture may already be released
    }

    injectTouch(AndroidMotionEventAction.Up, e);
};

const handlePointerLeave = (e: PointerEvent) => {
    if (!touchPipelineReady()) return;
    if (activePointers.has(e.pointerId)) return;

    injectTouch(AndroidMotionEventAction.HoverExit, e);
};

const handlePointerCancel = (e: PointerEvent) => {
    if (!touchPipelineReady()) return;

    if (activePointers.has(e.pointerId)) {
        activePointers.delete(e.pointerId);
        injectTouch(AndroidMotionEventAction.Up, e);
    }
};

/** 浏览器意外释放 capture 时补发 Up，防止设备端一直按住 */
const handleLostPointerCapture = (e: PointerEvent) => {
    if (!touchPipelineReady()) return;
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    injectTouch(AndroidMotionEventAction.Up, e);
};

const handleContextMenu = (e: MouseEvent) => {
    if (!isReady() || !isPointInCanvas(e.clientX, e.clientY)) return;
    e.preventDefault();
};

const sanitizeText = (text: string): string => {
    return text.replace(/[nN]$/g, '');
};

const handlePaste = async () => {
    if (!isReady() || !state.scrcpy || !state.scrcpy.controller) return;
    try {
        const clipboardText = await navigator.clipboard.readText();
        const sanitizedText = sanitizeText(clipboardText);

        const clipboardMessage: Omit<ScrcpySetClipboardControlMessage, 'type'> = {
            sequence: BigInt(0),
            paste: true,
            content: sanitizedText,
        };

        await state.scrcpy.controller.setClipboard(clipboardMessage);
    } catch (error) {
        console.error('粘贴到设备失败:', error);
    }
};

const handleKeyEvent = (e: KeyboardEvent) => {
    if (!isReady() || !state.keyboard) return;
    e.preventDefault();
    e.stopPropagation();

    const { type, code, ctrlKey, metaKey } = e;

    if (type === 'keydown' && (ctrlKey || metaKey)) {
        if (code === 'KeyV') {
            handlePaste();
            return;
        }
    }

    state.keyboard[type === 'keydown' ? 'down' : 'up'](code);
};

const handleFocus = () => {
    isVideoContainerFocused.value = true;
};

const handleBlur = () => {
    if (activePointers.size > 0) return;
    isVideoContainerFocused.value = false;
};

const checkRendering = () => {
    if (state.running) {
        isFullyRendered.value = true;
    }
    if (state.running && pictureReady.value && renderingCheckInterval !== undefined) {
        clearInterval(renderingCheckInterval);
        renderingCheckInterval = undefined;
    }
};

const syncPictureLayout = () => {
    if (state.width > 0 && state.height > 0) {
        placeholderAspect.value = `${state.width} / ${state.height}`;
    }
    const ready = !!(state.running && state.width > 0 && state.height > 0);
    if (ready) {
        if (!pictureReady.value) {
            pictureReady.value = true;
            nextTick(() => {
                state.updateVideoContainer();
                cancelAnimationFrame(layoutFadeRaf);
                layoutFadeRaf = requestAnimationFrame(() => {
                    state.updateVideoContainer();
                    layoutFadeRaf = requestAnimationFrame(() => {
                        videoFadedIn.value = true;
                    });
                });
            });
        }
    } else {
        pictureReady.value = false;
        videoFadedIn.value = false;
        placeholderAspect.value = '9 / 16';
    }
};

let renderingCheckInterval: ReturnType<typeof setInterval> | undefined;

const handleMouseEnter = () => {
    if (videoContainer.value) {
        videoContainer.value.focus();
        isVideoContainerFocused.value = true;
    }
};

const handleMouseLeave = () => {
    if (activePointers.size > 0) return;
    isVideoContainerFocused.value = false;
};

onMounted(() => {
    if (videoContainer.value) {
        videoContainer.value.addEventListener('wheel', handleWheel, { passive: false });
        videoContainer.value.addEventListener('focus', handleFocus);
        videoContainer.value.addEventListener('blur', handleBlur);
        videoContainer.value.addEventListener('mouseenter', handleMouseEnter);
        videoContainer.value.addEventListener('mouseleave', handleMouseLeave);
    }
    if (client.device && videoContainer.value) {
        state.setRendererContainer(videoContainer.value);
        void (async () => {
            await client.killScrcpyServerOnDevice();
            await new Promise<void>((r) => setTimeout(r, 200));
            const scrcpy = await state.start(client.device as any);
            if (!scrcpy) {
                return;
            }
            isCanvasReady.value = true;
            renderingCheckInterval = window.setInterval(() => {
                syncPictureLayout();
                checkRendering();
            }, 100);
        })();
    }

    window.addEventListener('keydown', handleKeyEvent);
    window.addEventListener('keyup', handleKeyEvent);
});

onUnmounted(() => {
    if (videoContainer.value) {
        videoContainer.value.removeEventListener('wheel', handleWheel);
        videoContainer.value.removeEventListener('focus', handleFocus);
        videoContainer.value.removeEventListener('blur', handleBlur);
        videoContainer.value.removeEventListener('mouseenter', handleMouseEnter);
        videoContainer.value.removeEventListener('mouseleave', handleMouseLeave);
    }
    window.removeEventListener('keydown', handleKeyEvent);
    window.removeEventListener('keyup', handleKeyEvent);
    if (renderingCheckInterval !== undefined) {
        clearInterval(renderingCheckInterval);
    }
    cancelAnimationFrame(layoutFadeRaf);
    activePointers.clear();
});

provide('setVideoContainerFocus', (focused: boolean) => {
    isVideoContainerFocused.value = focused;
});

// ===== 截图功能：供 UI-REL 父窗口获取画面 =====
const captureToastVisible = ref(false);
const captureToastMsg = ref('');

/** 截取当前 canvas 一帧并通过 postMessage 发送给父窗口 */
function captureAndSend() {
    const canvas = state.canvas;
    console.log('[PandaScrcpy] captureAndSend called, canvas:', !!canvas, 'running:', state.running, 'width:', state.width, 'height:', state.height);

    if (!canvas || !state.running) {
        // 即使未就绪也发送错误响应，避免父窗口无限等待
        console.warn('[PandaScrcpy] 投屏未就绪, canvas:', !!canvas, 'running:', state.running);
        try {
            window.parent.postMessage({
                type: 'SCREEN_CAPTURE',
                payload: { error: 'NOT_READY', imageBase64: '', timestamp: Date.now(), width: 0, height: 0 }
            }, '*');
        } catch(e) { /* ignore */ }
        showToast('⚠ 投屏未就绪');
        return;
    }

    try {
        // 直接从 canvas 导出 PNG (base64)
        const dataURL = canvas.toDataURL('image/png', 0.95);

        // 发送给父窗口（UI-REL 插件）
        window.parent.postMessage({
            type: 'SCREEN_CAPTURE',
            payload: {
                imageBase64: dataURL,
                timestamp: Date.now(),
                width: state.width,
                height: state.height,
            }
        }, '*');

        showToast('✓ 已截取');
        console.log('[PandaScrcpy] 截图已发送, 尺寸:', state.width, 'x', state.height);

    } catch (err) {
        console.error('[PandaScrcpy] 截图失败:', err);
        showToast('✗ 截取失败: ' + (err as Error).message);
    }
}

/** 显示短暂提示 */
function showToast(msg: string) {
    captureToastMsg.value = msg;
    captureToastVisible.value = true;
    setTimeout(() => { captureToastVisible.value = false; }, 1800);
}

/** 暴露全局方法，父窗口也可通过 iframe.contentWindow.__pandaCapture() 调用 */
(window as any).__pandaCapture = captureAndSend;

/** 监听来自父窗口的截图请求消息 */
window.addEventListener('message', (event) => {
    if (event.data?.type === 'REQUEST_SCREEN_CAPTURE') {
        captureAndSend();
    }
});
</script>

<template>
    <div ref="videoWrapper" class="video-wrapper">
        <!-- 截取按钮 -->
        <button
            class="capture-btn"
            :class="{ visible: pictureReady && videoFadedIn }"
            :disabled="!state.running"
            title="截取画面 (发送到 UI-REL)"
            @click.stop="captureAndSend()"
        >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
            </svg>
        </button>
        <!-- Toast 提示 -->
        <transition name="toast-fade">
            <div v-if="captureToastVisible" class="capture-toast">
                {{ captureToastMsg }}
            </div>
        </transition>
        <!-- 视频容器 -->
        <div
            ref="videoContainer"
            class="video-container"
            :class="{
                'video-container--placeholder': !pictureReady,
                'video-container--fade-in': videoFadedIn,
            }"
            :style="!pictureReady ? { aspectRatio: placeholderAspect } : undefined"
            tabindex="0"
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="handlePointerUp"
            @pointercancel="handlePointerCancel"
            @pointerleave="handlePointerLeave"
            @lostpointercapture="handleLostPointerCapture"
            @contextmenu="handleContextMenu"
        />
    </div>
</template>

<style scoped>
.video-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    background: transparent;
}

.video-container {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    background-color: var(--key-bg);
    cursor: crosshair;
    overflow: hidden;
    outline: none;
    touch-action: none;
    transition: background-color 0.35s ease;
}

.video-container--placeholder {
    width: auto;
    height: 100%;
    max-height: 100%;
    max-width: 100%;
    flex-shrink: 0;
}

.video-container--fade-in {
    background-color: transparent;
}

.video-container :deep(canvas) {
    display: block;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: auto !important;
    height: auto !important;
    max-width: calc(100% - 6px);
    max-height: calc(100% - 6px);
    background-color: transparent;
    border: 3px solid #303133;
    border-radius: 16px;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    opacity: 0;
    transition: opacity 0.45s ease;
}

.video-container--fade-in :deep(canvas) {
    opacity: 1;
}

/* ===== 截取按钮 ===== */
.capture-btn {
    position: absolute;
    bottom: 10px;
    right: 10px;
    z-index: 100;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.15);
    background: rgba(20, 20, 28, 0.75);
    backdrop-filter: blur(8px);
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    opacity: 0;
    transform: scale(0.85) translateY(6px);
    transition: all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.capture-btn.visible {
    opacity: 1;
    transform: scale(1) translateY(0);
}

.capture-btn:hover:not(:disabled) {
    background: rgba(0, 255, 200, 0.15);
    color: #00ffc8;
    border-color: rgba(0, 255, 200, 0.4);
    box-shadow: 0 2px 14px rgba(0, 255, 200, 0.18), 0 0 24px rgba(0, 255, 200, 0.08);
    transform: scale(1.08) translateY(0);
}

.capture-btn:active:not(:disabled) {
    transform: scale(0.94) translateY(0);
}

.capture-btn:disabled {
    color: rgba(255, 255, 255, 0.2);
    cursor: not-allowed;
}

.capture-btn svg {
    width: 17px;
    height: 17px;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* ===== Toast 提示 ===== */
.capture-toast {
    position: absolute;
    bottom: 54px;
    right: 8px;
    z-index: 101;
    font-size: 11.5px;
    font-weight: 600;
    color: #00ffc8;
    background: rgba(20, 20, 28, 0.85);
    backdrop-filter: blur(10px);
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid rgba(0, 255, 200, 0.25);
    pointer-events: none;
    white-space: nowrap;
    letter-spacing: 0.02em;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.toast-fade-enter-active {
    animation: toast-in 0.2s ease forwards;
}
.toast-fade-leave-active {
    animation: toast-out 0.3s ease forwards;
}
@keyframes toast-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes toast-out {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(-6px); }
}
</style>
