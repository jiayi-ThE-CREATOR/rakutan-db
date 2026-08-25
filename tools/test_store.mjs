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

console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
