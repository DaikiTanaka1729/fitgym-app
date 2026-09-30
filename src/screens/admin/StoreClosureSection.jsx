import React, { useCallback, useEffect, useState } from "react";
import { T, font, radius } from "../../theme/tokens";
import {
  Banner,
  Button,
  MonthCalendar,
  Segmented,
  Spinner,
  TextField,
  addDays,
  dayLabel,
  todayISO,
} from "../../components";
import { menuApi, shiftApi } from "../../api";
import { useSession } from "../../session";

// 休館日の設定
// ------------------------------------------------------------
// これまで休館は「その日の受付枠を全部クローズする」で表していたが、
// トレーナーごとの操作になるうえ、会員の画面では
// 「空きがない日」と「休館日」の区別が付かなかった。
//
//   定休日   … 曜日で指定(毎週月曜など)
//   臨時休館 … 日付で指定(年末年始・設備点検など)
//   臨時営業 … 定休日だが営業する日(祝日営業など)
//
// 休館にする日に予約が入っている場合、予約は自動で取り消さない。
// 会員に断りなく消すことになるため、件数を出して確認を求める。
// ------------------------------------------------------------

const WEEKDAYS = [
  { value: 0, label: "日" },
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
];

const MODES = [
  { value: "closed", label: "休館にする" },
  { value: "open", label: "営業にする" },
  { value: "clear", label: "指定を消す" },
];

const MODE_HINT = {
  closed: "この期間を休館日にします。会員の予約画面では日付が選べなくなります。",
  open: "定休日でも営業する日にします。祝日営業などに使います。",
  clear: "休館・営業の指定を取り消し、定休日の設定どおりに戻します。",
};

