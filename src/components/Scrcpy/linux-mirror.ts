import { Consumable, ReadableStream } from '@yume-chan/stream-extra';
import type { Adb } from '@yume-chan/adb';
import client from './adb-client';

const FFMPEG_PATH = '/tmp/ffmpeg';

export interface LinuxMirrorCallbacks {
    onStatus?: (status: string) => void;
    onError?: (error: string) => void;
    onFrame?: (width: number, height: number) => void;
    /** 每秒上报一次实时帧率与码率 */
    onStats?: (fps: number, kbps: number) => void;
    /** ffmpeg 推送进度（0-100） */
    onProgress?: (pct: number) => void;
}

export interface LinuxMirrorOptions {
    width?: number;
    height?: number;
    quality?: number;
    /** 输出缩放（相对 framebuffer 尺寸），越小编码越快、延迟越低 */
    scale?: number;
}

/**
 * Linux 车机（framebuffer /dev/fb0）镜像。
 *
 * 实测该精简 adbd：`exec:` 不可用（getProp 会 Socket open failed），但 `sync:` 可用。
 * 因此文件推送优先走标准 sync push；采集命令走 shell: 服务，
 * 并用 `stty raw` 关闭 pty 的转换/回显，保证二进制数据完整。
 */
export class LinuxMirror {
    private device: Adb | undefined;
    private socket: any = undefined;
    private process: any = undefined;
    private reader: any = undefined;
    private buffer: Uint8Array = new Uint8Array(0);
    private disposed = false;
    private rendering = false;
    private frameCount = 0;
    private byteCount = 0;
    private statTimer: ReturnType<typeof setInterval> | undefined;
    private canvas: HTMLCanvasElement | undefined;
    private ctx: CanvasRenderingContext2D | undefined;
    private callbacks: LinuxMirrorCallbacks;

    running = false;
    status = 'idle';
    width = 0;
    height = 0;
    error = '';

    constructor(callbacks: LinuxMirrorCallbacks = {}) {
        this.callbacks = callbacks;
    }

    setCanvas(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d') || undefined;
    }

    async start(
        device: Adb,
        ffmpegData: Uint8Array,
        options: LinuxMirrorOptions = {},
    ): Promise<void> {
        const width = options.width ?? 1024;
        const height = options.height ?? 600;
        const quality = options.quality ?? 14; // q:v 越大编码越快、码流越小
        const scale = options.scale ?? 0.45; // 缩小后再编码，显著降低单帧编码耗时

        this.device = device;
        this.disposed = false;
        this.buffer = new Uint8Array(0);

        try {
            // 设备上已有同尺寸的 ffmpeg 就复用，省去每次约 30 秒的推送
            let needPush = true;
            const remoteSize = parseInt(
                (await this.shellExecOut(`wc -c < ${FFMPEG_PATH}`)).trim(),
                10,
            );
            if (remoteSize === ffmpegData.length) {
                needPush = false;
            }
            if (needPush) {
                this.setStatus('正在推送 ffmpeg...');
                await this.pushFile(FFMPEG_PATH, ffmpegData, 0o755);
            } else {
                this.setStatus('复用设备上的 ffmpeg');
                await this.shellExec(`chmod 755 ${FFMPEG_PATH}`);
            }

            this.setStatus('正在启动采集...');
            await this.startCapture(width, height, quality, scale);
            this.running = true;
            this.setStatus('采集中');
            this.readLoop();
            this.startStats();
        } catch (e: any) {
            this.running = false;
            this.error = e?.message || String(e);
            this.setStatus('error');
            this.callbacks.onError?.(this.error);
            throw e;
        }
    }

    private setStatus(status: string) {
        this.status = status;
        this.callbacks.onStatus?.(status);
    }

    /** 每秒统计一次实际帧率与码率，用于定位瓶颈 */
    private startStats() {
        if (this.statTimer) return;
        this.statTimer = setInterval(() => {
            const fps = this.frameCount;
            const kbps = Math.round(this.byteCount / 1024);
            this.frameCount = 0;
            this.byteCount = 0;
            console.log(`[linux-mirror] 帧率=${fps}fps 码率=${kbps}KB/s`);
            this.callbacks.onStats?.(fps, kbps);
        }, 1000);
    }

