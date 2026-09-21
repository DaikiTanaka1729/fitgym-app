import React, { useCallback, useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Spinner } from "../../components";
import { memberApi } from "../../api";

// 時間課金メニューの購入登録(会員詳細に組み込む)
// ------------------------------------------------------------
// 回数券・通い放題は残数や契約期間が権利そのものになるが、
// 時間課金にはそれがない。そのため「この会員はこのメニューを
// 買った」という登録をここで行い、それが会員の予約画面に反映される。
// 登録のないメニューは会員側で「店舗でご購入ください」と表示され、選べない。
export default function MenuAccessSection({ memberId, onFlash }) {
  const [rows, setRows] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await memberApi.listMenuAccess({ memberId });
    if (error) setBanner(error);
    setRows(data || []);
  }, [memberId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(row) {
    const next = !row.purchased;
    setBusy(row.menu_id);
    setBanner(null);
    // 待ち時間に画面が固まらないよう、先に表示を切り替える
    setRows((prev) =>
      prev.map((r) => (r.menu_id === row.menu_id ? { ...r, purchased: next } : r))
    );
    const { error } = await memberApi.setMenuAccess({ memberId, menuId: row.menu_id, on: next });
    setBusy(null);
    if (error) {
      setBanner(error);
      load();
      return;
    }
    onFlash?.(next ? `${row.name} を予約できるようにしました` : `${row.name} の登録を外しました`);
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute, marginBottom: 10 }}>
        利用できるメニュー(時間課金)
      </div>

      {banner && <Banner>{banner}</Banner>}

      {rows === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
          <Spinner color={T.textFaint} size={18} />
        </div>
      )}

      {rows?.length === 0 && (
        <div
          style={{
            border: `1px dashed ${T.fieldBorder}`,
            borderRadius: radius.lg,
            padding: "22px 16px",
            textAlign: "center",
            background: T.bgSubtle,
            color: T.textFaint,
            fontSize: 12.5,
          }}
        >
          時間課金のメニューが登録されていません。
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows?.map((r) => (
          <label
            key={r.menu_id}
            style={{
              border: `1px solid ${r.purchased ? T.navy : T.borderFaint}`,
              background: r.purchased ? T.navySoft : T.bg,
              borderRadius: radius.lg,
              padding: "11px 14px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: busy === r.menu_id ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={!!r.purchased}
              disabled={busy === r.menu_id}
              onChange={() => toggle(r)}
              style={{ width: 17, height: 17, accentColor: T.navy, cursor: "inherit" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</span>
                <Badge tone="gray">時間課金</Badge>
                {r.status !== "published" && <Badge tone="amber">仮登録</Badge>}
              </div>
              <div style={{ fontSize: 11.5, color: T.textMute, marginTop: 4 }}>
                {r.duration_min} 分 · {r.price != null ? `¥${Number(r.price).toLocaleString()}` : "—"}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div style={{ fontSize: 11, color: T.textMute, marginTop: 10, lineHeight: 1.7 }}>
        チェックを入れたメニューだけが、この会員の予約画面で選べるようになります。
        外したメニューは一覧には表示されますが「店舗でご購入ください」となり選べません。
      </div>
    </div>
  );
}
