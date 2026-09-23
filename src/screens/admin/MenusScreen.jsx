import React, { useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, DataTable, Segmented, Spinner, TextField, Toast } from "../../components";
import { menuApi } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";
import NominationLinksSection from "./NominationLinksSection";

const TONE = { time: "primary", unlimited: "accent", ticket: "amber", nomination: "navy" };
const STATUS = { draft: { label: "仮登録", tone: "gray" }, published: { label: "公開中", tone: "primary" } };
const LABEL = { time: "時間課金", unlimited: "通い放題", ticket: "回数券", nomination: "指名券" };

// 表示順。小さいほど上に出る。数で持つのは、並べ替えのたびに
// 文字から順位へ読み替える処理を書かなくて済むようにするため。
const PRIORITY = {
  1: { label: "高", tone: "primary" },
  2: { label: "中", tone: "gray" },
  3: { label: "低", tone: "gray" },
};

const EMPTY = {
  id: null,
  name: "",
  billing_type: "time",
  priority: "2",
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
  const canApprove = admin?.can_approve_menus === true;
  const [rows, setRows] = useState(null);
  const [publishing, setPublishing] = useState(null);
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
      priority: num(form.priority) ?? 2,
      price: num(form.price) ?? 0,
      is_active: form.is_active,
      // 指名券は施術ではないので所要時間を持たない。回数と期限は回数券と同じ扱い。
      duration_min:
        form.billing_type === "unlimited" || form.billing_type === "nomination"
          ? null
          : num(form.duration_min),
      // 同時予約の上限は課金形態によらず効く(create_reservation が見ている)。
      // 指名券は予約できないので持たせない。
      max_active: form.billing_type === "nomination" ? null : num(form.max_active),
      ticket_count:
        form.billing_type === "ticket" || form.billing_type === "nomination"
          ? num(form.ticket_count)
          : null,
      // 回数券・指名券は有効期限、通い放題は1契約あたりの期間。
      // 「購入を反映」で契約を作るときの長さになる。
      valid_months:
        form.billing_type === "time" ? null : num(form.valid_months),
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

  async function togglePublish(row) {
    setBanner(null);
    setPublishing(row.id);
    const published = row.status !== "published";
    const { error } = await menuApi.setPublished({ menuId: row.id, published });
    setPublishing(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash(published ? "メニューを公開しました" : "公開を停止しました");
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

            <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>優先度</div>
            <div style={{ marginBottom: 6 }}>
              <Segmented
                value={form.priority}
                onChange={set("priority")}
                options={[
                  { value: "1", label: "高" },
                  { value: "2", label: "中" },
                  { value: "3", label: "低" },
                ]}
              />
            </div>
            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.7, marginBottom: 14 }}>
              高いものから上に並びます。会員の予約画面と、会員詳細の購入登録に効きます。
            </div>

            <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>課金タイプ</div>
            <div style={{ marginBottom: 14 }}>
              <Segmented
                value={form.billing_type}
                onChange={set("billing_type")}
                options={[
                  { value: "time", label: "時間課金" },
                  { value: "unlimited", label: "通い放題" },
                  { value: "ticket", label: "回数券" },
                  { value: "nomination", label: "指名券" },
                ]}
              />
            </div>

            {form.billing_type === "time" && (
              <>
                <TextField label="所要時間(分)" value={form.duration_min} onChange={set("duration_min")} placeholder="60" />
                <TextField label="価格(税込・円)" value={form.price} onChange={set("price")} placeholder="8000" />
                <TextField
                  label="同時予約の上限(件)"
                  value={form.max_active}
                  onChange={set("max_active")}
                  placeholder="未入力なら 5 件"
                />
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
                <TextField
                  label="1契約あたりの期間(月数)"
                  value={form.valid_months}
                  onChange={set("valid_months")}
                  placeholder="未入力なら 1 ヶ月"
                />
              </>
            )}

            {form.billing_type === "ticket" && (
              <>
                <TextField label="所要時間(分)" value={form.duration_min} onChange={set("duration_min")} placeholder="60" />
                <TextField label="回数" value={form.ticket_count} onChange={set("ticket_count")} placeholder="10" />
                <TextField label="有効期限(購入からの月数)" value={form.valid_months} onChange={set("valid_months")} placeholder="6" />
                <TextField label="価格(税込・円)" value={form.price} onChange={set("price")} placeholder="70000" />
                <TextField
                  label="同時予約の上限(件)"
                  value={form.max_active}
                  onChange={set("max_active")}
                  placeholder="未入力なら 5 件"
                />
              </>
            )}

            {form.billing_type === "nomination" && (
              <>
                <TextField label="回数" value={form.ticket_count} onChange={set("ticket_count")} placeholder="5" />
                <TextField label="有効期限(購入からの月数)" value={form.valid_months} onChange={set("valid_months")} placeholder="6" />
                <TextField label="価格(税込・円)" value={form.price} onChange={set("price")} placeholder="5000" />
                <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.8, margin: "2px 0 14px" }}>
                  指名券そのものは予約できません。会員は予約のときに「トレーナーを指名する」に
                  チェックを入れて使います。どのメニューに使えるかは、登録後に一覧の
                  「適用メニュー」から指定してください。
                </div>
              </>
            )}

            {form.billing_type !== "nomination" && (
              <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.7, margin: "-4px 0 14px" }}>
                同時予約の上限は「その会員がこれから先に持てる予約の合計件数」です。
                メニューごとに違う値を入れた場合、そのとき予約するメニューの値で判定します。
              </div>
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
            {
              key: "priority",
              label: "優先度",
              w: "0.5fr",
              render: (v) => (
                <Badge tone={PRIORITY[v ?? 2]?.tone || "gray"}>{PRIORITY[v ?? 2]?.label || "中"}</Badge>
              ),
            },
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
                r.billing_type === "nomination"
                  ? `${v ?? "—"}回 / ${r.valid_months ? `${r.valid_months}ヶ月` : "無期限"}`
                  : r.billing_type === "ticket"
                  ? `${v ?? "—"}回 / ${r.valid_months ? `${r.valid_months}ヶ月` : "無期限"} / 同時 ${r.max_active ?? 5} 件`
                  : r.billing_type === "unlimited"
                  ? `同時 ${r.max_active ?? 5} 件 / ${r.valid_months ?? 1}ヶ月`
                  : `同時 ${r.max_active ?? 5} 件`,
            },
            {
              key: "status",
              label: "公開状態",
              w: "0.7fr",
              render: (v, r) => (
                <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                  <Badge tone={STATUS[v]?.tone || "gray"}>{STATUS[v]?.label || v}</Badge>
                  {!r.is_active && <Badge tone="gray">停止中</Badge>}
                </span>
              ),
            },
            {
              key: "id",
              label: "操作",
              w: "1fr",
              render: (_v, r) => (
                <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    onClick={() =>
                      setForm({
                        id: r.id,
                        name: r.name,
                        billing_type: r.billing_type,
                        priority: String(r.priority ?? 2),
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
                  {canApprove ? (
                    <span
                      onClick={() => publishing !== r.id && togglePublish(r)}
                      role="button"
                      tabIndex={0}
                      style={{
                        color: r.status === "published" ? T.dangerDark : T.primaryDark,
                        cursor: publishing === r.id ? "default" : "pointer",
                        opacity: publishing === r.id ? 0.5 : 1,
                      }}
                    >
                      {r.status === "published" ? "公開を停止" : "公開する"}
                    </span>
                  ) : (
                    r.status !== "published" && (
                      <span style={{ color: T.textFaint }}>承認待ち</span>
                    )
                  )}
                </span>
              ),
            },
          ]}
          rows={rows}
        />
      )}

      {rows && <NominationLinksSection menus={rows} onFlash={flash} />}
    </AdminLayout>
  );
}
