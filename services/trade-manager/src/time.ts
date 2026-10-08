import { config } from './config.js';

interface MarketClock {
  date: string;
  hour: number;
  minute: number;
  weekday: string;
}

export function getMarketClock(date = new Date()): MarketClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || '';

  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    weekday: value('weekday')
  };
}

export function isTradingSession(date = new Date()): boolean {
  const clock = getMarketClock(date);
  const minutes = clock.hour * 60 + clock.minute;

  const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;

  return morning || afternoon;
}

export function isLateSession(date = new Date()): boolean {
  const clock = getMarketClock(date);
  const minutes = clock.hour * 60 + clock.minute;
  return minutes >= 14 * 60 + 45 && minutes <= 15 * 60;
}

export function isAfterCloseWindow(date = new Date()): boolean {
  const clock = getMarketClock(date);
  const minutes = clock.hour * 60 + clock.minute;
  return minutes >= 15 * 60 + 1 && minutes <= 15 * 60 + 30;
}

export function localMarketTime(): string {
  const clock = getMarketClock();
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  return `${clock.date} ${hh}:${mm}`;
}
