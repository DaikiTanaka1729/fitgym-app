import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, radius } from "../../theme/tokens";
import { Banner } from "../../components";
import { supabase } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";

const CARDS = [
  { to: "/admin/members", title: "会員管理", desc: "一覧・検索・CSV出力" },
  { to: "/admin/reservations", title: "予約状況の確認", desc: "日付別の予約と枠の消化状況" },
  { to: "/admin/shifts", title: "受付枠(シフト)", desc: "トレーナー別の受付時間・クローズ" },
  { to: "/admin/timetable", title: "タイムテーブル", desc: "24時間の枠に誰を配置するか・申し送りメモ" },
  { to: "/admin/menus", title: "メニュー設定", desc: "3課金形態の登録・編集" },
  { to: "/admin/trainers", title: "トレーナー", desc: "担当できるメニューの紐づけ" },
  { to: "/admin/surveys", title: "アンケート・体験予約", desc: "回答の集計と体験申し込みの管理" },
];

// A-02 管理ダッシュボード
export default function DashboardScreen() {
  const navigate = useNavigate();
  const { admin } = useSession();
  const [stat, setStat] = useState(null);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!admin) return;
    (async () => {
      const today = new Date();
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

      const [members, todays, menus, slots] = await Promise.all([
        supabase.from("members").select("id", { count: "exact", head: true }).eq("store_id", admin.store_id),
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("store_id", admin.store_id)
          .eq("status", "booked")
          .gte("start_at", from)
          .lt("start_at", to),
        supabase.from("menus").select("id", { count: "exact", head: true }).eq("store_id", admin.store_id),
        supabase
          .from("slots")
          .select("id", { count: "exact", head: true })
          .eq("store_id", admin.store_id)
          .gte("start_at", from)
          .lt("start_at", to),
      ]);

      const err = members.error || todays.error || menus.error || slots.error;
      if (err) setBanner(err.message);

      setStat({
        members: members.count ?? 0,
        today: todays.count ?? 0,
        menus: menus.count ?? 0,
        slots: slots.count ?? 0,
      });
    })();
  }, [admin]);

  return (
    <AdminLayout title="ダッシュボード" sub="本日の状況">
      {banner && <Banner>{banner}</Banner>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 22 }}>
        <Stat label="会員数" value={stat?.members} unit="名" />
        <Stat label="本日の予約" value={stat?.today} unit="件" />
        <Stat label="本日の受付枠" value={stat?.slots} unit="枠" />
        <Stat label="メニュー" value={stat?.menus} unit="件" />
      </div>

      <div style={{ fontSize: 12, fontWeight: 500, color: T.textMute, marginBottom: 10 }}>各機能</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        {CARDS.map((c) => (
          <div
            key={c.to}
            onClick={() => navigate(c.to)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && navigate(c.to)}
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: radius.lg,
              padding: "14px 16px",
              cursor: "pointer",
              background: T.bg,
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.title}</div>
            <div style={{ fontSize: 11.5, color: T.textMute, marginTop: 4 }}>{c.desc}</div>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "13px 15px", background: T.navySoft }}>
      <div style={{ fontSize: 11, color: T.textMute }}>{label}</div>
      <div style={{ marginTop: 3, color: T.navy, fontWeight: 500 }}>
        <span style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</span>
        <span style={{ fontSize: 11, marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  );
}
