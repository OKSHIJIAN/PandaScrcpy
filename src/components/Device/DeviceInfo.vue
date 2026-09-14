<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DeviceBasicInfo from './DeviceBasicInfo.vue';
import BatteryInfo from './BatteryInfo.vue';
import StorageInfo from './StorageInfo.vue';
import client from '../Scrcpy/adb-client';
import { Adb } from '@yume-chan/adb';

const device = computed(() => client.device || undefined);
const isLoading = ref(true);
/** Linux 车机：无电池、无 Android 设置页，相关 UI 不显示 */
const isLinuxDevice = computed(() => client.isLinux);

const deviceInfo = ref({
    deviceModel: '',
    manufacturer: '',
    androidVersion: '',
    sdkVersionCode: '',
    resolution: '',
    screenDensity: '',
    ipAddress: '',
    totalMemory: '',
    usedMemory: '',
    totalStorage: '',
    usedStorage: '',
    serialNumber: '',
    cpuInfo: '',
    cpuMin: '',
    cpuMax: '',
    cpuCur: '',
    brand: '',
    product: '',
    board: '',
    display: '',
    id: '',
    fingerPrint: '',
    host: '',
    hardware: '',
    device: '',
    user: '',
    radioVersion: '',
    tags: '',
    type: '',
    basebandVer: '',
    cpuAbi: '',
    abis: '',
    batteryPercentage: 0,
    voltage: 0,
    temperature: 0,
    batteryHealth: 0,
    batteryChargeCounter: 0,
    batteryCurrent: 0,
    oemLockedState: '',
    bootloader: '',
    abPartition: '',
    uptime: '',
    storageType: '',
    kernelVersion: '',
    rootState: 'none',
});

async function executeShellCommand(device: Adb, command: string): Promise<string> {
    const subprocess = await device.subprocess.shellProtocol!.spawn(command);
    const reader = subprocess.stdout.getReader();
    let result = '';
    let done = false;

    try {
        while (!done) {
            const { value, done: isDone } = await reader.read();
            done = isDone;
            if (value) {
                result += new TextDecoder().decode(value);
            }
        }
    } finally {
        reader.releaseLock();
    }

    await subprocess.exited;
    return result.trim();
}

