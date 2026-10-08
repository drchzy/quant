import cron from 'node-cron';
import { config } from './config.js';
import { runSelect } from './select.js';

/**
 * 默认工作日16:40执行。
 * market-data 默认16:10同步，预留30分钟避免数据尚未完成。
 */
export function startScheduler(): void {
  if (!config.autoSelectEnabled) {
    console.log('自动选股已关闭');
    return;
  }

  cron.schedule(
    config.selectCron,
    async () => {
      try {
        const result = await runSelect();
        console.log(
          `自动选股完成：${result.tradeDate}，候选 ${result.count} 只`
        );
      } catch (error) {
        console.error('自动选股失败', error);
      }
    },
    { timezone: config.timeZone }
  );

  console.log(
    `自动选股已开启：${config.selectCron} (${config.timeZone})`
  );
}
