// 日時の表示は日本時間に固定する。サーバーは UTC で保持している。
const TZ = "Asia/Tokyo";

export const jstTime = (iso) =>
  new Date(iso).toLocaleTimeString("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const jstDate = (iso) =>
  new Date(iso).toLocaleDateString("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", weekday: "short" });

export const jstHour = (iso) =>
  Number(new Date(iso).toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }));

// 今日から n 日分の日付(YYYY-MM-DD・日本時間)
export function nextDates(n) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const label = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", weekday: "short" });
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push({ value: fmt.format(d), label: label.format(d), isToday: i === 0 });
  }
  return out;
}

// 24時間営業のため1日48枠ある。そのまま並べるとスマホでは長すぎるので
// 時間帯で畳んで表示する。
export const BANDS = [
  { key: "early", label: "早朝", range: "00:00 - 05:30", from: 0, to: 6 },
  { key: "am", label: "午前", range: "06:00 - 11:30", from: 6, to: 12 },
  { key: "pm", label: "午後", range: "12:00 - 17:30", from: 12, to: 18 },
  { key: "night", label: "夜間", range: "18:00 - 23:30", from: 18, to: 24 },
];

export function bandOfNow() {
  const h = jstHour(new Date().toISOString());
  return BANDS.find((b) => h >= b.from && h < b.to)?.key || "am";
}
