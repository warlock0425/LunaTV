import { ChevronDown, ChevronUp } from 'lucide-react';
import React from 'react';

export interface CollapsibleTabProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const CollapsibleTab = ({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleTabProps) => {
  return (
    <div className='rounded-xl shadow-sm mb-4 overflow-hidden bg-white/80 backdrop-blur-md dark:bg-zinc-800/50 dark:ring-1 dark:ring-zinc-700'>
      <button
        onClick={onToggle}
        className='w-full px-6 py-4 flex items-center justify-between bg-zinc-50/70 dark:bg-zinc-800/60 hover:bg-zinc-100/80 dark:hover:bg-zinc-700/60 transition-colors'
      >
        <div className='flex items-center gap-3'>
          {icon}
          <h3 className='text-lg font-medium text-zinc-900 dark:text-zinc-100'>
            {title}
          </h3>
        </div>
        <div className='text-zinc-500 dark:text-zinc-400'>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {isExpanded && <div className='px-6 py-4'>{children}</div>}
    </div>
  );
};
