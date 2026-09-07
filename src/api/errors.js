// ============================================================
// エラーハンドリングの統一
// ------------------------------------------------------------
// Supabase / ネットワークのエラーを利用者向けの日本語に変換する。
// 画面側は返ってきた error をそのまま表示すればよい。
// ============================================================
import { isSupabaseConfigured } from "./client";

const ERROR_MESSAGES = {
  // 認証系
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません",
  email_exists: "このメールアドレスは既に登録されています",
  user_not_found: "アカウントが見つかりません",
  weak_password: "パスワードは8文字以上で入力してください",
  over_email_send_rate_limit: "しばらく時間をおいて再度お試しください",
  // 予約系(create_reservation / cancel_reservation が返すコード)
  slot_full: "選択した時間帯は満席です",
  slot_closed: "選択した時間帯は予約を受け付けていません",
  slot_past: "過ぎた時間帯は予約できません",
  slot_not_found: "選択した時間帯が見つかりません",
  ticket_exhausted: "回数券の残回数がありません",
  ticket_expired: "回数券の有効期限が切れています",
  membership_expired: "通い放題の契約期間が終了しています",
  reservation_limit: "予約の保有上限に達しています",
  duplicate_reservation: "同じ時間帯に既に予約があります",
  menu_not_found: "選択したメニューは現在ご利用いただけません",
  source_mismatch: "メニューと支払い方法が一致しません",
  member_not_found: "対象の会員が見つかりません",
  reservation_not_found: "予約が見つかりません",
  already_cancelled: "この予約は既にキャンセルされています",
  cancel_too_late: "開始時刻を過ぎているためキャンセルできません",
  not_authenticated: "ログインが必要です",
  forbidden: "この操作を行う権限がありません",
  slot_in_use: "予約が入っているため、この枠は外せません",
  invalid_action: "操作の種類が正しくありません",
  invalid_range: "期間または時間帯の指定が正しくありません",
  approval_required: "メニューを公開するには承認権限が必要です",
  // 汎用
  network: "通信エラーが発生しました。接続をご確認ください",
  unknown: "エラーが発生しました。時間をおいて再度お試しください",
};

export function toFriendlyError(error) {
  if (!error) return null;
  const code = error.code || error.name || "";
  const msg = (error.message || "").toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login")) return ERROR_MESSAGES.invalid_credentials;
  if (msg.includes("already registered") || msg.includes("user already")) return ERROR_MESSAGES.email_exists;
  if (msg.includes("password") && msg.includes("weak")) return ERROR_MESSAGES.weak_password;
  if (msg.includes("network") || msg.includes("fetch")) return ERROR_MESSAGES.network;
  // 予約RPCは RAISE EXCEPTION のメッセージにコードを載せて返すため、部分一致で拾う
  const hit = Object.keys(ERROR_MESSAGES).find((k) => msg.includes(k));
  if (hit) return ERROR_MESSAGES[hit];
  return ERROR_MESSAGES[code] || error.message || ERROR_MESSAGES.unknown;
}

// すべてのAPI呼び出しをこのラッパで包み、戻り値を { data, error } に統一する。
export async function apiCall(fn) {
  if (!isSupabaseConfigured) {
    return { data: null, error: "サーバー未接続です(環境構築後に有効化されます)" };
  }
  try {
    const { data, error } = await fn();
    if (error) return { data: null, error: toFriendlyError(error) };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: toFriendlyError(e) };
  }
}
