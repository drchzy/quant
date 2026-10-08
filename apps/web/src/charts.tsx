import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export function DailyChart({ rows }: { rows: any[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const chart = echarts.init(ref.current);

    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis' },
      grid: {
        left: 54,
        right: 20,
        top: 20,
        bottom: 52
      },
      xAxis: {
        type: 'category',
        data: rows.map((row) =>
          String(row.trade_date || '').slice(0, 10)
        )
      },
      yAxis: {
        type: 'value',
        scale: true
      },
      dataZoom: [
        { type: 'inside', start: 55, end: 100 },
        { type: 'slider', start: 55, end: 100 }
      ],
      series: [
        {
          name: '日K',
          type: 'candlestick',
          data: rows.map((row) => [
            Number(row.open),
            Number(row.close),
            Number(row.low),
            Number(row.high)
          ])
        }
      ]
    });

    const resize = () => chart.resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [rows]);

  return <div className="chart" ref={ref} />;
}

export function MinuteChart({ rows }: { rows: any[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const chart = echarts.init(ref.current);

    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis' },
      grid: {
        left: 54,
        right: 20,
        top: 20,
        bottom: 40
      },
      xAxis: {
        type: 'category',
        data: rows.map((row) =>
          String(row.trade_time || row.datetime || row.time || '')
            .replace('T', ' ')
            .slice(5, 16)
        )
      },
      yAxis: {
        type: 'value',
        scale: true
      },
      series: [
        {
          name: '价格',
          type: 'line',
          showSymbol: false,
          data: rows.map((row) =>
            Number(row.close ?? row.price)
          )
        }
      ]
    });

    const resize = () => chart.resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [rows]);

  return <div className="chart" ref={ref} />;
}
