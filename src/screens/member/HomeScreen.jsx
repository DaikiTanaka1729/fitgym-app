import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, radius } from "../../theme/tokens";
import { Button, Banner, Badge, Spinner } from "../../components";
import { reservationApi, authApi } from "../../api";
import { useDisplayName } from "../../session";
import MemberLayout from "./MemberLayout";
import { APP_NAME } from "../../appConfig";
import { jstDate, jstTime } from "./format";

const TONE = { time: "primary", unlimited: "accent", ticket: "amber" };
const LABEL = { time: "時間課金", unlimited: "通い放題", ticket: "回数券" };

// M-03 ホーム
export default function HomeScreen() {
  const navigate = useNavigate();
  const name = useDisplayName();
  const [rows, setRows] = useState(null);
  const [banner, setBanner] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await reservationApi.listMine();
    if (error) {
      setBanner(error);
      setRows([]);
      return;
    }
    setRows(data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(id) {
    setBanner(null);
    setCancelling(id);
    const { error } = await reservationApi.cancel({ reservationId: id });
    setCancelling(null);
    if (error) {
      setBanner(error);
      return;
    }
    load();
  }

  async function signOut() {
    await authApi.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <MemberLayout title={APP_NAME} sub={name ? `${name} さん` : ""}>
      {banner && <Banner>{banner}</Banner>}

      <Button full onClick={() => navigate("/reserve")}>
        予約する
      </Button>

      <div style={{ marginTop: 22, marginBottom: 10, fontSize: 12, fontWeight: 500, color: T.textMute }}>
        これからの予約
      </div>

      {rows === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {rows?.length === 0 && (
        <div
          style={{
            border: `1px dashed ${T.fieldBorder}`,
            borderRadius: radius.lg,
            padding: "26px 16px",
            textAlign: "center",
            background: T.bgSubtle,
            color: T.textFaint,
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          予約はまだありません。
          <br />
          「予約する」から進んでください。
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows?.map((r) => (
          <div
            key={r.id}
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: radius.lg,
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{r.menu_name}</div>
              <Badge tone={TONE[r.billing_type]}>{LABEL[r.billing_type]}</Badge>
            </div>
            <div style={{ fontSize: 12, color: T.textMute, marginTop: 5 }}>
              {jstDate(r.start_at)} {jstTime(r.start_at)} 〜 {jstTime(r.end_at)}
            </div>
            {r.cancelable && (
              <div style={{ marginTop: 10 }}>
                <Button variant="ghost" onClick={() => cancel(r.id)} loading={cancelling === r.id}>
                  キャンセル
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        onClick={signOut}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && signOut()}
        style={{ textAlign: "center", fontSize: 11, color: T.textFaint, marginTop: 24, cursor: "pointer" }}
      >
        ログアウト
      </div>
    </MemberLayout>
  );
}
