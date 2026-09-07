import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, radius } from "../../theme/tokens";
import { Banner, Button, TextField } from "../../components";
import { authApi } from "../../api";
import { useSession } from "../../session";
import AuthCard from "../auth/AuthCard";
import { validateNewPassword } from "../auth/validation";

// M-09 初回パスワード変更
// 管理者が仮パスワードを発行した会員は、この画面を通らないと先に進めない。
export default function ChangePasswordScreen() {
  const navigate = useNavigate();
  const { refreshProfile } = useSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState({});
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setBanner(null);
    const e = validateNewPassword({ password: pw, confirm: pw2 });
    setErr(e);
    if (Object.keys(e).length) return;

    setLoading(true);
    const { error } = await authApi.updatePassword({ password: pw });
    if (error) {
      setLoading(false);
      setBanner(error);
      return;
    }
    // 変更が終わったので強制フラグを落とす
    const cleared = await authApi.clearMustChangePassword();
    setLoading(false);
    if (cleared.error) {
      setBanner(cleared.error);
      return;
    }
    await refreshProfile?.();
    navigate("/home", { replace: true });
  }

  return (
    <AuthCard title="パスワードの変更" sub="続けるには新しいパスワードの設定が必要です">
      {banner && <Banner>{banner}</Banner>}

      <div
        style={{
          background: T.amberSoft,
          color: T.amberDark,
          borderRadius: radius.md,
          padding: "9px 11px",
          fontSize: 11.5,
          lineHeight: 1.7,
          marginBottom: 14,
        }}
      >
        いまお使いのパスワードは、店舗が発行した仮のものです。
        ご本人だけがわかるパスワードに変更してください。
      </div>

      <TextField
        label="新しいパスワード"
        required
        type="password"
        value={pw}
        onChange={setPw}
        placeholder="8文字以上"
        error={err.password}
      />
      <TextField
        label="新しいパスワード(確認)"
        required
        type="password"
        value={pw2}
        onChange={setPw2}
        placeholder="もう一度入力"
        error={err.confirm}
      />

      <div
        style={{
          background: T.primarySoft,
          borderRadius: radius.md,
          padding: "8px 10px",
          fontSize: 10.5,
          color: T.primaryDark,
          lineHeight: 1.6,
          marginBottom: 13,
        }}
      >
        {pw.length >= 8 ? "✓" : "・"} 8文字以上　{pw && pw === pw2 ? "✓" : "・"} 2つが一致
      </div>

      <Button full onClick={submit} loading={loading}>
        パスワードを変更する
      </Button>
    </AuthCard>
  );
}
