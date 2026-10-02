const express = require("express");
const path = require("path");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 8787;
const parser = new Parser({ timeout: 12000 });

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function clean(s = "") { return String(s).replace(/\s+/g, " ").trim(); }
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function escText(s = "") { return clean(s).replace(/<[^>]*>/g, ""); }
function slug(s = "") { return clean(s).toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 80); }

function tokenWords(text) {
  return clean(text).toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(w => w.length >= 4);
}

const STOP = new Set((
  "the and for with from that this what when where how why are was has have into about health healthy treatment symptoms symptom india indian people their your you they these those does can could should will after before best home medicine medical disease condition video videos official latest today news doctor doctors patient patients cure treatment natural health care"
).split(/\s+/));

const DIMENSIONS = [
  ["Timing", [/\bafter eating\b|\bafter meals?\b|\bpost meal\b|\bmorning\b|\bnight\b|\bevening\b|\bbedtime\b|\bfasting\b|\bwhen\b/]],
  ["Food / trigger", [/\bfood\b|\bmeal\b|\brice\b|\broti\b|\bfruit\b|\bvegetable\b|\bmilk\b|\bdairy\b|\bcurd\b|\bspicy\b|\bgluten\b|\bsugar\b/]],
  ["Hydration", [/\bwater\b|\bhydration\b|\bdrink\b|\belectrolyte\b|\bdehydration\b/]],
  ["Movement / posture", [/\bwalk\b|\bwalking\b|\bexercise\b|\bmovement\b|\bposture\b|\bsitting\b|\bstretch\b/]],
  ["Sleep / recovery", [/\bsleep\b|\bsleeping\b|\bcircadian\b|\brecovery\b|\brest\b/]],
  ["Stress / behaviour", [/\bstress\b|\banxiety\b|\bbehavior\b|\bbehaviour\b|\bhabit\b|\broutine\b/]],
  ["Test / measurement", [/\btest\b|\breport\b|\bscan\b|\bmarker\b|\blevel\b|\bresult\b|\bhba1c\b|\bcrp\b|\bcreatinine\b/]],
  ["Treatment / remedy", [/\bmedicine\b|\btablet\b|\bsupplement\b|\bremedy\b|\btherapy\b|\bayurveda\b|\bherb\b|\bchuran\b/]],
  ["Mechanism / connection", [/\bwhy\b|\bcause\b|\bmechanism\b|\binsulin\b|\bhormone\b|\binflammation\b|\bmicrobiome\b|\bbacteria\b|\bnerve\b|\bcortisol\b/]],
  ["Comparison", [/\bvs\b|\bversus\b|\bdifference\b|\bbetter\b|\bworse\b|\bfresh\b|\bfermented\b|\braw\b|\bcooked\b|\bcold\b|\bhot\b/]]
];

const PROBES = [
  "{k}",
  "{k} questions", "{k} why how", "{k} problems symptoms", "{k} food diet", "{k} habits routine",
  "{k} morning night", "{k} after eating", "{k} causes mechanism", "{k} test report", "{k} remedy treatment",
  "{k} experience discussion", "{k} India Hindi", "{k} vs", "{k} mistakes", "{k} myth reality"
];

async function youtubeSearch(q, maxResults = 25) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { items: [], enabled: false };
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Math.min(maxResults, 50)));
  url.searchParams.set("regionCode", "IN");
  url.searchParams.set("relevanceLanguage", "hi");
  url.searchParams.set("q", q);
  url.searchParams.set("key", key);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`YouTube search failed: ${r.status}`);
  const data = await r.json();
  return { enabled: true, items: (data.items || []).map(x => ({
    id: x.id?.videoId ? `yt:${x.id.videoId}` : null,
    title: clean(x.snippet?.title), description: clean(x.snippet?.description),
    text: clean(`${x.snippet?.title || ""} ${x.snippet?.description || ""}`),
    publishedAt: x.snippet?.publishedAt, channel: x.snippet?.channelTitle,
    videoId: x.id?.videoId, url: x.id?.videoId ? `https://www.youtube.com/watch?v=${x.id.videoId}` : null,
    source: "YouTube"
  })).filter(x => x.id) };
}

