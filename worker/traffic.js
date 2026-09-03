/* 計測リンク（/l/<slug>）の正本と、毎朝のアクセス速報。
 *
 * worker/index.js から切り出してある。理由は2つ:
 *   1. Workers の入口モジュールは **関数以外の named export を受け付けない**
 *      （`export const STATS_SQL = "…"` を index.js に置くと、デプロイでも
 *       wrangler dev でも「Incorrect type for map entry」で起動ごと落ちる。
 *       2026-09-03 に実測）。表や SQL 文をテストから読みたいので、
 *       入口ではないこのファイルに置く
 *   2. index.js が 1,100 行を超えていて、これ以上足すと読めなくなる
 */

/* 配った slug の正本はこの1枚。ここから配信側（TRACKING_SLUGS）と
 * 集計側（毎朝の速報）の両方を作る。2枚に割ると、片方に足し忘れた slug が
 * 「直接・その他」へ静かに化けて、宣伝の効き目が消える。
 *   [チャネル名, [[slug, 内訳の呼び名], ...]]
 * 内訳が2本以上あるチャネルだけ、速報に内訳を出す。 */
export const STATS_CHANNELS = [
  ["Instagram", [["ig", "プロフ"], ["story", "ストーリー"]]],
  ["LINE 公式", [["line", "メッセージ"], ["line-rich", "リッチメニュー"]]],
  ["LINE オプチャ", [["oc1", "oc1"], ["oc2", "oc2"], ["oc3", "oc3"], ["oc4", "oc4"], ["oc5", "oc5"]]],
  ["X", [["x", "ポスト"]]],
  ["学生団体DM", [["dm-a", "A層"], ["dm-b", "B層"]]],
  ["個人配布", [["kasai", "笠井"], ["shunya", "しゅんや"], ["kimura", "きむら"], ["wang", "王"]]],
];

// slug の付いていない訪問（裸のURL・ブックマーク・口コミ経由）の置き場。
const STATS_DIRECT = "直接・その他";

export const TRACKING_SLUGS = new Set(
  STATS_CHANNELS.flatMap(([, slugs]) => slugs.map(([slug]) => slug))
);

/* ── 毎朝のアクセス速報（cron → Analytics Engine → Discord） ──
 *
 * 「きのう何人来たか」と「どこから来たか」を JST 08:00 に1通流す。
 * 数えているのは自前の POST /api/hit（Cloudflare Web Analytics の
 * beacon は広告ブロッカーに塞がれるので、あちらは下限にしかならない）。
 *
 * 流入元は /l/<slug> の**パス**から決まる。/api/hit はパスを blob2 に
 * 入れているので、集計のためにクライアントを変える必要は無い
 * ―― すでに人へ配ってあるリンクが、そのまま過去ぶんの集計にも効く。
 *
 * 🚨 この数字の意味（協賛の話で出す前に読む）
 *   ・slug 付きのリンクを踏んだ人だけが流入元に分かれる。裸のURL・
 *     ブックマーク・口コミで聞いて手打ちした人は全部「直接・その他」。
 *   ・入口が /l/ig でも、サイト内でロゴや About を押すとパスが / に変わる。
 *     だから**流入元の正本は「訪問」**（タブを開いて最初の1回。必ず入口で立つ）で、
 *     ページ表示・検索・詳細は参考値。
 */
const STATS_DATASET = "rakutan_use";   // wrangler.toml の [[analytics_engine_datasets]] と揃える
const STATS_DAYS = 7;                  // 走査に出す日数

/* 抽選（_sample_interval）を掛けるのを省かないこと。件数が増えると
   Cloudflare 側が間引いて保存し、掛けずに数えるとその日だけ静かに少なく出る。
   窓を9日にしてあるのは、7日の走査＋前日比＋JST の日境目のぶん。 */
export const STATS_SQL = `
SELECT formatDateTime(timestamp, '%Y-%m-%d', 'Asia/Tokyo') AS day,
       blob1 AS event,
       blob2 AS path,
       SUM(_sample_interval * double1) AS n,
       SUM(_sample_interval * double2) AS visits
FROM ${STATS_DATASET}
WHERE timestamp >= NOW() - INTERVAL '9' DAY
GROUP BY day, event, path
ORDER BY day ASC
FORMAT JSON`;

const STATS_SLUG_INDEX = new Map(
  STATS_CHANNELS.flatMap(([name, slugs]) => slugs.map(([slug, label]) => [slug, [name, label]]))
);

function statsChannelOf(path) {
  const m = /^\/l\/([\w-]+)$/.exec(String(path ?? ""));
  return (m && STATS_SLUG_INDEX.get(m[1])) || [STATS_DIRECT, ""];
}

