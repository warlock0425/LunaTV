import React, { useCallback, useMemo, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import {
  AlertModal,
  showError,
  showSuccess,
  useAlertModal,
} from './AlertModal';
import { buttonStyles } from './buttonStyles';
import { useLoadingState } from './Loading';
import {
  AddUserGroupModal,
  BatchUserGroupModal,
  ConfigureApisModal,
  ConfigureUserGroupModal,
  DeleteUserGroupModal,
  DeleteUserModal,
  EditUserGroupModal,
} from './UserConfigModals';

export interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

export const UserConfig = ({
  config,
  role,
  refreshConfig,
}: UserConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [showAddUserGroupForm, setShowAddUserGroupForm] = useState(false);
  const [showEditUserGroupForm, setShowEditUserGroupForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    userGroup: '', // 新增使用者群組字段
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  const [newUserGroup, setNewUserGroup] = useState({
    name: '',
    enabledApis: [] as string[],
  });
  const [editingUserGroup, setEditingUserGroup] = useState<{
    name: string;
    enabledApis: string[];
  } | null>(null);
  const [showConfigureApisModal, setShowConfigureApisModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
    tags?: string[];
  } | null>(null);
  const [selectedApis, setSelectedApis] = useState<string[]>([]);
  const [showConfigureUserGroupModal, setShowConfigureUserGroupModal] =
    useState(false);
  const [selectedUserForGroup, setSelectedUserForGroup] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  } | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showBatchUserGroupModal, setShowBatchUserGroupModal] = useState(false);
  const [selectedUserGroup, setSelectedUserGroup] = useState<string>('');
  const [showDeleteUserGroupModal, setShowDeleteUserGroupModal] =
    useState(false);
  const [deletingUserGroup, setDeletingUserGroup] = useState<{
    name: string;
    affectedUsers: Array<{
      username: string;
      role: 'user' | 'admin' | 'owner';
    }>;
  } | null>(null);
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // 當前登入使用者名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;

  // 使用 useMemo 計算全選狀態，避免每次渲染都重新計算
  const selectAllUsers = useMemo(() => {
    const selectableUserCount =
      config?.UserConfig?.Users?.filter(
        (user) =>
          role === 'owner' ||
          (role === 'admin' &&
            (user.role === 'user' || user.username === currentUsername))
      ).length || 0;
    return selectedUsers.size === selectableUserCount && selectedUsers.size > 0;
  }, [selectedUsers.size, config?.UserConfig?.Users, role, currentUsername]);

  // 取得使用者群組列表
  const userGroups = config?.UserConfig?.Tags || [];

  // 處理使用者群組相關操作
  const handleUserGroupAction = async (
    action: 'add' | 'edit' | 'delete',
    groupName: string,
    enabledApis?: string[]
  ) => {
    return withLoading(`userGroup_${action}_${groupName}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'userGroup',
            groupAction: action,
            groupName,
            enabledApis,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失敗: ${res.status}`);
        }

        await refreshConfig();

        if (action === 'add') {
          setNewUserGroup({ name: '', enabledApis: [] });
          setShowAddUserGroupForm(false);
        } else if (action === 'edit') {
          setEditingUserGroup(null);
          setShowEditUserGroupForm(false);
        }

        showSuccess(
          action === 'add'
            ? '使用者群組新增成功'
            : action === 'edit'
              ? '使用者群組更新成功'
              : '使用者群組刪除成功',
          showAlert
        );
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失敗', showAlert);
        throw err;
      }
    });
  };

  const handleAddUserGroup = () => {
    if (!newUserGroup.name.trim()) return;
    handleUserGroupAction('add', newUserGroup.name, newUserGroup.enabledApis);
  };

  const handleEditUserGroup = () => {
    if (!editingUserGroup?.name.trim()) return;
    handleUserGroupAction(
      'edit',
      editingUserGroup.name,
      editingUserGroup.enabledApis
    );
  };

  const handleDeleteUserGroup = (groupName: string) => {
    // 計算會受影響的使用者數量
    const affectedUsers =
      config?.UserConfig?.Users?.filter(
        (user) => user.tags && user.tags.includes(groupName)
      ) || [];

    setDeletingUserGroup({
      name: groupName,
      affectedUsers: affectedUsers.map((u) => ({
        username: u.username,
        role: u.role,
      })),
    });
    setShowDeleteUserGroupModal(true);
  };

  const handleConfirmDeleteUserGroup = async () => {
    if (!deletingUserGroup) return;

    try {
      await handleUserGroupAction('delete', deletingUserGroup.name);
      setShowDeleteUserGroupModal(false);
      setDeletingUserGroup(null);
    } catch (err) {
      // 錯誤處理已在 handleUserGroupAction 中處理
    }
  };

  const handleStartEditUserGroup = (group: {
    name: string;
    enabledApis: string[];
  }) => {
    setEditingUserGroup({ ...group });
    setShowEditUserGroupForm(true);
    setShowAddUserGroupForm(false);
  };

  // 為使用者分配使用者群組
  const handleAssignUserGroup = async (
    username: string,
    userGroups: string[]
  ) => {
    return withLoading(`assignUserGroup_${username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: username,
            action: 'updateUserGroups',
            userGroups,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失敗: ${res.status}`);
        }

        await refreshConfig();
        showSuccess('使用者群組分配成功', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失敗', showAlert);
        throw err;
      }
    });
  };

  const handleBanUser = async (uname: string) => {
    await withLoading(`banUser_${uname}`, () => handleUserAction('ban', uname));
  };

  const handleUnbanUser = async (uname: string) => {
    await withLoading(`unbanUser_${uname}`, () =>
      handleUserAction('unban', uname)
    );
  };

  const handleSetAdmin = async (uname: string) => {
    await withLoading(`setAdmin_${uname}`, () =>
      handleUserAction('setAdmin', uname)
    );
  };

  const handleRemoveAdmin = async (uname: string) => {
    await withLoading(`removeAdmin_${uname}`, () =>
      handleUserAction('cancelAdmin', uname)
    );
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await withLoading('addUser', async () => {
      const succeeded = await handleUserAction(
        'add',
        newUser.username,
        newUser.password,
        newUser.userGroup
      );
      if (!succeeded) return;
      setNewUser({ username: '', password: '', userGroup: '' });
      setShowAddUserForm(false);
    });
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await withLoading(
      `changePassword_${changePasswordUser.username}`,
      async () => {
        const succeeded = await handleUserAction(
          'changePassword',
          changePasswordUser.username,
          changePasswordUser.password
        );
        if (!succeeded) return;
        setChangePasswordUser({ username: '', password: '' });
        setShowChangePasswordForm(false);
      }
    );
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 關閉新增使用者表單
  };

  const handleDeleteUser = (username: string) => {
    setDeletingUser(username);
    setShowDeleteUserModal(true);
  };

  const handleConfigureUserApis = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
  }) => {
    setSelectedUser(user);
    setSelectedApis(user.enabledApis || []);
    setShowConfigureApisModal(true);
  };

  const handleConfigureUserGroup = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  }) => {
    setSelectedUserForGroup(user);
    setSelectedUserGroups(user.tags || []);
    setShowConfigureUserGroupModal(true);
  };

  const handleSaveUserGroups = async () => {
    if (!selectedUserForGroup) return;

    await withLoading(
      `saveUserGroups_${selectedUserForGroup.username}`,
      async () => {
        try {
          await handleAssignUserGroup(
            selectedUserForGroup.username,
            selectedUserGroups
          );
          setShowConfigureUserGroupModal(false);
          setSelectedUserForGroup(null);
          setSelectedUserGroups([]);
        } catch (err) {
          // 錯誤處理已在 handleAssignUserGroup 中處理
        }
      }
    );
  };

  // 處理使用者選擇
  const handleSelectUser = useCallback((username: string, checked: boolean) => {
    setSelectedUsers((prev) => {
      const newSelectedUsers = new Set(prev);
      if (checked) {
        newSelectedUsers.add(username);
      } else {
        newSelectedUsers.delete(username);
      }
      return newSelectedUsers;
    });
  }, []);

  const handleSelectAllUsers = useCallback(
    (checked: boolean) => {
      if (checked) {
        // 只選擇自己有權限操作的使用者
        const selectableUsernames =
          config?.UserConfig?.Users?.filter(
            (user) =>
              role === 'owner' ||
              (role === 'admin' &&
                (user.role === 'user' || user.username === currentUsername))
          ).map((u) => u.username) || [];
        setSelectedUsers(new Set(selectableUsernames));
      } else {
        setSelectedUsers(new Set());
      }
    },
    [config?.UserConfig?.Users, role, currentUsername]
  );

  // 批量設定使用者群組
  const handleBatchSetUserGroup = async (userGroup: string) => {
    if (selectedUsers.size === 0) return;

    await withLoading('batchSetUserGroup', async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batchUpdateUserGroups',
            usernames: Array.from(selectedUsers),
            userGroups: userGroup === '' ? [] : [userGroup],
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失敗: ${res.status}`);
        }

        const userCount = selectedUsers.size;
        setSelectedUsers(new Set());
        setShowBatchUserGroupModal(false);
        setSelectedUserGroup('');
        showSuccess(
          `已為 ${userCount} 個使用者設定使用者群組: ${userGroup}`,
          showAlert
        );

        // 重新整理設定
        await refreshConfig();
      } catch (err) {
        showError('批量設定使用者群組失敗', showAlert);
        throw err;
      }
    });
  };

  const handleSaveUserApis = async () => {
    if (!selectedUser) return;

    await withLoading(`saveUserApis_${selectedUser.username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: selectedUser.username,
            action: 'updateUserApis',
            enabledApis: selectedApis,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失敗: ${res.status}`);
        }

        // 成功後重新整理設定
        await refreshConfig();
        setShowConfigureApisModal(false);
        setSelectedUser(null);
        setSelectedApis([]);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失敗', showAlert);
        throw err;
      }
    });
  };

  // 通用請求函數
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser',
    targetUsername: string,
    targetPassword?: string,
    userGroup?: string
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          ...(userGroup ? { userGroup } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失敗: ${res.status}`);
      }

      // 成功後重新整理設定（無需整頁重新整理）
      await refreshConfig();
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失敗', showAlert);
      return false;
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;

    await withLoading(`deleteUser_${deletingUser}`, async () => {
      try {
        const succeeded = await handleUserAction('deleteUser', deletingUser);
        if (!succeeded) return;
        setShowDeleteUserModal(false);
        setDeletingUser(null);
      } catch (err) {
        // 錯誤處理已在 handleUserAction 中處理
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-zinc-500 dark:text-zinc-400'>
        載入中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 使用者統計 */}
      <div>
        <h4 className='text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3'>
          使用者統計
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            總使用者數
          </div>
        </div>
      </div>

      {/* 使用者群組管理 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-zinc-700 dark:text-zinc-300'>
            使用者群組管理
          </h4>
          <button
            onClick={() => {
              setShowAddUserGroupForm(!showAddUserGroupForm);
              if (showEditUserGroupForm) {
                setShowEditUserGroupForm(false);
                setEditingUserGroup(null);
              }
            }}
            className={
              showAddUserGroupForm
                ? buttonStyles.secondary
                : buttonStyles.primary
            }
          >
            {showAddUserGroupForm ? '取消' : '新增使用者群組'}
          </button>
        </div>

        {/* 使用者群組列表 */}
        <div className='border border-zinc-200 dark:border-zinc-700 rounded-lg max-h-[20rem] overflow-y-auto overflow-x-auto relative'>
          <table className='min-w-full divide-y divide-zinc-200 dark:divide-zinc-700'>
            <thead className='bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'>
                  使用者群組名稱
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'>
                  可用影片源
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-zinc-200 dark:divide-zinc-700'>
              {userGroups.map((group) => (
                <tr
                  key={group.name}
                  className='hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors'
                >
                  <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                    {group.name}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center space-x-2'>
                      <span className='text-sm text-zinc-900 dark:text-zinc-100'>
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `${group.enabledApis.length} 個源`
                          : '無限制'}
                      </span>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                    <button
                      onClick={() => handleStartEditUserGroup(group)}
                      disabled={isLoading(`userGroup_edit_${group.name}`)}
                      className={`${buttonStyles.roundedPrimary} ${
                        isLoading(`userGroup_edit_${group.name}`)
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      編輯
                    </button>
                    <button
                      onClick={() => handleDeleteUserGroup(group.name)}
                      className={buttonStyles.roundedDanger}
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
              {userGroups.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className='px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400'
                  >
                    暫無使用者群組，請新增使用者群組來管理使用者權限
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 使用者列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-zinc-700 dark:text-zinc-300'>
            使用者列表
          </h4>
          <div className='flex items-center space-x-2'>
            {/* 批量操作按鈕 */}
            {selectedUsers.size > 0 && (
              <>
                <div className='flex items-center space-x-3'>
                  <span className='text-sm text-zinc-600 dark:text-zinc-400'>
                    已選擇 {selectedUsers.size} 個使用者
                  </span>
                  <button
                    onClick={() => setShowBatchUserGroupModal(true)}
                    className={buttonStyles.primary}
                  >
                    批量設定使用者群組
                  </button>
                </div>
                <div className='w-px h-6 bg-zinc-300 dark:bg-zinc-600'></div>
              </>
            )}
            <button
              onClick={() => {
                setShowAddUserForm(!showAddUserForm);
                if (showChangePasswordForm) {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }
              }}
              className={
                showAddUserForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddUserForm ? '取消' : '新增使用者'}
            </button>
          </div>
        </div>

        {/* 新增使用者表單 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700'>
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <input
                  type='text'
                  placeholder='使用者名'
                  value={newUser.username}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
                <input
                  type='password'
                  placeholder='密碼'
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
                  使用者群組（可選）
                </label>
                <select
                  value={newUser.userGroup}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      userGroup: e.target.value,
                    }))
                  }
                  className='w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                >
                  <option value=''>無使用者群組（無限制）</option>
                  {userGroups.map((group) => (
                    <option key={group.name} value={group.name}>
                      {group.name} (
                      {group.enabledApis && group.enabledApis.length > 0
                        ? `${group.enabledApis.length} 個源`
                        : '無限制'}
                      )
                    </option>
                  ))}
                </select>
              </div>
              <div className='flex justify-end'>
                <button
                  onClick={handleAddUser}
                  disabled={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                  }
                  className={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                      ? buttonStyles.disabled
                      : buttonStyles.success
                  }
                >
                  {isLoading('addUser') ? '新增中...' : '新增'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 修改密碼表單 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改使用者密碼
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='使用者名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密碼'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                }
                className={`w-full sm:w-auto ${
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                    ? buttonStyles.disabled
                    : buttonStyles.primary
                }`}
              >
                {isLoading(`changePassword_${changePasswordUser.username}`)
                  ? '修改中...'
                  : '修改密碼'}
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className={`w-full sm:w-auto ${buttonStyles.secondary}`}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 使用者列表 */}
        <div
          className='border border-zinc-200 dark:border-zinc-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto relative'
          data-table='user-list'
        >
          <table className='min-w-full divide-y divide-zinc-200 dark:divide-zinc-700'>
            <thead className='bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10'>
              <tr>
                <th className='w-4' />
                <th className='w-10 px-1 py-3 text-center'>
                  {(() => {
                    // 檢查是否有權限操作任何使用者
                    const hasAnyPermission = config?.UserConfig?.Users?.some(
                      (user) =>
                        role === 'owner' ||
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername))
                    );

                    return hasAnyPermission ? (
                      <input
                        type='checkbox'
                        checked={selectAllUsers}
                        onChange={(e) => handleSelectAllUsers(e.target.checked)}
                        className='w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600'
                      />
                    ) : (
                      <div className='w-4 h-4' />
                    );
                  })()}
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'
                >
                  使用者名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'
                >
                  狀態
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'
                >
                  使用者群組
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'
                >
                  採集源權限
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按規則排序使用者：自己 -> 站長(若非自己) -> 管理員 -> 其他 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  return 3;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-zinc-200 dark:divide-zinc-700'>
                  {sortedUsers.map((user) => {
                    // 修改密碼權限：站長可修改管理員和普通使用者密碼，管理員可修改普通使用者和自己的密碼，但任何人都不能修改站長密碼
                    const canChangePassword =
                      user.role !== 'owner' && // 不能修改站長密碼
                      (role === 'owner' || // 站長可以修改管理員和普通使用者密碼
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername))); // 管理員可以修改普通使用者和自己的密碼

                    // 刪除使用者權限：站長可刪除除自己外的所有使用者，管理員僅可刪除普通使用者
                    const canDeleteUser =
                      user.username !== currentUsername &&
                      (role === 'owner' || // 站長可以刪除除自己外的所有使用者
                        (role === 'admin' && user.role === 'user')); // 管理員僅可刪除普通使用者

                    // 其他操作權限：不能操作自己，站長可操作所有使用者，管理員可操作普通使用者
                    const canOperate =
                      user.username !== currentUsername &&
                      (role === 'owner' ||
                        (role === 'admin' && user.role === 'user'));
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors'
                      >
                        <td className='w-4' />
                        <td className='w-10 px-1 py-3 text-center'>
                          {role === 'owner' ||
                          (role === 'admin' &&
                            (user.role === 'user' ||
                              user.username === currentUsername)) ? (
                            <input
                              type='checkbox'
                              checked={selectedUsers.has(user.username)}
                              onChange={(e) =>
                                handleSelectUser(
                                  user.username,
                                  e.target.checked
                                )
                              }
                              className='w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600'
                            />
                          ) : (
                            <div className='w-4 h-4' />
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              user.role === 'owner'
                                ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                : user.role === 'admin'
                                  ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                            }`}
                          >
                            {user.role === 'owner'
                              ? '站長'
                              : user.role === 'admin'
                                ? '管理員'
                                : '普通使用者'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              !user.banned
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {!user.banned ? '正常' : '已封禁'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-zinc-900 dark:text-zinc-100'>
                              {user.tags && user.tags.length > 0
                                ? user.tags.join(', ')
                                : '無使用者群組'}
                            </span>
                            {/* 設定使用者群組按鈕 */}
                            {(role === 'owner' ||
                              (role === 'admin' &&
                                (user.role === 'user' ||
                                  user.username === currentUsername))) && (
                              <button
                                onClick={() => handleConfigureUserGroup(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                設定
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-zinc-900 dark:text-zinc-100'>
                              {user.enabledApis && user.enabledApis.length > 0
                                ? `${user.enabledApis.length} 個源`
                                : '無限制'}
                            </span>
                            {/* 設定採集源權限按鈕 */}
                            {(role === 'owner' ||
                              (role === 'admin' &&
                                (user.role === 'user' ||
                                  user.username === currentUsername))) && (
                              <button
                                onClick={() => handleConfigureUserApis(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                設定
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密碼按鈕 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className={buttonStyles.roundedPrimary}
                            >
                              修改密碼
                            </button>
                          )}
                          {canOperate && (
                            <>
                              {/* 其他操作按鈕 */}
                              {user.role === 'user' && (
                                <button
                                  onClick={() => handleSetAdmin(user.username)}
                                  disabled={isLoading(
                                    `setAdmin_${user.username}`
                                  )}
                                  className={`${buttonStyles.roundedPurple} ${
                                    isLoading(`setAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  設為管理
                                </button>
                              )}
                              {user.role === 'admin' && (
                                <button
                                  onClick={() =>
                                    handleRemoveAdmin(user.username)
                                  }
                                  disabled={isLoading(
                                    `removeAdmin_${user.username}`
                                  )}
                                  className={`${
                                    buttonStyles.roundedSecondary
                                  } ${
                                    isLoading(`removeAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  取消管理
                                </button>
                              )}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    disabled={isLoading(
                                      `banUser_${user.username}`
                                    )}
                                    className={`${buttonStyles.roundedDanger} ${
                                      isLoading(`banUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    disabled={isLoading(
                                      `unbanUser_${user.username}`
                                    )}
                                    className={`${
                                      buttonStyles.roundedSuccess
                                    } ${
                                      isLoading(`unbanUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 刪除使用者按鈕 - 放在最後，使用更明顯的紅色樣式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
                              className={buttonStyles.roundedDanger}
                            >
                              刪除使用者
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })()}
          </table>
        </div>
      </div>

      {/* 設定使用者採集源權限彈窗 */}
      {showConfigureApisModal && selectedUser && (
        <ConfigureApisModal
          username={selectedUser.username}
          sources={config?.SourceConfig}
          selectedApis={selectedApis}
          onChangeApis={setSelectedApis}
          onClose={() => {
            setShowConfigureApisModal(false);
            setSelectedUser(null);
            setSelectedApis([]);
          }}
          onSave={handleSaveUserApis}
          saving={isLoading(`saveUserApis_${selectedUser.username}`)}
        />
      )}

      {/* 新增使用者群組彈窗 */}
      {showAddUserGroupForm && (
        <AddUserGroupModal
          value={newUserGroup}
          onChange={setNewUserGroup}
          sources={config?.SourceConfig}
          onClose={() => {
            setShowAddUserGroupForm(false);
            setNewUserGroup({ name: '', enabledApis: [] });
          }}
          onSubmit={handleAddUserGroup}
          saving={isLoading('userGroup_add_new')}
        />
      )}

      {/* 編輯使用者群組彈窗 */}
      {showEditUserGroupForm && editingUserGroup && (
        <EditUserGroupModal
          groupName={editingUserGroup.name}
          enabledApis={editingUserGroup.enabledApis}
          onChangeApis={(next) =>
            setEditingUserGroup((prev) =>
              prev ? { ...prev, enabledApis: next } : null
            )
          }
          sources={config?.SourceConfig}
          onClose={() => {
            setShowEditUserGroupForm(false);
            setEditingUserGroup(null);
          }}
          onSubmit={handleEditUserGroup}
          saving={isLoading(`userGroup_edit_${editingUserGroup.name}`)}
        />
      )}

      {/* 設定使用者群組彈窗 */}
      {showConfigureUserGroupModal && selectedUserForGroup && (
        <ConfigureUserGroupModal
          username={selectedUserForGroup.username}
          userGroups={userGroups}
          value={selectedUserGroups.length > 0 ? selectedUserGroups[0] : ''}
          onChange={(value) => setSelectedUserGroups(value ? [value] : [])}
          onClose={() => {
            setShowConfigureUserGroupModal(false);
            setSelectedUserForGroup(null);
            setSelectedUserGroups([]);
          }}
          onSave={handleSaveUserGroups}
          saving={isLoading(`saveUserGroups_${selectedUserForGroup.username}`)}
        />
      )}

      {/* 刪除使用者群組確認彈窗 */}
      {showDeleteUserGroupModal && deletingUserGroup && (
        <DeleteUserGroupModal
          group={deletingUserGroup}
          onClose={() => {
            setShowDeleteUserGroupModal(false);
            setDeletingUserGroup(null);
          }}
          onConfirm={handleConfirmDeleteUserGroup}
          deleting={isLoading(`userGroup_delete_${deletingUserGroup.name}`)}
        />
      )}

      {/* 刪除使用者確認彈窗 */}
      {showDeleteUserModal && deletingUser && (
        <DeleteUserModal
          username={deletingUser}
          onClose={() => {
            setShowDeleteUserModal(false);
            setDeletingUser(null);
          }}
          onConfirm={handleConfirmDeleteUser}
        />
      )}

      {/* 批量設定使用者群組彈窗 */}
      {showBatchUserGroupModal && (
        <BatchUserGroupModal
          count={selectedUsers.size}
          userGroups={userGroups}
          value={selectedUserGroup}
          onChange={setSelectedUserGroup}
          onClose={() => {
            setShowBatchUserGroupModal(false);
            setSelectedUserGroup('');
          }}
          onConfirm={() => handleBatchSetUserGroup(selectedUserGroup)}
          saving={isLoading('batchSetUserGroup')}
        />
      )}

      {/* 通用彈窗組件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};
