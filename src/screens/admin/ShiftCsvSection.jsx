import React, { useRef, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner } from "../../components";
import { downloadCsv, shiftApi } from "../../api";
import { APP_SLUG } from "../../appConfig";
import { buildTemplate, readShiftCsv } from "./shiftCsv";

// 受付枠のCSV取り込み(トレーナー画面に組み込む)
// ------------------------------------------------------------
// 出勤表をそのまま貼れることを優先する。
//   ・ひな型は、翌月の日付を横軸・30分刻みの時間を縦軸にした表
//   ・トレーナーごとに1ブロック。全員分が1つのファイルに入る
//   ・1行が駄目でも残りは登録する(どこが駄目かを返す)
//   ・同じ枠を二重に作らないので、貼り直しても壊れない
// 読み書きの中身は shiftCsv.js にまとめてある。
// ------------------------------------------------------------

export default function ShiftCsvSection({ staff = [], onDone }) {
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState(null);
  const [rows, setRows] = useState(null);      // 取り込む予定の行
  const [bad, setBad] = useState([]);          // 読み取れなかった行
  const [result, setResult] = useState(null);  // 登録後の結果
  const [saving, setSaving] = useState(false);
  const [format, setFormat] = useState(null);

  function reset() {
    setRows(null);
    setBad([]);
    setResult(null);
    setBanner(null);
    setFormat(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function readFile(file) {
    reset();
    const reader = new FileReader();
    reader.onload = () => {
      try {
        parse(String(reader.result));
      } catch (e) {
        setBanner("CSVを読み取れませんでした。文字コードは UTF-8 で保存してください。");
      }
    };
    reader.onerror = () => setBanner("ファイルを読み込めませんでした");
    reader.readAsText(file, "UTF-8");
  }

  function parse(text) {
    const { ranges, errors, fatal, format } = readShiftCsv(text);
    if (fatal) {
      setBanner(fatal);
      return;
    }
    setRows(ranges.map((r, i) => ({ ...r, key: i })));
    setBad(errors);
    setFormat(format);
    if (ranges.length === 0) setBanner("登録できる出勤がありませんでした");
  }

  async function submit() {
    setBanner(null);
    setSaving(true);
    const { data, error } = await shiftApi.importShifts({
      rows: rows.map(({ key, label, ...r }) => r),
    });
    setSaving(false);
    if (error) {
      setBanner(error);
      return;
    }
    setResult(data || []);
    setRows(null);
    if (fileRef.current) fileRef.current.value = "";
    onDone?.();
  }

  function template() {
    downloadCsv(`${APP_SLUG}_shifts_${nextMonth()}.csv`, buildTemplate(staff));
  }

  const madeTotal = (result || []).reduce((a, r) => a + (r.created || 0), 0);
  const failed = (result || []).filter((r) => r.error);

  return (
    <div style={{ marginBottom: 26 }}>
      <div
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: `1px solid ${T.fieldBorder}`,
          borderRadius: radius.lg,
          background: T.bgSubtle,
          padding: "11px 14px",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>受付枠をCSVでまとめて登録</span>
        <span style={{ fontSize: 11, color: T.textMute }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ border: `1px solid ${T.borderFaint}`, borderTop: "none", borderRadius: `0 0 ${radius.lg}px ${radius.lg}px`, padding: 16 }}>
          {banner && <Banner>{banner}</Banner>}

          <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.9, marginBottom: 14 }}>
            「見本をダウンロード」で<strong>翌月のひな型</strong>が出ます。横が日付、縦が30分刻みの時間で、
            トレーナー全員分が1つのファイルに入っています。
            <br />
            出勤する時間の<strong>「開始」と「終了」のセルに、開始 / 終了 と入力</strong>して読み込ませてください。
            1日に2回出勤する場合は、開始と終了を2組書きます。
            <br />
            終了の時刻そのものの枠は作りません(18:00 と書くと最後の枠は 17:30 開始です)。
            <br />
            すでにある枠は作り直さないので、同じファイルを二度読み込んでも壊れません。
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <Button variant="ghost" onClick={template}>
              見本をダウンロード
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
              style={{ fontSize: 12, color: T.textMute }}
            />
          </div>

          {bad.length > 0 && (
            <div
              style={{
                border: `1px solid ${T.dangerBorder}`,
                background: T.dangerSoft,
                borderRadius: radius.lg,
                padding: "11px 13px",
                fontSize: 11.5,
                lineHeight: 1.8,
                color: T.dangerDark,
                marginBottom: 12,
              }}
            >
              読み取れなかった箇所({bad.length}件)
              {bad.slice(0, 10).map((b, i) => (
                <div key={i}>
                  {b.line ? `${b.line}行目 … ` : ""}{b.why}
                </div>
              ))}
              {bad.length > 10 && <div>ほか {bad.length - 10} 件</div>}
            </div>
          )}

          {rows && rows.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
                この内容で登録します(出勤 {rows.length} 件{format === "grid" ? "・表形式" : ""})
              </div>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 12 }}>
                  <thead>
                    <tr>
                      {["トレーナー", "日付", "時間", "定員"].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 30).map((r, i) => (
                      <tr key={r.key} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                        <td style={tdStyle}>{r.label || r.staff}</td>
                        <td style={tdStyle}>{r.date === r.date_to ? r.date : `${r.date} 〜 ${r.date_to}`}</td>
                        <td style={tdStyle}>{r.start} 〜 {r.end}</td>
                        <td style={tdStyle}>{r.capacity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 30 && (
                  <div style={{ fontSize: 11, color: T.textFaint, padding: "6px 2px" }}>
                    ほか {rows.length - 30} 件(すべて登録されます)
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="navy" onClick={submit} loading={saving}>
                  この内容で登録する
                </Button>
                <Button variant="ghost" onClick={reset}>
                  やめる
                </Button>
              </div>
            </>
          )}

          {saving && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <Spinner color={T.navy} size={14} />
              <span style={{ fontSize: 11.5, color: T.textMute }}>登録しています…</span>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Badge tone={failed.length ? "amber" : "primary"}>
                  {failed.length ? "一部が登録できませんでした" : "登録しました"}
                </Badge>
                <span style={{ fontSize: 12 }}>受付枠 {madeTotal} 件を作成</span>
              </div>
              {failed.length > 0 && (
                <div style={{ fontSize: 11.5, color: T.dangerDark, lineHeight: 1.8 }}>
                  {failed.map((f) => (
                    <div key={f.row_no}>
                      {f.row_no}件目({f.staff}) … {f.error}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <Button variant="ghost" onClick={reset}>
                  続けて読み込む
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ファイル名に入れる翌月(2026-10)
function nextMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const thStyle = {
  background: T.navy,
  color: T.onDark,
  fontSize: 11,
  fontWeight: 500,
  padding: "8px 10px",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle = { padding: "7px 10px", borderTop: `1px solid ${T.borderFaint}`, whiteSpace: "nowrap" };