/** Linux 车机专用：exec:/getprop 不可用，用一条 shell 批量收集系统信息 */
async function runLinuxProbe(adbDevice: Adb) {
    const probeScript = [
        "echo \"KERNEL=$(uname -r 2>/dev/null)\"",
        "echo \"ARCH=$(uname -m 2>/dev/null)\"",
        "echo \"UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)\"",
        "echo \"MEM_TOTAL=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null)\"",
        "echo \"MEM_AVAIL=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null)\"",
        "echo \"MODE=$(head -1 /sys/class/graphics/fb0/modes 2>/dev/null)\"",
        "echo \"CPU=$(grep -m1 -i 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2)\"",
        "echo \"CORES=$(grep -c processor /proc/cpuinfo 2>/dev/null)\"",
        "echo \"DISK=$(df -h / 2>/dev/null | tail -1 | awk '{print $2}')\"",
        "echo \"DISK_USED=$(df -h / 2>/dev/null | tail -1 | awk '{print $3}')\"",
        "echo \"IP=$(ip -4 addr 2>/dev/null | awk '/inet / {print $2}' | grep -v '^127' | head -1 | cut -d/ -f1)\"",
        "echo \"HOST=$(hostname 2>/dev/null)\"",
        "echo \"OSRAW=$(grep PRETTY_NAME /etc/os-release 2>/dev/null)\"",
        "echo \"BATT=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null)\"",
    ].join('; ');

    let out = '';
    try {
        out = await adbDevice.createSocketAndWait(`shell:${probeScript}\n`);
    } catch {
        return; // shell 也不可用时，保留兜底信息直接展示
    }

    const kv: Record<string, string> = {};
    for (const line of out.split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx > 0) kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    const osMatch = (kv.OSRAW || '').match(/"(.*)"/);
    const osName = osMatch ? osMatch[1] : '';

    // 真实显示分辨率：优先 fb0/modes（如 "U:1024x600p-60"）。
    // virtual_size 是含多缓冲的虚拟尺寸（如 1024x1800 = 600×3），不能当分辨率用。
    let resolution = '';
    const modeMatch = (kv.MODE || '').match(/(\d+)x(\d+)/);
    if (modeMatch) {
        resolution = `${modeMatch[1]}x${modeMatch[2]}`;
    }

    const toMB = (kb?: string) =>
        kb && /^\d+$/.test(kb) ? `${Math.round(parseInt(kb, 10) / 1024)} MB` : '';
    const memTotal = toMB(kv.MEM_TOTAL);
    const memAvail = toMB(kv.MEM_AVAIL);
    const memUsed =
        memTotal && memAvail
            ? `${Math.max(0, parseInt(memTotal, 10) - parseInt(memAvail, 10))} MB`
            : '';
    const up = parseInt(kv.UPTIME || '0', 10);
    const uptimeStr = up
        ? `${Math.floor(up / 86400)}天 ${Math.floor((up % 86400) / 3600)}时 ${Math.floor(
              (up % 3600) / 60,
          )}分`
        : '未知';
    const cores = /^\d+$/.test(kv.CORES || '') ? kv.CORES : '';
    const cpuName = (kv.CPU || '').trim() || kv.ARCH || '';

    deviceInfo.value = {
        ...deviceInfo.value,
        deviceModel: osName || kv.HOST || 'Linux 车机',
        manufacturer: kv.HOST || 'Linux',
        androidVersion: 'Linux',
        sdkVersionCode: kv.KERNEL || '',
        resolution,
        screenDensity: '',
        ipAddress: kv.IP || '—',
        totalMemory: memTotal,
        usedMemory: memUsed,
        totalStorage: kv.DISK || '',
        usedStorage: kv.DISK_USED || '',
        serialNumber: client.serial || '',
        cpuInfo: cores ? `${cpuName} ×${cores}核` : cpuName,
        cpuMin: '',
        cpuMax: '',
        cpuCur: '',
        cpuAbi: kv.ARCH || '',
        abis: kv.ARCH || '',
        hardware: kv.ARCH || '',
        board: kv.ARCH || '',
        kernelVersion: kv.KERNEL || '',
        // BL 锁 / A/B 槽 / 闪存类型均为 Android 概念，Linux 车机不适用
        oemLockedState: '-',
        bootloader: '-',
        abPartition: '-',
        storageType: '-',
        uptime: uptimeStr,
        batteryPercentage: kv.BATT && /^\d+$/.test(kv.BATT) ? parseInt(kv.BATT, 10) : 0,
        rootState: 'none',
    };
}

