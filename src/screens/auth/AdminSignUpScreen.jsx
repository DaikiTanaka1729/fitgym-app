import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, radius } from "../../theme/tokens";
import { Banner, Button, CheckCircleIcon, TextField } from "../../components";
import AuthCard from "./AuthCard";
import { ADMIN_CONSOLE_NAME } from "../../appConfig";
import { authApi } from "../../api";
import { isEmail } from "./validation";

// A-01b 管理者の新規登録
// 登録はできるが、既存の店舗管理者が承認するまで管理画面は操作できない。
// 店舗に有効な管理者が1人もいない場合だけ自動で承認される。
export default function AdminSignUpScreen() {
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", password2: "" });
  const [err, setErr] = useState({});
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null); // 'active' | 'pending'

  const set = (k) => (v) => setF({ ...f, [k]: v });

  async function submit() {
    setBanner(null);
    const e = {};
    if (!f.name.trim()) e.name = "氏名を入力してください";
    if (!f.email.trim()) e.email = "メールアドレスを入力してください";
    else if (!isEmail(f.email)) e.email = "メールアドレスの形式が正しくありません";
    if (f.password.length < 8) e.password = "パスワードは8文字以上で入力してください";
    if (f.password !== f.password2) e.password2 = "パスワードが一致しません";
    setErr(e);
    if (Object.keys(e).length) return;

    setLoading(true);
    const { data, error } = await authApi.signUpAdmin({
      name: f.name.trim(),
      email: f.email.trim(),
      password: f.password,
    });
    setLoading(false);
    if (error) {
      setBanner(error);
      return;
    }
    setDone(data === "active" ? "active" : "pending");
  }

  if (done) {
    return (
      <AuthCard accent={T.navy} title={ADMIN_CONSOLE_NAME} sub="登録完了">
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <CheckCircleIcon />
          <div style={{ fontSize: 15, fontWeight: 500, marginTop: 10 }}>
            {done === "active" ? "登録が完了しました" : "登録を受け付けました"}
          </div>
        </div>

        {done === "active" ? (
          <>
            <div style={{ fontSize: 12, color: T.textMute, lineHeight: 1.8, marginBottom: 16 }}>
              この店舗で最初の管理者のため、そのままご利用いただけます。
              権限は<strong>店舗管理者</strong>です。
            </div>
            <Button variant="navy" full onClick={() => navigate("/admin", { replace: true })}>
              管理画面へ進む
            </Button>
          </>
        ) : (
          <>
            <div
              style={{
                background: T.amberSoft,
                color: T.amberDark,
                borderRadius: radius.md,
                padding: "11px 13px",
                fontSize: 11.5,
                lineHeight: 1.8,
                marginBottom: 14,
              }}
            >
              <strong>承認待ちです。</strong>
              <br />
              既存の店舗管理者が承認すると、管理画面をご利用いただけます。
              承認されるまではログインしても操作できません。
            </div>
            <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.8, marginBottom: 16 }}>
              店舗管理者の方に、承認をご依頼ください。
              承認は「トレーナー」の画面から行えます。
            </div>
            <Button variant="ghost" full onClick={() => navigate("/admin/login", { replace: true })}>
              ログイン画面へ戻る
            </Button>
          </>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard accent={T.navy} title={ADMIN_CONSOLE_NAME} sub="管理者の新規登録">
      {banner && <Banner>{banner}</Banner>}

      <div
        style={{
          background: T.navySoft,
          color: T.navy,
          borderRadius: radius.md,
          padding: "10px 12px",
          fontSize: 11,
          lineHeight: 1.8,
          marginBottom: 14,
        }}
      >
        登録後、既存の店舗管理者による<strong>承認</strong>が必要です。
        承認されるまで管理画面は操作できません。
      </div>

      <TextField label="氏名" required value={f.name} onChange={set("name")} placeholder="山田 太郎" error={err.name} />
      <TextField
        label="メールアドレス"
        required
        value={f.email}
        onChange={set("email")}
        placeholder="name@example.com"
        error={err.email}
      />
      <TextField
        label="パスワード"
        required
        type="password"
        value={f.password}
        onChange={set("password")}
        placeholder="8文字以上"
        error={err.password}
      />
      <TextField
        label="パスワード(確認)"
        required
        type="password"
        value={f.password2}
        onChange={set("password2")}
        placeholder="もう一度入力"
        error={err.password2}
      />

      <Button variant="navy" full onClick={submit} loading={loading}>
        登録する
      </Button>

      <div
        onClick={() => navigate("/admin/login")}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && navigate("/admin/login")}
        style={{ textAlign: "center", fontSize: 11, color: T.accent, marginTop: 12, cursor: "pointer" }}
      >
        すでに登録済みの方はログイン
      </div>
    </AuthCard>
  );
}
