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
//
// メニューは「ご利用中(購入済み)」と「未購入」に分けて出す。
// 未購入のメニューも予約はできるが、来店時に店舗でのお支払いが必要になる。
// その旨を選ぶ前・確定前の両方で伝える。
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
  const [showOthers, setShowOthers] = useState(false);

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
    const { error } = await reservationApi.create({
      menuId: menu.id,
      startAt,
      allowUnpurchased: !menu.bookable,
    });
    setBooking(null);
    if (error) {
      setBanner(error);
      // 満席だった場合は最新の空き状況に取り直す
      const { data } = await reservationApi.listAvailableTimes({ date, menuId: menu.id });
      setTimes(data || []);
      return;
    }
    navigate("/reserve/done", { state: { menu, startAt, needsPurchase: !menu.bookable } });
  }

  // ---- ステップ1:メニュー選択 ----
  if (step === 1) {
    const owned = menus?.filter((m) => m.bookable) || [];
    const others = menus?.filter((m) => !m.bookable) || [];

    const pick = (m) => {
      setMenu(m);
      setStep(2);
    };

    return (
      <MemberLayout title="予約" sub="メニューを選んでください" onBack={() => navigate("/home")}>
        {banner && <Banner>{banner}</Banner>}
        {menus === null && (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
            <Spinner color={T.textFaint} size={20} />
          </div>
        )}

        {menus && owned.length === 0 && (
          <div
            style={{
              border: `1px dashed ${T.fieldBorder}`,
              borderRadius: radius.lg,
              padding: "22px 16px",
              textAlign: "center",
              background: T.bgSubtle,
              color: T.textFaint,
              fontSize: 12,
              lineHeight: 1.8,
              marginBottom: 14,
            }}
          >
            ご利用中のメニューはまだありません。
            <br />
            下の「未購入のメニュー」からも予約できます。
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {owned.map((m) => (
            <MenuCard key={m.id} menu={m} onClick={() => pick(m)} />
          ))}
        </div>

        {others.length > 0 && (
          <div style={{ marginTop: owned.length > 0 ? 22 : 0 }}>
            <div
              onClick={() => setShowOthers(!showOthers)}
              role="button"
              tabIndex={0}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                border: `1px solid ${T.fieldBorder}`,
                borderRadius: radius.lg,
                background: T.bgSubtle,
                padding: "11px 13px",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>未購入のメニュー</span>
              <span style={{ fontSize: 11, color: T.textMute }}>
                {others.length}件 {showOthers ? "▲" : "▼"}
              </span>
            </div>

            {showOthers && (
              <>
                <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.8, margin: "10px 2px 10px" }}>
                  こちらからも予約できます。料金のお支払いは、ご来店時に店舗で承ります。
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {others.map((m) => (
                    <MenuCard key={m.id} menu={m} onClick={() => pick(m)} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </MemberLayout>
    );
  }

  // ---- ステップ2:日付と時刻の選択 ----
  const now = new Date();
  const isToday = date === dates[0].value;

  return (
    <MemberLayout title="予約" sub={menu.name} onBack={() => setStep(1)}>
      {banner && <Banner>{banner}</Banner>}

      {!menu.bookable && (
        <div
          style={{
            border: `1px solid ${T.amberDark}33`,
            background: T.amberSoft,
            borderRadius: radius.lg,
            padding: "11px 13px",
            fontSize: 11.5,
            lineHeight: 1.8,
            color: T.text,
            marginBottom: 16,
          }}
        >
          このメニューはまだご購入いただいていません。
          <br />
          時間を選ぶと予約が入りますが、料金のお支払いはご来店時に店舗で承ります。
        </div>
      )}

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

// メニュー1件の見た目。購入済みと未購入で色だけ変える。
// 未購入でも押せる(押すと未購入のまま予約に進む)。
function MenuCard({ menu, onClick }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      style={{
        border: `1px solid ${menu.bookable ? T.border : T.fieldBorder}`,
        borderRadius: radius.lg,
        padding: "13px 14px",
        cursor: "pointer",
        background: menu.bookable ? T.bg : T.bgSubtle,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{menu.name}</div>
        <Badge tone={TONE[menu.billing_type]}>{LABEL[menu.billing_type]}</Badge>
      </div>
      <div style={{ fontSize: 11, color: T.textMute, marginTop: 5 }}>
        {menu.duration_min}分 · ¥{menu.price.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: menu.bookable ? T.primaryDark : T.textMute, marginTop: 3 }}>
        {menu.note}
      </div>
    </div>
  );
}
