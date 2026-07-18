import { act, render, screen, within } from '@testing-library/react';

import EpgScrollableRow from './EpgScrollableRow';

describe('EpgScrollableRow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('分鐘計時器會依目前時間更新正在播放的節目', () => {
    const initialTime = new Date('2026-07-18T00:00:30.000Z');
    jest.setSystemTime(initialTime);

    render(
      <EpgScrollableRow
        currentTime={initialTime}
        programs={[
          {
            start: '2026-07-18T00:00:00.000Z',
            end: '2026-07-18T00:01:00.000Z',
            title: '第一節目',
          },
          {
            start: '2026-07-18T00:01:00.000Z',
            end: '2026-07-18T00:02:00.000Z',
            title: '第二節目',
          },
        ]}
      />
    );

    act(() => jest.advanceTimersByTime(100));
    const firstCard = screen.getByTitle('第一節目').parentElement;
    expect(firstCard).not.toBeNull();
    expect(
      within(firstCard as HTMLElement).getByText('正在播放')
    ).toBeVisible();

    act(() => jest.advanceTimersByTime(60_000));
    const secondCard = screen.getByTitle('第二節目').parentElement;
    expect(secondCard).not.toBeNull();
    expect(
      within(secondCard as HTMLElement).getByText('正在播放')
    ).toBeVisible();
  });
});
