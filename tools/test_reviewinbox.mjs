/* 口コミの受け箱と「不公開にする」（worker/reviewinbox.js）。D1 は SQLite で代わりにする。
 *
 *   node tools/test_reviewinbox.mjs
 *
 * 守りたいこと:
 *   ・投稿は科目ごとに1行ずつ受け箱に入る（学年・学部も各行に写す）
 *   ・Discord の通知に、一言と「不公開にする」リンクが付く（一言の無い科目には付けない）
 *   ・GET では下げない（リンクの事前取得で誤って下げないため）。POST で受け箱と reviews の両方を下げる
 *   ・署名が合わないリンクでは何もしない
 */
import { d1 } from "./d1_sqlite.mjs";
import { saveToInbox, inboxNotice, handleHidePage, handleHide } from "../worker/reviewinbox.js";

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const DB = d1();
const env = { DB, SESSION_SECRET: "ss" };
const payload = {
  grade: "1年", semester: "spring", faculty: "文学部", department: "全学科",
  selections: [
    { day: "火", period: 1, subject: { id: "135337", name: "数理科学 I", teacher: "髙野",
      review: { form_v: 5, items: { exam: 2 }, comment: "テストは簡単" } } },
    { day: "水", period: 2, subject: { id: "138531", name: "別の授業", review: { form_v: 5, comment: "" } } },
  ],
};

const saved = await saveToInbox(env, payload);
const rows = DB.raw.prepare("SELECT * FROM review_inbox ORDER BY course_id").all();
check(rows.length === 2, `受け箱が科目ごとに1行でない: ${rows.length}`);
const p0 = JSON.parse(rows.find(r => r.course_id === "135337").payload);
check(p0.faculty === "文学部" && p0.subject.review.comment === "テストは簡単", "受け箱の1行に投稿の中身が無い");
check(rows.every(r => r.done === 0 && r.hidden === 0), "受け箱の初期値が違う");

const notice = await inboxNotice(env, saved, 1500);
check(notice.includes("「テストは簡単」") && notice.includes("/review/hide?r="), "通知に一言と不公開リンクが無い");
check(!notice.includes("別の授業"), "一言の無い科目にリンクを付けている");
const link = new URL(notice.match(/<(https:\/\/[^>]+)>/)[1]);
const id = link.searchParams.get("r"), sig = link.searchParams.get("s");
check(id === saved.find(s => s.note).id, "リンクの id が受け箱の行と違う");

/* 取り込みずみ（reviews にもある）の行を用意 */
DB.raw.prepare("INSERT INTO reviews (id, row, hidden, src) VALUES ('i1', '{}', 0, ?)").run(id);

const g = await handleHidePage(new Request(link.toString()), env);
const gh = await g.text();
check(gh.includes("不公開にしますか") && gh.includes("テストは簡単"), "確認のページに一言が出ない");
check(DB.raw.prepare("SELECT hidden FROM review_inbox WHERE id = ?").get(id).hidden === 0, "GET で下げてしまった");

const bad = await handleHide(new Request("https://x/review/hide", { method: "POST",
  body: new URLSearchParams({ r: id, s: "wrong" }) }), env);
check((await bad.text()).includes("正しくありません") &&
      DB.raw.prepare("SELECT hidden FROM review_inbox WHERE id = ?").get(id).hidden === 0, "署名の違うリンクで下げた");

await handleHide(new Request("https://x/review/hide", { method: "POST", body: new URLSearchParams({ r: id, s: sig }) }), env);
check(DB.raw.prepare("SELECT hidden FROM review_inbox WHERE id = ?").get(id).hidden === 1, "受け箱が不公開にならない");
check(DB.raw.prepare("SELECT hidden FROM reviews WHERE src = ?").get(id).hidden === 1, "取り込みずみの reviews が不公開にならない");

/* 長い通知は文字数の中に収める（リンクを途中で切らない） */
const many = Array.from({ length: 30 }, (_, i) => ({ id: `id${i}xxxxxx`, name: "科目", note: "あ".repeat(200) }));
const long = await inboxNotice(env, many, 1800);
check(long.length <= 1800 && long.includes("ほか"), `長い通知が文字数を超える、または「ほか」が無い: ${long.length}`);
check((long.match(/<https:[^>]+>/g) || []).every(l => l.includes("&s=")), "途中で切れたリンクがある");

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
for (const f of fails) console.log("  NG ", f);
process.exit(fails.length ? 1 : 0);
