import cron from 'node-cron';
import { config } from './config.js';
import {
  expireTodayPlans,
  refreshTrading,
  syncLatestPlans
} from './trading.js';
import {
  isAfterCloseWindow,
  isTradingSession
} from './time.js';

/**
 * 盘中每分钟检查一次。
 * 节假日虽然cron仍会触发，但东财分时日期不是今天时不会改变计划状态。
 */
export function startScheduler(): void {
  if (!config.monitorEnabled) {
    console.log('盘中监控已关闭');
    return;
  }

  cron.schedule(
    config.monitorCron,
    async () => {
      try {
        if (isTradingSession()) {
          await refreshTrading();
          return;
        }

        if (isAfterCloseWindow()) {
          await expireTodayPlans();
        }
      } catch (error) {
        console.error('盘中监控执行失败', error);
      }
    },
    { timezone: config.timeZone }
  );

  // stock-select默认16:40完成收盘选股，16:45同步明日重点计划。
  cron.schedule(
    config.planSyncCron,
    async () => {
      try {
        const result = await syncLatestPlans();
        console.log(
          `交易计划同步完成：新增 ${result.added} 条`
        );
      } catch (error) {
        console.error('交易计划同步失败', error);
      }
    },
    { timezone: config.timeZone }
  );

  console.log(
    `盘中监控已开启：${config.monitorCron}；计划同步：${config.planSyncCron}`
  );
}
