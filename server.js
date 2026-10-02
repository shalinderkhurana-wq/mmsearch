
const express = require("express");
const path = require("path");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 8787;
const parser = new Parser({ timeout: 12000 });

app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname, "public")));

function clean(s=""){
  return String(s).replace(/\s+/g," ").trim();
}
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }
function escText(s=""){ return clean(s).replace(/<[^>]*>/g,""); }

function buildQueries(ctx){
  const node = ctx.node || ctx.keyword || "";
  const pathText = (ctx.path || []).join(" ");
  const q = uniq([
    node,
    `"${node}" gut health`,
    `${node} पेट gut`,
    `${node} health India`,
    pathText
  ]);
  return q.slice(0,5);
}

async function youtubeSearch(q, maxResults=10){
  const key = process.env.YOUTUBE_API_KEY;
  if(!key) return {items:[], enabled:false, note:"YOUTUBE_API_KEY not configured"};

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part","snippet");
  url.searchParams.set("type","video");
  url.searchParams.set("maxResults",String(Math.min(maxResults,50)));
  url.searchParams.set("regionCode","IN");
  url.searchParams.set("relevanceLanguage","hi");
  url.searchParams.set("q",q);
  url.searchParams.set("key",key);

  const r = await fetch(url);
  if(!r.ok) throw new Error(`YouTube search failed: ${r.status} ${await r.text()}`);
  const data = await r.json();

  return {
    enabled:true,
    items:(data.items||[]).map(x=>({
      title:clean(x.snippet?.title),
      description:clean(x.snippet?.description),
      publishedAt:x.snippet?.publishedAt,
      channel:x.snippet?.channelTitle,
      videoId:x.id?.videoId,
      url:x.id?.videoId ? `https://www.youtube.com/watch?v=${x.id.videoId}` : null
    }))
  };
}

async function youtubeComments(videoId, maxResults=20){
  const key = process.env.YOUTUBE_API_KEY;
  if(!key || !videoId) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.set("part","snippet");
  url.searchParams.set("videoId",videoId);
  url.searchParams.set("maxResults",String(Math.min(maxResults,100)));
  url.searchParams.set("textFormat","plainText");
  url.searchParams.set("order","relevance");
  url.searchParams.set("key",key);

  const r = await fetch(url);
  if(!r.ok) return [];
  const data = await r.json();
  return (data.items||[]).map(x=>({
    text:clean(x.snippet?.topLevelComment?.snippet?.textDisplay),
    publishedAt:x.snippet?.topLevelComment?.snippet?.publishedAt,
    likeCount:x.snippet?.topLevelComment?.snippet?.likeCount || 0,
    source:"YouTube comment"
  })).filter(x=>x.text);
}

async function redditSearch(q, limit=20){
  // Public Reddit JSON endpoint; for production scale, configure REDDIT_CLIENT_ID/SECRET
  // and migrate this function to OAuth as required by Reddit's current developer rules.
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q",q);
  url.searchParams.set("sort","new");
  url.searchParams.set("t","month");
  url.searchParams.set("limit",String(Math.min(limit,100)));
  url.searchParams.set("restrict_sr","false");

  const r = await fetch(url, {
    headers: {"User-Agent":"MEDIMANCH-Territory-Explorer/1.0"}
  });
  if(!r.ok) throw new Error(`Reddit search failed: ${r.status}`);
  const data = await r.json();

  return (data?.data?.children||[]).map(x=>({
    title:clean(x.data?.title),
    text:clean(x.data?.selftext),
    subreddit:x.data?.subreddit,
    createdUtc:x.data?.created_utc,
    score:x.data?.score || 0,
    url:x.data?.permalink ? `https://www.reddit.com${x.data.permalink}` : null,
    source:"Reddit"
  }));
}

async function newsRss(q){
  // Google News RSS gives a current news/discussion discovery layer without
  // requiring a search API key. This is a discovery signal, not search volume.
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const feed = await parser.parseURL(url);
  return (feed.items||[]).slice(0,15).map(x=>({
    title:clean(x.title),
    text:clean(x.contentSnippet || x.content),
    publishedAt:x.isoDate || x.pubDate,
    url:x.link,
    source:"Google News RSS"
  }));
}

function classifyQuestion(text){
  const t=text.toLowerCase();
  if(/[?]|why|how|kya|kyun|kaise|can i|should i|is it|does it/.test(t)) return "QUESTION";
  if(/cure|treat|remedy|इलाज|उपाय|दवा/.test(t)) return "TREATMENT_INTENT";
  if(/before|after|result|experience|worked|काम/.test(t)) return "EXPERIENCE";
  if(/myth|true|fake|real|सच|झूठ/.test(t)) return "MYTH_CHECK";
  return "CURIOSITY";
}

