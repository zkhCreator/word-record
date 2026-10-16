const DAY = 86_400_000;

export function dayBucket(ts: number, now = Date.now()) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return '今天';
  if (ts >= startOfToday - DAY) return '昨天';
  if (ts >= startOfToday - 6 * DAY) return '本周';
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

export function shortDate(ts: number) {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}`;
}

export function hostname(url: string | null) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function formatInterval(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(min, 1)} 分钟`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天`;
  return `${Math.round(days / 30)} 个月`;
}

/** "18:30", "明天 09:00" or "3 天后" for an upcoming timestamp. */
export function formatDue(ts: number, now = Date.now()) {
  if (ts <= now) return '现在';
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((ts - startOfToday) / DAY);
  if (dayDiff === 0) return `今天 ${hm}`;
  if (dayDiff === 1) return `明天 ${hm}`;
  return `${dayDiff} 天后`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function dayLabel(ts: number, index: number) {
  if (index === 0) return '今天';
  if (index === 1) return '明天';
  return WEEKDAYS[new Date(ts).getDay()];
}