async function youtubeComments(videoId, maxResults = 20) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !videoId) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.set("part", "snippet"); url.searchParams.set("videoId", videoId);
  url.searchParams.set("maxResults", String(Math.min(maxResults, 100)));
  url.searchParams.set("textFormat", "plainText"); url.searchParams.set("order", "relevance"); url.searchParams.set("key", key);
  const r = await fetch(url); if (!r.ok) return [];
  const data = await r.json();
  return (data.items || []).map(x => {
    const s = x.snippet?.topLevelComment?.snippet || {};
    return { id: `ytc:${x.id}`, title: "YouTube comment", text: clean(s.textDisplay), publishedAt: s.publishedAt, likeCount: s.likeCount || 0, source: "YouTube comment", url: `https://www.youtube.com/watch?v=${videoId}` };
  }).filter(x => x.text);
}

async function redditSearch(q, limit = 40, sort = "relevance") {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", q); url.searchParams.set("sort", sort); url.searchParams.set("t", sort === "new" ? "month" : "year");
  url.searchParams.set("limit", String(Math.min(limit, 100))); url.searchParams.set("restrict_sr", "false");
  const r = await fetch(url, { headers: { "User-Agent": "MEDIMANCH-Territory-Explorer/2.0" } });
  if (!r.ok) throw new Error(`Reddit search failed: ${r.status}`);
  const data = await r.json();
  return (data?.data?.children || []).map(x => ({
    id: `rd:${x.data?.id}`, title: clean(x.data?.title), text: clean(x.data?.selftext),
    subreddit: x.data?.subreddit, createdUtc: x.data?.created_utc, score: x.data?.score || 0,
    url: x.data?.permalink ? `https://www.reddit.com${x.data.permalink}` : null, source: "Reddit"
  })).filter(x => x.id && (x.title || x.text));
}

async function newsRss(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const feed = await parser.parseURL(url);
  return (feed.items || []).slice(0, 20).map((x, i) => ({
    id: `news:${slug(x.link || x.title)}:${i}`, title: clean(x.title), text: clean(x.contentSnippet || x.content),
    publishedAt: x.isoDate || x.pubDate, url: x.link, source: "Google News RSS"
  }));
}

function normalize(items) {
  const seen = new Set();
  return items.filter(x => {
    const key = x.id || `${x.source}|${clean(x.title)}|${clean(x.text).slice(0,120)}`;
    if (!key || seen.has(key)) return false; seen.add(key); return true;
  }).map(x => ({
    id: x.id, source: x.source, title: clean(x.title || ""), text: clean(x.text || x.description || ""),
    publishedAt: x.publishedAt || null, url: x.url || null, score: x.score || 0, channel: x.channel || null
  }));
}

function corpusFor(items) { return items.map(x => `${x.title} ${x.text}`).join(" ").toLowerCase(); }

function phraseCounts(items) {
  const counts = new Map();
  for (const item of items) {
    const words = tokenWords(`${item.title} ${item.text}`);
    const local = new Set();
    for (let i = 0; i < words.length; i++) {
      const a = words[i];
      if (STOP.has(a)) continue;
      local.add(a);
      if (i < words.length - 1) {
        const b = words[i + 1];
        if (!STOP.has(b)) local.add(`${a} ${b}`);
      }
      if (i < words.length - 2) {
        const b = words[i + 1], c = words[i + 2];
        if (!STOP.has(b) && !STOP.has(c)) local.add(`${a} ${b} ${c}`);
      }
    }
    for (const p of local) counts.set(p, (counts.get(p) || 0) + 1);
  }
  return counts;
}

function candidateTerritories(items, keyword) {
  const counts = phraseCounts(items);
  const k = keyword.toLowerCase();
  const candidates = [...counts.entries()]
    .filter(([p, n]) => n >= 2 && !p.includes(k) && p.length > 3)
    .sort((a,b) => (b[1] * Math.min(b[0].split(" ").length, 2)) - (a[1] * Math.min(a[0].split(" ").length, 2)))
    .slice(0, 60);

  // Prefer recognisable topic nouns/phrases over generic verbs.
  const generic = /^(know|need|want|make|take|does|can|should|could|people|health|doctor|medical|treatment|best|home|natural|india|today|video|really|using|things|ways)$/;
  return candidates.filter(([p]) => !generic.test(p) && !/^\d+$/.test(p)).slice(0, 28);
}

