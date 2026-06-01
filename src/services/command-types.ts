/**
 * 远程控制命令类型定义
 * 用于 WebRTC DataChannel 传输触摸和按键事件
 */

// 触摸命令
export interface TouchCommand {
  type: 'touch';
  action: 'down' | 'move' | 'up';
  x: number;      // 归一化坐标 0-1
  y: number;      // 归一化坐标 0-1
  pointerId: number;
}

// 按键命令
export interface KeyCommand {
  type: 'key';
  key: 'back' | 'home' | 'recents';
}

// 画质设置命令
export interface SettingsCommand {
  type: 'settings';
  fps?: number;        // 目标帧率 5/10/15/30
  quality?: number;    // 编码质量 30-100
}

// 远程控制命令联合类型
export type RemoteControlCommand = TouchCommand | KeyCommand | SettingsCommand;

/**
 * 序列化命令为 JSON 字符串
 */
export function serializeCommand(cmd: RemoteControlCommand): string {
  return JSON.stringify(cmd);
}

/**
 * 反序列化 JSON 字符串为命令对象
 * 返回 null 如果解析失败或格式无效
 */
function parseSettingsCommand(parsed: any): SettingsCommand | null {
  if (parsed.type !== 'settings') return null;
  const cmd: SettingsCommand = { type: 'settings' };
  if (typeof parsed.fps === 'number' && [5, 10, 15, 30].includes(parsed.fps)) {
    cmd.fps = parsed.fps;
  }
  if (typeof parsed.quality === 'number' && parsed.quality >= 30 && parsed.quality <= 100) {
    cmd.quality = parsed.quality;
  }
  // 至少要有一个有效参数
  return cmd.fps !== undefined || cmd.quality !== undefined ? cmd : null;
}

export function deserializeCommand(data: string): RemoteControlCommand | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') return null;

    if (parsed.type === 'touch') {
      if (
        typeof parsed.action === 'string' &&
        ['down', 'move', 'up'].includes(parsed.action) &&
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        typeof parsed.pointerId === 'number'
      ) {
        return parsed as TouchCommand;
      }
    } else if (parsed.type === 'key') {
      if (
        typeof parsed.key === 'string' &&
        ['back', 'home', 'recents'].includes(parsed.key)
      ) {
        return parsed as KeyCommand;
      }
    } else if (parsed.type === 'settings') {
      return parseSettingsCommand(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 类型守卫：判断是否为 TouchCommand
 */
export function isTouchCommand(cmd: RemoteControlCommand): cmd is TouchCommand {
  return cmd.type === 'touch';
}

/**
 * 类型守卫：判断是否为 KeyCommand
 */
export function isKeyCommand(cmd: RemoteControlCommand): cmd is KeyCommand {
  return cmd.type === 'key';
}

/**
 * 类型守卫：判断是否为 SettingsCommand
 */
export function isSettingsCommand(cmd: RemoteControlCommand): cmd is SettingsCommand {
  return cmd.type === 'settings';
}
