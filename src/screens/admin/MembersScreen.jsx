import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Badge, Banner, Button, DataTable, Spinner, TextField } from "../../components";
import { downloadCsv, memberApi, toCsv } from "../../api";
import AdminLayout from "./AdminLayout";

const CSV_COLUMNS = [
  { label: "会員ID", value: (r) => r.id },
  { label: "氏名", value: (r) => r.name },
  { label: "メールアドレス", value: (r) => r.email },
  { label: "生年月日", value: (r) => r.birth_date || "" },
  { label: "グレード", value: (r) => r.grade },
  { label: "登録日", value: (r) => jdate(r.created_at) },
  { label: "これからの予約", value: (r) => r.upcoming },
  { label: "累計予約", value: (r) => r.total_reservations },
  { label: "回数券残", value: (r) => r.tickets_left },
  { label: "通い放題期限", value: (r) => r.membership_until || "" },
  { label: "直近来店", value: (r) => r.last_visit || "" },
];

const jdate = (v) =>
  v ? new Date(v).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }) : "";

// A-03 会員情報管理
export default function MembersScreen() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState("");
  const [banner, setBanner] = useState(null);

  const load = useCallback(async (q) => {
    setRows(null);
    const { data, error } = await memberApi.list({ query: q });
    if (error) setBanner(error);
    setRows(data || []);
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  // 入力が止まってから検索する
  useEffect(() => {
    const id = setTimeout(() => load(query), 350);
    return () => clearTimeout(id);
  }, [query, load]);

  function exportCsv() {
    if (!rows?.length) return;
    const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    downloadCsv(`fitgym_members_${stamp}.csv`, toCsv(rows, CSV_COLUMNS));
  }

  return (
    <AdminLayout
      title="会員管理"
      sub={rows ? `${rows.length} 名` : ""}
      actions={
        <Button variant="navy" onClick={exportCsv} disabled={!rows?.length}>
          CSVで書き出す
        </Button>
      }
    >
      {banner && <Banner>{banner}</Banner>}

      <div style={{ maxWidth: 320, marginBottom: 16 }}>
        <TextField
          label="検索(氏名・メールアドレス)"
          value={query}
          onChange={setQuery}
          placeholder="田中 / tanaka@..."
        />
      </div>

      {rows === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {rows?.length === 0 && (
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
          {query ? "該当する会員が見つかりませんでした。" : "会員がまだ登録されていません。"}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <DataTable
              columns={[
                { key: "name", label: "氏名", w: "1.1fr" },
                { key: "email", label: "メールアドレス", w: "1.6fr" },
                {
                  key: "upcoming",
                  label: "予約",
                  w: "0.7fr",
                  render: (v, r) => (
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {v > 0 ? <b style={{ color: T.primaryDark }}>{v}</b> : "0"}
                      <span style={{ color: T.textFaint }}> / 累計 {r.total_reservations}</span>
                    </span>
                  ),
                },
                {
                  key: "tickets_left",
                  label: "回数券",
                  w: "0.6fr",
                  render: (v) => (v > 0 ? <Badge tone="amber">残 {v} 回</Badge> : <span style={{ color: T.textFaint }}>—</span>),
                },
                {
                  key: "membership_until",
                  label: "通い放題",
                  w: "0.9fr",
                  render: (v) => (v ? <Badge tone="accent">{jdate(v)} まで</Badge> : <span style={{ color: T.textFaint }}>—</span>),
                },
                {
                  key: "last_visit",
                  label: "直近来店",
                  w: "0.8fr",
                  render: (v) => (v ? jdate(v) : <span style={{ color: T.textFaint }}>—</span>),
                },
                {
                  key: "id",
                  label: "操作",
                  w: "0.5fr",
                  render: (v) => (
                    <span
                      onClick={() => navigate(`/admin/members/${v}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/members/${v}`)}
                      style={{ color: T.accent, cursor: "pointer", fontFamily: font }}
                    >
                      詳細
                    </span>
                  ),
                },
              ]}
              rows={rows}
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11.5, color: T.textMute, lineHeight: 1.7 }}>
        CSV は Excel でそのまま開けます(文字化け防止の BOM 付き)。検索で絞り込んだ状態のまま書き出せます。
      </div>
    </AdminLayout>
  );
}
