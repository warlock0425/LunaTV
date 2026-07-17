/* eslint-disable @typescript-eslint/no-explicit-any */
import { formatPlayerTime } from '@/lib/play-page-utils';

export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

interface SkipSettingsContext {
  getPlayer: () => any;
  skipConfigRef: { current: SkipConfig };
  onChange: (newConfig: SkipConfig) => void;
}

const SET_INTRO_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>';
const SET_OUTRO_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>';

/**
 * 建立「跳過片頭片尾」三項播放器設定（開關、設定片頭、設定片尾）。
 * 同時用於 Artplayer 建立時的 settings 陣列與 handleSkipConfigChange
 * 重設設定面板（setting.update），確保兩處行為一致。
 */
export function buildSkipSettings(ctx: SkipSettingsContext): {
  skipToggle: any;
  setIntro: any;
  setOutro: any;
} {
  const { getPlayer, skipConfigRef, onChange } = ctx;

  const skipToggle = {
    name: '跳過片頭片尾',
    html: '跳過片頭片尾',
    switch: skipConfigRef.current.enable,
    onSwitch: function (item: any) {
      const newConfig = {
        ...skipConfigRef.current,
        enable: !item.switch,
      };
      onChange(newConfig);
      return !item.switch;
    },
  };

  const setIntro = {
    name: '設定片頭',
    html: '設定片頭',
    icon: SET_INTRO_ICON,
    tooltip:
      skipConfigRef.current.intro_time === 0
        ? '設定片頭時間'
        : `${formatPlayerTime(skipConfigRef.current.intro_time)}`,
    onClick: function () {
      const currentTime = getPlayer()?.currentTime || 0;
      if (currentTime > 0) {
        const newConfig = {
          ...skipConfigRef.current,
          intro_time: currentTime,
        };
        onChange(newConfig);
        return `${formatPlayerTime(currentTime)}`;
      }
    },
  };

  const setOutro = {
    name: '設定片尾',
    html: '設定片尾',
    icon: SET_OUTRO_ICON,
    tooltip:
      skipConfigRef.current.outro_time >= 0
        ? '設定片尾時間'
        : `-${formatPlayerTime(-skipConfigRef.current.outro_time)}`,
    onClick: function () {
      const outroTime =
        -(getPlayer()?.duration - getPlayer()?.currentTime) || 0;
      if (outroTime < 0) {
        const newConfig = {
          ...skipConfigRef.current,
          outro_time: outroTime,
        };
        onChange(newConfig);
        return `-${formatPlayerTime(-outroTime)}`;
      }
    },
  };

  return { skipToggle, setIntro, setOutro };
}
