import { parseCustomTimeFormat } from '@/lib/time';

/**
 * 清洗 EPG 節目單：僅保留今日節目（含跨天）、按開始時間排序、
 * 去除時間重疊的節目（重疊時保留時長較短者）。
 */
export const cleanEpgData = (
  programs: Array<{ start: string; end: string; title: string }>
) => {
  if (!programs || programs.length === 0) return programs;

  // 取得今日日期（只考慮年月日，忽略時間）
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const todayEnd = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1
  );

  // 首先過濾出今日的節目（包括跨天節目）
  const todayPrograms = programs.filter((program) => {
    const programStart = parseCustomTimeFormat(program.start);
    const programEnd = parseCustomTimeFormat(program.end);

    // 取得節目的日期範圍
    const programStartDate = new Date(
      programStart.getFullYear(),
      programStart.getMonth(),
      programStart.getDate()
    );
    const programEndDate = new Date(
      programEnd.getFullYear(),
      programEnd.getMonth(),
      programEnd.getDate()
    );

    // 如果節目的開始時間或結束時間在今天，或者節目跨越今天，都算作今天的節目
    return (
      (programStartDate >= todayStart && programStartDate < todayEnd) || // 開始時間在今天
      (programEndDate >= todayStart && programEndDate < todayEnd) || // 結束時間在今天
      (programStartDate < todayStart && programEndDate >= todayEnd) // 節目跨越今天（跨天節目）
    );
  });

  // 按開始時間排序
  const sortedPrograms = [...todayPrograms].sort((a, b) => {
    const startA = parseCustomTimeFormat(a.start).getTime();
    const startB = parseCustomTimeFormat(b.start).getTime();
    return startA - startB;
  });

  const cleanedPrograms: Array<{
    start: string;
    end: string;
    title: string;
  }> = [];

  for (let i = 0; i < sortedPrograms.length; i++) {
    const currentProgram = sortedPrograms[i];
    const currentStart = parseCustomTimeFormat(currentProgram.start);
    const currentEnd = parseCustomTimeFormat(currentProgram.end);

    // 檢查是否與已新增的節目重疊
    let hasOverlap = false;

    for (const existingProgram of cleanedPrograms) {
      const existingStart = parseCustomTimeFormat(existingProgram.start);
      const existingEnd = parseCustomTimeFormat(existingProgram.end);

      // 檢查時間重疊（考慮完整的日期和時間）
      if (
        (currentStart >= existingStart && currentStart < existingEnd) || // 當前節目開始時間在已存在節目時間段內
        (currentEnd > existingStart && currentEnd <= existingEnd) || // 當前節目結束時間在已存在節目時間段內
        (currentStart <= existingStart && currentEnd >= existingEnd) // 當前節目完全包含已存在節目
      ) {
        hasOverlap = true;
        break;
      }
    }

    // 如果沒有重疊，則新增該節目
    if (!hasOverlap) {
      cleanedPrograms.push(currentProgram);
    } else {
      // 如果有重疊，檢查是否需要替換已存在的節目
      for (let j = 0; j < cleanedPrograms.length; j++) {
        const existingProgram = cleanedPrograms[j];
        const existingStart = parseCustomTimeFormat(existingProgram.start);
        const existingEnd = parseCustomTimeFormat(existingProgram.end);

        // 檢查是否與當前節目重疊（考慮完整的日期和時間）
        if (
          (currentStart >= existingStart && currentStart < existingEnd) ||
          (currentEnd > existingStart && currentEnd <= existingEnd) ||
          (currentStart <= existingStart && currentEnd >= existingEnd)
        ) {
          // 計算節目時長
          const currentDuration = currentEnd.getTime() - currentStart.getTime();
          const existingDuration =
            existingEnd.getTime() - existingStart.getTime();

          // 如果當前節目時間更短，則替換已存在的節目
          if (currentDuration < existingDuration) {
            cleanedPrograms[j] = currentProgram;
          }
          break;
        }
      }
    }
  }

  return cleanedPrograms;
};
