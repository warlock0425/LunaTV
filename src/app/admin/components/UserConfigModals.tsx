import React from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';

import { buttonStyles } from './buttonStyles';

type SourceList = NonNullable<AdminConfig['SourceConfig']>;
type UserGroupList = AdminConfig['UserConfig']['Tags'];

// 提取URL域名的輔助函數
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    // 如果URL格式不正確，返回原字符串
    return url;
  }
}

// ---------------------------------------------------------------------------
// 共用基礎元件
// ---------------------------------------------------------------------------

function CloseIcon() {
  return (
    <svg
      className='w-6 h-6'
      fill='none'
      stroke='currentColor'
      viewBox='0 0 24 24'
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='M6 18L18 6M6 6l12 12'
      />
    </svg>
  );
}

/** 彈窗外殼：遮罩＋卡片＋標題列＋右上關閉鈕（原七個彈窗的共同結構） */
function ModalShell({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  /** true 時為可捲動的寬版（採集源/群組編輯用），false 為窄版確認框 */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return createPortal(
    <div
      className='fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-zinc-800 rounded-lg shadow-xl w-full ${
          wide ? 'max-w-4xl max-h-[80vh] overflow-y-auto' : 'max-w-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6'>
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100'>
              {title}
            </h3>
            <button
              onClick={onClose}
              className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
            >
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** 藍色資訊說明框 */
function InfoBanner({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
      <div className='flex items-center space-x-2 mb-2'>
        <svg
          className='w-5 h-5 text-blue-600 dark:text-blue-400'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
          />
        </svg>
        <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
          {title}
        </span>
      </div>
      <p className='text-sm text-blue-700 dark:text-blue-400 mt-1'>
        {children}
      </p>
    </div>
  );
}

/** 紅色危險操作警告框 */
function DangerBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
      <div className='flex items-center space-x-2 mb-2'>
        <svg
          className='w-5 h-5 text-red-600 dark:text-red-400'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
          />
        </svg>
        <span className='text-sm font-medium text-red-800 dark:text-red-300'>
          危險操作警告
        </span>
      </div>
      <p className='text-sm text-red-700 dark:text-red-400'>{children}</p>
    </div>
  );
}

/** 採集源多選格（三個彈窗共用） */
function SourceGrid({
  sources,
  selected,
  onChange,
  accent = 'blue',
}: {
  sources: SourceList | undefined;
  selected: string[];
  onChange: (next: string[]) => void;
  accent?: 'blue' | 'purple';
}) {
  const checkboxClass =
    accent === 'purple'
      ? 'rounded border-zinc-300 text-purple-600 focus:ring-purple-500 dark:border-zinc-600 dark:bg-zinc-700'
      : 'rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-700';
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
      {sources?.map((source) => (
        <label
          key={source.key}
          className='flex items-center space-x-3 p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors'
        >
          <input
            type='checkbox'
            checked={selected.includes(source.key)}
            onChange={(e) => {
              if (e.target.checked) {
                onChange([...selected, source.key]);
              } else {
                onChange(selected.filter((api) => api !== source.key));
              }
            }}
            className={checkboxClass}
          />
          <div className='flex-1 min-w-0'>
            <div className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'>
              {source.name}
            </div>
            {source.api && (
              <div className='text-xs text-zinc-500 dark:text-zinc-400 truncate'>
                {extractDomain(source.api)}
              </div>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}

/** 「全不選／全選」快速操作鈕 */
function QuickSelectButtons({
  sources,
  onChange,
}: {
  sources: SourceList | undefined;
  onChange: (next: string[]) => void;
}) {
  return (
    <>
      <button onClick={() => onChange([])} className={buttonStyles.quickAction}>
        全不選（無限制）
      </button>
      <button
        onClick={() => {
          const allApis =
            sources?.filter((source) => !source.disabled).map((s) => s.key) ||
            [];
          onChange(allApis);
        }}
        className={buttonStyles.quickAction}
      >
        全選
      </button>
    </>
  );
}

/** 使用者群組下拉選擇器（單選；空值代表無限制） */
function GroupSelect({
  userGroups,
  value,
  onChange,
}: {
  userGroups: UserGroupList;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className='w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'
      >
        <option value=''>無使用者群組（無限制）</option>
        {(userGroups || []).map((group) => (
          <option key={group.name} value={group.name}>
            {group.name}{' '}
            {group.enabledApis && group.enabledApis.length > 0
              ? `(${group.enabledApis.length} 個源)`
              : ''}
          </option>
        ))}
      </select>
      <p className='mt-2 text-xs text-zinc-500 dark:text-zinc-400'>
        選擇"無使用者群組"為無限制，選擇特定使用者群組將限制使用者只能存取該使用者群組允許的採集源
      </p>
    </>
  );
}

/** 取消＋主要動作按鈕列 */
function ModalActions({
  onCancel,
  onConfirm,
  confirmText,
  confirmingText,
  confirming = false,
  disabled = false,
  danger = false,
  bordered = false,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmText: string;
  confirmingText?: string;
  confirming?: boolean;
  disabled?: boolean;
  danger?: boolean;
  bordered?: boolean;
}) {
  const isDisabled = disabled || confirming;
  const activeStyle = danger ? buttonStyles.danger : buttonStyles.primary;
  return (
    <div
      className={`flex justify-end space-x-3${
        bordered ? ' pt-4 border-t border-zinc-200 dark:border-zinc-700' : ''
      }`}
    >
      <button
        onClick={onCancel}
        className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
      >
        取消
      </button>
      <button
        onClick={onConfirm}
        disabled={isDisabled}
        className={`px-6 py-2.5 text-sm font-medium ${
          isDisabled ? buttonStyles.disabled : activeStyle
        }`}
      >
        {confirming && confirmingText ? confirmingText : confirmText}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 七個業務彈窗
// ---------------------------------------------------------------------------

/** 設定使用者採集源權限彈窗 */
export function ConfigureApisModal({
  username,
  sources,
  selectedApis,
  onChangeApis,
  onClose,
  onSave,
  saving,
}: {
  username: string;
  sources: SourceList | undefined;
  selectedApis: string[];
  onChangeApis: (next: string[]) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <ModalShell
      title={`設定使用者採集源權限 - ${username}`}
      onClose={onClose}
      wide
    >
      <div className='mb-6'>
        <InfoBanner title='設定說明'>
          提示：全不選為無限制，選中的採集源將限制使用者只能存取這些源
        </InfoBanner>
      </div>

      <div className='mb-6'>
        <h4 className='text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4'>
          選擇可用的採集源：
        </h4>
        <SourceGrid
          sources={sources}
          selected={selectedApis}
          onChange={onChangeApis}
        />
      </div>

      <div className='flex flex-wrap items-center justify-between mb-6 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg'>
        <div className='flex space-x-2'>
          <QuickSelectButtons sources={sources} onChange={onChangeApis} />
        </div>
        <div className='text-sm text-zinc-600 dark:text-zinc-400'>
          已選擇：
          <span className='font-medium text-blue-600 dark:text-blue-400'>
            {selectedApis.length > 0 ? `${selectedApis.length} 個源` : '無限制'}
          </span>
        </div>
      </div>

      <ModalActions
        onCancel={onClose}
        onConfirm={onSave}
        confirming={saving}
        confirmText='確認設定'
        confirmingText='設定中...'
      />
    </ModalShell>
  );
}

/** 新增使用者群組彈窗 */
export function AddUserGroupModal({
  value,
  onChange,
  sources,
  onClose,
  onSubmit,
  saving,
}: {
  value: { name: string; enabledApis: string[] };
  onChange: (next: { name: string; enabledApis: string[] }) => void;
  sources: SourceList | undefined;
  onClose: () => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  return (
    <ModalShell title='新增新使用者群組' onClose={onClose} wide>
      <div className='space-y-6'>
        <div>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            使用者群組名稱
          </label>
          <input
            type='text'
            placeholder='請輸入使用者群組名稱'
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            className='w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4'>
            可用影片源
          </label>
          <SourceGrid
            sources={sources}
            selected={value.enabledApis}
            onChange={(next) => onChange({ ...value, enabledApis: next })}
          />
          <div className='mt-4 flex space-x-2'>
            <QuickSelectButtons
              sources={sources}
              onChange={(next) => onChange({ ...value, enabledApis: next })}
            />
          </div>
        </div>

        <ModalActions
          onCancel={onClose}
          onConfirm={onSubmit}
          confirming={saving}
          disabled={!value.name.trim()}
          confirmText='新增使用者群組'
          confirmingText='新增中...'
          bordered
        />
      </div>
    </ModalShell>
  );
}

/** 編輯使用者群組彈窗 */
export function EditUserGroupModal({
  groupName,
  enabledApis,
  onChangeApis,
  sources,
  onClose,
  onSubmit,
  saving,
}: {
  groupName: string;
  enabledApis: string[];
  onChangeApis: (next: string[]) => void;
  sources: SourceList | undefined;
  onClose: () => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  return (
    <ModalShell title={`編輯使用者群組 - ${groupName}`} onClose={onClose} wide>
      <div className='space-y-6'>
        <div>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4'>
            可用影片源
          </label>
          <SourceGrid
            sources={sources}
            selected={enabledApis}
            onChange={onChangeApis}
            accent='purple'
          />
          <div className='mt-4 flex space-x-2'>
            <QuickSelectButtons sources={sources} onChange={onChangeApis} />
          </div>
        </div>

        <ModalActions
          onCancel={onClose}
          onConfirm={onSubmit}
          confirming={saving}
          confirmText='儲存修改'
          confirmingText='儲存中...'
          bordered
        />
      </div>
    </ModalShell>
  );
}

/** 設定單一使用者的使用者群組彈窗 */
export function ConfigureUserGroupModal({
  username,
  userGroups,
  value,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  username: string;
  userGroups: UserGroupList;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <ModalShell title={`設定使用者群組 - ${username}`} onClose={onClose} wide>
      <div className='mb-6'>
        <InfoBanner title='設定說明'>
          提示：選擇"無使用者群組"為無限制，選擇特定使用者群組將限制使用者只能存取該使用者群組允許的採集源
        </InfoBanner>
      </div>

      <div className='mb-6'>
        <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
          選擇使用者群組：
        </label>
        <GroupSelect
          userGroups={userGroups}
          value={value}
          onChange={onChange}
        />
      </div>

      <ModalActions
        onCancel={onClose}
        onConfirm={onSave}
        confirming={saving}
        confirmText='確認設定'
        confirmingText='設定中...'
      />
    </ModalShell>
  );
}

/** 刪除使用者群組確認彈窗 */
export function DeleteUserGroupModal({
  group,
  onClose,
  onConfirm,
  deleting,
}: {
  group: {
    name: string;
    affectedUsers: Array<{
      username: string;
      role: 'user' | 'admin' | 'owner';
    }>;
  };
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <ModalShell title='確認刪除使用者群組' onClose={onClose}>
      <div className='mb-6'>
        <DangerBanner>
          刪除使用者群組 <strong>{group.name}</strong>{' '}
          將影響所有使用該組的使用者，此操作不可恢復！
        </DangerBanner>

        {group.affectedUsers.length > 0 ? (
          <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4'>
            <div className='flex items-center space-x-2 mb-2'>
              <svg
                className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                />
              </svg>
              <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                ⚠️ 將影響 {group.affectedUsers.length} 個使用者：
              </span>
            </div>
            <div className='space-y-1'>
              {group.affectedUsers.map((user, index) => (
                <div
                  key={index}
                  className='text-sm text-yellow-700 dark:text-yellow-300'
                >
                  • {user.username} ({user.role})
                </div>
              ))}
            </div>
            <p className='text-xs text-yellow-600 dark:text-yellow-400 mt-2'>
              這些使用者的使用者群組將被自動移除
            </p>
          </div>
        ) : (
          <div className='bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4'>
            <div className='flex items-center space-x-2'>
              <svg
                className='w-5 h-5 text-green-600 dark:text-green-400'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M5 13l4 4L19 7'
                />
              </svg>
              <span className='text-sm font-medium text-green-800 dark:text-green-300'>
                ✅ 目前沒有使用者使用此使用者群組
              </span>
            </div>
          </div>
        )}
      </div>

      <ModalActions
        onCancel={onClose}
        onConfirm={onConfirm}
        confirming={deleting}
        confirmText='確認刪除'
        confirmingText='刪除中...'
        danger
      />
    </ModalShell>
  );
}

/** 刪除使用者確認彈窗 */
export function DeleteUserModal({
  username,
  onClose,
  onConfirm,
}: {
  username: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title='確認刪除使用者' onClose={onClose}>
      <div className='mb-6'>
        <DangerBanner>
          刪除使用者 <strong>{username}</strong>{' '}
          將同時刪除其搜尋歷史、播放記錄和收藏夾，此操作不可恢復！
        </DangerBanner>

        <ModalActions
          onCancel={onClose}
          onConfirm={onConfirm}
          confirmText='確認刪除'
          danger
        />
      </div>
    </ModalShell>
  );
}

/** 批量設定使用者群組彈窗 */
export function BatchUserGroupModal({
  count,
  userGroups,
  value,
  onChange,
  onClose,
  onConfirm,
  saving,
}: {
  count: number;
  userGroups: UserGroupList;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  return (
    <ModalShell title='批量設定使用者群組' onClose={onClose}>
      <div className='mb-6'>
        <div className='mb-4'>
          <InfoBanner title='批量操作說明'>
            將為選中的 <strong>{count} 個使用者</strong>{' '}
            設定使用者群組，選擇"無使用者群組"為無限制
          </InfoBanner>
        </div>

        <div>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            選擇使用者群組：
          </label>
          <GroupSelect
            userGroups={userGroups}
            value={value}
            onChange={onChange}
          />
        </div>
      </div>

      <ModalActions
        onCancel={onClose}
        onConfirm={onConfirm}
        confirming={saving}
        confirmText='確認設定'
        confirmingText='設定中...'
      />
    </ModalShell>
  );
}
