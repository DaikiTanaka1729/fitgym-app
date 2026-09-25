import React, { useCallback, useEffect, useState } from "react";
import { T, font, radius } from "../../theme/tokens";
import { Banner, Button, Segmented, Spinner, TextField, Toast } from "../../components";
import { shiftApi } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";
import { jstTime, nextDates } from "../member/format";

const HOURS = Array.from({ length: 25 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

const ACTIONS = [
  { value: "create", label: "追加", done: "追加", variant: "navy",
    hint: "指定した範囲に30分刻みで枠を作ります。すでにある枠はそのままです。" },
  { value: "delete", label: "削除", done: "削除", variant: "danger",
    hint: "枠ごと消します。予約が入っている枠は消しません。" },
  { value: "close", label: "クローズ", done: "クローズ", variant: "danger",
    hint: "枠は残したまま受付だけ止めます。臨時休業などに使います。" },
  { value: "open", label: "再開", done: "再開", variant: "navy",
    hint: "クローズした枠の受付を再開します。" },
];

const WEEKDAYS = [
  { value: 0, label: "日" },
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
];

// A-10 受付枠(シフト)設定
// 「その時間に誰がいるか」を登録する。これが無いと予約可能な時刻が1つも出ない。
export default function ShiftsScreen() {
  const { admin } = useSession();
  // 店舗管理者は全員分、トレーナーは自分の分だけを操作できる。
  // サーバー側でも同じ判定をしているので、ここは見せ方の調整。
  const isStoreAdmin = admin?.role === "admin";
  const canEdit = (staffId) => isStoreAdmin || staffId === admin?.id;
  const dates = nextDates(14);

  const [staff, setStaff] = useState([]);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);

  // 一括操作フォーム
  const [form, setForm] = useState({
    action: "create",
    adminId: "",            // "" は全トレーナー(店舗管理者のみ)
    from: dates[0].value,
    to: dates[6].value,
    start: "09:00",
    end: "18:00",
    capacity: "1",
    weekdays: [],           // 空配列 = すべての曜日
  });
  const [running, setRunning] = useState(false);

  // 当日の枠
  const [date, setDate] = useState(dates[0].value);
  const [slots, setSlots] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    shiftApi.listStaff().then(({ data, error }) => {
      if (error) setBanner(error);
      setStaff(data || []);
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

  // トレーナーとして入っている場合、対象は自分に固定する
  useEffect(() => {
    if (admin && !isStoreAdmin) {
      setForm((f) => (f.adminId === admin.id ? f : { ...f, adminId: admin.id }));
    }
  }, [admin, isStoreAdmin]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function run() {
    setBanner(null);
    if (form.start >= form.end) {
      setBanner("終了時刻は開始時刻より後にしてください");
      return;
    }
    if (form.to < form.from) {
      setBanner("終了日は開始日より後にしてください");
      return;
    }
    setRunning(true);
    const { data, error } = await shiftApi.bulk({
      action: form.action,
      adminId: form.adminId || null,
      from: form.from,
      to: form.to,
      start: form.start,
      end: form.end,
      capacity: Number(form.capacity) || 1,
      weekdays: form.weekdays.length ? form.weekdays : null,
    });
    setRunning(false);
    if (error) {
      setBanner(error);
      return;
    }
    const r = data?.[0] || { affected: 0, skipped: 0 };
    const verb = ACTIONS.find((a) => a.value === form.action)?.done || "処理";
    flash(
      `${r.affected} 枠を${verb}しました` +
        (r.skipped ? `(予約が入っている ${r.skipped} 枠は対象外)` : "")
    );
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

      {/* ---- 一括操作 ---- */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: 16, marginBottom: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>受付枠をまとめて操作</div>

        <div style={{ marginBottom: 14, maxWidth: 420 }}>
          <Segmented
            value={form.action}
            onChange={(v) => setForm({ ...form, action: v })}
            options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <Field label="トレーナー">
            <Select
              value={form.adminId}
              onChange={(v) => setForm({ ...form, adminId: v })}
              options={
                isStoreAdmin
                  ? [{ value: "", label: "全トレーナー" }, ...staff.map((s) => ({ value: s.id, label: s.name }))]
                  : staff.filter((s) => s.id === admin?.id).map((s) => ({ value: s.id, label: s.name }))
              }
            />
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
          {form.action === "create" && (
            <Field label="1枠あたりの定員">
              <TextField value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} />
            </Field>
          )}
        </div>

        {/* 曜日の絞り込み */}
        <div style={{ marginTop: 4, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>
            曜日で絞る(未選択ならすべての曜日)
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {WEEKDAYS.map((w) => {
              const on = form.weekdays.includes(w.value);
              return (
                <button
                  key={w.value}
                  onClick={() =>
                    setForm({
                      ...form,
                      weekdays: on
                        ? form.weekdays.filter((x) => x !== w.value)
                        : [...form.weekdays, w.value],
                    })
                  }
                  style={{
                    width: 38,
                    height: 32,
                    borderRadius: radius.md,
                    fontSize: 12,
                    fontFamily: font,
                    cursor: "pointer",
                    border: `1px solid ${on ? T.navy : T.fieldBorder}`,
                    background: on ? T.navySoft : T.bg,
                    color: on ? T.navy : T.textMute,
                    fontWeight: on ? 500 : 400,
                  }}
                >
                  {w.label}
                </button>
              );
            })}
            {form.weekdays.length > 0 && (
              <button
                onClick={() => setForm({ ...form, weekdays: [] })}
                style={{
                  height: 32,
                  padding: "0 10px",
                  borderRadius: radius.md,
                  fontSize: 11,
                  fontFamily: font,
                  cursor: "pointer",
                  border: `1px solid ${T.border}`,
                  background: T.bg,
                  color: T.textMute,
                }}
              >
                解除
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button
            variant={ACTIONS.find((a) => a.value === form.action)?.variant || "navy"}
            onClick={run}
            loading={running}
          >
            この内容で{ACTIONS.find((a) => a.value === form.action)?.label}
          </Button>
          <span style={{ fontSize: 11, color: T.textMute, lineHeight: 1.7 }}>
            {ACTIONS.find((a) => a.value === form.action)?.hint}
            {form.action === "create" && " 終了時刻の枠は作りません(18:00 指定なら最後は 17:30)。"}
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
          上のフォームから追加してください。
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
                const mine = canEdit(s.staff_id);
                return (
                  <button
                    key={s.id}
                    disabled={!mine}
                    title={mine ? "" : "自分の受付枠のみ操作できます"}
                    onClick={() => {
                      const next = new Set(selected);
                      on ? next.delete(s.id) : next.add(s.id);
                      setSelected(next);
                    }}
                    style={{
                      border: `1px solid ${on ? T.navy : s.is_closed ? T.grayDark : T.fieldBorder}`,
                      // クローズは濃いグレーで塗る。赤は不具合や警告に使う色なので、
                      // 「店舗が意図して閉じた枠」とは区別する。
                      background: on ? T.navySoft : s.is_closed ? T.grayDark : T.bg,
                      color: s.is_closed ? T.onDark : T.text,
                      borderRadius: radius.md,
                      padding: "6px 2px",
                      fontSize: 11.5,
                      fontFamily: font,
                      cursor: mine ? "pointer" : "default",
                      opacity: mine ? 1 : 0.45,
                      lineHeight: 1.3,
                    }}
                  >
                    {jstTime(s.start_at)}
                    <div style={{ fontSize: 9, color: s.is_closed ? T.onDark : T.textFaint, opacity: s.is_closed ? 0.8 : 1 }}>
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
