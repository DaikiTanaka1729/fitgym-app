import React, { useMemo, useState } from "react";
import { T, font, radius } from "../theme/tokens";
import useNarrow from "./useNarrow";

// カレンダーで日付を選ぶ
// ------------------------------------------------------------
// プルダウンで日付を選ぶ形だと、2ヶ月先の予定を入れるときに
// 延々とスクロールすることになる。月を送って目で探せるようにする。
//
// 日付は "YYYY-MM-DD" の文字列で扱う。Date に入れると
// 実行環境のタイムゾーンで1日ずれることがあるため、
// 計算は年月日の数値のまま(UTC 基準)で行う。
// ------------------------------------------------------------

const TZ = "Asia/Tokyo";
const ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// 日本時間の今日
export const todayISO = () => ISO.format(new Date());

// "YYYY-MM-DD" を n 日ずらす
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// 月初( n ヶ月ずらす )
function monthStart(iso, n = 0) {
  const [y, m] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 10);
}

// 曜日(0=日)。ローカル時間に寄らないよう UTC で見る。
function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// その月のマスを作る。月初の週の日曜から、月末の週の土曜まで。
function gridOf(monthIso) {
  const [y, m] = monthIso.split("-").map(Number);
  const first = `${monthIso.slice(0, 8)}01`;
  const lead = weekdayOf(first);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + last) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const iso = addDays(first, i - lead);
    cells.push({ iso, inMonth: iso.slice(0, 7) === monthIso.slice(0, 7), day: Number(iso.slice(8)) });
  }
  return cells;
}

const monthLabel = (iso) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月`;
export const dayLabel = (iso) =>
  `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}(${"日月火水木金土"[weekdayOf(iso)]})`;

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export default function MonthCalendar({
  mode = "single", // "single" | "range" | "multi"
  value, // single: "YYYY-MM-DD" / range: {from,to} / multi: ["YYYY-MM-DD"]
  onChange,
  min, // これより前は選べない
  max, // これより後は選べない
  marks, // { "YYYY-MM-DD": { closed, dot, title } }
  months, // 並べて出す月数。既定は広い画面で2、狭い画面で1。
  monthsAhead = 15, // 何ヶ月先まで送れるか
}) {
  const narrow = useNarrow(560);
  const shown = months || (narrow ? 1 : 2);

  const anchor =
    mode === "range" ? value?.from : mode === "multi" ? value?.[0] : value;
  const [cursor, setCursor] = useState(() => monthStart(anchor || todayISO()));

  const limitFrom = monthStart(min || todayISO());
  const limitTo = monthStart(max || todayISO(), monthsAhead);

  const canPrev = cursor > limitFrom;
  const canNext = monthStart(cursor, shown) <= limitTo;

  const selected = useMemo(() => {
    if (mode === "multi") return new Set(value || []);
    return null;
  }, [mode, value]);

  function pick(iso) {
    if (mode === "single") {
      onChange?.(iso);
      return;
    }
    if (mode === "multi") {
      const next = new Set(value || []);
      next.has(iso) ? next.delete(iso) : next.add(iso);
      onChange?.([...next].sort());
      return;
    }
    // range: 1回目で開始、2回目で終了。開始より前を押したら選び直し。
    const { from, to } = value || {};
    if (!from || to || iso < from) onChange?.({ from: iso, to: null });
    else onChange?.({ from, to: iso });
  }

  function stateOf(iso) {
    if (mode === "single") return value === iso ? "edge" : null;
    if (mode === "multi") return selected.has(iso) ? "edge" : null;
    const { from, to } = value || {};
    if (!from) return null;
    if (iso === from || iso === to) return "edge";
    if (to && iso > from && iso < to) return "mid";
    return null;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Nav dir="prev" disabled={!canPrev} onClick={() => setCursor(monthStart(cursor, -1))} />
        <div style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>
          {Array.from({ length: shown }, (_, i) => monthLabel(monthStart(cursor, i))).join(" / ")}
        </div>
        <Nav dir="next" disabled={!canNext} onClick={() => setCursor(monthStart(cursor, 1))} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {Array.from({ length: shown }, (_, i) => {
          const m = monthStart(cursor, i);
          return (
            <div key={m} style={{ flex: "1 1 240px", minWidth: 220 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 3 }}>
                {WEEK.map((w, wi) => (
                  <div
                    key={w}
                    style={{
                      textAlign: "center",
                      fontSize: 10.5,
                      fontWeight: 500,
                      paddingBottom: 3,
                      color: wi === 0 ? T.danger : wi === 6 ? T.accent : T.textMute,
                    }}
                  >
                    {w}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
                {gridOf(m).map((c) => (
                  <Cell
                    key={c.iso}
                    cell={c}
                    state={stateOf(c.iso)}
                    mark={marks?.[c.iso]}
                    today={c.iso === todayISO()}
                    disabled={
                      !c.inMonth || (min && c.iso < min) || (max && c.iso > max)
                    }
                    onClick={() => pick(c.iso)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Cell({ cell, state, mark, today, disabled, onClick }) {
  const wd = weekdayOf(cell.iso);
  const base = disabled
    ? { bg: "transparent", fg: T.textFaint, bd: "transparent" }
    : mark?.closed
    ? { bg: T.grayDark, fg: T.onDark, bd: T.grayDark }
    : { bg: T.bg, fg: wd === 0 ? T.danger : wd === 6 ? T.accent : T.text, bd: T.borderFaint };

  // 休館日は選択範囲に入っても濃いグレーのままにする。
  // 「その日も含めて操作しようとしている」ことは枠線で示す。
  const skin =
    state && mark?.closed && !disabled
      ? { bg: T.grayDark, fg: T.onDark, bd: T.navy }
      : state === "edge"
      ? { bg: T.navy, fg: T.onDark, bd: T.navy }
      : state === "mid"
      ? { bg: T.navySoft, fg: T.navy, bd: T.navySoft }
      : base;

  // 月外のマスは番号を出さないので、今日の枠線も付けない。
  const outlineToday = today && state == null && cell.inMonth;

  return (
    <button
      type="button"
      disabled={disabled}
      title={mark?.title || ""}
      onClick={onClick}
      style={{
        height: 38,
        border: `1px solid ${outlineToday ? T.navy : skin.bd}`,
        background: skin.bg,
        color: skin.fg,
        borderRadius: radius.md,
        fontSize: 12.5,
        fontFamily: font,
        fontWeight: state === "edge" || outlineToday ? 600 : 400,
        cursor: disabled ? "default" : "pointer",
        padding: 0,
        position: "relative",
        lineHeight: 1,
      }}
    >
      {cell.inMonth ? cell.day : ""}
      {mark?.dot && !disabled && (
        <span
          style={{
            position: "absolute",
            bottom: 4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: state ? T.onDark : T.primary,
          }}
        />
      )}
    </button>
  );
}

function Nav({ dir, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={dir === "prev" ? "前の月" : "次の月"}
      style={{
        width: 30,
        height: 28,
        border: `1px solid ${T.fieldBorder}`,
        background: T.bg,
        borderRadius: radius.md,
        color: disabled ? T.textFaint : T.navy,
        fontSize: 12,
        fontFamily: font,
        cursor: disabled ? "default" : "pointer",
        padding: 0,
      }}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}
