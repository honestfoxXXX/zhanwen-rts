/**
 * 全局设置（单例，localStorage 持久化）：
 * 音量三轨 / 屏幕震动 / 边缘滚动 / 目标链 / 伤害数字（伤害数字在 feedback.ts 单独存）。
 * 所有开关在设置面板可调、实时生效。
 */
export interface GameSettings {
  master: number;   // 0-1 主音量
  music: number;    // 0-1 音乐
  sfx: number;      // 0-1 音效
  shake: boolean;   // 屏幕震动
  edgeScroll: boolean; // 鼠标边缘滚动
  goalChain: boolean;  // 新手目标链
}

const KEY = 'zw_settings_v1';

const DEFAULTS: GameSettings = {
  master: 0.85,
  music: 0.7,
  sfx: 1,
  shake: true,
  edgeScroll: true,
  goalChain: true,
};

export const settings: GameSettings = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
})();

export function saveSettings(): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
