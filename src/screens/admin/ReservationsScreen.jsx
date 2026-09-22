import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner, Toast } from "../../components";
import { downloadCsv, reservationApi, shiftApi, toCsv } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";
import { APP_SLUG } from "../../appConfig";
import { nextDates } from "../member/format";

// membership は 0005 より前に入った予約の値。表示だけ拾えるようにしておく。
const SOURCE = { time: "時間課金", unlimited: "通い放題", membership: "通い放題", ticket: "回数券" };
const TONE = { time: "primary", unlimited: "accent", membership: "accent", ticket: "amber" };
const STATUS = { booked: "予約済", done: "完了", cancelled: "キャンセル" };

const jtime = (v) =>
  new Date(v).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

// A-05 予約状況の確認
export default function ReservationsScreen() {
  const navigate = useNavigate();
  const { admin } = useSession();
  const dates = nextDates(14);

  const [date, setDate] = useState(dates[0].value);
  const [rows, setRows] = useState(null);
  const [slots, setSlots] = useState([]);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [settling, setSettling] = useState(null);
  const [moving, setMoving] = useState(null);       // 付け替え中の予約
  const [movable, setMovable] = useState(null);     // 移動先の候補

  const load = useCallback(async () => {
    setRows(null);
    const [r, s] = await Promise.all([
      reservationApi.listDay({ date }),
      shiftApi.listDay({ date }),
    ]);
    if (r.error) setBanner(r.error);
    setRows(r.data || []);
    setSlots(s.data || []);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(m) {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  }

  async function cancel(id) {
    setBanner(null);
    setCancelling(id);
    const { error } = await reservationApi.cancel({ reservationId: id });
    setCancelling(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash("予約をキャンセルしました");
    load();
  }

  // 未購入のまま入った予約を、店舗での購入として処理する。
  // 回数券なら1回消費し、時間課金なら購入登録を作る。
  async function settle(id) {
    setBanner(null);
    setSettling(id);
    const { error } = await reservationApi.settlePurchase({ reservationId: id });
    setSettling(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash("店舗での購入として処理しました");
    load();
  }

  // 担当トレーナーの付け替え。指名された予約は対象外(サーバー側でも拒否される)。
  async function openMove(r) {
    setBanner(null);
    setMoving(r.id);
    setMovable(null);
    const { data, error } = await reservationApi.listAvailableTrainers({
      startAt: r.start_at,
      menuId: r.menu_id,
    });
    if (error) {
      setBanner(error);
      setMoving(null);
      return;
    }
    // いま担当している本人は候補から外す
    setMovable((data || []).filter((t) => t.staff_id !== r.staff_id));
  }

  async function move(reservationId, staffId) {
    setBanner(null);
    const { error } = await reservationApi.reassign({ reservationId, staffId });
    setMoving(null);
    setMovable(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash("担当トレーナーを変更しました");
    load();
  }

  function exportCsv() {
    const booked = (rows || []).filter((r) => r.status !== "cancelled");
    if (!booked.length) return;
    downloadCsv(
      `${APP_SLUG}_reservations_${date}.csv`,
      toCsv(booked, [
        { label: "開始", value: (r) => jtime(r.start_at) },
        { label: "終了", value: (r) => jtime(r.end_at) },
        { label: "会員名", value: (r) => r.member_name },
        { label: "メールアドレス", value: (r) => r.member_email },
        { label: "メニュー", value: (r) => r.menu_name },
        { label: "担当", value: (r) => r.trainer_name || "" },
        { label: "支払い", value: (r) => SOURCE[r.source] },
        { label: "状態", value: (r) => STATUS[r.status] },
      ])
    );
  }

  const active = (rows || []).filter((r) => r.status === "booked");
  const capacity = slots.filter((s) => !s.is_closed).reduce((a, s) => a + s.capacity, 0);
  const used = slots.reduce((a, s) => a + s.booked, 0);
  const rate = capacity > 0 ? Math.round((used / capacity) * 100) : 0;

  return (
    <AdminLayout
      title="予約状況の確認"
      sub="日付ごとの予約と枠の消化状況"
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select value={date} onChange={(e) => setDate(e.target.value)} style={selectStyle}>
            {dates.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <Button variant="navy" onClick={exportCsv} disabled={!active.length}>
            CSVで書き出す
          </Button>
        </div>
      }
    >
      {banner && <Banner>{banner}</Banner>}
      {toast && (
        <div style={{ marginBottom: 12 }}>
          <Toast>{toast}</Toast>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
        <Stat label="予約件数" value={active.length} unit="件" />
        <Stat label="受付枠(有効)" value={capacity} unit="枠" />
        <Stat label="消化" value={used} unit="枠" />
        <Stat label="稼働率" value={rate} unit="%" />
      </div>

      {rows === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {rows?.length === 0 && (
        <div
          style={{
            border: `1px dashed ${T.fieldBorder}`,
            borderRadius: radius.lg,
            padding: "28px 16px",
            textAlign: "center",
            background: T.bgSubtle,
            color: T.textFaint,
            fontSize: 12.5,
          }}
        >
          この日の予約はありません。
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760, fontSize: 12.5 }}>
            <thead>
              <tr>
                {["時間", "会員", "メニュー", "担当", "支払い", "状態", ""].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const cancelled = r.status === "cancelled";
                return (
                  <tr key={r.id} style={{ background: i % 2 ? T.bgSubtle : T.bg, opacity: cancelled ? 0.55 : 1 }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {jtime(r.start_at)} 〜 {jtime(r.end_at)}
                    </td>
                    <td style={tdStyle}>
                      <span
                        onClick={() => navigate(`/admin/members/${r.member_id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/members/${r.member_id}`)}
                        style={{ color: T.accent, cursor: "pointer" }}
                      >
                        {r.member_name}
                      </span>
                      <div style={{ fontSize: 10.5, color: T.textFaint }}>{r.member_email}</div>
                    </td>
                    <td style={tdStyle}>{r.menu_name}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span>{r.trainer_name || "—"}</span>
                        {r.nominated && <Badge tone="navy">指名</Badge>}
                        {!cancelled && !r.nominated && moving !== r.id && (
                          <span
                            onClick={() => openMove(r)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && openMove(r)}
                            style={{ color: T.accent, cursor: "pointer", fontSize: 11.5 }}
                          >
                            変更
                          </span>
                        )}
                      </div>

                      {moving === r.id && (
                        <div style={{ marginTop: 6 }}>
                          {movable === null ? (
                            <Spinner color={T.textFaint} size={14} />
                          ) : movable.length === 0 ? (
                            <div style={{ fontSize: 11, color: T.textMute }}>
                              この時間に空いている他のトレーナーがいません
                            </div>
                          ) : (
                            <select
                              defaultValue=""
                              onChange={(e) => e.target.value && move(r.id, e.target.value)}
                              style={{
                                background: T.field,
                                border: `1px solid ${T.fieldBorder}`,
                                borderRadius: radius.md,
                                padding: "6px 8px",
                                fontSize: 11.5,
                                fontFamily: font,
                                color: T.text,
                                outline: "none",
                              }}
                            >
                              <option value="">選んでください</option>
                              {movable.map((t) => (
                                <option key={t.staff_id} value={t.staff_id}>{t.name}</option>
                              ))}
                            </select>
                          )}
                          <div
                            onClick={() => { setMoving(null); setMovable(null); }}
                            role="button"
                            tabIndex={0}
                            style={{ fontSize: 11, color: T.textFaint, cursor: "pointer", marginTop: 4 }}
                          >
                            やめる
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <Badge tone={TONE[r.source]}>{SOURCE[r.source]}</Badge>
                      {r.needs_purchase && !cancelled && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="danger">要購入</Badge>
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <Badge tone={cancelled ? "gray" : "primary"}>{STATUS[r.status]}</Badge>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      {!cancelled && (
                        <div style={{ display: "flex", gap: 6 }}>
                          {r.needs_purchase && (
                            <Button variant="navy" onClick={() => settle(r.id)} loading={settling === r.id}>
                              購入を反映
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => cancel(r.id)} loading={cancelling === r.id}>
                            キャンセル
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11.5, color: T.textMute, lineHeight: 1.7 }}>
        稼働率は「消化した枠 ÷ クローズしていない受付枠」です。60分のメニューは2枠を消化します。
        <br />
        会員名を押すと会員詳細へ移動します。
        <br />
        「要購入」は未購入のメニューで入った予約です。店頭で代金を受け取ったら「購入を反映」を押してください。
        回数券の場合は、先に会員詳細で回数券を付与してから押すと1回分が消費されます。
        <br />
        担当の「変更」で、その時間に空いている別のトレーナーへ付け替えられます。
        「指名」の予約は会員が指名券を使って相手を選んでいるため、付け替えられません。
      </div>
    </AdminLayout>
  );
}

const thStyle = {
  background: T.navy,
  color: T.onDark,
  fontSize: 11,
  fontWeight: 500,
  padding: "9px 12px",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle = { padding: "9px 12px", borderTop: `1px solid ${T.borderFaint}`, verticalAlign: "middle" };

const selectStyle = {
  background: T.field,
  border: `1px solid ${T.fieldBorder}`,
  borderRadius: radius.md,
  padding: "8px 10px",
  fontSize: 12,
  color: T.text,
  fontFamily: font,
  outline: "none",
};

function Stat({ label, value, unit }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "12px 14px", background: T.navySoft }}>
      <div style={{ fontSize: 11, color: T.textMute }}>{label}</div>
      <div style={{ marginTop: 3, color: T.navy, fontWeight: 500 }}>
        <span style={{ fontSize: 21, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <span style={{ fontSize: 11, marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  );
}
