import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { Adb, AdbDaemonTransport, type AdbPacketData } from '@yume-chan/adb';
import { Consumable, ReadableStream, WritableStream } from '@yume-chan/stream-extra';

export interface DeviceMeta {
    serial: string;
    connect: () => Promise<{
        readable: ReadableStream<AdbPacketData>;
        writable: WritableStream<Consumable<AdbPacketData>>;
    }>;
}

/** 给 promise 加超时，避免设备无响应时无限等待 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
    ]);
}

export class AdbClient {
    device: Adb | undefined;
    serial: string | undefined;
    name: string | undefined;
    isLinux = false;
    /** sync: 服务是否可用（可用则走标准 push，绕过 pty） */
    syncAvailable = false;
    /** shell,v2,raw 是否可用（可用则采集走无 pty 的 raw 通道，吞吐远高于 pty） */
    shellV2Available = false;
    credentialStore: AdbWebCredentialStore;

    constructor() {
        this.credentialStore = new AdbWebCredentialStore('high-qa');
    }

    get isSupportedWebUsb() {
        return !!AdbDaemonWebUsbDeviceManager.BROWSER;
    }

    get isConnected() {
        return !!this.device;
    }

    get deviceName() {
        return this.name;
    }

    get deviceSerial() {
        return this.serial;
    }

    async connect(deviceMeta: DeviceMeta) {
        console.log('[adb-client] connect() 开始, serial =', deviceMeta.serial);
        if (this.device) {
            await this.disconnect();
        }
        let readable: ReadableStream<AdbPacketData>;
        let writable: WritableStream<Consumable<AdbPacketData>>;
        try {
            const streams = await withTimeout(
                deviceMeta.connect(),
                10000,
                'USB 连接超时：设备无响应，请拔插 USB 线后重试',
            );
            readable = streams.readable;
            writable = streams.writable;
        } catch (e: any) {
            if (typeof e === 'object' && e !== null && 'name' in e && e.name === 'NetworkError') {
                throw new Error(
                    'Failed to connect to device. Please check if the device is connected and try again.'
                );
            }
            throw e instanceof Error ? e : new Error(String(e));
        }

        this.device = new Adb(
            await withTimeout(
                AdbDaemonTransport.authenticate({
                    serial: deviceMeta.serial,
                    connection: { readable, writable },
                    credentialStore: this.credentialStore,
                }),
                10000,
                'ADB 握手超时：设备 adbd 无响应，请拔插 USB 或重启车机后重试',
            )
        );
        console.log(
            '[adb-client] authenticate 完成, maxPayload =',
            this.device.maxPayloadSize,
        );

        // 通道探测：决定文件推送与采集走哪条通道（全部带超时，避免探测挂住整个连接）
        this.syncAvailable = false;
        try {
            const sync: any = await Promise.race([
                this.device.sync(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('sync timeout')), 5000),
                ),
            ]);
            await Promise.race([
                sync.write({
                    filename: '/tmp/.zz_probe',
                    file: new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(new Uint8Array([0x41])); // "A"
                            controller.close();
                        },
                    }),
                    permission: 0o644,
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('sync write timeout')), 5000),
                ),
            ]);
            await Promise.race([
                sync.dispose(),
                new Promise((resolve) => setTimeout(resolve, 1500)),
            ]);
            this.syncAvailable = true;
        } catch {
            this.syncAvailable = false;
        }

        // shell,v2,raw：库的 isSupported 依赖 banner features（该设备为空会误判），此处直接实测
        this.shellV2Available = false;
        try {
            const sp = (this.device as any).subprocess?.shellProtocol;
            if (sp) {
                const r: any = await Promise.race([
                    sp.spawnWaitText('echo V2OK'),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), 4000),
                    ),
                ]);
                this.shellV2Available = /V2OK/.test(r?.stdout ?? '');
            }
        } catch {
            this.shellV2Available = false;
        }
        console.log(
            `[adb-client] 通道探测：sync=${this.syncAvailable} shellV2=${this.shellV2Available}`,
        );

        // 设备信息：该设备 exec: 不可用，getProp 会失败，统一用兜底值（不再打印噪音日志）
        try {
            this.serial = await this.device.getProp('ro.serialno');
        } catch {
            this.serial = deviceMeta.serial;
        }
        try {
            this.name = await this.device.getProp('ro.product.model');
        } catch {
            this.name = deviceMeta.serial;
        }
        // 纯 Linux 设备判定（exec: 不可用时 getProp 抛错，同样视为 Linux）
        try {
            const release = await this.device.getProp('ro.build.version.release');
            this.isLinux = release.trim() === '' || /not found/i.test(release);
        } catch {
            this.isLinux = true;
        }

        console.log(
            `[adb-client] connect() 完成 serial=${this.serial} name=${this.name} isLinux=${this.isLinux}`,
        );
        return this.device;
    }

    async disconnect() {
        if (!this.device) {
            return;
        }
        // close() 可能因设备无响应而挂起，加超时保护
        await Promise.race([
            this.device.close(),
            new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
        this.device = undefined;
        this.serial = undefined;
        this.name = undefined;
    }

    /** 心跳：执行一次 shell 命令保持连接活跃，返回是否成功 */
    async heartbeat() {
        if (!this.device) return false;
        try {
            await this.device.createSocketAndWait('shell:echo');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 结束设备上可能残留的 scrcpy 服务端，避免端口/进程占用导致无法再次投屏。
     * 依赖已建立的 Adb 会话；失败时静默忽略。
     */
    async killScrcpyServerOnDevice(): Promise<void> {
        const adb = this.device;
        if (!adb?.subprocess?.noneProtocol) {
            return;
        }
        try {
            await adb.subprocess.noneProtocol.spawnWaitText(
                "sh -c 'pkill -9 -f com.genymobile.scrcpy 2>/dev/null; pkill -9 -f scrcpy 2>/dev/null; true'",
            );
        } catch {
            // 无 pkill、权限或进程不存在时忽略
        }
    }

    async addUsbDevice() {
        return await AdbDaemonWebUsbDeviceManager.BROWSER!.requestDevice();
    }

    async getUsbDeviceList() {
        return await AdbDaemonWebUsbDeviceManager.BROWSER!.getDevices();
    }
}

const client = new AdbClient();
export default client;
