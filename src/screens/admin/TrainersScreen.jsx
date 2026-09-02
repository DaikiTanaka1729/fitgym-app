import React, { useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Banner, Spinner, Toast } from "../../components";
import { menuApi, shiftApi } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";

// A-11 トレーナー × メニューの紐づけ
// ここで設定した内容が、各時間帯に何件の予約を受けられるかを決める。
export default function TrainersScreen() {
  const { admin } = useSession();
  const [staff, setStaff] = useState(null);
  const [menus, setMenus] = useState([]);
  const [links, setLinks] = useState(new Set());
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!admin) return;
    (async () => {
      const [s, m, l] = await Promise.all([
        shiftApi.listStaff(),
        menuApi.list({ storeId: admin.store_id }),
        shiftApi.listStaffMenus(),
      ]);
      if (s.error || m.error || l.error) setBanner(s.error || m.error || l.error);
      setStaff(s.data || []);
      setMenus(m.data || []);
      setLinks(new Set((l.data || []).map((x) => `${x.admin_id}:${x.menu_id}`)));
    })();
  }, [admin]);

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
    >
      {banner && <Banner>{banner}</Banner>}
      {toast && (
        <div style={{ marginBottom: 12 }}>
          <Toast>{toast}</Toast>
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
              </tr>
            </thead>
            <tbody>
              {staff.map((s, i) => (
                <tr key={s.id} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                  <td style={td({ left: true })}>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 10.5, color: T.textFaint }}>
                      {s.role === "admin" ? "店舗管理者" : "スタッフ"}
                    </div>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11.5, color: T.textMute, lineHeight: 1.7 }}>
        担当を外しても、すでに入っている予約は取り消されません。
        <br />
        トレーナーの追加は現在データベースから行っています。画面からの追加は今後対応します。
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
