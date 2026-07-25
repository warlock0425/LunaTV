'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import {
  type FavoriteTag,
  getAllItemTags,
  getFavoriteTags,
  saveFavoriteTags,
} from '@/lib/favorite-tags.client';

export function TagManagerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<FavoriteTag[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('red');
  // 開啟時載入最新標籤（render 期調整狀態）
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setTags(getFavoriteTags());
  }

  const handleAdd = () => {
    const name = newName.trim();
    if (!name || tags.some((t) => t.name === name)) return;
    const updated = [...tags, { name, color: TAG_COLORS[newColor] }];
    saveFavoriteTags(updated);
    setTags(updated);
    setNewName('');
  };

  const handleDelete = (index: number) => {
    const deleted = tags[index];
    const updated = tags.filter((_, i) => i !== index);
    saveFavoriteTags(updated);
    setTags(updated);
    const allItems = getAllItemTags();
    for (const key of Object.keys(allItems)) {
      allItems[key] = allItems[key].filter((t) => t !== deleted.name);
    }
    // Legacy key kept for compatibility with existing localStorage data.
    localStorage.setItem(
      'moontv_favorite_tags_items',
      JSON.stringify(allItems)
    );
  };

  if (!open) return null;

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        className='bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex items-center justify-between mb-6'>
          <h3 className='text-lg font-bold text-zinc-900 dark:text-white'>
            管理標籤
          </h3>
          <button
            onClick={onClose}
            className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        <div className='space-y-3'>
          {tags.map((tag, i) => (
            <div
              key={tag.name}
              className='flex items-center gap-3 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl'
            >
              <span
                className='w-3 h-3 rounded-full flex-shrink-0'
                style={{ backgroundColor: tag.color }}
              />
              <span className='flex-1 text-sm font-medium text-zinc-900 dark:text-white'>
                {tag.name}
              </span>
              <button
                onClick={() => handleDelete(i)}
                className='text-zinc-400 hover:text-red-500 transition-colors'
              >
                <Trash2 className='w-4 h-4' />
              </button>
            </div>
          ))}
        </div>

        <div className='flex items-center gap-2 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800'>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder='新增標籤名稱...'
            className='flex-1 px-3 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl outline-none focus:ring-2 focus:ring-accent/50 text-zinc-900 dark:text-white placeholder-zinc-400'
          />
          <select
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className='px-2 py-2 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-xl outline-none text-zinc-900 dark:text-white'
          >
            {Object.entries(TAG_COLORS).map(([name, color]) => (
              <option
                key={name}
                value={name}
                style={{ backgroundColor: color }}
              >
                {name}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            className='px-3 py-2 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent-deep transition-colors'
          >
            <Plus className='w-4 h-4' />
          </button>
        </div>
      </div>
    </div>
  );
}

export const TAG_COLORS: Record<string, string> = {
  red: '#ff3e6c',
  accent: '#ff3e6c',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
};
