import React, { useCallback, useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Banner, Button, Segmented, Spinner, TextField } from "../../components";
import { menuApi } from "../../api";
import { useSession } from "../../session";

// 直前予約の締切(メニュー設定に組み込む)
// ------------------------------------------------------------
// 開始の何分前で予約を締め切るかを決める。準備やトレーナーの移動に
// 時間が要るため、直前の予約は受けられない。
//
// これは店舗の運用ルールなので、店舗に1つ持つ。
// メニューごとに変えたい場合は、メニューの編集画面で上書きできる。
// ------------------------------------------------------------

// よく使う値。分で持つが、選ぶときは時間で見せる。
const PRESETS = [
  { value: "60", label: "1時間前" },
  { value: "120", label: "2時間前" },
  { value: "180", label: "3時間前" },
  { value: "1440", label: "前日" },
];

// 分を読みやすい言い方にする
export function cutoffLabel(min) {
  const n = Number(min);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "締切なし(直前まで可)";
  if (n % 1440 === 0) return `${n / 1440}日前`;
  if (n % 60 === 0) return `${n / 60}時間前`;
  return `${n}分前`;
}

export default function BookingCutoffSection({ onFlash }) {
  const { admin } = useSession();
  const isStoreAdmin = admin?.role === "admin";

  const [current, setCurrent] = useState(null);
  const [value, setValue] = useState("120");
  const [custom, setCustom] = useState(false);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await menuApi.getStoreSettings();
    if (error) {
      setBanner(error);
      return;
    }
    const min = data?.[0]?.booking_cutoff_min ?? 120;
    setCurrent(min);
    setValue(String(min));
    setCustom(!PRESETS.some((p) => Number(p.value) === min));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBanner(null);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 10080) {
      setBanner("0〜10080(7日)の範囲の整数で入力してください");
      return;
    }
    setSaving(true);
    const { error } = await menuApi.setBookingCutoff({ minutes: n });
    setSaving(false);
    if (error) {
      setBanner(error);
      return;
    }
    setCurrent(n);
    onFlash?.(`直前予約の締切を「${cutoffLabel(n)}」にしました`);
  }

  const changed = current !== null && Number(value) !== current;

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>直前予約の締切</div>
      <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.8, marginBottom: 12 }}>
        開始時刻のどれだけ前で予約を締め切るかを決めます。締切を過ぎた時間は、会員の予約画面に表示されません。
        <br />
        管理者による代理予約は、この締切の対象外です(お電話を受けて直前に入れる運用のため)。
      </div>

      {banner && <Banner>{banner}</Banner>}

      {current === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
          <Spinner color={T.textFaint} size={18} />
        </div>
      ) : (
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: radius.lg,
            padding: 16,
            maxWidth: 520,
            background: T.bg,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 11.5, color: T.textMute }}>現在の設定</span>
            <span style={{ fontSize: 17, fontWeight: 600, color: T.navy }}>{cutoffLabel(current)}</span>
          </div>

          {!custom && (
            <div style={{ marginBottom: 12 }}>
              <Segmented
                value={value}
                onChange={setValue}
                options={PRESETS}
              />
            </div>
          )}

          {custom && (
            <div style={{ maxWidth: 220, marginBottom: 6 }}>
              <TextField
                label="締切(分)"
                value={value}
                onChange={setValue}
                placeholder="120"
              />
            </div>
          )}

          <div
            onClick={() => setCustom(!custom)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setCustom(!custom)}
            style={{ fontSize: 11.5, color: T.accent, cursor: "pointer", marginBottom: 14 }}
          >
            {custom ? "よく使う設定から選ぶ" : "分で細かく指定する"}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button
              variant="navy"
              onClick={save}
              loading={saving}
              disabled={!isStoreAdmin || !changed}
            >
              保存する
            </Button>
            {!isStoreAdmin && (
              <span style={{ fontSize: 11.5, color: T.textMute }}>
                変更できるのは店舗管理者のみです
              </span>
            )}
            {isStoreAdmin && changed && (
              <span style={{ fontSize: 11.5, color: T.textMute }}>
                {cutoffLabel(Number(value))} に変更します
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.8, marginTop: 10 }}>
        メニューごとに違う締切にしたい場合は、そのメニューの編集画面で上書きできます。
        メニュー側が未入力なら、ここの設定が使われます。
      </div>
    </div>
  );
}
