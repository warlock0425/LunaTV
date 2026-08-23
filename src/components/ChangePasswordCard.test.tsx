import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import ChangePasswordCard from './ChangePasswordCard';

/**
 * 鎖住改密卡的三個早退分支 + 前端確認密碼。
 *
 * 這張卡的重點不是「送出後 API 怎麼回」，而是「誰根本不該看到表單」：
 * - localstorage：全站共用 PASSWORD，沒有個人密碼
 * - 站長：帳密來自環境變數，API 一定拒絕線上改密
 * 兩種情況給表單 = 按了必定失敗。那正是設計要避開的失效模式。
 */

const mockReplace = jest.fn();
const mockGetClientStorageType = jest.fn();
const mockGetAuthInfo = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/app/play/play-page-helpers', () => ({
  getClientStorageType: () => mockGetClientStorageType(),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: () => mockGetAuthInfo(),
}));

function fillForm(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('目前密碼'), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText('新密碼'), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText('確認新密碼'), {
    target: { value: confirm },
  });
}

describe('ChangePasswordCard 可見性閘門', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClientStorageType.mockReturnValue('redis');
    mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'user' });
  });

  it('localstorage 模式什麼都不渲染', () => {
    mockGetClientStorageType.mockReturnValue('localstorage');

    const { container } = render(<ChangePasswordCard />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('修改密碼')).not.toBeInTheDocument();
  });

  it('站長只看到說明，沒有輸入框', () => {
    mockGetAuthInfo.mockReturnValue({ username: 'owner', role: 'owner' });

    render(<ChangePasswordCard />);

    expect(screen.getByText('修改密碼')).toBeInTheDocument();
    expect(
      screen.getByText(/站長密碼由部署環境變數 PASSWORD 控制/)
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('目前密碼')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('新密碼')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '修改密碼' })
    ).not.toBeInTheDocument();
  });

  it('一般使用者看得到表單', () => {
    render(<ChangePasswordCard />);

    expect(screen.getByLabelText('目前密碼')).toBeInTheDocument();
    expect(screen.getByLabelText('新密碼')).toBeInTheDocument();
    expect(screen.getByLabelText('確認新密碼')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '修改密碼' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/環境變數/)).not.toBeInTheDocument();
  });
});

describe('ChangePasswordCard 前端驗證', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClientStorageType.mockReturnValue('redis');
    mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'user' });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('兩次新密碼不一致時不送出、顯示錯誤', async () => {
    render(<ChangePasswordCard />);

    fillForm('old-pass', 'new-pass-1', 'new-pass-2');
    fireEvent.click(screen.getByRole('button', { name: '修改密碼' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '兩次輸入的新密碼不一致'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
