import { describeSourceValidation } from './source-validation-status';

describe('describeSourceValidation', () => {
  it('連線失敗建議停用', () => {
    const suggestion = describeSourceValidation({ status: 'invalid' });
    expect(suggestion).toEqual({
      suggest: true,
      label: '建議停用',
      reason: '連線失敗，建議檢查 API 或暫時停用',
    });
  });

  it('部分通過且解集數失敗：標籤要指出是集數，不是籠統的「建議關注」', () => {
    const suggestion = describeSourceValidation({
      status: 'partial',
      levels: { search: 'pass', detail: 'fail', playable: 'skip' },
    });
    expect(suggestion?.label).toBe('解集數失敗');
    expect(suggestion?.reason).toContain('詳情接口');
  });

  it('部分通過且試播失敗：標籤與集數失敗必須可區分', () => {
    const suggestion = describeSourceValidation({
      status: 'partial',
      levels: { search: 'pass', detail: 'pass', playable: 'fail' },
    });
    expect(suggestion?.label).toBe('試播失敗');
    expect(suggestion?.reason).toContain('換關鍵詞重測');
  });

  it('兩級都失敗時以解集數為準（源壞掉比關鍵詞沒片嚴重）', () => {
    const suggestion = describeSourceValidation({
      status: 'partial',
      levels: { search: 'pass', detail: 'fail', playable: 'fail' },
    });
    expect(suggestion?.label).toBe('解集數失敗');
  });

  it('可播與無結果都不給建議', () => {
    expect(
      describeSourceValidation({
        status: 'valid',
        levels: { search: 'pass', detail: 'pass', playable: 'pass' },
      })
    ).toBeNull();
    expect(describeSourceValidation({ status: 'no_results' })).toBeNull();
  });

  it('檢測中不下結論', () => {
    expect(describeSourceValidation({ status: 'validating' })).toBeNull();
  });

  it('尚未檢測（null／undefined）或部分通過但沒有失敗級別時回 null', () => {
    expect(describeSourceValidation(null)).toBeNull();
    expect(describeSourceValidation(undefined)).toBeNull();
    expect(
      describeSourceValidation({
        status: 'partial',
        levels: { search: 'pass', detail: 'skip', playable: 'skip' },
      })
    ).toBeNull();
  });
});
