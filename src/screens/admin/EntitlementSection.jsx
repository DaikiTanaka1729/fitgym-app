import React, { useCallback, useEffect, useState } from "react";
import { T, font, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Segmented, Spinner, TextField } from "../../components";
import { memberApi, menuApi } from "../../api";
import { useSession } from "../../session";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// n ヶ月後の日付(YYYY-MM-DD)
function monthsLater(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

const jdate = (v) =>
  v ? new Date(v).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", year: "numeric" }) : "—";

// A-1 回数券・通い放題の付与(会員詳細に組み込む)
// 購入・決済の管理は行わない。「この会員は何回分の権利を持つか」だけを扱う。
export default function EntitlementSection({ memberId, onFlash }) {
  const { admin } = useSession();
  const [rows, setRows] = useState(null);
  const [menus, setMenus] = useState([]);
  const [banner, setBanner] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);

  const [form, setForm] = useState({
    kind: "ticket",
    menuId: "",
    remaining: "10",
    expireOn: monthsLater(6),
    startOn: today(),
    endOn: monthsLater(1),
  });

  const load = useCallback(async () => {
    const [e, m] = await Promise.all([
      memberApi.listEntitlements({ memberId }),
      menuApi.list({ storeId: admin.store_id }),
    ]);
    if (e.error) setBanner(e.error);
    setRows(e.data || []);
    setMenus((m.data || []).filter((x) => x.is_active && x.billing_type !== "time"));
  }, [memberId, admin]);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  const kindMenus = menus.filter((m) =>
    form.kind === "ticket" ? m.billing_type === "ticket" : m.billing_type === "unlimited"
  );

  // メニューを選んだら、そのメニューの既定値を入れる
  function pickMenu(menuId) {
    const m = menus.find((x) => x.id === menuId);
    if (!m) {
      setForm({ ...form, menuId });
      return;
    }
    setForm({
      ...form,
      menuId,
      remaining: m.ticket_count ? String(m.ticket_count) : form.remaining,
      expireOn: m.valid_months ? monthsLater(m.valid_months) : form.expireOn,
    });
  }

  async function grant() {
    setBanner(null);
    if (!form.menuId) {
      setBanner("メニューを選んでください");
      return;
    }

    setSaving(true);
    let res;
    if (form.kind === "ticket") {
      const n = Number(form.remaining);
      if (!Number.isInteger(n) || n < 1) {
        setSaving(false);
        setBanner("回数は1以上の整数で入力してください");
        return;
      }
      res = await memberApi.grantTicket({
        storeId: admin.store_id,
        memberId,
        menuId: form.menuId,
        remaining: n,
        expireOn: form.expireOn || null,
      });
    } else {
      if (form.endOn < form.startOn) {
        setSaving(false);
        setBanner("終了日は開始日より後にしてください");
        return;
      }
      res = await memberApi.grantMembership({
        storeId: admin.store_id,
        memberId,
        menuId: form.menuId,
        startOn: form.startOn,
        endOn: form.endOn,
      });
    }
    setSaving(false);
    if (res.error) {
      setBanner(res.error);
      return;
    }
    setOpen(false);
    setForm({ ...form, menuId: "" });
    onFlash?.(form.kind === "ticket" ? "回数券を付与しました" : "通い放題の契約を登録しました");
    load();
  }

  async function adjustTicket(row, delta) {
    const next = Math.max(0, (row.remaining ?? 0) + delta);
    setBusy(row.id);
    setBanner(null);
    const { error } = await memberApi.updateTicket({ ticketId: row.id, patch: { remaining: next } });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    load();
  }

  async function endMembership(row) {
    setBusy(row.id);
    setBanner(null);
    const { error } = await memberApi.updateMembership({
      membershipId: row.id,
      patch: { end_on: today() },
    });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    onFlash?.("契約を本日で終了しました");
    load();
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute }}>回数券・通い放題</div>
        {!open && (
          <Button variant="navy" onClick={() => setOpen(true)}>
            付与する
          </Button>
        )}
      </div>

      {banner && <Banner>{banner}</Banner>}

      {open && (
        <div style={{ border: `1px solid ${T.navy}`, borderRadius: radius.lg, padding: 16, marginBottom: 14 }}>
          <div style={{ maxWidth: 300, marginBottom: 14 }}>
            <Segmented
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: v, menuId: "" })}
              options={[
                { value: "ticket", label: "回数券" },
                { value: "unlimited", label: "通い放題" },
              ]}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, maxWidth: 620 }}>
            <Field label="メニュー">
              <select value={form.menuId} onChange={(e) => pickMenu(e.target.value)} style={selectStyle}>
                <option value="">選んでください</option>
                {kindMenus.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>

            {form.kind === "ticket" ? (
              <>
                <Field label="回数">
                  <TextField value={form.remaining} onChange={(v) => setForm({ ...form, remaining: v })} />
                </Field>
                <Field label="有効期限(空欄なら無期限)">
                  <input
                    type="date"
                    value={form.expireOn}
                    onChange={(e) => setForm({ ...form, expireOn: e.target.value })}
                    style={selectStyle}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="開始日">
                  <input
                    type="date"
                    value={form.startOn}
                    onChange={(e) => setForm({ ...form, startOn: e.target.value })}
                    style={selectStyle}
                  />
                </Field>
                <Field label="終了日">
                  <input
                    type="date"
                    value={form.endOn}
                    onChange={(e) => setForm({ ...form, endOn: e.target.value })}
                    style={selectStyle}
                  />
                </Field>
              </>
            )}
          </div>

          {kindMenus.length === 0 && (
            <div style={{ fontSize: 11.5, color: T.danger, marginTop: 4 }}>
              {form.kind === "ticket" ? "回数券" : "通い放題"}のメニューが登録されていません。先にメニュー設定で追加してください。
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Button variant="navy" onClick={grant} loading={saving} disabled={kindMenus.length === 0}>
              付与する
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
          </div>

          <div style={{ fontSize: 11, color: T.textMute, marginTop: 10, lineHeight: 1.7 }}>
            購入・決済の記録は行いません。ここで登録するのは「予約に使える権利」だけです。
          </div>
        </div>
      )}

      {rows === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
          <Spinner color={T.textFaint} size={18} />
        </div>
      )}

      {rows?.length === 0 && !open && (
        <div
          style={{
            border: `1px dashed ${T.fieldBorder}`,
            borderRadius: radius.lg,
            padding: "22px 16px",
            textAlign: "center",
            background: T.bgSubtle,
            color: T.textFaint,
            fontSize: 12.5,
            lineHeight: 1.7,
          }}
        >
          回数券・通い放題の登録はありません。
          <br />
          この会員が予約できるのは、上で登録した時間課金のメニューだけです。
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows?.map((r) => (
          <div
            key={`${r.kind}:${r.id}`}
            style={{
              border: `1px solid ${r.is_valid ? T.border : T.borderFaint}`,
              borderRadius: radius.lg,
              padding: "11px 14px",
              opacity: r.is_valid ? 1 : 0.6,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{r.menu_name}</span>
                <Badge tone={r.kind === "ticket" ? "amber" : "accent"}>
                  {r.kind === "ticket" ? "回数券" : "通い放題"}
                </Badge>
                {!r.is_valid && <Badge tone="gray">利用不可</Badge>}
              </div>
              <div style={{ fontSize: 11.5, color: T.textMute, marginTop: 4 }}>
                {r.kind === "ticket"
                  ? `残り ${r.remaining} 回 · 有効期限 ${r.expire_on ? jdate(r.expire_on) : "無期限"}`
                  : `${jdate(r.start_on)} 〜 ${jdate(r.end_on)}`}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {r.kind === "ticket" ? (
                <>
                  <Round onClick={() => adjustTicket(r, -1)} disabled={busy === r.id || r.remaining <= 0}>
                    −
                  </Round>
                  <Round onClick={() => adjustTicket(r, 1)} disabled={busy === r.id}>
                    ＋
                  </Round>
                </>
              ) : (
                r.is_valid && (
                  <Button variant="ghost" onClick={() => endMembership(r)} loading={busy === r.id}>
                    本日で終了
                  </Button>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
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

function Round({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${T.fieldBorder}`,
        background: T.bg,
        color: disabled ? T.textFaint : T.text,
        fontSize: 14,
        fontFamily: font,
        cursor: disabled ? "default" : "pointer",
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

const selectStyle = {
  width: "100%",
  background: T.field,
  border: `1px solid ${T.fieldBorder}`,
  borderRadius: radius.md,
  padding: "9px 10px",
  fontSize: 12,
  color: T.text,
  fontFamily: font,
  boxSizing: "border-box",
  outline: "none",
};
