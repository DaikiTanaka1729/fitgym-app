import React, { useCallback, useEffect, useState } from "react";
import { T, font, radius } from "../../theme/tokens";
import { Banner, Button, Spinner, TextField, Toast } from "../../components";
import { shiftApi } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";
import { jstTime, nextDates } from "../member/format";

const HOURS = Array.from({ length: 25 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

// A-10 受付枠(シフト)設定
// 「その時間に誰がいるか」を登録する。これが無いと予約可能な時刻が1つも出ない。
export default function ShiftsScreen() {
  const { admin } = useSession();
  const dates = nextDates(14);

  const [staff, setStaff] = useState([]);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);

  // 一括作成フォーム
  const [form, setForm] = useState({ adminId: "", from: dates[0].value, to: dates[6].value, start: "09:00", end: "18:00", capacity: "1" });
  const [creating, setCreating] = useState(false);

  // 当日の枠
  const [date, setDate] = useState(dates[0].value);
  const [slots, setSlots] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    shiftApi.listStaff().then(({ data, error }) => {
      if (error) setBanner(error);
      setStaff(data || []);
      if (data?.length) setForm((f) => ({ ...f, adminId: f.adminId || data[0].id }));
    });
  }, []);

  const loadSlots = useCallback(async () => {
    if (!admin) return;
    setSlots(null);
    setSelected(new Set());
    const { data, error } = await shiftApi.listByDate({ storeId: admin.store_id, date });
    if (error) setBanner(error);
    setSlots(data || []);
  }, [admin, date]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function create() {
    setBanner(null);
    if (!form.adminId) {
      setBanner("トレーナーを選んでください");
      return;
    }
    if (form.start >= form.end) {
      setBanner("終了時刻は開始時刻より後にしてください");
      return;
    }
    setCreating(true);
    const { data, error } = await shiftApi.create({
      adminId: form.adminId,
      from: form.from,
      to: form.to,
      start: form.start,
      end: form.end,
      capacity: Number(form.capacity) || 1,
    });
    setCreating(false);
    if (error) {
      setBanner(error);
      return;
    }
    flash(`受付枠を ${data} 件作成しました`);
    loadSlots();
  }

  async function setClosed(closed) {
    if (selected.size === 0) return;
    setUpdating(true);
    setBanner(null);
    const { error } = await shiftApi.setClosed({ slotIds: [...selected], closed });
    setUpdating(false);
    if (error) {
      setBanner(error);
      return;
    }
    flash(closed ? `${selected.size} 枠をクローズしました` : `${selected.size} 枠を再開しました`);
    loadSlots();
  }

  const byStaff = {};
  (slots || []).forEach((s) => {
    (byStaff[s.staff_id] ||= { name: s.admins?.name || "—", rows: [] }).rows.push(s);
  });

  return (
    <AdminLayout title="受付枠(シフト)" sub="トレーナーが受け付けられる時間を登録します。ここが空だと予約できる時刻が表示されません。">
      {banner && <Banner>{banner}</Banner>}
      {toast && (
        <div style={{ marginBottom: 12 }}>
          <Toast>{toast}</Toast>
        </div>
      )}

      {/* ---- 一括作成 ---- */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: 16, marginBottom: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>受付枠をまとめて作成</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <Field label="トレーナー">
            <Select value={form.adminId} onChange={(v) => setForm({ ...form, adminId: v })}
              options={staff.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label="開始日">
            <Select value={form.from} onChange={(v) => setForm({ ...form, from: v })}
              options={dates.map((d) => ({ value: d.value, label: d.label }))} />
          </Field>
          <Field label="終了日">
            <Select value={form.to} onChange={(v) => setForm({ ...form, to: v })}
              options={dates.map((d) => ({ value: d.value, label: d.label }))} />
          </Field>
          <Field label="開始時刻">
            <Select value={form.start} onChange={(v) => setForm({ ...form, start: v })}
              options={HOURS.slice(0, 24).map((h) => ({ value: h, label: h }))} />
          </Field>
          <Field label="終了時刻">
            <Select value={form.end} onChange={(v) => setForm({ ...form, end: v })}
              options={HOURS.slice(1).map((h) => ({ value: h, label: h === "24:00" ? "24:00(終日)" : h }))} />
          </Field>
          <Field label="1枠あたりの定員">
            <TextField value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} />
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
          <Button variant="navy" onClick={create} loading={creating}>
            この内容で作成
          </Button>
          <span style={{ fontSize: 11, color: T.textMute }}>
            30分刻みで作成します。終了時刻の枠は作りません(18:00 指定なら最後は 17:30)。
          </span>
        </div>
      </div>

      {/* ---- 日別の枠 ---- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>登録済みの枠</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: T.textMute }}>日付</span>
          <Select value={date} onChange={setDate} options={dates.map((d) => ({ value: d.value, label: d.label }))} width={140} />
        </div>
      </div>

      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: T.textMute }}>{selected.size} 枠を選択中</span>
          <Button variant="danger" onClick={() => setClosed(true)} loading={updating}>
            クローズする
          </Button>
          <Button variant="ghost" onClick={() => setClosed(false)} loading={updating}>
            再開する
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            選択を解除
          </Button>
        </div>
      )}

      {slots === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {slots?.length === 0 && (
        <div
          style={{
            border: `1px dashed ${T.fieldBorder}`,
            borderRadius: radius.lg,
            padding: "28px 16px",
            textAlign: "center",
            background: T.bgSubtle,
            color: T.textFaint,
            fontSize: 12.5,
            lineHeight: 1.7,
          }}
        >
          この日の受付枠はまだありません。
          <br />
          上のフォームから作成してください。
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {Object.entries(byStaff).map(([id, g]) => (
          <div key={id} style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
            <div
              style={{
                padding: "9px 13px",
                background: T.navySoft,
                color: T.navy,
                fontSize: 12.5,
                fontWeight: 500,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{g.name}</span>
              <span style={{ fontWeight: 400, fontSize: 11 }}>
                {g.rows.length}枠 / クローズ {g.rows.filter((r) => r.is_closed).length}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(64px,1fr))",
                gap: 5,
                padding: 10,
              }}
            >
              {g.rows.map((s) => {
                const on = selected.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      const next = new Set(selected);
                      on ? next.delete(s.id) : next.add(s.id);
                      setSelected(next);
                    }}
                    style={{
                      border: `1px solid ${on ? T.navy : s.is_closed ? T.dangerBorder : T.fieldBorder}`,
                      background: on ? T.navySoft : s.is_closed ? T.dangerSoft : T.bg,
                      color: s.is_closed ? T.dangerDark : T.text,
                      borderRadius: radius.md,
                      padding: "6px 2px",
                      fontSize: 11.5,
                      fontFamily: font,
                      cursor: "pointer",
                      lineHeight: 1.3,
                    }}
                  >
                    {jstTime(s.start_at)}
                    <div style={{ fontSize: 9, color: s.is_closed ? T.dangerDark : T.textFaint }}>
                      {s.is_closed ? "休止" : `定員${s.capacity}`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, width }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: width || "100%",
        background: T.field,
        border: `1px solid ${T.fieldBorder}`,
        borderRadius: radius.md,
        padding: "9px 10px",
        fontSize: 12,
        color: T.text,
        fontFamily: font,
        boxSizing: "border-box",
        outline: "none",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
