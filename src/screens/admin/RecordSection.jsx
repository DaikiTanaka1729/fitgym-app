import React, { useCallback, useEffect, useState } from "react";
import { T, font, radius } from "../../theme/tokens";
import { Banner, Button, Spinner, TextField } from "../../components";
import { recordApi } from "../../api";
import { useSession } from "../../session";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const blankExercise = () => ({ name: "", weight: "", reps: "", sets: "" });

// A-04 記録の代理入力(会員詳細に組み込む)
export default function RecordSection({ memberId, onFlash }) {
  const { admin } = useSession();
  const [rows, setRows] = useState(null);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ performedOn: today(), memo: "", exercises: [blankExercise()] });

  const load = useCallback(async () => {
    const { data, error } = await recordApi.listByMember({ memberId });
    if (error) setBanner(error);
    setRows(data || []);
  }, [memberId]);

  useEffect(() => {
    load();
  }, [load]);

  const setEx = (i, k) => (v) => {
    const ex = [...form.exercises];
    ex[i] = { ...ex[i], [k]: v };
    setForm({ ...form, exercises: ex });
  };

  async function save() {
    setBanner(null);
    const exercises = form.exercises
      .filter((e) => e.name.trim())
      .map((e) => ({
        name: e.name.trim(),
        weight: e.weight === "" ? null : Number(e.weight),
        reps: e.reps === "" ? null : Number(e.reps),
        sets: e.sets === "" ? null : Number(e.sets),
      }));

    if (exercises.length === 0 && !form.memo.trim()) {
      setBanner("種目またはメモを入力してください");
      return;
    }

    setSaving(true);
    const { error } = await recordApi.create({
      storeId: admin.store_id,
      memberId,
      adminId: admin.id,
      performedOn: form.performedOn,
      exercises,
      trainerMemo: form.memo.trim(),
    });
    setSaving(false);
    if (error) {
      setBanner(error);
      return;
    }
    setForm({ performedOn: today(), memo: "", exercises: [blankExercise()] });
    setOpen(false);
    onFlash?.("記録を保存しました");
    load();
  }

  async function remove(id) {
    setBanner(null);
    const { error } = await recordApi.remove(id);
    if (error) {
      setBanner(error);
      return;
    }
    onFlash?.("記録を削除しました");
    load();
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute }}>トレーニング記録</div>
        {!open && (
          <Button variant="navy" onClick={() => setOpen(true)}>
            記録を追加
          </Button>
        )}
      </div>

      {banner && <Banner>{banner}</Banner>}

      {open && (
        <div style={{ border: `1px solid ${T.navy}`, borderRadius: radius.lg, padding: 16, marginBottom: 14 }}>
          <div style={{ maxWidth: 300, marginBottom: 6 }}>
            <TextField
              label="実施日"
              type="date"
              value={form.performedOn}
              onChange={(v) => setForm({ ...form, performedOn: v })}
            />
          </div>

          <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 6 }}>種目</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {form.exercises.map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr .8fr .7fr .7fr auto", gap: 6, alignItems: "start" }}>
                <Compact value={e.name} onChange={setEx(i, "name")} placeholder="ベンチプレス" />
                <Compact value={e.weight} onChange={setEx(i, "weight")} placeholder="80" suffix="kg" />
                <Compact value={e.reps} onChange={setEx(i, "reps")} placeholder="5" suffix="回" />
                <Compact value={e.sets} onChange={setEx(i, "sets")} placeholder="3" suffix="set" />
                <button
                  onClick={() => setForm({ ...form, exercises: form.exercises.filter((_, j) => j !== i) })}
                  disabled={form.exercises.length === 1}
                  style={{
                    border: `1px solid ${T.fieldBorder}`,
                    background: T.bg,
                    color: T.textMute,
                    borderRadius: radius.md,
                    height: 36,
                    width: 36,
                    cursor: form.exercises.length === 1 ? "default" : "pointer",
                    fontFamily: font,
                    opacity: form.exercises.length === 1 ? 0.4 : 1,
                  }}
                  aria-label="この種目を削除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <Button variant="ghost" onClick={() => setForm({ ...form, exercises: [...form.exercises, blankExercise()] })}>
              + 種目を追加
            </Button>
          </div>

          <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 5 }}>トレーナーメモ</div>
          <textarea
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
            rows={3}
            placeholder="フォームが安定してきた。次回は重量を上げて様子を見る。"
            style={{
              width: "100%",
              background: T.field,
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
              marginBottom: 12,
            }}
          />

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="navy" onClick={save} loading={saving}>
              記録を保存
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
          </div>
        </div>
      )}

      {rows === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
          <Spinner color={T.textFaint} size={18} />
        </div>
      )}

      {rows?.length === 0 && !open && (
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
          記録はまだありません。
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows?.map((r) => (
          <div key={r.id} style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "11px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {new Date(r.performed_on).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10.5, color: T.textFaint }}>{r.admins?.name || "—"}</span>
                <span
                  onClick={() => remove(r.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && remove(r.id)}
                  style={{ fontSize: 11, color: T.danger, cursor: "pointer" }}
                >
                  削除
                </span>
              </div>
            </div>

            {r.exercises?.length > 0 && (
              <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 3 }}>
                {r.exercises.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.text, fontVariantNumeric: "tabular-nums" }}>
                    {e.name}
                    <span style={{ color: T.textMute }}>
                      {e.weight != null ? ` ${e.weight}kg` : ""}
                      {e.reps != null ? ` × ${e.reps}回` : ""}
                      {e.sets != null ? ` × ${e.sets}セット` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {r.trainer_memo && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: T.textMute, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {r.trainer_memo}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Compact({ value, onChange, placeholder, suffix }) {
  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          background: T.field,
          border: `1px solid ${T.fieldBorder}`,
          borderRadius: radius.md,
          padding: "9px 10px",
          paddingRight: suffix ? 30 : 10,
          fontSize: 12,
          color: T.text,
          fontFamily: font,
          boxSizing: "border-box",
          outline: "none",
        }}
      />
      {suffix && (
        <span style={{ position: "absolute", right: 8, top: 10, fontSize: 10, color: T.textFaint }}>{suffix}</span>
      )}
    </div>
  );
}
