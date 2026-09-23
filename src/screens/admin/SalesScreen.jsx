import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Segmented, Spinner, Toast } from "../../components";
import { downloadCsv, salesApi, toCsv } from "../../api";
import { useSession } from "../../session";
import AdminLayout from "./AdminLayout";
import { APP_SLUG } from "../../appConfig";

// A-12 売上
// ------------------------------------------------------------
// 確定した売上(受け取った代金)と、売上見込み(未購入のまま入っている
// 予約)を分けて出す。予約はキャンセルされうるので、混ぜると
// 締めの数字として使えなくなる。
// ------------------------------------------------------------

const KIND = { time: "時間課金", ticket: "回数券", unlimited: "通い放題", nomination: "指名券" };
const TONE = { time: "primary", ticket: "amber", unlimited: "accent", nomination: "navy" };
const SOURCE = { grant: "会員詳細から", settle: "予約の購入を反映", backfill: "過去分の取り込み" };

const yen = (v) => `¥${Number(v ?? 0).toLocaleString()}`;
const jst = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const jdate = (v) =>
  new Date(v).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
const jdt = (v) =>
  new Date(v).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// よく使う期間。締めの作業を押しやすくする。
function presets() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = (yy, mm) => jst(new Date(yy, mm, 1));
  const last = (yy, mm) => jst(new Date(yy, mm + 1, 0));
  return [
    { key: "this", label: "今月", from: first(y, m), to: last(y, m) },
    { key: "prev", label: "先月", from: first(y, m - 1), to: last(y, m - 1) },
    { key: "year", label: "今年", from: first(y, 0), to: last(y, 11) },
  ];
}

