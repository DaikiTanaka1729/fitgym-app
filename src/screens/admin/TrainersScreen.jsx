import React, { useCallback, useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner, TextField, Toast } from "../../components";
import { menuApi, shiftApi } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";

// A-11 トレーナー × メニューの紐づけ
// ここで設定した内容が、各時間帯に何件の予約を受けられるかを決める。
export default function TrainersScreen() {
  const { admin } = useSession();
  const isStoreAdmin = admin?.role === "admin";
  const [staff, setStaff] = useState(null);
  const [menus, setMenus] = useState([]);
  const [links, setLinks] = useState(new Set());
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(null);   // { id?, name, email, role }
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    if (!admin) return;
    const [s, m, l] = await Promise.all([
      shiftApi.listStaff(),
      menuApi.list({ storeId: admin.store_id }),
      shiftApi.listStaffMenus(),
    ]);
    if (s.error || m.error || l.error) setBanner(s.error || m.error || l.error);
    setStaff(s.data || []);
    setMenus(m.data || []);
    setLinks(new Set((l.data || []).map((x) => `${x.admin_id}:${x.menu_id}`)));
  }, [admin]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  async function saveStaff() {
    setBanner(null);
    if (!form.name.trim()) {
      setBanner("氏名を入力してください");
      return;
    }
    setSaving(true);
    const { error } = form.id
      ? await shiftApi.updateStaff({ adminId: form.id, name: form.name.trim(), role: form.role })
      : await shiftApi.createStaff({ name: form.name.trim(), email: form.email.trim(), role: form.role });
    setSaving(false);
    if (error) {
      setBanner(error);
      return;
    }
    setForm(null);
    flash(form.id ? "トレーナー情報を更新しました" : "トレーナーを追加しました");
    load();
  }

  async function approve(s, role) {
    setBanner(null);
    setBusy(`ok:${s.id}`);
    const { error } = await shiftApi.approveAdmin({ adminId: s.id, role });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash(`${s.name} さんを承認しました`);
    load();
  }

  async function removeStaff(id) {
    setBanner(null);
    setBusy(`del:${id}`);
    const { error } = await shiftApi.deleteStaff({ adminId: id });
    setBusy(null);
    setConfirmDelete(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash("トレーナーを削除しました");
    load();
  }

  async function toggleApproval(s) {
    setBanner(null);
    const key = `approve:${s.id}`;
    setBusy(key);
    const { error } = await shiftApi.setApprovalRight({ adminId: s.id, can: !s.can_approve_menus });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    setStaff((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, can_approve_menus: !x.can_approve_menus } : x))
    );
    setToast(s.can_approve_menus ? "承認権限を外しました" : "承認権限を付与しました");
    setTimeout(() => setToast(null), 2000);
  }

  async function toggle(adminId, menuId) {
    const key = `${adminId}:${menuId}`;
    const on = links.has(key);
    setBusy(key);
    setBanner(null);
    const { error } = on
      ? await shiftApi.unlinkMenu({ adminId, menuId })
      : await shiftApi.linkMenu({ adminId, menuId, storeId: admin.store_id });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    const next = new Set(links);
    on ? next.delete(key) : next.add(key);
    setLinks(next);
    setToast(on ? "担当から外しました" : "担当に追加しました");
    setTimeout(() => setToast(null), 2000);
  }

  return (
    <AdminLayout
      title="トレーナー × メニュー"
      sub="担当できるメニューにチェックを入れてください。この設定が各時間帯の受入可能数になります。"
      actions={
        isStoreAdmin &&
        !form && (
          <Button variant="navy" onClick={() => setForm({ name: "", email: "", role: "staff" })}>
            トレーナーを追加
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
        <div style={{ border: `1px solid ${T.navy}`, borderRadius: radius.lg, padding: 16, marginBottom: 18, maxWidth: 380 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
            {form.id ? "トレーナー情報の編集" : "トレーナーを追加"}
          </div>

          <TextField
            label="氏名"
            required
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            placeholder="田中 太郎"
          />

          {!form.id && (
            <TextField
              label="メールアドレス"
              required
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="trainer@example.com"
            />
          )}

          <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 5 }}>権限</div>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            style={{
              width: "100%",
              background: T.field,
              border: `1px solid ${T.fieldBorder}`,
              borderRadius: radius.md,
              padding: "9px 10px",
              fontSize: 12,
              color: T.text,
              boxSizing: "border-box",
              outline: "none",
              marginBottom: 12,
            }}
          >
            <option value="staff">スタッフ(記録入力・予約枠)</option>
            <option value="admin">店舗管理者(すべての操作)</option>
          </select>

          <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.7, marginBottom: 14 }}>
            ここで追加したトレーナーは、受付枠を持つだけならログイン不要です。
            管理画面にログインさせる場合は、別途アカウントの紐づけが必要です。
            {form.id && <><br />メールアドレスは認証情報に紐づくため変更できません。</>}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="navy" onClick={saveStaff} loading={saving}>
              保存する
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              キャンセル
            </Button>
          </div>
        </div>
      )}

      {staff === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {staff?.length === 0 && (
        <Empty>トレーナーが登録されていません。</Empty>
      )}

      {staff && staff.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 520, width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th({ left: true })}>トレーナー</th>
                {menus.map((m) => (
                  <th key={m.id} style={th()}>
                    {m.name}
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,.7)", fontWeight: 400 }}>
                      {m.duration_min ? `${m.duration_min}分` : "—"}
                    </div>
                  </th>
                ))}
                <th style={th()}>
                  メニュー承認
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,.7)", fontWeight: 400 }}>
                    公開できる人
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s, i) => (
                <tr key={s.id} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                  <td style={td({ left: true })}>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 10.5, color: T.textFaint }}>
                        {s.role === "admin" ? "店舗管理者" : "スタッフ"}
                      </span>
                      {s.status === "pending" && <Badge tone="amber">承認待ち</Badge>}
                      {s.auth_user_id && s.status === "active" && <Badge tone="navy">ログイン可</Badge>}
                    </div>

                    {s.status === "pending" && isStoreAdmin && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        <Button variant="navy" onClick={() => approve(s, "staff")} loading={busy === `ok:${s.id}`}>
                          スタッフとして承認
                        </Button>
                        <Button variant="ghost" onClick={() => approve(s, "admin")} loading={busy === `ok:${s.id}`}>
                          店舗管理者として承認
                        </Button>
                      </div>
                    )}
                    {isStoreAdmin && (
                      <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 11 }}>
                        <span
                          onClick={() => setForm({ id: s.id, name: s.name, email: s.email, role: s.role })}
                          role="button"
                          tabIndex={0}
                          style={{ color: T.accent, cursor: "pointer" }}
                        >
                          編集
                        </span>
                        {confirmDelete === s.id ? (
                          <>
                            <span
                              onClick={() => removeStaff(s.id)}
                              role="button"
                              tabIndex={0}
                              style={{ color: T.danger, cursor: "pointer", fontWeight: 500 }}
                            >
                              {busy === `del:${s.id}` ? "削除中…" : "本当に削除"}
                            </span>
                            <span
                              onClick={() => setConfirmDelete(null)}
                              role="button"
                              tabIndex={0}
                              style={{ color: T.textMute, cursor: "pointer" }}
                            >
                              やめる
                            </span>
                          </>
                        ) : (
                          <span
                            onClick={() => setConfirmDelete(s.id)}
                            role="button"
                            tabIndex={0}
                            style={{ color: T.danger, cursor: "pointer" }}
                          >
                            削除
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  {menus.map((m) => {
                    const key = `${s.id}:${m.id}`;
                    const on = links.has(key);
                    return (
                      <td key={m.id} style={td()}>
                        <button
                          onClick={() => toggle(s.id, m.id)}
                          disabled={busy === key}
                          aria-pressed={on}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 7,
                            cursor: busy === key ? "default" : "pointer",
                            border: `1.5px solid ${on ? T.primary : T.fieldBorder}`,
                            background: on ? T.primary : T.bg,
                            color: T.onDark,
                            fontSize: 15,
                            lineHeight: 1,
                          }}
                        >
                          {on ? "✓" : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td style={td()}>
                    <button
                      onClick={() => isStoreAdmin && toggleApproval(s)}
                      disabled={!isStoreAdmin || busy === `approve:${s.id}`}
                      aria-pressed={s.can_approve_menus}
                      title={isStoreAdmin ? "" : "店舗管理者のみ変更できます"}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 7,
                        cursor: isStoreAdmin ? "pointer" : "default",
                        border: `1.5px solid ${s.can_approve_menus ? T.navy : T.fieldBorder}`,
                        background: s.can_approve_menus ? T.navy : T.bg,
                        color: T.onDark,
                        fontSize: 15,
                        lineHeight: 1,
                        opacity: isStoreAdmin ? 1 : 0.5,
                      }}
                    >
                      {s.can_approve_menus ? "✓" : ""}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11.5, color: T.textMute, lineHeight: 1.7 }}>
        担当を外しても、すでに入っている予約は取り消されません。
        <br />
        「メニュー承認」にチェックが入っている人だけが、仮登録されたメニューを会員に公開できます。変更できるのは店舗管理者のみです。
        <br />
        削除すると、予約が入っていない受付枠も一緒に消えます。予約が残っている場合は削除できません。
        <br />
        管理者ログイン画面から新規登録された方は「承認待ち」として並びます。承認するまで管理画面は操作できません。
        <br />
        「ログイン可」の方を削除すると、認証アカウントも一緒に削除されます。
      </div>
    </AdminLayout>
  );
}

const th = ({ left } = {}) => ({
  background: T.navy,
  color: T.onDark,
  fontSize: 11,
  fontWeight: 500,
  padding: "9px 12px",
  textAlign: left ? "left" : "center",
  whiteSpace: "nowrap",
});

const td = ({ left } = {}) => ({
  padding: "8px 12px",
  textAlign: left ? "left" : "center",
  borderTop: `1px solid ${T.borderFaint}`,
});

function Empty({ children }) {
  return (
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
      {children}
    </div>
  );
}