// UTC の刻みから JST の日付（YYYY-MM-DD）を作る。JST は夏時間が無いので +9 固定でよい。
function statsJstDay(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const statsRound = (v) => Math.round(Number(v) || 0);

/* SQL の行 → Discord の本文。ここは外に触らない純関数
   （tools/test_traffic_report.mjs が数え方だけを見張れるように）。 */
export function buildTrafficReport(rows, now) {
  const DAY = 86400000;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const yesterday = statsJstDay(nowMs - DAY);
  const dayBefore = statsJstDay(nowMs - 2 * DAY);
  const week = [];
  for (let i = STATS_DAYS; i >= 1; i--) week.push(statsJstDay(nowMs - i * DAY));

  const totals = new Map();   // 日 → { visits, pv, search, detail }
  const channels = new Map(); // 日 → Map(チャネル → { total, parts })
  for (const r of rows ?? []) {
    const day = String(r.day);
    const t = totals.get(day) ?? { visits: 0, pv: 0, search: 0, detail: 0 };
    const n = Number(r.n) || 0;
    if (r.event === "pv") {
      t.pv += n;
      const v = Number(r.visits) || 0;
      t.visits += v;
      if (v > 0) {
        const perDay = channels.get(day) ?? new Map();
        const [name, label] = statsChannelOf(r.path);
        const c = perDay.get(name) ?? { total: 0, parts: [] };
        c.total += v;
        if (label) c.parts.push([label, v]);
        perDay.set(name, c);
        channels.set(day, perDay);
      }
    } else if (r.event === "search") t.search += n;
    else if (r.event === "detail") t.detail += n;
    totals.set(day, t);
  }

  const y = totals.get(yesterday) ?? { visits: 0, pv: 0, search: 0, detail: 0 };
  const lines = [`📊 **ラクハン アクセス速報** ｜ ${yesterday}（JST）`, ""];

  /* 0 でも鳴らす。Discord 上では「誰も来なかった」と「計測が壊れた」が
     同じ沈黙に見える ―― 疑う順番まで書いておく。 */
  if (statsRound(y.visits) === 0 && statsRound(y.pv) === 0) {
    lines.push("きのうの訪問は **0** でした。");
    lines.push("誰も来なかったのか、計測が故障しているのかは、この数字だけでは分かりません。");
    lines.push("疑う順番 ① 直前のデプロイ ② nginx が Origin と Referer を落としている ③ 端末が ?nostats=1 を踏んでいる");
    return lines.join("\n");
  }

  const prev = statsRound(totals.get(dayBefore)?.visits ?? 0);
  const diff = statsRound(y.visits) - prev;
  lines.push(`**訪問 ${statsRound(y.visits)}**（前日 ${prev} / ${diff >= 0 ? "+" : ""}${diff}）`);
  lines.push(`ページ表示 ${statsRound(y.pv)} ・ 検索 ${statsRound(y.search)} ・ 詳細 ${statsRound(y.detail)}`);
  lines.push("");

  /* 0 の欄も消さない。消えると「きのうは Instagram が 0 だった」が読めず、
     宣伝を止めた日と数え損ねた日の区別が付かなくなる。 */
  lines.push("**流入元（訪問）**");
  const perDay = channels.get(yesterday) ?? new Map();
  for (const [name, slugs] of [...STATS_CHANNELS, [STATS_DIRECT, []]]) {
    const c = perDay.get(name) ?? { total: 0, parts: [] };
    const parts = c.parts
      .filter(([, v]) => statsRound(v) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, v]) => `${label} ${statsRound(v)}`)
      .join(" / ");
    /* 内訳を出すかどうかは「その日いくつ来たか」ではなく
       「そのチャネルが何本の slug で配ってあるか」で決める。1本しか来なかった日でも
       個人配布は誰の、オプチャはどの部屋の数字なのかが要る（そこが知りたい欄なので）。
       逆に X のように配布が1本だけの欄は「X 4（ポスト 4）」になるだけなので出さない。 */
    lines.push(`・${name} ${statsRound(c.total)}` + (slugs.length > 1 && parts ? `（${parts}）` : ""));
  }

  const weekly = week.map((d) => [d, statsRound(totals.get(d)?.visits ?? 0)]);
  const sum = weekly.reduce((a, [, v]) => a + v, 0);
  const max = Math.max(1, ...weekly.map(([, v]) => v));
  lines.push("");
  lines.push(`**直近${STATS_DAYS}日の訪問（合計 ${sum}）**`);
  lines.push("```");
  for (const [d, v] of weekly) {
    lines.push(`${d.slice(5)} ${"▇".repeat(Math.round((v / max) * 12)).padEnd(12, " ")} ${v}`);
  }
  lines.push("```");

  const weekChannels = new Map();
  for (const d of week) {
    for (const [name, c] of channels.get(d) ?? new Map()) {
      weekChannels.set(name, (weekChannels.get(name) ?? 0) + c.total);
    }
  }
  const share = [...weekChannels]
    .filter(([, v]) => statsRound(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => `${name} ${Math.round((v / (sum || 1)) * 100)}%`)
    .join(" / ");
  if (share) lines.push(`${STATS_DAYS}日の割合 ── ${share}`);

  // Discord は 2000 字を超えると投稿ごと落ちる。落とすくらいなら削る。
  const out = lines.join("\n");
  return out.length > 1900 ? out.slice(0, 1900) + "\n…（長いので省略）" : out;
}

async function statsQuery(env) {
  const account = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;
  if (!account || !token) throw new Error("CF_ACCOUNT_ID / CF_API_TOKEN が未設定");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: STATS_SQL }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL API が ${res.status}（${text.slice(0, 200)}）`);
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`JSON として読めない（${text.slice(0, 200)}）`); }
  return json.data ?? [];
}

/* cron の入口。webhook が未設定のあいだは外へ一切出ない（口コミ通知と同じ）。
   設定してあるなら、失敗した日も鳴らす ―― 沈黙は「0件」と見分けが付かない。 */
export async function runDailyTraffic(env, now) {
  const webhook = env.STATS_DISCORD_WEBHOOK;
  if (!webhook) return;

  let content;
  try {
    content = buildTrafficReport(await statsQuery(env), now);
  } catch (e) {
    content =
      "⚠️ **ラクハン アクセス速報**：きのうの数字を取れませんでした。\n" +
      `> ${String(e?.message ?? e).slice(0, 300)}\n` +
      "黙って止まると「0件」と区別が付かないので鳴らしています。手で確かめるなら `node tools/stats.mjs`。";
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // 本文に数字しか入らない作りだが、念のため飛ばさない。
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) console.error("stats webhook failed", res.status);
}
