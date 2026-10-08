import cron from 'node-cron';
import { config } from './config.js';
import { syncDailyMarket, syncSectors } from './sync.js';

/**
 * 定时任务只负责收盘后的轻量增量同步。
 * 全市场历史日 K 初始化属于重任务，只允许用户手动启动。
 */
export function startScheduler(): void {
  if (!config.syncEnabled) {
    console.log('定时同步已关闭');
    return;
  }

  cron.schedule(
    config.dailySyncCron,
    async () => {
      console.log('开始执行每日市场同步');
      await syncDailyMarket();
      await syncSectors();
    },
    { timezone: config.timeZone }
  );

  console.log(
    `定时同步已开启：${config.dailySyncCron} (${config.timeZone})`
  );
}
