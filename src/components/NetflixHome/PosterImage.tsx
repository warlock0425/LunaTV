'use client';

import Image from 'next/image';
import { useState } from 'react';

import { getProxiedImageUrl, processImageUrl } from '@/lib/utils';

export function PosterImage({
  src,
  title,
  className = 'object-cover transition-transform duration-300 group-hover:scale-[1.03]',
  onImageError,
}: {
  src?: string;
  title: string;
  className?: string;
  onImageError?: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [retryWithProxy, setRetryWithProxy] = useState(false);
  // 直連優先（觀眾 IP 通常暢通），失敗才退回伺服器代理
  const directUrl = processImageUrl(src || '');
  const proxiedUrl = src ? getProxiedImageUrl(src) : '';
  const imageUrl = retryWithProxy && proxiedUrl ? proxiedUrl : directUrl;

  // src 變化時重置錯誤/重試狀態（render 期調整狀態）
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setImgError(false);
    setRetryWithProxy(false);
  }

  if (!imageUrl || imgError) {
    return (
      <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-poster-fallback px-3 text-center'>
        <span className='line-clamp-4 text-sm font-semibold leading-relaxed text-zinc-200'>
          {title}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={imageUrl}
      alt={title}
      fill
      className={className}
      unoptimized
      referrerPolicy='no-referrer'
      onLoad={(e) => {
        // 檢查圖片原始尺寸，防盜鏈通常回傳 1x1 或非常小的佔位黑圖 (200 OK)
        const { naturalWidth, naturalHeight } = e.currentTarget;
        if (naturalWidth > 0 && naturalWidth <= 10 && naturalHeight <= 10) {
          if (!retryWithProxy && proxiedUrl && proxiedUrl !== directUrl) {
            setRetryWithProxy(true);
          } else {
            setImgError(true);
            onImageError?.();
          }
        }
      }}
      onError={() => {
        if (!retryWithProxy && proxiedUrl && proxiedUrl !== directUrl) {
          // 直連失敗（防盜鏈／地區封鎖），改走伺服器代理
          setRetryWithProxy(true);
        } else {
          setImgError(true);
          onImageError?.();
        }
      }}
    />
  );
}
