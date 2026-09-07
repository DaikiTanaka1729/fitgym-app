import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { T, radius } from "../../theme/tokens";
import { Button, Badge, CheckCircleIcon } from "../../components";
import { menuApi } from "../../api";
import MemberLayout from "./MemberLayout";
import { jstDate, jstTime } from "./format";

const TONE = { time: "primary", unlimited: "accent", ticket: "amber" };
const LABEL = { time: "時間課金", unlimited: "通い放題", ticket: "回数券" };

// M-05 予約完了
export default function ReserveDoneScreen() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [note, setNote] = useState(null);

  // 回数券の残数は消化後の値を出したいので、確定後に取り直す。
  useEffect(() => {
    if (state?.menu?.billing_type !== "ticket") return;
    menuApi.listMine().then(({ data }) => {
      const m = data?.find((x) => x.id === state.menu.id);
      if (m) setNote(m.note);
    });
  }, [state]);

  // 直接URLを開かれた場合はホームへ戻す
  if (!state?.menu || !state?.startAt) return <Navigate to="/home" replace />;

  const { menu, startAt } = state;
  const end = new Date(new Date(startAt).getTime() + menu.duration_min * 60000).toISOString();

  return (
    <MemberLayout title="予約完了" sub="ご予約を承りました">
      <div style={{ textAlign: "center", padding: "10px 0 18px" }}>
        <CheckCircleIcon />
        <div style={{ fontSize: 15, fontWeight: 500, marginTop: 10 }}>予約が完了しました</div>
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{menu.name}</div>
          <Badge tone={TONE[menu.billing_type]}>{LABEL[menu.billing_type]}</Badge>
        </div>

        <div style={{ borderTop: `1px solid ${T.borderFaint}`, margin: "11px 0" }} />

        <Row label="日時" value={`${jstDate(startAt)} ${jstTime(startAt)} 〜 ${jstTime(end)}`} />
        <Row label="所要時間" value={`${menu.duration_min}分`} />
        {menu.billing_type === "time" && <Row label="料金" value={`¥${menu.price.toLocaleString()}`} />}
        {menu.billing_type === "ticket" && note && <Row label="回数券" value={note} />}
      </div>

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <Button full onClick={() => navigate("/home")}>
          ホームへ戻る
        </Button>
        <Button variant="secondary" full onClick={() => navigate("/reserve")}>
          続けて予約する
        </Button>
        <div
          onClick={() => navigate("/survey")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && navigate("/survey")}
          style={{ textAlign: "center", fontSize: 11.5, color: T.accent, cursor: "pointer", marginTop: 2 }}
        >
          ご意見をお聞かせください
        </div>
      </div>
    </MemberLayout>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
      <span style={{ fontSize: 11.5, color: T.textMute }}>{label}</span>
      <span style={{ fontSize: 12.5, color: T.text, textAlign: "right" }}>{value}</span>
    </div>
  );
}