async function getDeviceInfo() {
    if (!device.value) return;

    // Linux 车机走专用分支（getProp/exec: 必然失败）
    if (client.isLinux) {
        await runLinuxProbe(device.value);
        return;
    }

    const adbDevice = device.value;

    deviceInfo.value = {
        deviceModel: await adbDevice.getProp('ro.product.model'),
        manufacturer: await adbDevice.getProp('ro.product.manufacturer'),
        androidVersion: await adbDevice.getProp('ro.build.version.release'),
        sdkVersionCode: await adbDevice.getProp('ro.build.version.sdk'),
        resolution: await executeShellCommand(adbDevice, "wm size | awk '{print $3}'"),
        screenDensity: await adbDevice.getProp('ro.sf.lcd_density'),
        ipAddress: await executeShellCommand(
            adbDevice,
            "ip addr show wlan0 | grep 'inet ' | cut -d' ' -f6 | cut -d/ -f1"
        ),
        totalMemory: `${await executeShellCommand(
            adbDevice,
            "free -m | awk '/Mem:/ {print $2}'"
        )} MB`,
        usedMemory: await executeShellCommand(
            adbDevice,
            "free -m | awk '/Mem:/ {print $3}'"
        ),
        totalStorage: await executeShellCommand(
            adbDevice,
            "df -h /data | awk '/\\/data/ {print $2}'"
        ),
        usedStorage: await executeShellCommand(
            adbDevice,
            "df -h /data | awk '/\\/data/ {print $3}'"
        ),
        serialNumber: await adbDevice.getProp('ro.serialno'),
        cpuInfo: await adbDevice.getProp('ro.hardware'),
        cpuMin: await executeShellCommand(
            adbDevice,
            'cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq'
        ),
        cpuMax: await executeShellCommand(
            adbDevice,
            'cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq'
        ),
        cpuCur: await executeShellCommand(
            adbDevice,
            'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'
        ),
        brand: await adbDevice.getProp('ro.product.brand'),
        product: await adbDevice.getProp('ro.product.name'),
        board: await adbDevice.getProp('ro.product.board'),
        display: await adbDevice.getProp('ro.build.display.id'),
        id: await adbDevice.getProp('ro.build.id'),
        fingerPrint: await adbDevice.getProp('ro.build.fingerprint'),
        host: await adbDevice.getProp('ro.build.host'),
        hardware: await adbDevice.getProp('ro.hardware'),
        device: await adbDevice.getProp('ro.product.device'),
        user: await adbDevice.getProp('ro.build.user'),
        radioVersion: await adbDevice.getProp('gsm.version.baseband'),
        tags: await adbDevice.getProp('ro.build.tags'),
        type: await adbDevice.getProp('ro.build.type'),
        basebandVer: await adbDevice.getProp('gsm.version.baseband'),
        cpuAbi: await adbDevice.getProp('ro.product.cpu.abi'),
        abis: await adbDevice.getProp('ro.product.cpu.abilist'),
        batteryPercentage: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep level | awk \'{print $2}\''), 10),
        voltage: parseFloat((await executeShellCommand(
            adbDevice, 
            'dumpsys battery | grep "  voltage" | awk \'{print $2}\''
        )) || '0') / 1000,
        temperature: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep temperature | awk \'{print $2}\''), 10) / 10,
        batteryHealth: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep mSavedBatteryAsoc | awk \'{print $2}\''), 10),
        batteryChargeCounter: parseFloat(await executeShellCommand(adbDevice, 'dumpsys battery | grep "Charge counter" | awk \'{print $3}\'') || '0') / 1000,
        batteryCurrent: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep "current now" | awk \'{print $3}\''), 10),
        oemLockedState: await executeShellCommand(
            adbDevice,
            'getprop ro.boot.flash.locked'
        ),
        bootloader: await executeShellCommand(
            adbDevice,
            'getprop ro.boot.verifiedbootstate'
        ),
        abPartition: await executeShellCommand(
            adbDevice,
            'getprop ro.boot.slot_suffix'
        ),
        uptime: await executeShellCommand(
            adbDevice,
            'cat /proc/uptime | cut -d. -f1'
        ),
        storageType: await executeShellCommand(
            adbDevice,
            'if getprop ro.boot.bootdevice | grep -qi ufs; then echo UFS; else echo eMMC; fi'
        ),
        kernelVersion: await executeShellCommand(
            adbDevice,
            'uname -r'
        ),
        rootState: await executeShellCommand(
            adbDevice,
            'ls /system/bin/su > /dev/null 2>&1 && echo rooted || echo none'
        ),
    };
}

const openSettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.SETTINGS');
};

const openDeveloperOptions = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS');
};

const openBrowser = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.intent.action.VIEW -d "http://www.google.com"');
};

const openWifiSettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.WIFI_SETTINGS');
};

const openDisplaySettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.DISPLAY_SETTINGS');
};

const openAppSettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.APPLICATION_SETTINGS');
};

const openAboutPhone = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.DEVICE_INFO_SETTINGS');
};

const refreshDeviceInfo = async () => {
    isLoading.value = true;
    try {
        await getDeviceInfo();
    } catch {
        /* 单项信息失败也展示已收集的部分，避免骨架屏卡死 */
    } finally {
        isLoading.value = false;
    }
};

