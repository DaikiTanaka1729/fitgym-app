// ============================================================
// 受付枠のExcelひな型(トレーナーごとにシートを分ける)
// ------------------------------------------------------------
// CSVには「シート」が無いため、全員分を1枚に縦に並べるしかなかった。
// Excel にすることで、トレーナー1人につき1シートに分けられる。
//
// 各シートの中身は CSV のときと同じ形にしてある。
//   1行目 対象月   2026-10
//   2行目 トレーナー  <メールアドレス>  <氏名>
//   5行目 時間 | 1(木) | 2(金) | …
//   6行目以降 00:00 から 23:30 まで、30分刻み
//
// 出勤する時間の「開始」「終了」のセルは**プルダウンから選ぶ**。
// 手で打つと「開始 」「開 始」のような表記ゆれが起きるため。
//
// 読み込みは、全シートを縦につないで1枚の表として扱い、
// CSV と同じ解析(shiftCsv.js)にかける。
//
// exceljs はファイルが大きいので、使うときだけ読み込む(動的import)。
// ============================================================

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// Excel のシート名に使えない文字を落とす(31文字まで)
function sheetName(name, used) {
  let s = String(name || "シート").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "シート";
  let n = 2;
  let out = s;
  while (used.has(out)) out = `${s}(${n++})`;
  used.add(out);
  return out;
}

// 既定は翌月。今月や翌々月を出したいこともあるので、画面から選べるようにする。
export function nextMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 「2026-10」を年と月に分ける。おかしな値なら翌月に寄せる。
function splitMonth(tag) {
  const m = String(tag || "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return splitMonth(nextMonth());
  return { year: Number(m[1]), month: Number(m[2]) };
}

// ------------------------------------------------------------
// ひな型を作る
// ------------------------------------------------------------
export async function buildWorkbook(staff, monthTag) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "eFsystem";
  wb.created = new Date();

  const { year, month } = splitMonth(monthTag);
  const tag = `${year}-${String(month).padStart(2, "0")}`;
  const days = new Date(year, month, 0).getDate();

  const times = [];
  for (let n = 0; n < 48; n++) {
    times.push(`${String(Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "30" : "00"}`);
  }

  const people = staff.length
    ? staff
    : [{ email: "trainer@example.com", name: "トレーナーを登録してください" }];

  const used = new Set();

  for (const person of people) {
    const ws = wb.addWorksheet(sheetName(person.name || person.email, used), {
      views: [{ state: "frozen", xSplit: 1, ySplit: 5 }],
    });

    ws.getCell("A1").value = "対象月";
    ws.getCell("B1").value = tag;
    ws.getCell("A2").value = "トレーナー";
    ws.getCell("B2").value = person.email || person.name;
    ws.getCell("C2").value = person.name || "";
    ws.getCell("A3").value =
      "出勤する時間の「開始」と「終了」のセルで、プルダウンから選んでください。1日に2回出勤する場合は2組書きます。";

    for (const row of [1, 2, 3]) ws.getRow(row).font = { size: 10, color: { argb: "FF6B7280" } };
    ws.getCell("A1").font = { size: 10, bold: true, color: { argb: "FF1E2761" } };
    ws.getCell("A2").font = { size: 10, bold: true, color: { argb: "FF1E2761" } };
    ws.getCell("C2").font = { size: 11, bold: true, color: { argb: "FF1E2761" } };

    // 見出し(5行目)
    const head = ["時間"];
    for (let d = 1; d <= days; d++) {
      head.push(`${d}(${WEEK[new Date(year, month - 1, d).getDay()]})`);
    }
    const headRow = ws.getRow(5);
    head.forEach((v, i) => {
      const c = headRow.getCell(i + 1);
      c.value = v;
      c.font = { size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2761" } };
      c.alignment = { horizontal: "center", vertical: "middle" };
    });
    headRow.height = 20;

    // 時間(6行目以降)
    times.forEach((t, i) => {
      const row = ws.getRow(6 + i);
      const c = row.getCell(1);
      c.value = t;
      c.font = { size: 10 };
      c.alignment = { horizontal: "center" };
      // 1時間ごとに薄く色を敷いて、目で追いやすくする
      if (i % 2 === 0) {
        for (let d = 0; d <= days; d++) {
          row.getCell(d + 1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF4F6FA" },
          };
        }
      }
      row.height = 17;
    });

    ws.getColumn(1).width = 8;
    for (let d = 0; d < days; d++) ws.getColumn(d + 2).width = 7;

    // 開始 / 終了 のプルダウン
    const validation = {
      type: "list",
      allowBlank: true,
      formulae: ['"開始,終了"'],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "入力できません",
      error: "「開始」または「終了」をプルダウンから選んでください。",
    };
    for (let i = 0; i < times.length; i++) {
      for (let d = 0; d < days; d++) {
        ws.getCell(6 + i, d + 2).dataValidation = validation;
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ------------------------------------------------------------
// 読み込む
// ------------------------------------------------------------
// 全シートを縦につないで1枚の表にする。シートの境目には空行を入れる。
// トレーナーの行でブロックに切る解析は CSV と共通。
// ------------------------------------------------------------
export async function readWorkbook(file) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const table = [];
  wb.eachSheet((ws) => {
    let width = 1;
    ws.eachRow({ includeEmpty: true }, (row) => {
      width = Math.max(width, row.cellCount);
    });

    ws.eachRow({ includeEmpty: true }, (row) => {
      const cells = [];
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)));
      table.push(cells);
    });
    table.push([""]);   // シートの区切り
  });

  return table;
}

// セルの見た目の文字を取り出す。
// 時刻は Excel 側で時刻型になっていることがあるので、その場合は HH:MM に直す。
function cellText(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return "";

  if (v instanceof Date) {
    // Excel の時刻は 1899-12-30 起点。日付部分は捨てて時分だけ使う。
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.result !== undefined) return String(v.result);
    if (v.hyperlink && v.text) return String(v.text);
    return "";
  }
  return String(v);
}