function itemsForPhrase(items, phrase) {
  const p = phrase.toLowerCase();
  return items.filter(x => `${x.title} ${x.text}`.toLowerCase().includes(p));
}

function labelCase(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }

function dimensionHits(items) {
  const corpus = corpusFor(items);
  return DIMENSIONS.map(([name, regexes]) => {
    const hits = regexes.reduce((n, re) => n + (corpus.match(re) || []).length, 0);
    return { name, hits };
  }).filter(x => x.hits > 0).sort((a,b) => b.hits - a.hits);
}

function exactAngles(items, territory) {
  const text = corpusFor(items);
  const out = [];
  const tests = [
    ["after eating", /after eating|after meal|post meal/], ["morning", /morning|waking/], ["night", /night|bedtime|sleep/],
    ["food-related", /food|meal|rice|roti|fruit|vegetable|milk|curd|diet/], ["water-related", /water|hydration|drink/],
    ["movement", /walk|walking|exercise|movement|posture/], ["stress-related", /stress|anxiety|cortisol/],
    ["test / measurement", /test|report|marker|level|scan|hba1c|creatinine/], ["treatment / remedy", /medicine|remedy|therapy|supplement|ayurveda|herb/],
    ["hidden connection", /connection|linked|related|cause|why|mechanism/], ["fresh vs changed form", /fresh|fermented|soaked|cooked|cooled|raw|reheated/]
  ];
  for (const [name,re] of tests) if (re.test(text)) out.push(name);
  return uniq(out).slice(0, 6);
}

function questionsFor(items) {
  return uniq(items.map(x => clean(x.text || x.title)).filter(t => /\?|\bwhy\b|\bhow\b|\bwhat\b|\bcan i\b|\bshould i\b|\bdoes\b|\bkya\b|\bkyun\b|\bkaise\b/i.test(t))).slice(0, 18);
}

function makeLeafTitles(keyword, territory, angle, items) {
  const qs = questionsFor(items).slice(0, 5);
  const titles = [];
  for (const q of qs) {
    let t = q.replace(/\s+/g, " ").trim();
    if (t.length > 110) t = t.slice(0, 107) + "...";
    if (t && !titles.includes(t)) titles.push(t);
  }
  if (!titles.length) {
    titles.push(
      `What is actually happening with ${territory.toLowerCase()} ${angle.toLowerCase()}?`,
      `Why does ${territory.toLowerCase()} change around ${angle.toLowerCase()}?`,
      `${territory}: what should people check about ${angle.toLowerCase()}?`
    );
  }
  return titles.slice(0, 5);
}

