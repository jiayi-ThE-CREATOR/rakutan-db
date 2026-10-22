/* 口コミの受け箱と「不公開にする」（2026-10-21 wang 決定：取り込みを自動化・先に公開して問題があれば下げる）。
 * 設計: docs/superpowers/specs/2026-10-21-review-auto-ingest-design.md
 *
 *   saveToInbox(env, payload)  … 投稿（/api/kuchikomi）を科目ごとに review_inbox へ1行ずつ入れる
 *   inboxNotice(env, saved, n) … Discord の通知に足す「一言＋不公開にするリンク」
 *   GET  /review/hide?r=&s=    … 確認のボタンだけのページ（リンクの事前取得で誤って下げないため）
 *   POST /review/hide          … 署名を確かめて hidden=1 にする（受け箱と、取り込みずみの reviews の両方）
 *
 * 「不公開」は今の publish:false と同じ ―― 一言だけ伏せ、選択式の答えは点数に入れ続ける。
 * 画面から消えるのは翌朝の取り込み（GitHub Actions）の後。
 */
import { hmac, b64urlEncode, SITE_URL } from "./linelogin.js";

const NOTE_MAX = 300;

async function hideSig(env, id) {
  return b64urlEncode(await hmac(env.SESSION_SECRET, `hide:${id}`)).slice(0, 24);
}

export async function saveToInbox(env, payload) {
  if (!env.DB) return [];
  const sels = Array.isArray(payload && payload.selections) ? payload.selections : [];
  const now = Date.now();
  const saved = [];
  const stmts = [];
  for (const sel of sels.slice(0, 40)) {
    const sub = (sel && sel.subject) || {};
    const courseId = String(sub.id || "").slice(0, 20);
    if (!courseId) continue;
    const id = b64urlEncode(crypto.getRandomValues(new Uint8Array(12)));
    /* 1科目ぶんだけを持つ（学年・学部などの投稿全体の情報は各行に写す）。 */
    const one = { grade: payload.grade, semester: payload.semester, faculty: payload.faculty,
                  department: payload.department, day: sel.day, period: sel.period, subject: sub };
    stmts.push(env.DB.prepare(
      "INSERT INTO review_inbox (id, at, course_id, payload) VALUES (?, ?, ?, ?)")
      .bind(id, now, courseId, JSON.stringify(one).slice(0, 20000)));
    const note = String((sub.review && sub.review.comment) || "").trim();
    saved.push({ id, name: String(sub.name || courseId), note });
  }
  if (stmts.length) await env.DB.batch(stmts);
  return saved;
}

/* 一言のある科目だけ、本文と「不公開にする」リンクを並べる。budget 文字を超えるぶんは数だけ言う。 */
export async function inboxNotice(env, saved, budget = 1500) {
  const withNote = saved.filter((s) => s.note);
  if (!withNote.length) return "";
  let out = "\n\n💬 一言（公開されます。問題があれば「不公開」を押してください）";
  let rest = 0;
  for (const s of withNote) {
    const link = `${SITE_URL}/review/hide?r=${s.id}&s=${await hideSig(env, s.id)}`;
    const block = `\n・${s.name.slice(0, 40)}：「${s.note.slice(0, NOTE_MAX)}」\n　→ 不公開にする <${link}>`;
    if (out.length + block.length > budget - 40) { rest++; continue; }
    out += block;
  }
  if (rest) out += `\n…ほか ${rest} 件の一言（スプレッドシートで確認してください）`;
  return out;
}

function page(title, body) {
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}｜ラクハン</title>
<style>body{font-family:sans-serif;max-width:460px;margin:12vh auto;padding:0 16px;color:#222;background:#faf8f5;line-height:1.8}
button{background:#a32b2b;color:#fff;border:0;padding:12px 22px;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer}
blockquote{margin:12px 0;padding:10px 14px;background:#fff;border-left:4px solid #DB6209}</style></head><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function check(env, id, sig) {
  if (!env.DB || !env.SESSION_SECRET || !/^[A-Za-z0-9_-]{8,40}$/.test(id || "")) return false;
  return sig === (await hideSig(env, id));
}

export async function handleHidePage(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get("r"), sig = url.searchParams.get("s");
  if (!(await check(env, id, sig))) return page("リンクが正しくありません", "<h1>リンクが正しくありません</h1>");
  const row = await env.DB.prepare("SELECT payload, hidden FROM review_inbox WHERE id = ?").bind(id).first();
  if (!row) return page("見つかりません", "<h1>口コミが見つかりません</h1>");
  let note = "", name = "";
  try { const p = JSON.parse(row.payload); note = p.subject?.review?.comment || ""; name = p.subject?.name || ""; } catch {}
  if (row.hidden) return page("不公開ずみ", `<h1>この一言はもう不公開です</h1><p>${esc(name)}</p><blockquote>${esc(note)}</blockquote>`);
  return page("不公開にする", `<h1>この一言を不公開にしますか？</h1><p>${esc(name)}</p><blockquote>${esc(note)}</blockquote>
<p>不公開にしても、選択式の答え（負担の点数）はそのまま使います。サイトから消えるのは翌朝の更新の後です。</p>
<form method="post" action="/review/hide"><input type="hidden" name="r" value="${esc(id)}"><input type="hidden" name="s" value="${esc(sig)}">
<button type="submit">不公開にする</button></form>`);
}

export async function handleHide(request, env) {
  let id = "", sig = "";
  try { const f = await request.formData(); id = String(f.get("r") || ""); sig = String(f.get("s") || ""); } catch {}
  if (!(await check(env, id, sig))) return page("リンクが正しくありません", "<h1>リンクが正しくありません</h1>");
  await env.DB.batch([
    env.DB.prepare("UPDATE review_inbox SET hidden = 1 WHERE id = ?").bind(id),
    env.DB.prepare("UPDATE reviews SET hidden = 1 WHERE src = ?").bind(id),
  ]);
  return page("不公開にしました", "<h1>不公開にしました</h1><p>翌朝の更新で、サイトから一言が消えます。</p>");
}
