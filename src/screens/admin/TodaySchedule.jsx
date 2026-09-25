import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Spinner } from "../../components";
import { noteApi, reservationApi, shiftApi } from "../../api";

// membership は 0005 より前に入った予約の値。表示だけ拾えるようにしておく。
const SOURCE = { time: "時間課金", unlimited: "通い放題", membership: "通い放題", ticket: "回数券" };
const TONE = { time: "primary", unlimited: "accent", membership: "accent", ticket: "amber" };

const CELLS = 48; // 30分 × 48 = 24時間
const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

const todayJst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// JST の時刻から「その日の何番目の30分枠か」を求める
const cellIndex = (iso) => {
  const s = new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = s.split(":").map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
};

const jtime = (iso) =>
  new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

// 管理画面ホームの「本日のスケジュール」
// 24時間の時間軸に予約の入り方を描き、その日の申し送りメモを扱う。
export default function TodaySchedule() {
  const navigate = useNavigate();
  const date = todayJst();

  const [slots, setSlots] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [banner, setBanner] = useState(null);

  const [note, setNote] = useState("");
  const [noteMeta, setNoteMeta] = useState(null);
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  // 現在時刻の位置(1分ごとに更新)
  const [nowPct, setNowPct] = useState(nowPercent());

  const load = useCallback(async () => {
    const [s, r, n] = await Promise.all([
      shiftApi.listDay({ date }),
      reservationApi.listDay({ date }),
      noteApi.get({ date }),
    ]);
    if (s.error) setBanner(s.error);
    setSlots(s.data || []);
    setReservations((r.data || []).filter((x) => x.status !== "cancelled"));
    const row = n.data?.[0];
    setNote(row?.body || "");
    setNoteMeta(row ? { at: row.updated_at, by: row.updated_by_name } : null);
    setNoteDirty(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNowPct(nowPercent()), 60000);
    return () => clearInterval(id);
  }, []);

  async function saveNote() {
    setSavingNote(true);
    setBanner(null);
    const { error } = await noteApi.save({ date, body: note });
    setSavingNote(false);
    if (error) {
      setBanner(error);
      return;
    }
    setNoteDirty(false);
    load();
  }

  // トレーナーごとに 48 マスの状態を組み立てる
  const tracks = [];
  if (slots) {
    const byStaff = new Map();
    slots.forEach((s) => {
      if (!byStaff.has(s.staff_id)) {
        byStaff.set(s.staff_id, {
          id: s.staff_id,
          name: s.staff_name,
          cells: Array.from({ length: CELLS }, () => ({ state: "none", items: [] })),
        });
      }
      const t = byStaff.get(s.staff_id);
      const i = cellIndex(s.start_at);
      t.cells[i] = { state: s.is_closed ? "closed" : "open", items: [] };
    });

    reservations.forEach((r) => {
      const t = byStaff.get(r.staff_id);
      if (!t) return;
      const from = cellIndex(r.start_at);
      const span = Math.max(1, Math.round((new Date(r.end_at) - new Date(r.start_at)) / 1800000));
      for (let i = from; i < Math.min(CELLS, from + span); i++) {
        t.cells[i] = { state: "booked", items: [...t.cells[i].items, r] };
      }
    });

    tracks.push(...byStaff.values());
  }

  const upcoming = reservations.filter((r) => new Date(r.end_at) > new Date());

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute }}>
          本日のスケジュール
          <span style={{ marginLeft: 8, color: T.textFaint, fontWeight: 400 }}>
            予約 {reservations.length} 件 / これから {upcoming.length} 件
          </span>
        </div>
        <Button variant="ghost" onClick={() => navigate("/admin/timetable")}>
          受付枠を編集する
        </Button>
      </div>

      {banner && <Banner>{banner}</Banner>}

      {/* ---- 24時間の時間軸 ---- */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "14px 16px", marginBottom: 12 }}>
        {slots === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "22px 0" }}>
            <Spinner color={T.textFaint} size={18} />
          </div>
        ) : tracks.length === 0 ? (
          <div style={{ padding: "18px 0", textAlign: "center", color: T.textFaint, fontSize: 12.5, lineHeight: 1.8 }}>
            本日の受付枠が登録されていません。
            <br />
            「受付枠を編集する」からトレーナーを配置してください。
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 660 }}>
              {/* 時刻の目盛り */}
              <div style={{ display: "flex", marginBottom: 4 }}>
                <div style={{ width: 92, flex: "0 0 92px" }} />
                <div style={{ position: "relative", flex: 1, height: 14 }}>
                  {HOUR_MARKS.map((h) => (
                    <span
                      key={h}
                      style={{
                        position: "absolute",
                        left: `${(h / 24) * 100}%`,
                        transform: h === 0 ? "none" : h === 24 ? "translateX(-100%)" : "translateX(-50%)",
                        fontSize: 9.5,
                        color: T.textFaint,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                </div>
              </div>

              {/* トレーナーごとの帯 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tracks.map((t) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
                    <div
                      style={{
                        width: 92,
                        flex: "0 0 92px",
                        fontSize: 11.5,
                        paddingRight: 8,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.name}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        flex: 1,
                        display: "grid",
                        gridTemplateColumns: `repeat(${CELLS}, 1fr)`,
                        gap: 1,
                        background: T.borderFaint,
                        border: `1px solid ${T.border}`,
                        borderRadius: 5,
                        overflow: "hidden",
                        height: 24,
                      }}
                    >
                      {t.cells.map((c, i) => (
                        <div
                          key={i}
                          title={cellTitle(i, c)}
                          onClick={() => c.items[0] && navigate(`/admin/members/${c.items[0].member_id}`)}
                          style={{
                            background: cellColor(c.state),
                            cursor: c.items[0] ? "pointer" : "default",
                          }}
                        />
                      ))}
                      {/* 現在時刻 */}
                      <div
                        style={{
                          position: "absolute",
                          left: `${nowPct}%`,
                          top: -2,
                          bottom: -2,
                          width: 2,
                          background: T.danger,
                          pointerEvents: "none",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* 凡例 */}
              <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: T.textMute, flexWrap: "wrap" }}>
                <Legend color={cellColor("booked")} label="予約あり" />
                <Legend color={cellColor("open")} label="受付可" />
                <Legend color={cellColor("closed")} label="クローズ" />
                <Legend color={cellColor("none")} label="未配置" />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 2, height: 12, background: T.danger, display: "inline-block" }} />
                  現在時刻
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- 本日の予約一覧 ---- */}
      {reservations.length > 0 && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, overflow: "hidden", marginBottom: 12 }}>
          {reservations.map((r, i) => {
            const finished = new Date(r.end_at) <= new Date();
            return (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "9px 14px",
                  borderTop: i ? `1px solid ${T.borderFaint}` : "none",
                  background: i % 2 ? T.bgSubtle : T.bg,
                  opacity: finished ? 0.5 : 1,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontWeight: 500 }}>
                  {jtime(r.start_at)} 〜 {jtime(r.end_at)}
                </span>
                <span
                  onClick={() => navigate(`/admin/members/${r.member_id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/members/${r.member_id}`)}
                  style={{ fontSize: 12.5, color: T.accent, cursor: "pointer" }}
                >
                  {r.member_name}
                </span>
                <span style={{ fontSize: 12, color: T.textMute }}>{r.menu_name}</span>
                {r.trainer_name && (
                  <span style={{ fontSize: 11.5, color: T.textFaint }}>担当 {r.trainer_name}</span>
                )}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {r.needs_purchase && r.status !== "cancelled" && <Badge tone="danger">要購入</Badge>}
                  {r.nominated && <Badge tone="navy">指名</Badge>}
                  <Badge tone={TONE[r.source]}>{SOURCE[r.source]}</Badge>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- 申し送りメモ ---- */}
      <div style={{ border: `1px solid ${T.amber}`, background: T.amberSoft, borderRadius: radius.lg, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.amberDark }}>
            本日の申し送りメモ(管理者・スタッフ全員が閲覧できます)
          </div>
          <div style={{ fontSize: 10.5, color: T.amberDark, opacity: 0.85 }}>
            {noteMeta
              ? `最終更新 ${new Date(noteMeta.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}${noteMeta.by ? ` / ${noteMeta.by}` : ""}`
              : "まだメモはありません"}
          </div>
        </div>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteDirty(true);
          }}
          rows={3}
          placeholder="例:14:00〜16:00 は田中トレーナーが外出。急な予約は佐藤トレーナーへ。"
          style={{
            width: "100%",
            background: T.bg,
            border: `1px solid ${T.fieldBorder}`,
            borderRadius: radius.md,
            padding: "9px 11px",
            fontSize: 12.5,
            lineHeight: 1.7,
            color: T.text,
            fontFamily: font,
            boxSizing: "border-box",
            outline: "none",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <Button variant="navy" onClick={saveNote} loading={savingNote} disabled={!noteDirty}>
            メモを保存
          </Button>
          {noteDirty && <span style={{ fontSize: 11, color: T.amberDark }}>未保存の変更があります</span>}
        </div>
      </div>
    </div>
  );
}

function nowPercent() {
  const s = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = s.split(":").map(Number);
  return ((h * 60 + m) / 1440) * 100;
}

function cellColor(state) {
  if (state === "booked") return T.primary;
  if (state === "open") return T.primarySoft;
  // クローズは濃いグレー。赤は不具合や警告に使う色なので、
  // 「店舗が意図して閉じた枠」とは区別する。
  if (state === "closed") return T.grayDark;
  return T.bg;
}

function cellTitle(i, c) {
  const label = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  if (c.state === "booked") {
    const names = [...new Set(c.items.map((r) => `${r.member_name}(${r.menu_name})`))];
    return `${label} ${names.join(" / ")}`;
  }
  if (c.state === "closed") return `${label} クローズ`;
  if (c.state === "open") return `${label} 受付可`;
  return `${label} 未配置`;
}

function Legend({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 16, height: 12, background: color, border: `1px solid ${T.border}`, borderRadius: 3, display: "inline-block" }} />
      {label}
    </span>
  );
}
