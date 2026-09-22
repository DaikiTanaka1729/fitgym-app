import React, { useCallback, useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Spinner } from "../../components";
import { menuApi } from "../../api";

// 指名券が使えるメニューの指定(メニュー設定に組み込む)
// ------------------------------------------------------------
// 指名券は「どのメニューのときにトレーナーを指名できるか」を
// 券ごとに決める。ここでチェックを入れたメニューでだけ、
// 会員の予約画面に「トレーナーを指名する」が出る。
// ------------------------------------------------------------
export default function NominationLinksSection({ menus, onFlash }) {
  const [links, setLinks] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await menuApi.listNominationLinks();
    if (error) setBanner(error);
    setLinks(new Set((data || []).map((x) => `${x.nomination_menu_id}:${x.menu_id}`)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nominations = menus.filter((m) => m.billing_type === "nomination" && m.is_active);
  const targets = menus.filter((m) => m.billing_type !== "nomination" && m.is_active);

  async function toggle(nominationMenuId, menuId) {
    const key = `${nominationMenuId}:${menuId}`;
    const on = links.has(key);
    setBusy(key);
    setBanner(null);
    const { error } = await menuApi.setNominationLink({ nominationMenuId, menuId, on: !on });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    const next = new Set(links);
    on ? next.delete(key) : next.add(key);
    setLinks(next);
    onFlash?.(on ? "適用から外しました" : "適用に追加しました");
  }

  if (nominations.length === 0) return null;

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>指名券の適用メニュー</div>
      <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.8, marginBottom: 12 }}>
        チェックを入れたメニューでだけ、その指名券を使ってトレーナーを指名できます。
        指名した予約は、あとから担当を付け替えられません。
      </div>

      {banner && <Banner>{banner}</Banner>}

      {links === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
          <Spinner color={T.textFaint} size={18} />
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 520, fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left" }}>指名券</th>
                {targets.map((m) => (
                  <th key={m.id} style={thStyle}>
                    {m.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nominations.map((n, i) => (
                <tr key={n.id} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <span style={{ marginRight: 8 }}>{n.name}</span>
                    <Badge tone="navy">指名券</Badge>
                  </td>
                  {targets.map((m) => {
                    const key = `${n.id}:${m.id}`;
                    return (
                      <td key={m.id} style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={links.has(key)}
                          disabled={busy === key}
                          onChange={() => toggle(n.id, m.id)}
                          style={{ width: 16, height: 16, accentColor: T.navy, cursor: "pointer" }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {targets.length === 0 && (
            <div
              style={{
                border: `1px dashed ${T.fieldBorder}`,
                borderRadius: radius.lg,
                padding: "18px 16px",
                textAlign: "center",
                color: T.textFaint,
                fontSize: 12,
                marginTop: 10,
              }}
            >
              指名券を適用できるメニューがありません。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const thStyle = {
  background: T.navy,
  color: T.onDark,
  fontSize: 11,
  fontWeight: 500,
  padding: "8px 12px",
  textAlign: "center",
  whiteSpace: "nowrap",
};

const tdStyle = { padding: "8px 12px", borderTop: `1px solid ${T.borderFaint}` };
