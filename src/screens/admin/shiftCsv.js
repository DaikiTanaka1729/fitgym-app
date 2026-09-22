// ============================================================
// 受付枠CSVの読み書き
// ------------------------------------------------------------
// 出勤表をそのまま貼れることを優先する。2つの形式を受け付ける。
//
// 【表形式】(ひな型はこちら)
//   トレーナーごとに1ブロック。横軸が日付、縦軸が30分刻みの時間。
//   出勤する時間の「開始」と「終了」のセルに文字を入れる。
//
//     対象月,2026-10
//
//     トレーナー,trainer.tanaka@fitgym.local,田中トレーナー
//     時間,1(木),2(金),3(土),...
//     09:00,開始,,開始
//     18:00,終了,,
//     19:00,,,終了
//
//     トレーナー,trainer.sato@fitgym.local,佐藤トレーナー
//     ...
//
//   1日に2回出勤する場合は、開始と終了を2組書けばよい。
//   終了の時刻の枠は作らない(18:00 なら最後の枠は 17:30 開始)。
//
// 【行形式】(以前のひな型。引き続き読める)
//   トレーナー,日付,終了日,開始,終了,定員
//   trainer@example.com,2026-10-01,2026-10-14,09:00,18:00,1
//
// どちらも、サーバーへ渡す形は同じ
//   { staff, date, date_to, start, end, capacity }
// ============================================================

const START_WORDS = ["開始", "出勤", "start", "in", "○", "◯", "o"];
const END_WORDS = ["終了", "退勤", "end", "out", "×", "x"];

const norm = (v) => String(v ?? "").replace(/^﻿/, "").trim();
const lower = (v) => norm(v).toLowerCase();

// CSV を行×列に分解する。引用符の中のカンマと改行に対応する。
// 空行は「ブロックの区切り」として意味を持つので、ここでは捨てない。
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  const src = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
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
  return rows;
}