    /** 执行 shell 命令（一次性命令，读输出到结束）。命令末尾必须带换行，否则 sh 不执行。 */
    private async shellExec(command: string): Promise<void> {
        if (!this.device) return;
        try {
            await this.device.createSocketAndWait(`shell:${command}\n`);
        } catch {
            /* ignore */
        }
    }

    /** 执行 shell 命令并返回输出文本 */
    private async shellExecOut(command: string): Promise<string> {
        if (!this.device) return '';
        try {
            return await this.device.createSocketAndWait(`shell:${command}\n`);
        } catch {
            return '';
        }
    }

    /** 通过 sync: 服务推文件（标准 adb push，绕过 pty，快一个量级） */
    private async pushFileSync(filename: string, data: Uint8Array, permission: number) {
        const sync = await this.device!.sync();
        const CHUNK = 64 * 1024;
        let sent = 0;
        try {
            const file = new ReadableStream<Uint8Array>({
                pull: (controller) => {
                    if (sent >= data.length) {
                        controller.close();
                        return;
                    }
                    const end = Math.min(sent + CHUNK, data.length);
                    controller.enqueue(data.subarray(sent, end));
                    sent = end;
                    const pct = Math.round((sent / data.length) * 100);
                    this.setStatus(
                        `正在推送 ffmpeg... ${pct}%  ${(sent / 1048576).toFixed(1)}/${(
                            data.length / 1048576
                        ).toFixed(1)}MB`,
                    );
                    this.callbacks.onProgress?.(pct);
                    console.log(
                        `[linux-mirror] pushFile(sync) 进度 ${pct}% ${sent}/${data.length}`,
                    );
                },
            });
            await sync.write({ filename, file, permission });
        } finally {
            try {
                await sync.dispose();
            } catch {
                /* ignore */
            }
        }
        console.log('[linux-mirror] pushFile(sync) 完成');
    }

