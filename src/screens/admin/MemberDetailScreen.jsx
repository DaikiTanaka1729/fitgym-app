import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner, TextField, Toast } from "../../components";
import { memberApi, reservationApi } from "../../api";
import AdminLayout from "./AdminLayout";
import EntitlementSection from "./EntitlementSection";
import MenuAccessSection from "./MenuAccessSection";
import RecordSection from "./RecordSection";
import PasswordSection from "./PasswordSection";

// membership は 0005 より前に入った予約の値。表示だけ拾えるようにしておく。
const SOURCE = { time: "時間課金", unlimited: "通い放題", membership: "通い放題", ticket: "回数券" };
const TONE = { time: "primary", unlimited: "accent", membership: "accent", ticket: "amber" };
const STATUS = { booked: "予約済", done: "完了", cancelled: "キャンセル" };

const jdt = (v) =>
  new Date(v).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const jtime = (v) =>
  new Date(v).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

// A-03d 会員詳細
export default function MemberDetailScreen() {
  const { memberId } = useParams();
  const navigate = useNavigate();

  const [member, setMember] = useState(null);
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [settling, setSettling] = useState(null);

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([
      memberApi.get({ memberId }),
      memberApi.listReservations({ memberId }),
    ]);
    if (m.error) setBanner(m.error);
    setMember(m.data?.[0] || null);
    setRows(r.data || []);
  }, [memberId]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  async function save() {
    setBanner(null);
    if (!edit.name.trim()) {
      setBanner("氏名を入力してください");
      return;
    }
    setSaving(true);
    const { error } = await memberApi.update({
      memberId,
      patch: {
        name: edit.name.trim(),
        birth_date: edit.birth_date || null,
        grade: edit.grade || "normal",
      },
    });
    setSaving(false);
    if (error) {
      setBanner(error);
      return;
    }
    setEdit(null);
    flash("会員情報を更新しました");
    load();
  }

  async function cancelReservation(id) {
    setBanner(null);
    setCancelling(id);
    const { error } = await reservationApi.cancel({ reservationId: id });
    setCancelling(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash("予約をキャンセルしました");
    load();
  }

  // 未購入のまま入った予約を、店舗での購入として処理する。
  // 回数券のときは、先に下の「回数券・通い放題」で付与しておく必要がある。
  async function settle(id) {
    setBanner(null);
    setSettling(id);
    const { error } = await reservationApi.settlePurchase({ reservationId: id });
    setSettling(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash("店舗での購入として処理しました");
    load();
  }

  if (member === null && rows === null) {
    return (
      <AdminLayout title="会員詳細">
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      </AdminLayout>
    );
  }

  if (!member) {
    return (
      <AdminLayout title="会員詳細">
        <Banner>会員が見つかりませんでした。</Banner>
        <Button variant="ghost" onClick={() => navigate("/admin/members")}>
          会員一覧へ戻る
        </Button>
      </AdminLayout>
    );
  }

  const upcoming = rows?.filter((r) => r.status === "booked" && new Date(r.start_at) > new Date()) || [];
  const past = rows?.filter((r) => !upcoming.includes(r)) || [];

  return (
    <AdminLayout
      title={member.name}
      sub={member.email}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {!edit && (
            <Button
              variant="navy"
              onClick={() =>
                setEdit({
                  name: member.name,
                  birth_date: member.birth_date || "",
                  grade: member.grade || "normal",
                })
              }
            >
              情報を編集
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate("/admin/members")}>
            一覧へ戻る
          </Button>
        </div>
      }
    >
      {banner && <Banner>{banner}</Banner>}
      {toast && (
        <div style={{ marginBottom: 12 }}>
          <Toast>{toast}</Toast>
        </div>
      )}

      {/* ---- 基本情報 ---- */}
      {edit ? (
        <div style={{ border: `1px solid ${T.navy}`, borderRadius: radius.lg, padding: 16, marginBottom: 20, maxWidth: 380 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>会員情報の編集</div>
          <TextField label="氏名" required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
          <TextField
            label="生年月日(YYYY-MM-DD)"
            value={edit.birth_date}
            onChange={(v) => setEdit({ ...edit, birth_date: v })}
            placeholder="1990-01-01"
          />
          <TextField label="グレード" value={edit.grade} onChange={(v) => setEdit({ ...edit, grade: v })} placeholder="normal" />
          <div style={{ fontSize: 11, color: T.textMute, marginBottom: 12, lineHeight: 1.6 }}>
            メールアドレスは認証情報に紐づくため、この画面からは変更できません。
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="navy" onClick={save} loading={saving}>
              保存する
            </Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              キャンセル
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 22 }}>
          <Info label="生年月日" value={member.birth_date || "—"} />
          <Info label="グレード" value={member.grade} />
          <Info label="登録日" value={new Date(member.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} />
          <Info label="これからの予約" value={`${upcoming.length} 件`} />
        </div>
      )}

      {/* ---- これからの予約 ---- */}
      <Section title="これからの予約">
        {upcoming.length === 0 ? (
          <Empty>これからの予約はありません。</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcoming.map((r) => (
              <div
                key={r.id}
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: radius.lg,
                  padding: "11px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {jdt(r.start_at)} 〜 {jtime(r.end_at)}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.textMute, marginTop: 3 }}>
                    {r.menu_name}
                    {r.trainer_name ? ` · 担当 ${r.trainer_name}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge tone={TONE[r.source]}>{SOURCE[r.source]}</Badge>
                  {r.nominated && <Badge tone="navy">指名</Badge>}
                  {r.needs_purchase && <Badge tone="danger">要購入</Badge>}
                  {r.needs_purchase && (
                    <Button variant="navy" onClick={() => settle(r.id)} loading={settling === r.id}>
                      購入を反映
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => cancelReservation(r.id)} loading={cancelling === r.id}>
                    キャンセル
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---- 履歴 ---- */}
      <Section title="予約履歴">
        {past.length === 0 ? (
          <Empty>履歴はまだありません。</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["日時", "メニュー", "担当", "支払い", "状態"].map((h) => (
                    <th
                      key={h}
                      style={{
                        background: T.navy,
                        color: T.onDark,
                        fontSize: 11,
                        fontWeight: 500,
                        padding: "8px 12px",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {past.map((r, i) => (
                  <tr key={r.id} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                    <td style={cellStyle}>{jdt(r.start_at)}</td>
                    <td style={cellStyle}>{r.menu_name}</td>
                    <td style={cellStyle}>{r.trainer_name || "—"}</td>
                    <td style={cellStyle}>
                      <Badge tone={TONE[r.source]}>{SOURCE[r.source]}</Badge>
                      {r.needs_purchase && r.status !== "cancelled" && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="danger">要購入</Badge>
                        </div>
                      )}
                    </td>
                    <td style={cellStyle}>
                      <Badge tone={r.status === "cancelled" ? "gray" : "primary"}>{STATUS[r.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---- 時間課金メニューの購入登録 ---- */}
      <MenuAccessSection memberId={memberId} onFlash={flash} />

      {/* ---- 回数券・通い放題(A-1) ---- */}
      <EntitlementSection memberId={memberId} onFlash={flash} />

      {/* ---- 記録の代理入力(A-04) ---- */}
      <RecordSection memberId={memberId} onFlash={flash} />

      {/* ---- パスワード操作(A-08) ---- */}
      <PasswordSection member={member} onFlash={flash} />
    </AdminLayout>
  );
}

const cellStyle = { padding: "9px 12px", borderTop: `1px solid ${T.borderFaint}` };

function Info({ label, value }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "11px 14px" }}>
      <div style={{ fontSize: 11, color: T.textMute }}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
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
      {children}
    </div>
  );
}