export default function StoreClosureSection({ onFlash }) {
  const { admin } = useSession();
  const isStoreAdmin = admin?.role === "admin";

  const today = todayISO();
  const rangeEnd = addDays(today, 365);

  const [weekdays, setWeekdays] = useState(null); // null = 読み込み中
  const [savedWeekdays, setSavedWeekdays] = useState([]);
  const [closedDays, setClosedDays] = useState(new Set());
  const [closures, setClosures] = useState([]);

  const [range, setRange] = useState({ from: null, to: null });
  const [mode, setMode] = useState("closed");
  const [note, setNote] = useState("");

  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  // 予約が入っている期間を休館にしようとしたときの確認
  const [pending, setPending] = useState(null); // { count }

  const load = useCallback(async () => {
    const [settings, days, list] = await Promise.all([
      menuApi.getStoreSettings(),
      shiftApi.listClosedDays({ from: today, to: rangeEnd }),
      shiftApi.listClosures({ from: today, to: rangeEnd }),
    ]);
    const err = settings.error || days.error || list.error;
    if (err) setBanner(err);
    const wd = (settings.data?.[0]?.closed_weekdays || []).map(Number);
    setWeekdays(wd);
    setSavedWeekdays(wd);
    setClosedDays(new Set((days.data || []).map((d) => d.day)));
    setClosures(list.data || []);
  }, [today, rangeEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const from = range.from;
  const to = range.to || range.from;

  // 休館にする前に、その期間の予約件数を見る
  async function apply(skipCheck = false) {
    setBanner(null);
    if (!from) {
      setBanner("カレンダーから日付を選んでください");
      return;
    }
    if (mode === "closed" && !skipCheck) {
      setBusy(true);
      const { data, error } = await shiftApi.countReservations({ from, to });
      setBusy(false);
      if (error) {
        setBanner(error);
        return;
      }
      const n = Number(data) || 0;
      if (n > 0) {
        setPending({ count: n });
        return;
      }
    }
    setPending(null);
    setBusy(true);
    const { data, error } = await shiftApi.setClosure({
      from,
      to,
      mode,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setBanner(error);
      return;
    }
    const r = data?.[0] || {};
    const span = from === to ? dayLabel(from) : `${dayLabel(from)}〜${dayLabel(to)}`;
    const verb = mode === "clear" ? "指定を消しました" : mode === "open" ? "営業日にしました" : "休館日にしました";
    onFlash?.(
      `${span} を${verb}` +
        (mode === "closed" && r.reservations
          ? `(予約 ${r.reservations} 件は残っています。会員へご連絡ください)`
          : "")
    );
    setRange({ from: null, to: null });
    setNote("");
    load();
  }

  async function saveWeekdays() {
    setBanner(null);
    setBusy(true);
    const { data, error } = await shiftApi.setClosedWeekdays({ weekdays });
    setBusy(false);
    if (error) {
      setBanner(error);
      return;
    }
    setSavedWeekdays(weekdays);
    const n = Number(data) || 0;
    const names = weekdays
      .slice()
      .sort()
      .map((w) => WEEKDAYS[w].label)
      .join("・");
    onFlash?.(
      (names ? `定休日を毎週 ${names} にしました` : "定休日をなしにしました") +
        (n ? `(該当する予約が ${n} 件あります。会員へご連絡ください)` : "")
    );
    load();
  }

  const weekdaysChanged =
    weekdays !== null &&
    JSON.stringify(weekdays.slice().sort()) !== JSON.stringify(savedWeekdays.slice().sort());

  // カレンダーに休館日を塗る。note があれば吹き出しに出す。
  const marks = {};
  closedDays.forEach((d) => {
    marks[d] = { closed: true, title: "休館日" };
  });
  closures.forEach((c) => {
    if (c.is_open) marks[c.closed_on] = { dot: true, title: c.note || "臨時営業" };
    else marks[c.closed_on] = { closed: true, title: c.note || "臨時休館" };
  });

  const upcoming = closures.filter((c) => c.closed_on >= today);
  const withBookings = upcoming.filter((c) => !c.is_open && c.reservations > 0);

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: 16, marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>休館日</div>
      <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.8, marginBottom: 14 }}>
        店舗として休む日を決めます。休館日は会員の予約画面で日付が選べなくなります。
        <br />
        すでに入っている予約は自動で取り消されません。件数をお知らせしますので、会員へご連絡ください。
      </div>

      {banner && <Banner>{banner}</Banner>}

      {/* 予約が入っている期間を休館にしようとしたときの確認 */}
      {pending && (
        <div
          style={{
            border: `1px solid ${T.dangerBorder}`,
            background: T.dangerSoft,
            borderRadius: radius.lg,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.dangerDark, marginBottom: 6 }}>
            この期間に予約が {pending.count} 件入っています
          </div>
          <div style={{ fontSize: 11.5, color: T.text, lineHeight: 1.8, marginBottom: 12 }}>
            {from === to ? dayLabel(from) : `${dayLabel(from)}〜${dayLabel(to)}`} を休館日にしても、
            入っている予約は取り消されません。会員へご連絡のうえ、予約一覧から個別にキャンセルしてください。
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button variant="danger" onClick={() => apply(true)} loading={busy}>
              それでも休館にする
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              やめる
            </Button>
          </div>
        </div>
      )}

      {weekdays === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "22px 0" }}>
          <Spinner color={T.textFaint} size={18} />
        </div>
      ) : (
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          {/* ---- 定休日 ---- */}
          <div style={{ flex: "1 1 260px", minWidth: 240 }}>
            <div style={{ fontSize: 11.5, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>
              定休日(毎週)
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
              {WEEKDAYS.map((w) => {
                const on = weekdays.includes(w.value);
                return (
                  <button
                    key={w.value}
                    type="button"
                    disabled={!isStoreAdmin}
                    onClick={() =>
                      setWeekdays(
                        on ? weekdays.filter((x) => x !== w.value) : [...weekdays, w.value]
                      )
                    }
                    style={{
                      width: 38,
                      height: 32,
                      borderRadius: radius.md,
                      fontSize: 12,
                      fontFamily: font,
                      cursor: isStoreAdmin ? "pointer" : "default",
                      border: `1px solid ${on ? T.grayDark : T.fieldBorder}`,
                      background: on ? T.grayDark : T.bg,
                      color: on ? T.onDark : T.textMute,
                      fontWeight: on ? 500 : 400,
                      opacity: isStoreAdmin ? 1 : 0.5,
                    }}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
            <Button
              variant="navy"
              onClick={saveWeekdays}
              loading={busy}
              disabled={!isStoreAdmin || !weekdaysChanged}
            >
              定休日を保存
            </Button>
            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.8, marginTop: 8 }}>
              未選択なら定休日なしです。定休日でも営業する日は、右のカレンダーで「営業にする」を選んでください。
            </div>

            {/* ---- 予約が残っている休館日 ---- */}
            {withBookings.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  border: `1px solid ${T.dangerBorder}`,
                  background: T.dangerSoft,
                  borderRadius: radius.md,
                  padding: 11,
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 600, color: T.dangerDark, marginBottom: 5 }}>
                  休館日に予約が残っています
                </div>
                <div style={{ fontSize: 11.5, color: T.text, lineHeight: 1.9 }}>
                  {withBookings.map((c) => (
                    <div key={c.closed_on}>
                      {dayLabel(c.closed_on)} … {c.reservations} 件
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ---- 日付を選ぶ ---- */}
          <div style={{ flex: "2 1 380px", minWidth: 280 }}>
            <div style={{ fontSize: 11.5, color: T.textMute, fontWeight: 500, marginBottom: 8 }}>
              日付で指定(クリックで開始、もう一度クリックで終了)
            </div>
            <MonthCalendar
              mode="range"
              value={range}
              onChange={(v) => {
                setRange(v);
                setPending(null);
              }}
              min={today}
              max={rangeEnd}
              marks={marks}
            />

            <div style={{ marginTop: 12, maxWidth: 420 }}>
              <Segmented value={mode} onChange={setMode} options={MODES} />
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
              {mode !== "clear" && (
                <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                  <TextField
                    label="理由(任意)"
                    value={note}
                    onChange={setNote}
                    placeholder="年末年始休業 など"
                  />
                </div>
              )}
              <Button
                variant={mode === "closed" ? "danger" : "navy"}
                onClick={() => apply(false)}
                loading={busy}
                disabled={!isStoreAdmin || !from}
              >
                {from
                  ? `${from === to ? dayLabel(from) : `${dayLabel(from)}〜${dayLabel(to)}`} を${
                      MODES.find((m) => m.value === mode).label
                    }`
                  : "日付を選んでください"}
              </Button>
            </div>

            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.8, marginTop: 8 }}>
              {MODE_HINT[mode]}
              {!isStoreAdmin && " 変更できるのは店舗管理者のみです。"}
            </div>

            {/* ---- 登録済みの指定 ---- */}
            {upcoming.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>
                  登録済みの指定
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {upcoming.map((c) => (
                    <span
                      key={c.closed_on}
                      title={c.note || ""}
                      style={{
                        fontSize: 11,
                        padding: "4px 9px",
                        borderRadius: radius.sm,
                        border: `1px solid ${c.is_open ? T.primaryBorder : T.border}`,
                        background: c.is_open ? T.primarySoft : T.graySoft,
                        color: c.is_open ? T.primaryDark : T.grayDark,
                      }}
                    >
                      {dayLabel(c.closed_on)} {c.is_open ? "営業" : "休館"}
                      {c.note ? `・${c.note}` : ""}
                      {!c.is_open && c.reservations > 0 ? `・予約${c.reservations}件` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
