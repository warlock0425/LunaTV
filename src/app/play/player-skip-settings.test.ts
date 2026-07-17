import { buildSkipSettings, SkipConfig } from './player-skip-settings';

function makeCtx(overrides?: {
  config?: Partial<SkipConfig>;
  player?: { currentTime?: number; duration?: number } | null;
}) {
  const skipConfigRef = {
    current: {
      enable: false,
      intro_time: 0,
      outro_time: 0,
      ...overrides?.config,
    },
  };
  const onChange = jest.fn();
  const player =
    overrides?.player === null
      ? null
      : { currentTime: 0, duration: 0, ...overrides?.player };
  return {
    skipConfigRef,
    onChange,
    settings: buildSkipSettings({
      getPlayer: () => player,
      skipConfigRef,
      onChange,
    }),
  };
}

describe('buildSkipSettings', () => {
  it('回傳三個設定項且名稱正確', () => {
    const { settings } = makeCtx();
    expect(settings.skipToggle.name).toBe('跳過片頭片尾');
    expect(settings.setIntro.name).toBe('設定片頭');
    expect(settings.setOutro.name).toBe('設定片尾');
  });

  it('開關 onSwitch 以反轉值呼叫 onChange 並回傳新狀態', () => {
    const { settings, onChange } = makeCtx({ config: { intro_time: 30 } });
    const returned = settings.skipToggle.onSwitch({ switch: false });
    expect(returned).toBe(true);
    expect(onChange).toHaveBeenCalledWith({
      enable: true,
      intro_time: 30,
      outro_time: 0,
    });
  });

  it('設定片頭以播放器當前時間寫入 intro_time', () => {
    const { settings, onChange } = makeCtx({ player: { currentTime: 95 } });
    const label = settings.setIntro.onClick();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ intro_time: 95 })
    );
    expect(label).toBe('01:35');
  });

  it('播放器時間為 0 時設定片頭不觸發 onChange', () => {
    const { settings, onChange } = makeCtx({ player: { currentTime: 0 } });
    expect(settings.setIntro.onClick()).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('設定片尾以距結尾的負秒數寫入 outro_time', () => {
    const { settings, onChange } = makeCtx({
      player: { currentTime: 1100, duration: 1200 },
    });
    settings.setOutro.onClick();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ outro_time: -100 })
    );
  });

  it('tooltip 依現有配置格式化', () => {
    const { settings } = makeCtx({ config: { intro_time: 90 } });
    expect(settings.setIntro.tooltip).toBe('01:30');
    const fresh = makeCtx();
    expect(fresh.settings.setIntro.tooltip).toBe('設定片頭時間');
  });
});
