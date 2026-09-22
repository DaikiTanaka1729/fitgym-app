import React, { useRef, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner } from "../../components";
import { shiftApi } from "../../api";
import { APP_SLUG } from "../../appConfig";
import { readShiftCsv, readShiftTable } from "./shiftCsv";
import { buildWorkbook, nextMonth, readWorkbook } from "./shiftXlsx";

// 受付枠の取り込み(トレーナー画面に組み込む)
// ------------------------------------------------------------
// 出勤表をそのまま貼れることを優先する。
//   ・ひな型は Excel。トレーナー1人につき1シート
//   ・横が日付、縦が30分刻み。開始 / 終了 はプルダウンで選ぶ
//   ・月は画面で選べる(既定は翌月)
//   ・1件が駄目でも残りは登録する(どこが駄目かを返す)
// ひな型の作成と読み込みは shiftXlsx.js、解析は shiftCsv.js。
// 以前のCSV(表形式・行形式)も引き続き読める。
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
  const [scope, setScope] = useState([]);
  const [replace, setReplace] = useState(false);
  const [month, setMonth] = useState(nextMonth());
  const [making, setMaking] = useState(false);

  function reset() {
    setRows(null);
    setBad([]);
    setResult(null);
    setBanner(null);
    setFormat(null);
    setScope([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function readFile(file) {
    reset();
    const isExcel = /\.xlsx?$/i.test(file.name);
    try {
      const out = isExcel
        ? readShiftTable(await readWorkbook(file))
        : readShiftCsv(await file.text());
      apply(out);
    } catch (e) {
      setBanner(
        isExcel
          ? "Excelファイルを読み取れませんでした。ひな型をダウンロードしてお使いください。"
          : "CSVを読み取れませんでした。文字コードは UTF-8 で保存してください。"
      );
    }
  }

  function apply({ ranges, errors, fatal, format, scope: scopeOf }) {
    if (fatal) {
      setBanner(fatal);
      return;
    }
    setRows(ranges.map((r, i) => ({ ...r, key: i })));
    setBad(errors);
    setFormat(format);
    setScope(scopeOf || []);
    if (ranges.length === 0) setBanner("登録できる出勤がありませんでした");
  }

  async function submit() {
    setBanner(null);
    setSaving(true);
    const { data, error } = await shiftApi.importShifts({
      rows: rows.map(({ key, label, ...r }) => r),
      replace,
      scope: scope.map(({ label, ...r }) => r),
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

  async function template() {
    setBanner(null);
    setMaking(true);
    try {
      const blob = await buildWorkbook(staff, month);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${APP_SLUG}_shifts_${month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setBanner("ひな型を作れませんでした。時間をおいて再度お試しください。");
    }
    setMaking(false);
  }

  const madeTotal = (result || []).reduce((a, r) => a + (r.created || 0), 0);
  const removedTotal = (result || []).reduce((a, r) => a + (r.removed || 0), 0);
  const keptTotal = (result || []).reduce((a, r) => a + (r.kept || 0), 0);
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
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>受付枠をまとめて登録(Excel)</span>
        <span style={{ fontSize: 11, color: T.textMute }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ border: `1px solid ${T.borderFaint}`, borderTop: "none", borderRadius: `0 0 ${radius.lg}px ${radius.lg}px`, padding: 16 }}>
          {banner && <Banner>{banner}</Banner>}

          <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.9, marginBottom: 14 }}>
            月を選んで「ひな型をダウンロード」を押すと、Excelのひな型が出ます。
            <strong>トレーナー1人につき1シート</strong>、横が日付、縦が30分刻みの時間です。
            <br />
            出勤する時間の<strong>「開始」と「終了」のセルで、プルダウンから選んで</strong>ください。
            手入力ではないので表記ゆれが起きません。1日に2回出勤する場合は、開始と終了を2組選びます。
            <br />
            終了の時刻そのものの枠は作りません(18:00 を選ぶと最後の枠は 17:30 開始です)。
            <br />
            直した出勤表を出し直すときは、登録前に出る
            <strong>「この期間の枠を入れ替える」</strong>にチェックを入れてください。
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{
                background: T.field,
                border: `1px solid ${T.fieldBorder}`,
                borderRadius: radius.md,
                padding: "8px 10px",
                fontSize: 12,
                color: T.text,
                outline: "none",
              }}
            />
            <Button variant="ghost" onClick={template} loading={making}>
              ひな型をダウンロード
            </Button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <span style={{ fontSize: 11.5, color: T.textMute }}>記入したファイル:</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                この内容で登録します(出勤 {rows.length} 件)
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

              <div
                onClick={() => setReplace(!replace)}
                role="button"
                tabIndex={0}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  border: `1px solid ${replace ? T.navy : T.fieldBorder}`,
                  background: replace ? T.navySoft : T.bg,
                  borderRadius: radius.lg,
                  padding: "11px 13px",
                  marginBottom: 14,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={() => setReplace(!replace)}
                  style={{ width: 16, height: 16, accentColor: T.navy, marginTop: 2, cursor: "pointer" }}
                />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>この期間の枠を入れ替える</div>
                  <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.8, marginTop: 3 }}>
                    {scope.length > 0 && (
                      <>
                        対象:{scope.map((x) => `${x.label}(${x.from} 〜 ${x.to})`).join(" / ")}
                        <br />
                      </>
                    )}
                    チェックを入れると、上の期間にある既存の枠を一度消してから登録し直します。
                    出勤表を直して出し直すときはこちらです。
                    <strong>予約が入っている枠は消しません。</strong>
                    <br />
                    チェックを外したままなら、足りない枠を足すだけです(既存の枠はそのまま残ります)。
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="navy" onClick={submit} loading={saving}>
                  {replace ? "入れ替えて登録する" : "この内容で登録する"}
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
                <span style={{ fontSize: 12 }}>
                  受付枠 {madeTotal} 件を作成
                  {removedTotal > 0 && ` · ${removedTotal} 件を削除`}
                  {keptTotal > 0 && ` · 予約があるため ${keptTotal} 件はそのまま`}
                </span>
              </div>
              {failed.length > 0 && (
                <div style={{ fontSize: 11.5, color: T.dangerDark, lineHeight: 1.8 }}>
                  {failed.map((f, i) => (
                    <div key={i}>
                      {f.row_no ? `${f.row_no}件目` : "入れ替え"}({f.staff}) … {f.error}
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
