import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner, Toast } from "../../components";
import { downloadCsv, reservationApi, shiftApi, toCsv } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";
import { nextDates } from "../member/format";

const SOURCE = { time: "時間課金", unlimited: "通い放題", ticket: "回数券" };
const TONE = { time: "primary", unlimited: "accent", ticket: "amber" };
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

  function exportCsv() {
    const booked = (rows || []).filter((r) => r.status !== "cancelled");
    if (!booked.length) return;
    downloadCsv(
      `fitgym_reservations_${date}.csv`,
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
                    <td style={tdStyle}>{r.trainer_name || "—"}</td>
                    <td style={tdStyle}>
                      <Badge tone={TONE[r.source]}>{SOURCE[r.source]}</Badge>
                    </td>
                    <td style={tdStyle}>
                      <Badge tone={cancelled ? "gray" : "primary"}>{STATUS[r.status]}</Badge>
                    </td>
                    <td style={tdStyle}>
                      {!cancelled && (
                        <Button variant="ghost" onClick={() => cancel(r.id)} loading={cancelling === r.id}>
                          キャンセル
                        </Button>
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