onMounted(async () => {
    if (client.isConnected) {
        try {
            await getDeviceInfo();
        } catch {
            /* ignore */
        }
        isLoading.value = false;
    } else {
        isLoading.value = false;
    }
});
</script>

<template>
    <div class="device-info">
        <div v-if="isLoading" class="info-grid">
            <v-skeleton-loader type="article, actions" class="skeleton-card" />
            <div class="info-side">
                <v-skeleton-loader type="card" class="skeleton-card" />
                <v-skeleton-loader type="card" class="skeleton-card" />
            </div>
        </div>
        <div v-else class="info-grid">
            <div class="basic-info-container">
                <DeviceBasicInfo :deviceInfo="deviceInfo" />
                <v-btn
                    class="refresh-btn"
                    icon="mdi-refresh"
                    variant="text"
                    size="small"
                    :loading="isLoading"
                    @click="refreshDeviceInfo"
                    title="刷新设备信息"
                />
            </div>
            <div class="info-side">
                <BatteryInfo
                    v-if="!isLinuxDevice"
                    :batteryPercentage="deviceInfo.batteryPercentage"
                    :voltage="deviceInfo.voltage"
                    :temperature="deviceInfo.temperature"
                    :batteryHealth="deviceInfo.batteryHealth"
                    :batteryChargeCounter="deviceInfo.batteryChargeCounter"
                    :batteryCurrent="deviceInfo.batteryCurrent"
                />
                <StorageInfo :deviceInfo="deviceInfo" />
            </div>
            <div v-if="!isLinuxDevice" class="device-controls">
                <v-btn-group variant="outlined" class="control-group">
                    <v-btn size="small" prepend-icon="mdi-cog" @click="openSettings" title="打开系统设置">设置</v-btn>
                    <v-btn size="small" prepend-icon="mdi-bug" @click="openDeveloperOptions" title="打开开发者选项">开发者</v-btn>
                    <v-btn size="small" prepend-icon="mdi-web" @click="openBrowser" title="打开浏览器">浏览器</v-btn>
                    <v-btn size="small" prepend-icon="mdi-wifi" @click="openWifiSettings" title="打开WiFi设置">WiFi</v-btn>
                </v-btn-group>
                <v-btn-group variant="outlined" class="control-group">
                    <v-btn size="small" prepend-icon="mdi-cellphone-screenshot" @click="openDisplaySettings" title="打开显示设置">显示</v-btn>
                    <v-btn size="small" prepend-icon="mdi-apps" @click="openAppSettings" title="打开应用设置">应用</v-btn>
                    <v-btn size="small" prepend-icon="mdi-information" @click="openAboutPhone" title="关于手机">关于</v-btn>
                </v-btn-group>
            </div>
        </div>
    </div>
</template>

<style scoped>
.device-info {
    box-sizing: border-box;
    height: 100%;
    padding: 12px;
    overflow-y: auto;
}

.basic-info-container {
    position: relative;
}

.refresh-btn {
    position: absolute;
    top: 10px;
    right: 12px;
    z-index: 1;
}

.info-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
}

.info-main {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.device-controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--border);
}

.control-group {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 8px;
    width: 100%;
}

.control-group :deep(.v-btn) {
    flex: 1;
    text-transform: none;
    min-width: 0;
    padding: 0 8px;
}

.info-side {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}

.info-side :deep(.v-card) {
    height: 100%;
    min-height: 160px;
}

@media (max-width: 768px) {
    .control-group {
        grid-template-columns: 1fr 1fr;
    }

    .info-side {
        grid-template-columns: 1fr;
    }
}

/* 适配暗色主题 */
:deep(.v-theme--dark) .device-controls {
    background-color: var(--v-surface-variant-dark);
}

.skeleton-card {
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--border);
    height: 100%;
    min-height: 120px;
}

/* 适配暗色主题 */
:deep(.v-theme--dark) .skeleton-card {
    background-color: var(--v-surface-variant-dark);
}
</style>
