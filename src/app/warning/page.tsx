import { Metadata } from 'next';

import { CURRENT_VERSION } from '@/lib/version';

export const metadata: Metadata = {
  title: '安全警告 - LunaTV',
  description: '站點安全設定警告',
};

export default async function WarningPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const isWeak = reason === 'weak';

  return (
    <div className='min-h-screen bg-surface-page flex flex-col'>
      <div className='flex-1 flex items-center justify-center p-4'>
        <div className='max-w-2xl w-full bg-surface-panel/90 rounded-2xl shadow-2xl p-6 sm:p-8 border border-accent/30 backdrop-blur-md'>
          <div className='flex justify-center mb-6 sm:mb-8'>
            <div className='w-16 h-16 sm:w-20 sm:h-20 bg-accent/10 rounded-full flex items-center justify-center border border-accent/30'>
              <svg
                className='w-10 h-10 sm:w-12 sm:h-12 text-accent'
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
            </div>
          </div>

          <div className='text-center mb-6 sm:mb-8'>
            <h1 className='text-2xl sm:text-3xl font-bold text-white mb-2'>
              安全合規設定警告
            </h1>
            <div className='w-12 sm:w-16 h-1 bg-accent mx-auto rounded-full' />
          </div>

          <div className='space-y-4 sm:space-y-6'>
            <div className='bg-accent/5 border-l-4 border-accent p-3 sm:p-4 rounded-r-lg'>
              <p className='text-base sm:text-lg font-semibold text-accent mb-2'>
                ⚠️ 安全風險提示
              </p>
              <p className='text-sm sm:text-base text-zinc-300'>
                {isWeak
                  ? '檢測到您的站點使用常見弱密碼，幾乎等於沒有存取控制。'
                  : '檢測到您的站點未設定存取控制，存在潛在的安全風險和法律合規問題。'}
              </p>
            </div>

            <div className='space-y-3 sm:space-y-4'>
              <h2 className='text-lg sm:text-xl font-semibold text-white'>
                主要風險
              </h2>
              <ul className='space-y-2 sm:space-y-3 text-sm sm:text-base text-zinc-400'>
                <li className='flex items-start'>
                  <span className='text-accent mr-2 mt-0.5'>•</span>
                  <span>未經授權的存取可能導致內容被惡意傳播</span>
                </li>
                <li className='flex items-start'>
                  <span className='text-accent mr-2 mt-0.5'>•</span>
                  <span>伺服器資源可能被濫用，影響正常服務</span>
                </li>
                <li className='flex items-start'>
                  <span className='text-accent mr-2 mt-0.5'>•</span>
                  <span>可能收到相關權利方的法律通知</span>
                </li>
                <li className='flex items-start'>
                  <span className='text-accent mr-2 mt-0.5'>•</span>
                  <span>服務提供商可能因合規問題終止服務</span>
                </li>
              </ul>
            </div>

            <div className='bg-accent/5 border border-accent/20 rounded-lg p-3 sm:p-4'>
              <h3 className='text-base sm:text-lg font-semibold text-accent mb-2'>
                🔒 安全設定建議
              </h3>
              <p className='text-sm sm:text-base text-zinc-300'>
                {isWeak ? (
                  <>
                    請把環境變數{' '}
                    <code className='bg-surface-panel px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono text-accent border border-accent/20'>
                      PASSWORD
                    </code>{' '}
                    改成足夠長、且不是 admin／123456
                    這類常見口令，然後重啟容器。
                  </>
                ) : (
                  <>
                    請立即設定{' '}
                    <code className='bg-surface-panel px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono text-accent border border-accent/20'>
                      PASSWORD
                    </code>{' '}
                    環境變數以啟用存取控制。
                  </>
                )}
              </p>
            </div>
          </div>

          <div className='mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-zinc-800'>
            <div className='text-center text-xs sm:text-sm text-zinc-500'>
              <p>
                LunaTV v{CURRENT_VERSION} ·
                為確保系統安全性和合規性，請及時完成安全設定
              </p>
            </div>
          </div>
        </div>
      </div>

      <footer className='py-4 text-center text-xs text-zinc-600 border-t border-zinc-800'>
        LunaTV v{CURRENT_VERSION}
      </footer>
    </div>
  );
}
