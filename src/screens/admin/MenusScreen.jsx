import React, { useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, DataTable, Segmented, Spinner, TextField, Toast } from "../../components";
import { menuApi } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";

const TONE = { time: "primary", unlimited: "accent", ticket: "amber" };
const LABEL = { time: "時間課金", unlimited: "通い放題", ticket: "回数券" };

const EMPTY = {
  id: null,
  name: "",
  billing_type: "time",
  duration_min: "60",
  price: "0",
  max_active: "",
  ticket_count: "",
  valid_months: "",
  is_active: true,
};

// A-09 メニュー設定
export default function MenusScreen() {
  const { admin } = useSession();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!admin) return;
    const { data, error } = await menuApi.list({ storeId: admin.store_id });
    if (error) setBanner(error);
    setRows(data || []);
  }

  useEffect(() => {
    load();
  }, [admin]);

  function flash(m) {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  }

  const set = (k) => (v) => setForm({ ...form, [k]: v });
  const num = (v) => (v === "" || v === null ? null : Number(v));

  async function save() {
    setBanner(null);
    if (!form.name.trim()) {
      setBanner("メニュー名を入力してください");
      return;
    }
    const payload = {
      store_id: admin.store_id,
      name: form.name.trim(),
      billing_type: form.billing_type,
      price: num(form.price) ?? 0,
      is_active: form.is_active,
      duration_min: form.billing_type === "unlimited" ? null : num(form.duration_min),
      max_active: form.billing_type === "unlimited" ? num(form.max_active) : null,
      ticket_count: form.billing_type === "ticket" ? num(form.ticket_count) : null,
      valid_months: form.billing_type === "ticket" ? num(form.valid_months) : null,
    };

    setSaving(true);
    const { error } = form.id
      ? await menuApi.update(form.id, payload)
      : await menuApi.create(payload);
    setSaving(false);
    if (error) {
      setBanner(error);
      return;
    }
    flash(form.id ? "メニューを更新しました" : "メニューを登録しました");
    setForm(null);
    load();
  }

  return (
    <AdminLayout
      title="メニュー設定"
      sub="会員が予約するメニューを登録します"
      actions={
        !form && (
          <Button variant="navy" onClick={() => setForm({ ...EMPTY })}>
            新規登録
          </Button>
        )
      }
    >
      {banner && <Banner>{banner}</Banner>}
      {toast && (
        <div style={{ marginBottom: 12 }}>
          <Toast>{toast}</Toast>
        </div>
      )}

      {form && (
        <div style={{ border: `1px solid ${T.navy}`, borderRadius: radius.lg, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
            {form.id ? "メニューを編集" : "メニューを新規登録"}
          </div>

          <div style={{ maxWidth: 420 }}>
            <TextField label="メニュー名" required value={form.name} onChange={set("name")} placeholder="パーソナル60分" />

            <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>課金タイプ</div>
            <div style={{ marginBottom: 14 }}>
              <Segmented
                value={form.billing_type}
                onChange={set("billing_type")}
                options={[
                  { value: "time", label: "時間課金" },
                  { value: "unlimited", label: "通い放題" },
                  { value: "ticket", label: "回数券" },
                ]}
              />
            </div>

            {form.billing_type === "time" && (
              <>
                <TextField label="所要時間(分)" value={form.duration_min} onChange={set("duration_min")} placeholder="60" />
                <TextField label="価格(税込・円)" value={form.price} onChange={set("price")} placeholder="8000" />
              </>
            )}

            {form.billing_type === "unlimited" && (
              <>
                <TextField label="価格(月額・税込・円)" value={form.price} onChange={set("price")} placeholder="15000" />
                <TextField
                  label="同時予約の上限(件)"
                  value={form.max_active}
                  onChange={set("max_active")}
                  placeholder="未入力なら 5 件"
                />
              </>
            )}

            {form.billing_type === "ticket" && (
              <>
                <TextField label="所要時間(分)" value={form.duration_min} onChange={set("duration_min")} placeholder="60" />
                <TextField label="回数" value={form.ticket_count} onChange={set("ticket_count")} placeholder="10" />
                <TextField label="有効期限(購入からの月数)" value={form.valid_months} onChange={set("valid_months")} placeholder="6" />
                <TextField label="価格(税込・円)" value={form.price} onChange={set("price")} placeholder="70000" />
              </>
            )}

            <div
              onClick={() => setForm({ ...form, is_active: !form.is_active })}
              role="button"
              tabIndex={0}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", margin: "4px 0 16px" }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  border: `1.5px solid ${form.is_active ? T.primary : T.fieldBorder}`,
                  background: form.is_active ? T.primary : T.bg,
                  color: T.onDark,
                  fontSize: 12,
                  lineHeight: "16px",
                  textAlign: "center",
                }}
              >
                {form.is_active ? "✓" : ""}
              </span>
              <span style={{ fontSize: 12 }}>会員の予約画面に表示する</span>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="navy" onClick={save} loading={saving}>
                保存する
              </Button>
              <Button variant="ghost" onClick={() => setForm(null)}>
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      {rows === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {rows && (
        <DataTable
          columns={[
            { key: "name", label: "メニュー名", w: "1.6fr" },
            {
              key: "billing_type",
              label: "課金タイプ",
              render: (v) => <Badge tone={TONE[v]}>{LABEL[v]}</Badge>,
            },
            {
              key: "duration_min",
              label: "所要時間",
              w: "0.8fr",
              render: (v) => (v ? `${v}分` : "—"),
            },
            {
              key: "price",
              label: "価格",
              render: (v, r) => `¥${(v ?? 0).toLocaleString()}${r.billing_type === "unlimited" ? " /月" : ""}`,
            },
            {
              key: "ticket_count",
              label: "回数・上限",
              w: "0.9fr",
              render: (v, r) =>
                r.billing_type === "ticket"
                  ? `${v ?? "—"}回 / ${r.valid_months ? `${r.valid_months}ヶ月` : "無期限"}`
                  : r.billing_type === "unlimited"
                  ? `同時 ${r.max_active ?? 5} 件`
                  : "—",
            },
            {
              key: "is_active",
              label: "状態",
              w: "0.6fr",
              render: (v) => <Badge tone={v ? "primary" : "gray"}>{v ? "有効" : "停止中"}</Badge>,
            },
            {
              key: "id",
              label: "操作",
              w: "0.5fr",
              render: (_v, r) => (
                <span
                  onClick={() =>
                    setForm({
                      id: r.id,
                      name: r.name,
                      billing_type: r.billing_type,
                      duration_min: r.duration_min ?? "",
                      price: String(r.price ?? 0),
                      max_active: r.max_active ?? "",
                      ticket_count: r.ticket_count ?? "",
                      valid_months: r.valid_months ?? "",
                      is_active: r.is_active,
                    })
                  }
                  role="button"
                  tabIndex={0}
                  style={{ color: T.accent, cursor: "pointer" }}
                >
                  編集
                </span>
              ),
            },
          ]}
          rows={rows}
        />
      )}
    </AdminLayout>
  );
}