// 「2026/10/1」「2026-10-01」を YYYY-MM-DD に揃える
export function toDate(v) {
  const m = norm(v).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// 「9:00」「09:00」「9」を HH:MM に揃える
export function toTime(v) {
  const m = norm(v).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 24 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

// 表形式の日付見出し。「2026-10-01」「10/1」「1(木)」のいずれも受ける。
// 日付だけの見出しは、対象月(YYYY-MM)と組み合わせる。
function headerDate(cell, month) {
  const s = norm(cell);
  if (!s) return null;

  const full = toDate(s);
  if (full) return full;

  // 10/1(木)
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})/);
  if (m && month) return `${month.slice(0, 4)}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;

  // 1(木)
  m = s.match(/^(\d{1,2})\s*(?:[(（].*)?$/);
  if (m && month) return `${month}-${m[1].padStart(2, "0")}`;

  return null;
}

// ------------------------------------------------------------
// 表形式を読む
// ------------------------------------------------------------
function parseGrid(table) {
  const ranges = [];
  const errors = [];
  const scope = [];   // ファイルが扱っている範囲。入れ替え取り込みに使う。

  // 対象月。Excel はシートごとに持つので、その行より上で一番近いものを使う。
  const monthAt = [];
  table.forEach((r, i) => {
    if (/^(対象月|月)$/.test(norm(r[0]))) {
      const m = norm(r[1]).match(/^(\d{4})[/-](\d{1,2})$/);
      if (m) monthAt.push({ at: i, month: `${m[1]}-${m[2].padStart(2, "0")}` });
    }
  });
  const monthFor = (line) => {
    let found = null;
    for (const x of monthAt) {
      if (x.at <= line) found = x.month;
      else break;
    }
    return found || monthAt[0]?.month || null;
  };

  // トレーナーの行でブロックに切る
  const heads = [];
  table.forEach((r, i) => {
    if (/^(トレーナー|担当|staff)$/.test(norm(r[0])) && norm(r[1])) heads.push(i);
  });

  heads.forEach((at, n) => {
    const staff = norm(table[at][1]);
    const label = norm(table[at][2]) || staff;
    const until = n + 1 < heads.length ? heads[n + 1] : table.length;

    // 見出し行(時間, 日付…)
    const headAt = table.findIndex(
      (r, i) => i > at && i < until && /^(時間|時刻|time)$/.test(norm(r[0]))
    );
    if (headAt < 0) {
      errors.push({ line: at + 1, why: `${label}:「時間」で始まる見出し行がありません` });
      return;
    }

    const month = monthFor(at);
    const dates = table[headAt].map((c, i) => (i === 0 ? null : headerDate(c, month)));
    if (!dates.some(Boolean)) {
      errors.push({ line: headAt + 1, why: `${label}:日付の見出しを読み取れません(対象月の行をご確認ください)` });
      return;
    }

    // 見出しに出ている日付の範囲が、このトレーナーの対象期間。
    // 出勤を取り消して空欄にした日も範囲に含めたいので、
    // 実際の出勤(ranges)ではなく見出しから取る。
    const known = dates.filter(Boolean).sort();
    scope.push({ staff, from: known[0], to: known[known.length - 1], label });

    // 列ごとに、開始と終了の時刻を拾う
    const marks = {};   // 列番号 -> [{ time, kind }]
    for (let i = headAt + 1; i < until; i++) {
      const row = table[i];
      const time = toTime(row[0]);
      if (!time) continue;   // 空行や注記の行は読み飛ばす

      for (let c = 1; c < row.length; c++) {
        const v = lower(row[c]);
        if (!v) continue;
        const kind = START_WORDS.includes(v) ? "start" : END_WORDS.includes(v) ? "end" : null;
        if (!kind) {
          errors.push({ line: i + 1, why: `${label} ${dates[c] || `${c}列目`}:「${norm(row[c])}」は読み取れません(開始 / 終了 のみ)` });
          continue;
        }
        if (!dates[c]) {
          errors.push({ line: i + 1, why: `${label}:${c + 1}列目の日付が読み取れません` });
          continue;
        }
        (marks[c] ||= []).push({ time, kind });
      }
    }

    // 開始と終了を順番に組にする
    for (const [c, list] of Object.entries(marks)) {
      list.sort((a, b) => a.time.localeCompare(b.time));
      const date = dates[c];
      let open = null;
      for (const mk of list) {
        if (mk.kind === "start") {
          if (open) {
            errors.push({ line: headAt + 1, why: `${label} ${date}:「開始」が続いています(${open} と ${mk.time})` });
            break;
          }
          open = mk.time;
        } else {
          if (!open) {
            errors.push({ line: headAt + 1, why: `${label} ${date}:「終了」の前に「開始」がありません(${mk.time})` });
            break;
          }
          ranges.push({ staff, date, date_to: date, start: open, end: mk.time, capacity: 1, label });
          open = null;
        }
      }
      if (open) {
        errors.push({ line: headAt + 1, why: `${label} ${date}:「開始」(${open})に対する「終了」がありません` });
      }
    }
  });

  return { ranges, errors, scope };
}

// ------------------------------------------------------------
// 行形式を読む
// ------------------------------------------------------------
const HEADERS = {
  staff: ["トレーナー", "トレーナー名", "氏名", "名前", "メール", "メールアドレス", "staff", "name", "email"],
  date: ["日付", "開始日", "date", "from"],
  date_to: ["終了日", "date_to", "to"],
  start: ["開始", "開始時刻", "start"],
  end: ["終了", "終了時刻", "end"],
  capacity: ["定員", "capacity"],
};

function headerKey(cell) {
  const c = lower(cell);
  for (const [key, names] of Object.entries(HEADERS)) {
    if (names.some((n) => n.toLowerCase() === c)) return key;
  }
  return null;
}

function parseRows(table) {
  const body = table.filter((r) => r.some((c) => norm(c) !== ""));
  const ranges = [];
  const errors = [];

  const cols = body[0].map(headerKey);
  if (!cols.includes("staff") || !cols.includes("date") || !cols.includes("start") || !cols.includes("end")) {
    return { ranges, errors, scope: [], fatal: "見出しに「トレーナー」「日付」「開始」「終了」が必要です。見本をダウンロードしてご確認ください。" };
  }

  body.slice(1).forEach((r, i) => {
    const get = (key) => {
      const at = cols.indexOf(key);
      return at < 0 ? "" : norm(r[at]);
    };
    const line = i + 2;
    const staff = get("staff");
    const date = toDate(get("date"));
    const dateTo = get("date_to") ? toDate(get("date_to")) : null;
    const start = toTime(get("start"));
    const end = toTime(get("end"));
    const capRaw = get("capacity");
    const capacity = capRaw ? Number(capRaw) : 1;

    if (!staff) return errors.push({ line, why: "トレーナーが空です" });
    if (!date) return errors.push({ line, why: "日付の形式が正しくありません(2026/10/01)" });
    if (get("date_to") && !dateTo) return errors.push({ line, why: "終了日の形式が正しくありません" });
    if (!start) return errors.push({ line, why: "開始時刻の形式が正しくありません(09:00)" });
    if (!end) return errors.push({ line, why: "終了時刻の形式が正しくありません(18:00)" });
    if (end <= start) return errors.push({ line, why: "終了が開始より後になっていません" });
    if (!Number.isInteger(capacity) || capacity < 1) return errors.push({ line, why: "定員は1以上の整数で入力してください" });

    ranges.push({ staff, date, date_to: dateTo || date, start, end, capacity, label: staff });
  });

  // 行形式には対象期間の欄がないので、書かれている日付の幅を範囲とみなす
  const byStaff = {};
  for (const r of ranges) {
    const cur = (byStaff[r.staff] ||= { staff: r.staff, from: r.date, to: r.date_to, label: r.staff });
    if (r.date < cur.from) cur.from = r.date;
    if (r.date_to > cur.to) cur.to = r.date_to;
  }

  return { ranges, errors, scope: Object.values(byStaff) };
}

// ------------------------------------------------------------
// 形式を見分けて読む
// ------------------------------------------------------------
export function readShiftCsv(text) {
  return readShiftTable(parseCsv(text));
}

// 表(行×列の配列)を読む。CSV も Excel もここに合流する。
export function readShiftTable(table) {
  // 「時間」で始まる行があるのは表形式だけ。行形式の見出しは
  // 「トレーナー,日付,…」で、1列目に時間が来ることはない。
  const isGrid = table.some((r) => /^(時間|時刻|time)$/.test(norm(r[0])));

  const out = isGrid ? parseGrid(table) : parseRows(table);
  // 終了が開始より後であること(表形式でも念のため)
  out.ranges = out.ranges.filter((r) => {
    if (r.end > r.start) return true;
    out.errors.push({ line: 0, why: `${r.label} ${r.date}:終了(${r.end})が開始(${r.start})より後になっていません` });
    return false;
  });
  return { ...out, format: isGrid ? "grid" : "rows" };
}

// ------------------------------------------------------------
// ひな型を作る
// ------------------------------------------------------------
// 翌月の日付を横軸、30分刻みの時間を縦軸にした表を、
// トレーナーの人数ぶん縦に並べる。
// ------------------------------------------------------------
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export function buildTemplate(staff) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const month = `${ny}-${String(nm).padStart(2, "0")}`;
  const days = new Date(ny, nm, 0).getDate();

  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const dateCols = [];
  for (let d = 1; d <= days; d++) {
    const w = WEEK[new Date(ny, nm - 1, d).getDay()];
    dateCols.push(`${d}(${w})`);
  }

  const times = [];
  for (let n = 0; n < 48; n++) {
    times.push(`${String(Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "30" : "00"}`);
  }

  const lines = [];
  lines.push(["対象月", month].map(esc).join(","));
  lines.push("");
  lines.push(["出勤する時間の「開始」と「終了」のセルに、開始 / 終了 と入力してください。"].map(esc).join(","));
  lines.push(["終了の時刻そのものの枠は作りません(18:00 と書くと最後の枠は 17:30 開始です)。"].map(esc).join(","));
  lines.push(["1日に2回出勤する場合は、開始と終了を2組書いてください。"].map(esc).join(","));
  lines.push("");

  const people = staff.length
    ? staff
    : [{ email: "trainer@example.com", name: "(トレーナーを登録してください)" }];

  people.forEach((s, i) => {
    lines.push(["トレーナー", s.email || s.name, s.name].map(esc).join(","));
    lines.push(["時間", ...dateCols].map(esc).join(","));
    for (const t of times) {
      lines.push([t, ...dateCols.map(() => "")].map(esc).join(","));
    }
    if (i < people.length - 1) lines.push("");
  });

  return "﻿" + lines.join("\r\n");
}