function scoreSignals(items, node){
  const text = items.map(x=>`${x.title||""} ${x.text||""}`).join(" ");
  const questionCount = items.filter(x=>classifyQuestion(`${x.title||""} ${x.text||""}`)==="QUESTION").length;
  const recentCount = items.length;
  const diversity = new Set(items.map(x=>x.source)).size;
  let score = 20 + Math.min(questionCount*6,30) + Math.min(recentCount*2,25) + Math.min(diversity*8,24);
  if(new RegExp(node.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i").test(text)) score += 5;
  return Math.min(score,100);
}

function deriveAngles(node, peopleQuestions){
  const q = peopleQuestions.slice(0,4);
  return [
    ["Human Question", q[0] || `${node}: log actually kya jaan-na chahte hain?`],
    ["Myth / Reality", `${node} ke popular claim ko evidence ke saath kaise test karein?`],
    ["Body Mechanism", `${node} body mein actually kya change karta hai?`],
    ["Visual Experiment", `${node} ko ek simple, visible experiment mein kaise demonstrate karein?`]
  ];
}

app.post("/api/scan", async (req,res)=>{
  try{
    const ctx = req.body || {};
    const node = clean(ctx.node || ctx.keyword || "gut health");
    const queries = buildQueries(ctx);

    const results = await Promise.allSettled([
      Promise.all(queries.slice(0,3).map(q=>youtubeSearch(q,8))),
      Promise.all(queries.slice(0,2).map(q=>redditSearch(q,12))),
      Promise.all(queries.slice(0,2).map(q=>newsRss(q)))
    ]);

    const yt = results[0].status==="fulfilled" ? results[0].value.flatMap(x=>x.items||[]) : [];
    const rd = results[1].status==="fulfilled" ? results[1].value.flat() : [];
    const nw = results[2].status==="fulfilled" ? results[2].value.flat() : [];

    const comments = [];
    for(const v of yt.slice(0,5)){
      if(v.videoId){
        const cs = await youtubeComments(v.videoId,10);
        comments.push(...cs);
      }
    }

    const all = [...yt,...rd,...nw,...comments];
    const questions = all
      .map(x=>clean(x.text || x.title))
      .filter(Boolean)
      .filter(t=>classifyQuestion(t)==="QUESTION")
      .slice(0,12);

    const discussions = [
      ...rd.slice(0,6).map(x=>clean(`${x.title}${x.text ? " — "+x.text : ""}`)),
      ...comments.slice(0,6).map(x=>clean(x.text)),
      ...nw.slice(0,6).map(x=>clean(x.title))
    ].filter(Boolean).slice(0,12);

    const behaviours = uniq(all.map(x=>classifyQuestion(x.text || x.title))).slice(0,6);

    const score = scoreSignals(all,node);
    const signalStrength = score >= 75 ? "VERY HIGH" : score >= 55 ? "HIGH" : score >= 35 ? "RISING" : "EARLY";

    const connected = [];
    const n=node.toLowerCase();
    if(/gut|microbiome|probiotic|ferment|bowel|motility|stool|digestion/.test(n)) connected.push("GUT");
    if(/water|hydration|electrolyte/.test(n)) connected.push("HYDRATION");
    if(/sleep|circadian|insomnia/.test(n)) connected.push("RECOVERY");
    if(/energy|fatigue/.test(n)) connected.push("ENERGY");
    const primary = connected[0] || (ctx.keyword || "GUT").toUpperCase();

    res.json({
      mode:"LIVE SIGNAL ENGINE",
      timestamp:new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}),
      path:ctx.path || [node],
      node,
      signalStrength,
      signalScore:score,
      sourceStatus:"LIVE SOURCES — raw discovery + derived classification",
      sources:uniq([
        process.env.YOUTUBE_API_KEY ? "YouTube Search" : null,
        process.env.YOUTUBE_API_KEY ? "YouTube Comments" : null,
        "Reddit public search",
        "Google News RSS"
      ]),
      peopleQuestions:questions.length ? questions : ["No strong question-shaped signals returned; broaden the territory and rescan."],
      discussions:discussions.length ? discussions : ["No current discussion items returned."],
      behaviours:behaviours,
      bic:{primary,connected:connected.slice(1),relationship:connected.length>1 ? "PARTIAL / CONTEXTUAL":"PRIMARY"},
      angles:deriveAngles(node,questions),
      rawCounts:{youtubeVideos:yt.length,youtubeComments:comments.length,reddit:rd.length,news:nw.length}
    });
  }catch(err){
    console.error(err);
    res.status(500).send(err.message || "Signal engine error");
  }
});

app.get("/api/health",(req,res)=>res.json({
  ok:true,
  youtube:!!process.env.YOUTUBE_API_KEY,
  reddit:"public-discovery",
  newsRss:true,
  time:new Date().toISOString()
}));

app.listen(PORT,()=>console.log(`MEDIMANCH Signal Engine running at http://localhost:${PORT}`));