    /**
     * 通过 shell: + stty raw + dd 写文件。
     * stty raw 关闭 pty 转换后，stdin 传原始二进制给 dd 写盘。
     */
    private async pushFile(filename: string, data: Uint8Array, permission: number) {
        if (!this.device) throw new Error('设备未连接');
        // sync: 服务可用时走标准 push（绕过 pty，快一个量级）
        if (client.syncAvailable) {
            await this.pushFileSync(filename, data, permission);
            return;
        }
        const bs = 4096;
        const count = Math.ceil(data.length / bs);
        const total = count * bs;
        // stty raw 下没有 EOF 机制，dd 必须以固定 count 结束，否则永远阻塞。
        // 故把数据按整块补齐（末尾补 0）；ELF 按 program header 长度解析，补零不影响执行。
        const padded = new Uint8Array(total);
        padded.set(data);
        console.log(`[linux-mirror] pushFile 开始 ${filename} size=${data.length} count=${count}`);
        // 命令末尾必须带换行，否则 sh 不执行；用 echo 回执确认 stty raw 已生效，
        // 避免二进制里的 0x03/0x13 等被 pty 当信号/流控破坏。
        const socket = await this.device.createSocket(
            `shell:stty raw; echo __PUSH_READY__; dd of=${filename} bs=${bs} count=${count}\n`,
        );
        const reader = socket.readable.getReader();
        const decoder = new TextDecoder();
        let ack = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                ack += decoder.decode(value, { stream: true });
                if (ack.includes('__PUSH_READY__')) break;
            }
        }
        if (!ack.includes('__PUSH_READY__')) {
            try {
                socket.close();
            } catch {
                /* ignore */
            }
            throw new Error('设备端 shell 未就绪（未收到 READY 回执）');
        }
        console.log('[linux-mirror] pushFile 设备端就绪，开始写数据');
        const writer = socket.writable.getWriter();
        const startAt = Date.now();
        let sent = 0;
        const REPORT = bs * 64; // 每 256KB 报告一次进度
        for (let i = 0; i < total; i += bs) {
            await writer.write(new Consumable(padded.subarray(i, i + bs)));
            sent += bs;
            if (sent % REPORT === 0 || sent === total) {
                const secs = (Date.now() - startAt) / 1000;
                const mbps = secs > 0 ? sent / 1048576 / secs : 0;
                const remain = mbps > 0 ? (total - sent) / 1048576 / mbps : 0;
                const pct = Math.min(100, Math.round((sent / total) * 100));
                this.setStatus(
                    `正在推送 ffmpeg... ${pct}%  ${(sent / 1048576).toFixed(1)}/${(
                        data.length / 1048576
                    ).toFixed(1)}MB  ${mbps.toFixed(2)}MB/s  剩余约 ${Math.ceil(remain)}s`,
                );
                this.callbacks.onProgress?.(pct);
                console.log(
                    `[linux-mirror] pushFile 进度 ${pct}% ${sent}/${total} ${mbps.toFixed(
                        2,
                    )}MB/s 剩余 ${Math.ceil(remain)}s`,
                );
            }
        }
        console.log('[linux-mirror] pushFile 数据已发完，等待 dd 完成');
        // dd 读满 count 个整块后自动结束，不依赖 EOF；继续读同一 reader 直到连接关闭
        try {
            while (true) {
                const { done } = await reader.read();
                if (done) break;
            }
        } catch {
            /* ignore */
        }
        try {
            await socket.closed;
        } catch {
            /* ignore */
        }
        console.log('[linux-mirror] pushFile dd 完成，chmod');
        await this.shellExec(`chmod ${permission.toString(8)} ${filename}`);
    }

    /** 启动采集（stty raw 关闭输出转换，保证 MJPEG 二进制完整） */
    private async startCapture(
        width: number,
        height: number,
        quality: number,
        scale: number,
    ) {
        // 偶数尺寸，避免 scale 后 yuv420 报奇数宽高
        const sw = Math.max(2, Math.round((width * scale) / 2) * 2);
        const sh = Math.max(2, Math.round((height * scale) / 2) * 2);
        // 直接用 fbdev 输入（mmap 显存），省掉 dd 每帧读整帧 + 管道拷贝；
        // scale 用 neighbor（最近邻）比默认 bicubic 快很多；
        // -flush_packets 1 / -avioflags direct 每帧立即写出；-threads 1 消除编码队列。
        // 用 dd + rawvideo（已验证在该设备上画面正常）。
        // dd/ffmpeg 的 stderr 都必须丢弃：pty 会把 stdout/stderr 混成一条流，
        // 混入的文本会插进 MJPEG 字节流导致帧边界错乱（花屏）。
        const frameBytes = width * height * 4;
        // 100% 缩放时省略 scale 滤镜，少一层滤镜开销
        const vf =
            sw === width && sh === height ? '' : `-vf scale=${sw}:${sh}:flags=neighbor `;
        const cmd =
            `while true; do dd if=/dev/fb0 bs=${frameBytes} count=1 2>/dev/null; done | ` +
            `${FFMPEG_PATH} -hide_banner -loglevel error ` +
            `-f rawvideo -pixel_format bgra -video_size ${width}x${height} -i pipe:0 ` +
            vf +
            `-c:v mjpeg -pix_fmt yuvj420p -q:v ${quality} -threads 1 ` +
            `-f mjpeg -flush_packets 1 -avioflags direct - 2>/dev/null`;
        console.log(
            `[linux-mirror] 采集参数 scale=${scale} quality=${quality} 输出=${sw}x${sh} 源=${width}x${height}`,
        );

        // 优先 shell,v2,raw：无 pty，stdout 是纯二进制流，吞吐远高于 pty（pty 实测仅 ~30KB/s）
        if (client.shellV2Available) {
            const sp = (this.device as any).subprocess?.shellProtocol;
            if (sp) {
                const proc = await sp.spawn(cmd);
                this.process = proc;
                this.reader = proc.stdout.getReader();
                // 必须消费 stderr，否则 stderr 缓冲满会阻塞 ffmpeg
                (async () => {
                    try {
                        const r = proc.stderr.getReader();
                        while (true) {
                            const { done } = await r.read();
                            if (done) break;
                        }
                    } catch {
                        /* ignore */
                    }
                })();
                console.log('[linux-mirror] 采集通道 = shell,v2,raw');
                return;
            }
        }

        // 回退：shell: (pty)，需 stty raw 关闭转换；末尾换行否则 sh 不执行这条长命令
        this.socket = await this.device!.createSocket(`shell:stty raw; ${cmd}\n`);
        this.reader = this.socket.readable.getReader();
        console.log('[linux-mirror] 采集通道 = shell: (pty)');
    }

    private async readLoop() {
        while (!this.disposed && this.running && this.reader) {
            try {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) this.onChunk(value);
            } catch {
                break;
            }
        }
    }

    private onChunk(chunk: Uint8Array) {
        this.byteCount += chunk.length;
        const merged = new Uint8Array(this.buffer.length + chunk.length);
        merged.set(this.buffer);
        merged.set(chunk, this.buffer.length);
        this.buffer = merged;
        if (this.buffer.length > 2 * 1024 * 1024) {
            this.buffer = this.buffer.slice(-1024 * 1024);
        }
        this.extractFrames();
    }

    private extractFrames() {
        // 只渲染最新一帧：解码跟不上时丢弃积压的旧帧，保证显示的是最新画面
        let last: Uint8Array | undefined;
        while (!this.disposed) {
            const start = this.indexOfSoi();
            if (start < 0) {
                if (this.buffer.length > 1024 * 1024) {
                    this.buffer = this.buffer.slice(-1024 * 1024);
                }
                break;
            }
            const end = this.indexOfEoi(start);
            if (end < 0) break; // 帧不完整，等待更多数据
            last = this.buffer.slice(start, end);
            this.buffer = this.buffer.slice(end);
        }
        if (last) this.renderFrame(last);
    }

    private indexOfSoi(): number {
        const b = this.buffer;
        for (let i = 0; i < b.length - 1; i++) {
            if (b[i] === 0xff && b[i + 1] === 0xd8) return i;
        }
        return -1;
    }

    private indexOfEoi(from: number): number {
        const b = this.buffer;
        for (let i = from + 2; i < b.length - 1; i++) {
            if (b[i] === 0xff && b[i + 1] === 0xd9) return i + 2;
        }
        return -1;
    }

    private async renderFrame(frame: Uint8Array) {
        if (this.rendering) return; // 上一帧仍在解码，丢弃本帧，避免解码队列积压
        this.rendering = true;
        try {
            const blob = new Blob([frame as unknown as BlobPart], { type: 'image/jpeg' });
            const bitmap = await createImageBitmap(blob);
            if (this.disposed || !this.canvas || !this.ctx) {
                bitmap.close();
                return;
            }
            if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
                this.canvas.width = bitmap.width;
                this.canvas.height = bitmap.height;
            }
            this.width = bitmap.width;
            this.height = bitmap.height;
            this.ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            this.frameCount++;
            this.callbacks.onFrame?.(bitmap.width, bitmap.height);
        } catch {
            // 忽略单帧解码错误
        } finally {
            this.rendering = false;
        }
    }

    async stop() {
        this.disposed = true;
        this.running = false;
        if (this.statTimer) {
            clearInterval(this.statTimer);
            this.statTimer = undefined;
        }
        try {
            this.reader?.cancel();
        } catch {
            /* ignore */
        }
        this.reader = undefined;
        try {
            this.process?.kill();
        } catch {
            /* ignore */
        }
        this.process = undefined;
        try {
            this.socket?.close();
        } catch {
            /* ignore */
        }
        this.socket = undefined;
        if (this.device) {
            try {
                await this.shellExec('pkill -9 ffmpeg');
            } catch {
                /* ignore */
            }
        }
        this.device = undefined;
        this.setStatus('idle');
    }
}
