/* eslint-disable no-console */

const DEBUG_LOGS_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true';

export const logger = {
  debug: (...args: unknown[]) => {
    if (DEBUG_LOGS_ENABLED) {
      console.log(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (DEBUG_LOGS_ENABLED) {
      console.info(...args);
    }
  },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
