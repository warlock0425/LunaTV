'use client';

import {
  FastForward,
  Pause,
  Play,
  Rewind,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import React from 'react';

export interface GestureIndicatorProps {
  type: 'seek' | 'volume' | 'brightness' | 'play' | 'pause' | 'speed' | null;
  value: string; // e.g. '+15s', '80%'
  position?: 'left' | 'center' | 'right';
}

export default function GestureIndicator({
  type,
  value,
  position = 'center',
}: GestureIndicatorProps) {
  if (!type) return null;

  let Icon = null;
  if (type === 'seek') {
    Icon = value.startsWith('+') ? FastForward : Rewind;
  } else if (type === 'volume') {
    Icon = value === '0%' ? VolumeX : Volume2;
  } else if (type === 'brightness') {
    Icon = Sun;
  } else if (type === 'play') {
    Icon = Play;
  } else if (type === 'pause') {
    Icon = Pause;
  } else if (type === 'speed') {
    Icon = FastForward;
  }

  let posClass = 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';
  if (position === 'left') {
    posClass = 'top-1/2 left-[20%] -translate-x-1/2 -translate-y-1/2';
  } else if (position === 'right') {
    posClass = 'top-1/2 right-[20%] translate-x-1/2 -translate-y-1/2';
  }

  const isPlayPause = type === 'play' || type === 'pause';

  return (
    <div
      className={`pointer-events-none absolute z-[100] flex flex-col items-center justify-center transition-opacity duration-300 animate-in fade-in zoom-in-75 slide-in-from-bottom-2 ${posClass}`}
    >
      {isPlayPause ? (
        <div className='flex items-center justify-center rounded-full bg-black/40 p-6 text-white shadow-2xl backdrop-blur-md'>
          {Icon && <Icon className='w-12 h-12 fill-current' />}
        </div>
      ) : (
        <div className='flex items-center justify-center gap-3 rounded-full bg-black/50 px-6 py-3 text-white shadow-xl backdrop-blur-md'>
          {Icon && <Icon className='w-6 h-6' />}
          <span className='text-xl font-bold tracking-wider drop-shadow-md'>
            {value}
          </span>
        </div>
      )}
    </div>
  );
}
