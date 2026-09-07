import React, { useCallback, useEffect, useState } from "react";
import { T, font, radius } from "../../theme/tokens";
import { Banner, Button, Toast } from "../../components";
import { generateTempPassword, memberApi } from "../../api";
import { useSession } from "../../session";

const ACTION_LABEL = { issue_temp_password: "仮パスワードを発行" };

// A-08 会員パスワード操作(会員詳細に組み込む)
export default function PasswordSection({ member, onFlash }) {
  const { admin } = useSession();
  const isStoreAdmin = admin?.role === "admin";

  const [banner, setBanner] = useState(null);
  const [sending, setSending] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [temp, setTemp] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [audit, setAudit] = useState([]);

  const loadAudit = useCallback(async () => {
    const { data } = await memberApi.listAudit({ memberId: member.id });
    setAudit(data || []);
  }, [member.id]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  async function sendMail() {
    setBanner(null);
    setSending(true);
    const { error } = await memberApi.sendResetMail({ email: member.email });
    setSending(false);
    if (error) {
      setBanner(error);
      return;
    }
    onFlash?.(`${member.email} に再設定メールを送信しました`);
  }

  async function issue() {
    setBanner(null);
    setIssuing(true);
    const pw = generateTempPassword();
    const { error } = await memberApi.issueTempPassword({ memberId: member.id, tempPassword: pw });
    setIssuing(false);
    setConfirming(false);
    if (error) {
      setBanner(error);
      return;
    }
    setTemp(pw);
    loadAudit();
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute, marginBottom: 10 }}>パスワード操作</div>

      {banner && <Banner>{banner}</Banner>}

      {/* 発行結果 */}
      {temp && (
        <div
          style={{
            border: `1px solid ${T.amber}`,
            background: T.amberSoft,
            borderRadius: radius.lg,
            padding: "14px 16px",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.amberDark, marginBottom: 8 }}>
            仮パスワードを発行しました
          </div>
          <div
            style={{
              background: T.bg,
              border: `1px solid ${T.amber}`,
              borderRadius: radius.md,
              padding: "12px 14px",
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              fontSize: 20,
              letterSpacing: ".08em",
              textAlign: "center",
              userSelect: "all",
            }}
          >
            {temp}
          </div>
          <div style={{ fontSize: 11.5, color: T.amberDark, marginTop: 10, lineHeight: 1.7 }}>
            この画面を閉じると二度と表示されません。いま会員へお伝えください。
            <br />
            会員は次回ログイン時に、本人のパスワードへの変更を求められます。
          </div>
          <div style={{ marginTop: 10 }}>
            <Button variant="ghost" onClick={() => setTemp(null)}>
              確認しました(閉じる)
            </Button>
          </div>
        </div>
      )}

      {/* 操作 */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 3 }}>
              再設定メールを送る
              <span style={{ marginLeft: 8, fontSize: 10, color: T.primaryDark, background: T.primarySoft, padding: "1px 7px", borderRadius: 4 }}>
                推奨
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.7, marginBottom: 8 }}>
              会員自身が新しいパスワードを設定します。管理者がパスワードを知ることはありません。
            </div>
            <Button variant="navy" onClick={sendMail} loading={sending}>
              {member.email} へ送信
            </Button>
          </div>

          <div style={{ borderTop: `1px solid ${T.borderFaint}` }} />

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 3 }}>仮パスワードを発行する</div>
            <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.7, marginBottom: 8 }}>
              メールを受け取れない会員向けです。その場で発行し、口頭・書面でお伝えください。
              会員は次回ログイン時に必ず本人のパスワードへ変更します。
              {!isStoreAdmin && (
                <>
                  <br />
                  <span style={{ color: T.danger }}>この操作は店舗管理者のみ実行できます。</span>
                </>
              )}
            </div>

            {confirming ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: T.dangerDark }}>
                  現在のパスワードは使えなくなります。よろしいですか?
                </span>
                <Button variant="danger" onClick={issue} loading={issuing}>
                  発行する
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  やめる
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)} disabled={!isStoreAdmin}>
                仮パスワードを発行
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 操作履歴 */}
      {audit.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6 }}>操作履歴(監査ログ)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {audit.map((a, i) => (
              <div key={i} style={{ fontSize: 11.5, color: T.textMute, fontFamily: font }}>
                {new Date(a.created_at).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {"  "}
                {ACTION_LABEL[a.action] || a.action}
                {a.actor_name ? ` / ${a.actor_name}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
