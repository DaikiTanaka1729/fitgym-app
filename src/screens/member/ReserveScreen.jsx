import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Button, Banner, Badge, Spinner } from "../../components";
import { menuApi, reservationApi } from "../../api";
import MemberLayout from "./MemberLayout";
import { BANDS, bandOfNow, jstHour, jstTime, nextDates } from "./format";

const TONE = { time: "primary", unlimited: "accent", ticket: "amber" };
const LABEL = { time: "時間課金", unlimited: "通い放題", ticket: "回数券" };

// M-04 予約
// メニューを選ぶ → 日付を選ぶ → 30分刻みの時刻を選ぶ、の3段階。
// トレーナーはサーバー側で自動割当するため、会員には見せない。
export default function ReserveScreen() {
  const navigate = useNavigate();
  const dates = nextDates(14);

  const [step, setStep] = useState(1);
  const [menus, setMenus] = useState(null);
  const [menu, setMenu] = useState(null);
  const [date, setDate] = useState(dates[0].value);
  const [times, setTimes] = useState(null);
  const [openBand, setOpenBand] = useState(bandOfNow());
  const [banner, setBanner] = useState(null);
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    menuApi.listMine().then(({ data, error }) => {
      if (error) setBanner(error);
      setMenus(data || []);
    });
  }, []);

  useEffect(() => {
    if (!menu) return;
    setTimes(null);
    reservationApi.listAvailableTimes({ date, menuId: menu.id }).then(({ data, error }) => {
      if (error) setBanner(error);
      setTimes(data || []);
    });
  }, [menu, date]);

  async function book(startAt) {
    setBanner(null);
    setBooking(startAt);
    const { error } = await reservationApi.create({ menuId: menu.id, startAt });
    setBooking(null);
    if (error) {
      setBanner(error);
      // 満席だった場合は最新の空き状況に取り直す
      const { data } = await reservationApi.listAvailableTimes({ date, menuId: menu.id });
      setTimes(data || []);
      return;
    }
    navigate("/reserve/done", { state: { menu, startAt } });
  }

  // ---- ステップ1:メニュー選択 ----
  if (step === 1) {
    return (
      <MemberLayout title="予約" sub="メニューを選んでください" onBack={() => navigate("/home")}>
        {banner && <Banner>{banner}</Banner>}
        {menus === null && (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
            <Spinner color={T.textFaint} size={20} />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {menus?.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                if (!m.bookable) return;
                setMenu(m);
                setStep(2);
              }}
              role="button"
              tabIndex={m.bookable ? 0 : -1}
              style={{
                border: `1px solid ${m.bookable ? T.border : T.line || T.fieldBorder}`,
                borderRadius: radius.lg,
                padding: "13px 14px",
                cursor: m.bookable ? "pointer" : "default",
                opacity: m.bookable ? 1 : 0.55,
                background: m.bookable ? T.bg : T.bgSubtle,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                <Badge tone={TONE[m.billing_type]}>{LABEL[m.billing_type]}</Badge>
              </div>
              <div style={{ fontSize: 11, color: T.textMute, marginTop: 5 }}>
                {m.duration_min}分 · ¥{m.price.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: m.bookable ? T.primaryDark : T.danger, marginTop: 3 }}>
                {m.note}
              </div>
            </div>
          ))}
        </div>
      </MemberLayout>
    );
  }

  // ---- ステップ2:日付と時刻の選択 ----
  const now = new Date();
  const isToday = date === dates[0].value;

  return (
    <MemberLayout title="予約" sub={menu.name} onBack={() => setStep(1)}>
      {banner && <Banner>{banner}</Banner>}

      <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>日付</div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 16 }}>
        {dates.map((d) => {
          const on = d.value === date;
          return (
            <div
              key={d.value}
              onClick={() => setDate(d.value)}
              role="button"
              tabIndex={0}
              style={{
                flex: "0 0 auto",
                border: `1px solid ${on ? T.primary : T.fieldBorder}`,
                background: on ? T.primarySoft : T.bg,
                color: on ? T.primaryDark : T.textMute,
                fontWeight: on ? 500 : 400,
                borderRadius: radius.md,
                padding: "7px 11px",
                fontSize: 11.5,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {d.isToday ? "今日" : d.label}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>
        時間({menu.duration_min}分)
      </div>

      {times === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {times?.length === 0 && (
        <div
          style={{
            border: `1px dashed ${T.fieldBorder}`,
            borderRadius: radius.lg,
            padding: "24px 16px",
            textAlign: "center",
            background: T.bgSubtle,
            color: T.textFaint,
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          この日に空いている時間はありません。
          <br />
          別の日をお選びください。
        </div>
      )}

      {times && times.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {BANDS.map((b) => {
            const inBand = times.filter((t) => {
              const h = jstHour(t.start_at);
              return h >= b.from && h < b.to;
            });
            if (inBand.length === 0) return null;
            const open = openBand === b.key;
            return (
              <div key={b.key} style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
                <div
                  onClick={() => setOpenBand(open ? null : b.key)}
                  role="button"
                  tabIndex={0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 13px",
                    background: open ? T.primarySoft : T.bgSubtle,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: open ? T.primaryDark : T.text }}>
                    {b.label}
                    <span style={{ fontSize: 10.5, color: T.textFaint, marginLeft: 8, fontWeight: 400 }}>
                      {b.range}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: T.textMute }}>
                    {inBand.length}枠 {open ? "▲" : "▼"}
                  </span>
                </div>

                {open && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
                      gap: 6,
                      padding: 10,
                    }}
                  >
                    {inBand.map((t) => {
                      const past = isToday && new Date(t.start_at) <= now;
                      const disabled = past || t.mine || t.available < 1;
                      return (
                        <button
                          key={t.start_at}
                          disabled={disabled || booking !== null}
                          onClick={() => book(t.start_at)}
                          style={{
                            border: `1px solid ${disabled ? T.fieldBorder : T.primary}`,
                            background: disabled ? T.field : T.bg,
                            color: disabled ? T.textFaint : T.primaryDark,
                            borderRadius: radius.md,
                            padding: "8px 4px",
                            fontSize: 12,
                            fontFamily: font,
                            fontWeight: 500,
                            cursor: disabled ? "default" : "pointer",
                            lineHeight: 1.35,
                          }}
                        >
                          {jstTime(t.start_at)}
                          <div style={{ fontSize: 9.5, fontWeight: 400, color: T.textFaint }}>
                            {t.mine ? "予約済" : past ? "—" : `空き${t.available}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {booking && (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
          <Spinner color={T.primary} size={14} />
          <span style={{ fontSize: 11.5, color: T.textMute }}>予約しています…</span>
        </div>
      )}
    </MemberLayout>
  );
}