function buildTree(keyword, items) {
  const territories = candidateTerritories(items, keyword);
  const used = new Set();
  const roots = [];

  for (const [phrase, count] of territories) {
    const phraseItems = itemsForPhrase(items, phrase);
    if (phraseItems.length < 2) continue;
    const rootName = labelCase(phrase);
    const rootKey = rootName.toLowerCase();
    if (used.has(rootKey)) continue;
    used.add(rootKey);

    const dims = dimensionHits(phraseItems).slice(0, 5);
    const angleNames = exactAngles(phraseItems, rootName);
    const dimensionList = uniq([...dims.map(x => x.name), ...angleNames]).slice(0, 6);
    const children = [];

    for (const dim of dimensionList) {
      const dimItems = phraseItems.filter(x => new RegExp(dim === "Timing" ? "after eating|after meal|post meal|morning|night|bedtime|fasting|evening" : dim === "Food / trigger" ? "food|meal|rice|roti|fruit|vegetable|milk|curd|diet" : dim === "Hydration" ? "water|hydration|drink|electrolyte" : dim === "Movement / posture" ? "walk|walking|exercise|movement|posture|sitting" : dim === "Sleep / recovery" ? "sleep|circadian|recovery|rest" : dim === "Stress / behaviour" ? "stress|anxiety|behavior|behaviour|habit|routine" : dim === "Test / measurement" ? "test|report|scan|marker|level|result|hba1c|creatinine" : dim === "Treatment / remedy" ? "medicine|tablet|supplement|remedy|therapy|ayurveda|herb|churan" : dim === "Mechanism / connection" ? "cause|mechanism|insulin|hormone|inflammation|microbiome|bacteria|nerve|cortisol" : "vs|versus|difference|better|worse|fresh|fermented|raw|cooked|cold|hot", "i").test(`${x.title} ${x.text}`));
      if (dimItems.length < 2) continue;

      // Turn the dimension into more concrete angle labels from repeated phrase language.
      const subCounts = phraseCounts(dimItems);
      const sub = [...subCounts.entries()]
        .filter(([p,n]) => n >= 2 && p !== phrase.toLowerCase() && p.split(" ").length <= 3 && p.length > 3)
        .sort((a,b)=>b[1]-a[1]).slice(0,4);
      const leaves = [];
      if (sub.length) {
        for (const [sp, sn] of sub) {
          const si = itemsForPhrase(dimItems, sp);
          if (si.length < 2) continue;
          leaves.push({ name: labelCase(sp), type: "angle", signal: sn >= 8 ? "STRONG" : sn >= 4 ? "REPEATED" : "EMERGING", items: si.length, samples: si.slice(0,6), titles: makeLeafTitles(keyword, rootName, labelCase(sp), si), questions: questionsFor(si).slice(0,8) });
        }
      }
      if (!leaves.length) {
        leaves.push({ name: dim, type: "angle", signal: dimItems.length >= 8 ? "STRONG" : "EMERGING", items: dimItems.length, samples: dimItems.slice(0,6), titles: makeLeafTitles(keyword, rootName, dim, dimItems), questions: questionsFor(dimItems).slice(0,8) });
      }
      children.push({ name: dim, type: "dimension", items: dimItems.length, children: leaves });
    }

    if (!children.length) {
      children.push({ name: "Repeated discussion", type: "dimension", items: phraseItems.length, children: [{ name: "Observed questions", type: "angle", items: phraseItems.length, samples: phraseItems.slice(0,6), titles: makeLeafTitles(keyword, rootName, "repeated discussion", phraseItems), questions: questionsFor(phraseItems).slice(0,8) }] });
    }

    roots.push({ name: rootName, type: "territory", items: phraseItems.length, signal: count >= 12 ? "STRONG" : count >= 6 ? "REPEATED" : "EMERGING", reason: `${count} source items repeatedly reference this territory`, samples: phraseItems.slice(0,6), children });
    if (roots.length >= 18) break;
  }

  // If phrase mining produced too few meaningful roots, expose the most recurring single terms.
  if (roots.length < 4) {
    const counts = phraseCounts(items);
    for (const [p,n] of [...counts.entries()].filter(([p,n])=>p.split(" ").length===1 && n>=2).sort((a,b)=>b[1]-a[1]).slice(0,20)) {
      if (STOP.has(p) || p === keyword.toLowerCase() || roots.some(r=>r.name.toLowerCase()===p)) continue;
      const si = itemsForPhrase(items,p); if (si.length < 2) continue;
      roots.push({ name: labelCase(p), type:"territory", items:si.length, signal:n>=8?"STRONG":"EMERGING", reason:"Recurring term in current live source material", samples:si.slice(0,6), children:[{ name:"Observed angles", type:"dimension", items:si.length, children:[{ name:"Recurring questions", type:"angle", items:si.length, samples:si.slice(0,6), titles:makeLeafTitles(keyword,labelCase(p),"recurring questions",si), questions:questionsFor(si).slice(0,8) }] }] });
      if (roots.length >= 18) break;
    }
  }

  return roots;
}

function signalScore(items, keyword) {
  const sources = new Set(items.map(x => x.source)).size;
  const questions = questionsFor(items).length;
  const uniqueTitles = new Set(items.map(x => x.title).filter(Boolean)).size;
  return Math.min(100, 15 + Math.min(items.length, 40) + Math.min(questions * 2, 20) + Math.min(sources * 8, 24) + Math.min(uniqueTitles / 5, 10));
}

function batchQueries(keyword, batch) {
  const offset = batch * 4;
  return PROBES.slice(offset, offset + 4).map(x => x.replaceAll("{k}", keyword));
}