export default function SalesScreen() {
  const navigate = useNavigate();
  const { admin } = useSession();
  const isStoreAdmin = admin?.role === "admin";
  const P = presets();

  const [tab, setTab] = useState("fixed");
  const [from, setFrom] = useState(P[0].from);
  const [to, setTo] = useState(P[0].to);
  const [rows, setRows] = useState(null);
  const [sum, setSum] = useState([]);
  const [expected, setExpected] = useState(null);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setRows(null);
    const [l, s, e] = await Promise.all([
      salesApi.list({ from, to }),
      salesApi.summary({ from, to }),
      salesApi.expected(),
    ]);
    if (l.error || s.error || e.error) setBanner(l.error || s.error || e.error);
    setRows(l.data || []);
    setSum(s.data || []);
    setExpected(e.data || []);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(m) {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  }

  async function remove(r) {
    setBanner(null);
    setBusy(r.id);
    const { error } = await salesApi.remove({ saleId: r.id });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    flash("売上を取り消しました");
    load();
  }

  const total = (rows || []).reduce((a, r) => a + (r.amount || 0), 0);
  const expectedTotal = (expected || []).reduce((a, r) => a + (r.amount || 0), 0);
  const overdue = (expected || []).filter((r) => r.overdue);
  const overdueTotal = overdue.reduce((a, r) => a + (r.amount || 0), 0);

  function exportFixed() {
    if (!rows?.length) return;
    downloadCsv(
      `${APP_SLUG}_sales_${from}_${to}.csv`,
      toCsv(rows, [
        { label: "売上日", value: (r) => r.sold_on },
        { label: "会員名", value: (r) => r.member_name || "(退会)" },
        { label: "メニュー", value: (r) => r.menu_name },
        { label: "種別", value: (r) => KIND[r.kind] || r.kind },
        { label: "金額", value: (r) => r.amount },
        { label: "登録者", value: (r) => r.admin_name || "" },
        { label: "経路", value: (r) => SOURCE[r.source] || r.source },
      ])
    );
  }

  function exportExpected() {
    if (!expected?.length) return;
    downloadCsv(
      `${APP_SLUG}_sales_expected_${jst(new Date())}.csv`,
      toCsv(expected, [
        { label: "予約日時", value: (r) => jdt(r.start_at) },
        { label: "会員名", value: (r) => r.member_name },
        { label: "メニュー", value: (r) => r.menu_name },
        { label: "種別", value: (r) => KIND[r.kind] || r.kind },
        { label: "見込み金額", value: (r) => r.amount },
        { label: "状態", value: (r) => (r.overdue ? "未処理(開始済み)" : "これから") },
      ])
    );
  }

  const loading = rows === null || expected === null;

  return (
    <AdminLayout
      title="売上"
      sub="会員が購入した時点で記録されます"
      actions={
        <Button
          variant="navy"
          onClick={tab === "fixed" ? exportFixed : exportExpected}
          disabled={tab === "fixed" ? !rows?.length : !expected?.length}
        >
          CSVで書き出す
        </Button>
      }
    >
      {banner && <Banner>{banner}</Banner>}
      {toast && (
        <div style={{ marginBottom: 12 }}>
          <Toast>{toast}</Toast>
        </div>
      )}

      <div style={{ maxWidth: 380, marginBottom: 16 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "fixed", label: "確定した売上" },
            { value: "expected", label: `売上見込み${expected?.length ? `(${expected.length})` : ""}` },
          ]}
        />
      </div>

      {/* ---------- 確定した売上 ---------- */}
      {tab === "fixed" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            {P.map((p) => {
              const on = from === p.from && to === p.to;
              return (
                <div
                  key={p.key}
                  onClick={() => {
                    setFrom(p.from);
                    setTo(p.to);
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    border: `1px solid ${on ? T.navy : T.fieldBorder}`,
                    background: on ? T.navySoft : T.bg,
                    color: on ? T.navy : T.textMute,
                    fontWeight: on ? 500 : 400,
                    borderRadius: radius.md,
                    padding: "7px 13px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {p.label}
                </div>
              );
            })}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateStyle} />
            <span style={{ fontSize: 12, color: T.textMute }}>〜</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={dateStyle} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
            <Stat label="売上合計" value={yen(total)} big />
            <Stat label="件数" value={`${rows?.length ?? 0} 件`} />
            <Stat
              label="1件あたり"
              value={rows?.length ? yen(Math.round(total / rows.length)) : "—"}
            />
          </div>

          {loading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
              <Spinner color={T.textFaint} size={20} />
            </div>
          )}

          {!loading && sum.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute, marginBottom: 8 }}>
                メニュー別
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sum.map((s) => (
                  <div
                    key={`${s.menu_name}:${s.kind}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      border: `1px solid ${T.borderFaint}`,
                      borderRadius: radius.md,
                      padding: "9px 13px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5 }}>{s.menu_name}</span>
                      <Badge tone={TONE[s.kind]}>{KIND[s.kind]}</Badge>
                      <span style={{ fontSize: 11, color: T.textFaint }}>{s.count} 件</span>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>{yen(s.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && rows?.length === 0 && (
            <Empty>この期間の売上はありません。</Empty>
          )}

          {!loading && rows?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["売上日", "会員", "メニュー", "種別", "金額", "登録者", "経路", ""].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{jdate(r.sold_on)}</td>
                      <td style={tdStyle}>
                        {r.member_id ? (
                          <span
                            onClick={() => navigate(`/admin/members/${r.member_id}`)}
                            role="button"
                            tabIndex={0}
                            style={{ color: T.accent, cursor: "pointer" }}
                          >
                            {r.member_name}
                          </span>
                        ) : (
                          <span style={{ color: T.textFaint }}>{r.member_name || "(退会)"}</span>
                        )}
                      </td>
                      <td style={tdStyle}>{r.menu_name}</td>
                      <td style={tdStyle}>
                        <Badge tone={TONE[r.kind]}>{KIND[r.kind]}</Badge>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {yen(r.amount)}
                      </td>
                      <td style={tdStyle}>{r.admin_name || "—"}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: T.textMute }}>
                        {SOURCE[r.source] || r.source}
                      </td>
                      <td style={tdStyle}>
                        {isStoreAdmin && (
                          <Button variant="ghost" onClick={() => remove(r)} loading={busy === r.id}>
                            取り消す
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 11.5, color: T.textMute, lineHeight: 1.8 }}>
            金額は購入した時点のメニュー価格を書き写して持っています。あとからメニューの値段を変えても、過去の売上は変わりません。
            <br />
            「過去分の取り込み」は、この機能を入れる前に付与された分です。当時の価格が残っていないため、取り込み時点の価格で計上しています。
            <br />
            すでにお持ちの回数券を1回消費した予約は、売上を二重に数えないよう計上しません(購入時に計上済みのため)。
          </div>
        </>
      )}

      {/* ---------- 売上見込み ---------- */}
      {tab === "expected" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
            <Stat label="見込み合計" value={yen(expectedTotal)} big />
            <Stat label="件数" value={`${expected?.length ?? 0} 件`} />
            <Stat label="未処理(開始済み)" value={`${overdue.length} 件 / ${yen(overdueTotal)}`} danger={overdue.length > 0} />
          </div>

          {loading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
              <Spinner color={T.textFaint} size={20} />
            </div>
          )}

          {!loading && expected?.length === 0 && (
            <Empty>未購入のまま入っている予約はありません。</Empty>
          )}

          {!loading && expected?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 660, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["予約日時", "会員", "メニュー", "種別", "見込み金額", "状態"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expected.map((r, i) => (
                    <tr key={r.reservation_id} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{jdt(r.start_at)}</td>
                      <td style={tdStyle}>
                        <span
                          onClick={() => navigate(`/admin/members/${r.member_id}`)}
                          role="button"
                          tabIndex={0}
                          style={{ color: T.accent, cursor: "pointer" }}
                        >
                          {r.member_name}
                        </span>
                      </td>
                      <td style={tdStyle}>{r.menu_name}</td>
                      <td style={tdStyle}>
                        <Badge tone={TONE[r.kind]}>{KIND[r.kind]}</Badge>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {yen(r.amount)}
                      </td>
                      <td style={tdStyle}>
                        {r.overdue ? <Badge tone="danger">未処理</Badge> : <Badge tone="gray">これから</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 11.5, color: T.textMute, lineHeight: 1.8 }}>
            未購入のメニューで入っている予約です。まだ代金を受け取っていないので、確定した売上には含めていません。
            <br />
            来店時に代金を受け取ったら、予約状況の画面で「購入を反映」を押してください。その時点で確定した売上に移ります。
            <br />
            「未処理」は開始時刻を過ぎているのに反映されていない分です。取りはぐれの可能性があるのでご確認ください。
          </div>
        </>
      )}
    </AdminLayout>
  );
}

function Stat({ label, value, big, danger }) {
  return (
    <div
      style={{
        border: `1px solid ${danger ? T.dangerBorder : T.borderFaint}`,
        background: danger ? T.dangerSoft : T.bgSubtle,
        borderRadius: radius.lg,
        padding: "13px 16px",
      }}
    >
      <div style={{ fontSize: 11, color: danger ? T.dangerDark : T.textMute, marginBottom: 5 }}>{label}</div>
      <div
        style={{
          fontSize: big ? 22 : 16,
          fontWeight: 600,
          color: danger ? T.dangerDark : T.navy,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return (
    <div
      style={{
        border: `1px dashed ${T.fieldBorder}`,
        borderRadius: radius.lg,
        padding: "26px 16px",
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

const dateStyle = {
  background: T.field,
  border: `1px solid ${T.fieldBorder}`,
  borderRadius: radius.md,
  padding: "7px 9px",
  fontSize: 12,
  color: T.text,
  fontFamily: font,
  outline: "none",
};

const thStyle = {
  background: T.navy,
  color: T.onDark,
  fontSize: 11,
  fontWeight: 500,
  padding: "9px 12px",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle = { padding: "9px 12px", borderTop: `1px solid ${T.borderFaint}` };
