import React, { useCallback, useEffect, useMemo, useState } from "react";
import { T, font, radius } from "../../theme/tokens";
import { Banner, Button, Segmented, Spinner, Toast } from "../../components";
import { noteApi, shiftApi } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";
import { nextDates } from "../member/format";

// 24時間を30分刻みで48行
const SLOTS = Array.from({ length: 48 }, (_, i) => ({
  h: Math.floor(i / 2),
  m: i % 2 ? 30 : 0,
  label: `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
}));

// その日の JST 時刻を ISO(+09:00)で作る
const iso = (date, h, m) =>
  `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;

// A-10(別ビュー)受付枠タイムテーブル
// 「トレーナー別に枠を作る」画面の裏返し。24時間の各枠に誰を配置するかで見る。
export default function TimetableScreen() {
  const { admin } = useSession();
  // 店舗管理者は全員分、トレーナーは自分の列だけ操作できる。
  // サーバー側でも同じ判定をしているので、ここは見せ方の調整。
  const isStoreAdmin = admin?.role === "admin";
  const canEdit = (staffId) => isStoreAdmin || staffId === admin?.id;
  const dates = nextDates(14);

  const [date, setDate] = useState(dates[0].value);
  const [mode, setMode] = useState("assign"); // assign(配置/解除) | close(クローズ/再開)
  const [staff, setStaff] = useState([]);
  const [slots, setSlots] = useState(null);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);

  // 申し送りメモ
  const [note, setNote] = useState("");
  const [noteMeta, setNoteMeta] = useState(null);
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    shiftApi.listStaff().then(({ data, error }) => {
      if (error) setBanner(error);
      setStaff(data || []);
    });
  }, []);

  const load = useCallback(async () => {
    setSlots(null);
    const [s, n] = await Promise.all([shiftApi.listDay({ date }), noteApi.get({ date })]);
    if (s.error) setBanner(s.error);
    setSlots(s.data || []);
    const row = n.data?.[0];
    setNote(row?.body || "");
    setNoteMeta(row ? { at: row.updated_at, by: row.updated_by_name } : null);
    setNoteDirty(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(m) {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  }

  // start_at(ISO) + staff_id で引ける形にする
  const index = useMemo(() => {
    const map = new Map();
    (slots || []).forEach((s) => {
      const d = new Date(s.start_at);
      const key = `${s.staff_id}:${d.toLocaleString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}`;
      map.set(key, s);
    });
    return map;
  }, [slots]);

  const cellOf = (staffId, label) => index.get(`${staffId}:${label}`);

  async function onCell(staffId, s) {
    if (!canEdit(staffId)) {
      setBanner("自分の受付枠のみ操作できます");
      return;
    }
    const cur = cellOf(staffId, s.label);
    const key = `${staffId}:${s.label}`;
    setBanner(null);
    setBusy(key);

    if (mode === "assign") {
      const { data, error } = await shiftApi.toggleSlot({ staffId, startAt: iso(date, s.h, s.m) });
      setBusy(null);
      if (error) {
        setBanner(error);
        return;
      }
      flash(data === "added" ? `${s.label} に配置しました` : `${s.label} の配置を外しました`);
    } else {
      if (!cur) {
        setBusy(null);
        setBanner("配置されていない枠はクローズできません");
        return;
      }
      const { error } = await shiftApi.setClosed({ slotIds: [cur.id], closed: !cur.is_closed });
      setBusy(null);
      if (error) {
        setBanner(error);
        return;
      }
      flash(cur.is_closed ? `${s.label} を再開しました` : `${s.label} をクローズしました`);
    }
    load();
  }

  // 列(トレーナー)の終日操作
  async function allDay(staffId, assign) {
    if (!canEdit(staffId)) {
      setBanner("自分の受付枠のみ操作できます");
      return;
    }
    setBanner(null);
    setBusy(`col:${staffId}`);
    let n = 0;
    for (const s of SLOTS) {
      const cur = cellOf(staffId, s.label);
      if (assign && cur) continue;
      if (!assign && !cur) continue;
      const { error } = await shiftApi.toggleSlot({ staffId, startAt: iso(date, s.h, s.m) });
      if (error) {
        // 予約が入っている枠は飛ばす
        continue;
      }
      n++;
    }
    setBusy(null);
    flash(assign ? `${n} 枠を配置しました` : `${n} 枠を外しました`);
    load();
  }

  async function saveNote() {
    setSavingNote(true);
    setBanner(null);
    const { error } = await noteApi.save({ date, body: note });
    setSavingNote(false);
    if (error) {
      setBanner(error);
      return;
    }
    setNoteDirty(false);
    flash("メモを保存しました");
    load();
  }

  const totalAt = (label) =>
    staff.reduce((acc, st) => {
      const c = cellOf(st.id, label);
      return acc + (c && !c.is_closed ? c.capacity - c.booked : 0);
    }, 0);

  return (
    <AdminLayout
      title="受付枠タイムテーブル"
      sub="24時間の各枠に、どのトレーナーを配置するかで見る画面です"
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={selectStyle}
          >
            {dates.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <div style={{ minWidth: 210 }}>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "assign", label: "配置 / 解除" },
                { value: "close", label: "クローズ / 再開" },
              ]}
            />
          </div>
        </div>
      }
    >
      {banner && <Banner>{banner}</Banner>}
      {toast && (
        <div style={{ marginBottom: 12 }}>
          <Toast>{toast}</Toast>
        </div>
      )}

      {/* ---- 申し送りメモ ---- */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: 14, marginBottom: 18, background: T.amberSoft }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.amberDark }}>
            申し送りメモ(管理者・スタッフ全員が閲覧できます)
          </div>
          <div style={{ fontSize: 10.5, color: T.amberDark, opacity: 0.85 }}>
            {noteMeta
              ? `最終更新 ${new Date(noteMeta.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}${noteMeta.by ? ` / ${noteMeta.by}` : ""}`
              : "まだメモはありません"}
          </div>
        </div>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteDirty(true);
          }}
          rows={3}
          placeholder="例:14:00〜16:00 は田中トレーナーが外出。急な予約は佐藤トレーナーへ。"
          style={{
            width: "100%",
            background: T.bg,
            border: `1px solid ${T.fieldBorder}`,
            borderRadius: radius.md,
            padding: "9px 11px",
            fontSize: 12.5,
            lineHeight: 1.7,
            color: T.text,
            fontFamily: font,
            boxSizing: "border-box",
            outline: "none",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <Button variant="navy" onClick={saveNote} loading={savingNote} disabled={!noteDirty}>
            メモを保存
          </Button>
          {noteDirty && <span style={{ fontSize: 11, color: T.amberDark }}>未保存の変更があります</span>}
        </div>
      </div>

      {/* ---- 凡例 ---- */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11.5, color: T.textMute, marginBottom: 10 }}>
        <Legend bg={T.bg} border={T.fieldBorder} label="未配置" />
        <Legend bg={T.primarySoft} border={T.primary} label="受付可" />
        <Legend bg={T.primary} border={T.primary} label="予約あり" solid />
        <Legend bg={T.dangerSoft} border={T.danger} label="クローズ" />
      </div>

      {slots === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {slots && staff.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: T.textFaint, fontSize: 12.5 }}>
          トレーナーが登録されていません。
        </div>
      )}

      {slots && staff.length > 0 && (
        <div style={{ overflow: "auto", maxHeight: 620, border: `1px solid ${T.border}`, borderRadius: radius.lg }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...headCell, left: 0, zIndex: 3, width: 62, minWidth: 62 }}>時刻</th>
                {staff.map((st) => (
                  <th key={st.id} style={{ ...headCell, zIndex: 2 }}>
                    <div>{st.name}</div>
                    <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 4 }}>
                      <MiniBtn onClick={() => allDay(st.id, true)} disabled={!canEdit(st.id) || busy === `col:${st.id}`}>終日配置</MiniBtn>
                      <MiniBtn onClick={() => allDay(st.id, false)} disabled={!canEdit(st.id) || busy === `col:${st.id}`}>解除</MiniBtn>
                    </div>
                  </th>
                ))}
                <th style={{ ...headCell, zIndex: 2, width: 58, minWidth: 58 }}>空き</th>
              </tr>
            </thead>
            <tbody>
              {SLOTS.map((s, i) => (
                <tr key={s.label} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                  <td
                    style={{
                      position: "sticky",
                      left: 0,
                      background: i % 2 ? T.bgSubtle : T.bg,
                      borderTop: `1px solid ${T.borderFaint}`,
                      padding: "0 8px",
                      fontFamily: font,
                      fontVariantNumeric: "tabular-nums",
                      color: s.m === 0 ? T.text : T.textFaint,
                      fontWeight: s.m === 0 ? 500 : 400,
                      fontSize: 11.5,
                      whiteSpace: "nowrap",
                      zIndex: 1,
                    }}
                  >
                    {s.label}
                  </td>
                  {staff.map((st) => {
                    const c = cellOf(st.id, s.label);
                    const key = `${st.id}:${s.label}`;
                    return (
                      <td key={st.id} style={{ borderTop: `1px solid ${T.borderFaint}`, padding: 3, textAlign: "center" }}>
                        <button
                          onClick={() => onCell(st.id, s)}
                          disabled={!canEdit(st.id) || busy === key || busy === `col:${st.id}`}
                          title={
                            !canEdit(st.id)
                              ? "自分の受付枠のみ操作できます"
                              : c
                              ? c.is_closed
                                ? "クローズ中"
                                : `定員${c.capacity} / 予約${c.booked}`
                              : "未配置"
                          }
                          style={{ ...cellStyle(c), opacity: canEdit(st.id) ? 1 : 0.45 }}
                        >
                          {c ? (c.is_closed ? "休" : c.booked > 0 ? `${c.booked}/${c.capacity}` : "○") : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td
                    style={{
                      borderTop: `1px solid ${T.borderFaint}`,
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                      color: totalAt(s.label) > 0 ? T.primaryDark : T.textFaint,
                      fontSize: 11.5,
                    }}
                  >
                    {totalAt(s.label)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11.5, color: T.textMute, lineHeight: 1.7 }}>
        「配置 / 解除」モードではセルを押すとトレーナーの配置を切り替えます。予約が入っている枠は外せません。
        <br />
        「クローズ / 再開」モードでは、配置済みの枠を一時的に受付停止にできます。枠は残るため、あとで再開できます。
      </div>
    </AdminLayout>
  );
}

const headCell = {
  position: "sticky",
  top: 0,
  background: T.navy,
  color: T.onDark,
  fontSize: 11,
  fontWeight: 500,
  padding: "8px 10px",
  textAlign: "center",
  whiteSpace: "nowrap",
};

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

function cellStyle(c) {
  const base = {
    width: "100%",
    minWidth: 52,
    height: 26,
    borderRadius: 5,
    cursor: "pointer",
    fontSize: 11,
    fontFamily: font,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  };
  if (!c) return { ...base, border: `1px solid ${T.fieldBorder}`, background: T.bg, color: T.textFaint };
  if (c.is_closed) return { ...base, border: `1px solid ${T.danger}`, background: T.dangerSoft, color: T.dangerDark };
  if (c.booked > 0) return { ...base, border: `1px solid ${T.primary}`, background: T.primary, color: T.onDark, fontWeight: 500 };
  return { ...base, border: `1px solid ${T.primary}`, background: T.primarySoft, color: T.primaryDark };
}

function MiniBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "1px solid rgba(255,255,255,.35)",
        background: "transparent",
        color: T.onDark,
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: 9.5,
        fontFamily: font,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Legend({ bg, border, label, solid }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 20, height: 14, borderRadius: 4, background: bg, border: `1px solid ${border}`, display: "inline-block" }} />
      {label}
      {solid ? "(件数を表示)" : ""}
    </span>
  );
}
