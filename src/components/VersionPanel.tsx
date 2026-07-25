'use client';

import React from 'react';

import { CHANGELOGS, CURRENT_VERSION } from '@/lib/version';
import { useMounted } from '@/hooks/useClientMount';

interface VersionPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function VersionPanel({ isOpen = true, onClose }: VersionPanelProps) {
  const mounted = useMounted();

  if (!mounted) return null;

  // 如果外部傳入的 isOpen 狀態為 false，直接不渲染，雙重防禦保險
  if (!isOpen) return null;

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (onClose) onClose();
  };

  return (
    <div
      className='fixed inset-0 bg-black/80 backdrop-blur-md z-[999999] flex items-center justify-center p-4 animate-fade-in'
      onClick={handleClose}
    >
      <div
        className='bg-deep border border-zinc-800 rounded-3xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl relative z-[999999]'
        onClick={(e) => e.stopPropagation()}
      >
        {/* 頂部列 */}
        <div className='p-6 border-b border-zinc-900 flex justify-between items-center bg-zinc-900/20'>
          <div className='flex items-center space-x-3'>
            <h3 className='text-xl font-bold text-white tracking-tight'>
              版本資訊
            </h3>
            <span className='px-2.5 py-0.5 bg-accent text-xs font-black text-white rounded-full uppercase tracking-wider'>
              {CURRENT_VERSION}
            </span>
          </div>
          <button
            onClick={handleClose}
            className='text-zinc-500 hover:text-white transition text-lg px-2 cursor-pointer'
          >
            ✕
          </button>
        </div>

        {/* 內容區 */}
        <div className='flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar'>
          <div className='bg-emerald-950/30 border border-emerald-800/40 rounded-2xl p-4 flex items-start space-x-3'>
            <span className='text-emerald-400 text-lg'>✅</span>
            <div>
              <p className='text-sm font-bold text-emerald-400'>
                當前為最新版本
              </p>
              <p className='text-xs text-zinc-500 mt-0.5'>
                系統核心引擎已同步至 {CURRENT_VERSION}
              </p>
            </div>
          </div>

          <p className='text-xs font-semibold text-zinc-400 uppercase tracking-wider pt-2 flex items-center space-x-2'>
            <span>🔄</span> <span>本地變更日誌</span>
          </p>

          <div className='space-y-3'>
            {CHANGELOGS.map((log, index) => (
              <div
                key={log.version}
                className={`p-4 border rounded-2xl transition duration-300 ${
                  index === 0
                    ? 'bg-zinc-900/50 border-accent/30'
                    : 'bg-zinc-900/10 border-zinc-900'
                }`}
              >
                <div className='flex justify-between items-center'>
                  <span
                    className={`text-sm font-black ${
                      index === 0 ? 'text-accent' : 'text-zinc-300'
                    }`}
                  >
                    {log.version}
                  </span>
                  <span className='text-xs text-zinc-600'>{log.date}</span>
                </div>
                <p className='text-xs text-zinc-400 mt-2 leading-relaxed pl-2 border-l border-zinc-800 whitespace-pre-line'>
                  {log.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
