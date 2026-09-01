/* store.js は localStorage の唯一の窓口。ここが黙って落ちると
 * お気に入りも時間割も静かに消えるので、壊れた値と例外を必ず試す。
 *   node tools/test_store.mjs
 *
 * store.js はブラウザ用の素のスクリプト（window.rkStore を作る）なので、
 * node:vm で偽の window と localStorage を与えて読み込む。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(path.join(ROOT, "web/assets/store.js"), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

/* 偽の localStorage。throws:true にすると全操作が例外を投げる
   （プライベートモードの再現）。 */
function makeStore(initial = {}, throws = false) {
  const m = new Map(Object.entries(initial));
  const boom = () => { throw new Error("SecurityError"); };
  return {
    getItem: throws ? boom : (k) => (m.has(k) ? m.get(k) : null),
    setItem: throws ? boom : (k, v) => void m.set(k, String(v)),
    removeItem: throws ? boom : (k) => void m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

function load(initial, throws) {
  const ls = makeStore(initial, throws);
  const ctx = { window: {}, localStorage: ls, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { s: ctx.window.rkStore, ls };
}

// ── プロフィール ───────────────────────────
{
  const { s, ls } = load({});
  check(s.getProfile().faculty === "", "初期の faculty は空文字であるべき");
  s.setProfile({ faculty: "law", grade: "2" });
  check(s.getProfile().grade === "2", "setProfile したのに読めない");
  const raw = JSON.parse(ls._dump()["osaka_u_settings"]);
  check(raw.faculty === "law", "osaka_u_settings に書かれていない");
}
{
  // kuchikomi が先に書いた semester / department を壊さないこと
  const pre = JSON.stringify({ semester: "autumn", department: "denshi" });
  const { s, ls } = load({ osaka_u_settings: pre });
  s.setProfile({ faculty: "engineering", grade: "3" });
  const raw = JSON.parse(ls._dump()["osaka_u_settings"]);
  check(raw.semester === "autumn", "kuchikomi の semester を消してしまった");
  check(raw.department === "denshi", "kuchikomi の department を消してしまった");
}

// ── onboarded ─────────────────────────────
{
  const { s } = load({});
  check(s.isOnboarded() === false, "初回は false であるべき");
  s.markOnboarded();
  check(s.isOnboarded() === true, "markOnboarded が効いていない");
}

// ── LINE 連携 ─────────────────────────────
// 「サイト側がそう覚えているだけ」の印。立てられること・取り消せること・
// 壊れた値で真にならないことだけ見る。
{
  const { s } = load({});
  check(s.isLineLinked() === false, "初期は未連携であるべき");
  s.markLineLinked();
  check(s.isLineLinked() === true, "markLineLinked が効いていない");
  s.clearLineLinked();
  check(s.isLineLinked() === false, "clearLineLinked で未連携に戻らない（取り消せない）");
}
{
  // "1" 以外はすべて未連携。true / "yes" のような値を真に採らないこと。
  const { s } = load({ rk_line_linked: "true" });
  check(s.isLineLinked() === false, '"1" 以外の値を連携済みとして採ってしまっている');
}

// ── お気に入り ─────────────────────────────
{
  const { s } = load({});
  check(s.getFavorites().length === 0, "初期は空であるべき");
  check(s.toggleFavorite("111") === true, "1回目の toggle は true を返すべき");
  check(s.isFavorite("111") === true, "isFavorite が false を返す");
  check(s.toggleFavorite("111") === false, "2回目の toggle は false を返すべき");
  check(s.getFavorites().length === 0, "外したのに残っている");
}

// ── 時間割 ────────────────────────────────
{
  const { s } = load({});
  s.setSlot("aki", "月2", "138531");
  check(s.getTimetable("aki").slots["月2"] === "138531", "setSlot が読めない");
  check(s.getTimetable("haru").slots["月2"] === undefined,
        "学期をまたいで漏れている（haru と aki は別の表）");
  // 1科目が複数コマを持てること
  s.setSlot("aki", "月3", "138531");
  check(s.getTimetable("aki").slots["月3"] === "138531",
        "同じ科目を2つのコマに置けない");
  s.clearSlot("aki", "月2");
  check(s.getTimetable("aki").slots["月2"] === undefined, "clearSlot が効かない");
  s.addExtra("aki", "020277");
  s.addExtra("aki", "020277");
  check(s.getTimetable("aki").extra.length === 1, "extra が重複して入る");
  s.removeExtra("aki", "020277");
  check(s.getTimetable("aki").extra.length === 0, "removeExtra が効かない");
}

// ── 壊れた値 ──────────────────────────────
{
  const { s } = load({ rk_favorites: "{壊れている", rk_timetable: "null",
                       osaka_u_settings: "[]" });
  check(s.getFavorites().length === 0, "壊れた rk_favorites で落ちる/変な値を返す");
  check(s.getTimetable("aki").extra.length === 0, "壊れた rk_timetable で落ちる");
  check(s.getProfile().faculty === "", "配列が入った osaka_u_settings で落ちる");
}

// ── localStorage が例外を投げる（プライベートモード） ──
{
  const { s } = load({}, true);
  check(s.getProfile().faculty === "", "例外を投げる環境で getProfile が落ちた");
  check(s.getFavorites().length === 0, "例外を投げる環境で getFavorites が落ちた");
  check(s.isOnboarded() === false, "例外を投げる環境で isOnboarded が落ちた");
  s.toggleFavorite("111");          // 投げないこと
  s.setSlot("aki", "月2", "111");   // 投げないこと
  check(true, "書き込みが例外を外へ漏らさない");
}

// ── toggleFavorite は例外下でメモリ保持すべき ──
{
  const { s } = load({}, true);
  // 1回目の toggle は true を返すべき（初回追加）
  const r1 = s.toggleFavorite("222");
  check(r1 === true, "プライベートモード下での1回目 toggle が true を返さない");
  // その間に isFavorite で確認できるべき
  const fav1 = s.isFavorite("222");
  check(fav1 === true, "プライベートモード下で toggle 後 isFavorite が true を返さない");
  // 2回目の toggle は false を返すべき（外す）
  const r2 = s.toggleFavorite("222");
  check(r2 === false, "プライベートモード下での2回目 toggle が false を返さない");
  // その後 isFavorite で確認
  const fav2 = s.isFavorite("222");
  check(fav2 === false, "プライベートモード下で2回目 toggle 後 isFavorite が false を返さない");
}

// ── 配列形の ids は拒絶すべき ──
{
  const { s } = load({ rk_favorites: JSON.stringify({ v: 1, ids: ["111", "222"] }) });
  check(s.getFavorites().length === 0, "配列形 ids から お気に入りが誤抽出される");
  check(s.isFavorite("111") === false, "配列形 ids で isFavorite が true を返す");
  check(s.isFavorite("222") === false, "配列形 ids で isFavorite が true を返す");
}

// ── memFallback の非対称throw（quota 枯渇の再現）──
// getItem は生きたまま setItem だけが例外を投げる。iOS 7〜10 の私的モードとは
// 違い、これは 2026年でも quota 枯渇で実際に起こる（final-review.md §2.1）。
// この状態で write が memFallback に退避したのに read がそれを見なければ、
// 「星を押した直後は★に見えるが、次の再描画で☆に戻る」という、
// Task 2 が潰したはずの症状が別の引き金で復活する。
{
  let setItemThrows = true;
  const m = new Map();
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (setItemThrows) throw new Error("QuotaExceededError"); m.set(k, String(v)); },
    removeItem: (k) => void m.delete(k),
  };
  const ctx = { window: {}, localStorage: ls, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const s = ctx.window.rkStore;

  // setItem が落ちている間も、書いた値がそのまま読み戻せること
  // （非対称throwの穴：getItem は例外を投げないので、read が memFallback を
  //   見ていないと localStorage の古い値＝未書き込みの null を返してしまう）。
  const r1 = s.toggleFavorite("333");
  check(r1 === true, "setItem throw 下で toggleFavorite(初回) が true を返さない");
  check(s.isFavorite("333") === true,
        "setItem throw 下で isFavorite が memFallback を見ずに古い値を返している");
  check(!m.has("rk_favorites"), "setItem throw 下なのに本物の localStorage に書けている（前提が壊れている）");

  // setItem が復帰したあと、本物の書き込みが memFallback の古い退避値に勝つこと
  // （delete を省略すると、退避したキーは書けるようになっても永久に古い値のまま）。
  setItemThrows = false;
  const r2 = s.toggleFavorite("333"); // 外す。今度は本物の localStorage に書ける
  check(r2 === false, "setItem 復帰後の2回目 toggle が false を返さない");
  check(m.has("rk_favorites"), "setItem 復帰後なのに本物の localStorage に書かれていない（delete 漏れ）");
  check(s.isFavorite("333") === false,
        "setItem 復帰後の本物の書き込みが memFallback の古い値に負けている（delete 漏れ）");
}

console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
