// 認証フォームの入力チェック。パスワードは8文字以上(基本設計書 第3章)。

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function validateSignup({ name, email, password, birth }) {
  const e = {};
  if (!name.trim()) e.name = "氏名を入力してください";
  if (!email.trim()) e.email = "メールアドレスを入力してください";
  else if (!isEmail(email)) e.email = "メールアドレスの形式が正しくありません";
  if (!password) e.password = "パスワードを入力してください";
  else if (password.length < 8) e.password = "パスワードは8文字以上で入力してください";
  if (birth && !/^\d{4}\/\d{2}\/\d{2}$/.test(birth)) e.birth = "YYYY/MM/DD 形式で入力してください";
  return e;
}

export function validateLogin({ email, password }) {
  const e = {};
  if (!email.trim()) e.email = "メールアドレスを入力してください";
  else if (!isEmail(email)) e.email = "メールアドレスの形式が正しくありません";
  if (!password) e.password = "パスワードを入力してください";
  return e;
}

export function validateNewPassword({ password, confirm }) {
  const e = {};
  if (password.length < 8) e.password = "パスワードは8文字以上で入力してください";
  if (password !== confirm) e.confirm = "パスワードが一致しません";
  return e;
}