async function collectBatch(keyword, batch = 0) {
  const queries = batchQueries(keyword, batch);
  if (!queries.length) return { items: [], queries: [], exhausted: true };
  const jobs = await Promise.allSettled([
    Promise.all(queries.map(q => youtubeSearch(q, 20))),
    Promise.all(queries.map(q => redditSearch(q, 35, batch % 2 ? "new" : "relevance"))),
    Promise.all(queries.map(q => newsRss(q)))
  ]);
  let items = [];
  if (jobs[0].status === "fulfilled") items.push(...jobs[0].value.flatMap(x => x.items || []));
  if (jobs[1].status === "fulfilled") items.push(...jobs[1].value.flat());
  if (jobs[2].status === "fulfilled") items.push(...jobs[2].value.flat());

  // Comments are expensive, so only fetch them from a small sample each batch.
  const ytVideos = jobs[0].status === "fulfilled" ? jobs[0].value.flatMap(x=>x.items||[]).filter(x=>x.videoId).slice(0,4) : [];
  const commentJobs = await Promise.all(ytVideos.map(v => youtubeComments(v.videoId, 12)));
  items.push(...commentJobs.flat());
  return { items: normalize(items), queries, exhausted: batch >= Math.floor(PROBES.length / 4) };
}

app.post("/api/discover", async (req, res) => {
  try {
    const keyword = clean(req.body?.keyword || "");
    const batch = Math.max(0, Number(req.body?.batch || 0));
    if (!keyword) return res.status(400).send("keyword required");
    const b = await collectBatch(keyword, batch);
    const prior = Array.isArray(req.body?.signals) ? normalize(req.body.signals) : [];
    const allSignals = normalize([...prior, ...b.items]);
    const tree = buildTree(keyword, allSignals);
    const score = signalScore(allSignals, keyword);
    res.json({ mode:"V2_DYNAMIC_TERRITORY_MAP", keyword, batch, nextBatch: b.exhausted ? null : batch + 1, exhausted:b.exhausted, queries:b.queries, timestamp:new Date().toISOString(), signalScore:Math.round(score), signalStrength:score>=75?"VERY HIGH":score>=55?"HIGH":score>=35?"RISING":"EARLY", rawCounts:{total:allSignals.length,newBatch:b.items.length,youtube:allSignals.filter(x=>x.source==="YouTube").length,comments:allSignals.filter(x=>x.source==="YouTube comment").length,reddit:allSignals.filter(x=>x.source==="Reddit").length,news:allSignals.filter(x=>x.source==="Google News RSS").length}, sources:uniq(allSignals.map(x=>x.source)), newSignals:b.items, tree, questions:questionsFor(allSignals), architecture:"LIVE FEED = EVIDENCE; HIERARCHY = INTELLIGENCE; LEAF TITLES = CONTENT OPPORTUNITIES" });
  } catch(err) { console.error(err); res.status(500).send(err.message || "Discovery error"); }
});

app.post("/api/scan", async (req,res)=>{
  try {
    const node=clean(req.body?.node||req.body?.keyword||""); if(!node) return res.status(400).send("node required");
    const b=await collectBatch(node,0); const questions=questionsFor(b.items); const score=signalScore(b.items,node);
    res.json({mode:"LIVE NODE SCAN",node,path:req.body?.path||[node],signalStrength:score>=75?"VERY HIGH":score>=55?"HIGH":score>=35?"RISING":"EARLY",signalScore:Math.round(score),sources:uniq(b.items.map(x=>x.source)),peopleQuestions:questions.length?questions:["No strong question-shaped signals returned."],discussions:b.items.filter(x=>x.source!=="YouTube").slice(0,12).map(x=>x.title||x.text),rawCounts:{total:b.items.length},timestamp:new Date().toISOString()});
  } catch(err) { res.status(500).send(err.message||"Signal scan error"); }
});

app.get("/api/health",(req,res)=>res.json({ok:true,version:"V2_DYNAMIC_TERRITORY_MAP",youtube:!!process.env.YOUTUBE_API_KEY,reddit:"public-discovery",newsRss:true,time:new Date().toISOString()}));

app.listen(PORT,()=>console.log(`MEDIMANCH V2 Dynamic Territory Map running at http://localhost:${PORT}`));
