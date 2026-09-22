import React, { useRef, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner } from "../../components";
import { downloadCsv, shiftApi } from "../../api";
import { APP_SLUG } from "../../appConfig";

// 受付枠のCSV取り込み(トレーナー画面に組み込む)
// ------------------------------------------------------------
// 出勤表をそのまま貼れることを優先する。
//   ・列の順番は見出しで判断する(並び替えても通る)
//   ・1行が駄目でも残りは登録する(どの行が駄目かを返す)
//   ・同じ枠を二重に作らないので、貼り直しても壊れない
// ------------------------------------------------------------

// 見出しのゆらぎを吸収する
const HEADERS = {
  staff: ["トレーナー", "トレーナー名", "氏名", "名前", "メール", "メールアドレス", "staff", "name", "email"],
  date: ["日付", "開始日", "date", "from"],
  date_to: ["終了日", "date_to", "to"],
  start: ["開始", "開始時刻", "start"],
  end: ["終了", "終了時刻", "end"],
  capacity: ["定員", "capacity"],
};

const norm = (s) => String(s || "").replace(/^﻿/, "").trim().toLowerCase();

function headerKey(cell) {
  const c = norm(cell);
  for (const [key, names] of Object.entries(HEADERS)) {
    if (names.some((n) => n.toLowerCase() === c)) return key;
  }
  return null;
}

// CSV を行×列に分解する。引用符の中のカンマと改行に対応する。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);

  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// 「2026/10/1」「2026-10-01」を YYYY-MM-DD に揃える
function toDate(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// 「9:00」「09:00」「9」を HH:MM に揃える
function toTime(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 24 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export default function ShiftCsvSection({ onDone }) {
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState(null);
  const [rows, setRows] = useState(null);      // 取り込む予定の行
  const [bad, setBad] = useState([]);          // 読み取れなかった行
  const [result, setResult] = useState(null);  // 登録後の結果
  const [saving, setSaving] = useState(false);

  function reset() {
    setRows(null);
    setBad([]);
    setResult(null);
    setBanner(null);
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
    const table = parseCsv(text);
    if (table.length < 2) {
      setBanner("見出し行とデータ行が必要です");
      return;
    }

    const cols = table[0].map(headerKey);
    if (!cols.includes("staff") || !cols.includes("date") || !cols.includes("start") || !cols.includes("end")) {
      setBanner("見出しに「トレーナー」「日付」「開始」「終了」が必要です。見本をダウンロードしてご確認ください。");
      return;
    }

    const ok = [];
    const ng = [];
    table.slice(1).forEach((r, i) => {
      const get = (key) => {
        const at = cols.indexOf(key);
        return at < 0 ? "" : String(r[at] ?? "").trim();
      };
      const line = i + 2; // 見出しが1行目
      const staff = get("staff");
      const date = toDate(get("date"));
      const dateTo = get("date_to") ? toDate(get("date_to")) : null;
      const start = toTime(get("start"));
      const end = toTime(get("end"));
      const capRaw = get("capacity");
      const capacity = capRaw ? Number(capRaw) : 1;

      if (!staff) return ng.push({ line, why: "トレーナーが空です" });
      if (!date) return ng.push({ line, why: "日付の形式が正しくありません(2026/10/01)" });
      if (get("date_to") && !dateTo) return ng.push({ line, why: "終了日の形式が正しくありません" });
      if (!start) return ng.push({ line, why: "開始時刻の形式が正しくありません(09:00)" });
      if (!end) return ng.push({ line, why: "終了時刻の形式が正しくありません(18:00)" });
      if (end <= start) return ng.push({ line, why: "終了が開始より後になっていません" });
      if (!Number.isInteger(capacity) || capacity < 1) return ng.push({ line, why: "定員は1以上の整数で入力してください" });

      ok.push({ line, staff, date, date_to: dateTo || date, start, end, capacity });
    });

    setRows(ok);
    setBad(ng);
    if (ok.length === 0) setBanner("登録できる行がありませんでした");
  }

  async function submit() {
    setBanner(null);
    setSaving(true);
    const { data, error } = await shiftApi.importShifts({
      rows: rows.map(({ line, ...r }) => r),
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
    downloadCsv(
      `${APP_SLUG}_shifts_template.csv`,
      toCsvTemplate()
    );
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
            出勤表を CSV にして読み込ませると、受付枠(30分刻み)をまとめて作ります。
            <br />
            トレーナーは<strong>メールアドレス</strong>で照合します。氏名でも通りますが、同姓同名がいる場合は
            メールアドレスで指定してください。
            <br />
            終了時刻の枠は作りません(18:00 と書くと最後の枠は 17:30 開始です)。
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
              読み取れなかった行({bad.length}件)
              {bad.slice(0, 10).map((b) => (
                <div key={b.line}>
                  {b.line}行目 … {b.why}
                </div>
              ))}
              {bad.length > 10 && <div>ほか {bad.length - 10} 行</div>}
            </div>
          )}

          {rows && rows.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
                この内容で登録します({rows.length}行)
              </div>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 12 }}>
                  <thead>
                    <tr>
                      {["行", "トレーナー", "日付", "時間", "定員"].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 30).map((r, i) => (
                      <tr key={r.line} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                        <td style={tdStyle}>{r.line}</td>
                        <td style={tdStyle}>{r.staff}</td>
                        <td style={tdStyle}>{r.date === r.date_to ? r.date : `${r.date} 〜 ${r.date_to}`}</td>
                        <td style={tdStyle}>{r.start} 〜 {r.end}</td>
                        <td style={tdStyle}>{r.capacity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 30 && (
                  <div style={{ fontSize: 11, color: T.textFaint, padding: "6px 2px" }}>
                    ほか {rows.length - 30} 行(すべて登録されます)
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

// 見本のCSV。そのまま書き換えて使えるよう、実際に通る値を入れておく。
function toCsvTemplate() {
  const today = new Date();
  const d = (n) => {
    const x = new Date(today);
    x.setDate(x.getDate() + n);
    return x.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  };
  const lines = [
    "トレーナー,日付,終了日,開始,終了,定員",
    `trainer@example.com,${d(1)},${d(14)},09:00,18:00,1`,
    `田中 太郎,${d(1)},,10:00,15:00,1`,
  ];
  return "﻿" + lines.join("\r\n");
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
