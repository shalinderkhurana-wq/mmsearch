
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


app.post("/api/discover", async (req,res)=>{
  try{
    const keyword = clean(req.body?.keyword || "");
    if(!keyword) return res.status(400).send("keyword required");

    // Multiple live probes are used to discover how people actually discuss the subject.
    const queries = uniq([
      keyword,
      `"${keyword}" health India`,
      `${keyword} questions`,
      `${keyword} symptoms problems`,
      `${keyword} food diet`,
      `${keyword} treatment remedy`,
      `${keyword} experience discussion`
    ]).slice(0,7);

    const results = await Promise.allSettled([
      Promise.all(queries.slice(0,4).map(q=>youtubeSearch(q,10))),
      Promise.all(queries.slice(0,4).map(q=>redditSearch(q,15))),
      Promise.all(queries.slice(0,4).map(q=>newsRss(q)))
    ]);

    const yt = results[0].status==="fulfilled" ? results[0].value.flatMap(x=>x.items||[]) : [];
    const rd = results[1].status==="fulfilled" ? results[1].value.flat() : [];
    const nw = results[2].status==="fulfilled" ? results[2].value.flat() : [];
    const all = [...yt,...rd,...nw];

    const textOf = x => clean(`${x.title||""} ${x.text||""}`).toLowerCase();

    // Territory families. The names are stable enough for navigation, but
    // membership is determined from live returned material.
    const families = [
      {name:"Symptoms & Human Problems", keys:["pain","symptom","problem","sign","issue","difficulty","swelling","fatigue","burning","constipation","bleeding","period","acne"], reason:"Repeated human-problem language"},
      {name:"Tests & Diagnosis", keys:["test","report","scan","diagnosis","marker","level","ultrasound","blood test","lab","result"], reason:"Repeated testing/diagnostic language"},
      {name:"Food & Diet", keys:["food","diet","meal","rice","curd","water","salt","protein","fat","fruit","vegetable","drink","nutrition"], reason:"Repeated food/diet language"},
      {name:"Treatment & Remedies", keys:["treatment","medicine","remedy","ayurveda","herbal","therapy","cure","tablet","supplement"], reason:"Repeated treatment/remedy language"},
      {name:"Mechanism & Body", keys:["function","mechanism","hormone","inflammation","bacteria","microbiome","organ","blood","filter","flow","nerve"], reason:"Repeated body/mechanism language"},
      {name:"Lifestyle & Prevention", keys:["exercise","lifestyle","habit","prevention","sleep","stress","morning","routine","walking"], reason:"Repeated lifestyle/prevention language"}
    ];

    // Subterritories and concept labels are extracted from the source language.
    // This keeps the navigation human-readable without fabricating exact questions.
    const subRules = {
      "Symptoms & Human Problems":[
        ["Pain / discomfort",["pain","ache","burning","cramp"]],
        ["Visible / measurable changes",["swelling","weight","skin","hair","blood"]],
        ["Digestive / elimination problems",["constipation","bloating","gas","stool","bowel"]]
      ],
      "Tests & Diagnosis":[
        ["Home / basic checks",["home","check","test","strip"]],
        ["Lab / clinical reports",["blood","report","marker","level","creatinine","hormone"]],
        ["Imaging / diagnosis",["scan","ultrasound","mri","diagnosis"]]
      ],
      "Food & Diet":[
        ["Food connection",["food","meal","diet","rice","curd","fruit","vegetable"]],
        ["Fat / protein / salt connection",["fat","protein","salt","oil"]],
        ["Water / hydration connection",["water","drink","hydration","electrolyte"]]
      ],
      "Treatment & Remedies":[
        ["Medicines / supplements",["medicine","tablet","supplement","capsule"]],
        ["Ayurveda / herbs",["ayurveda","herbal","herb","churan","rasayana"]],
        ["Home remedies",["remedy","home","kitchen","natural"]]
      ],
      "Mechanism & Body":[
        ["Body process",["function","mechanism","filter","flow","digestion"]],
        ["Microbes / inflammation",["microbiome","bacteria","probiotic","inflammation"]],
        ["Hormone / nerve connection",["hormone","nerve","vagus","insulin","cortisol"]]
      ],
      "Lifestyle & Prevention":[
        ["Daily habits",["habit","routine","morning","walking","exercise"]],
        ["Sleep / recovery",["sleep","circadian","recovery","morning light"]],
        ["Stress / behaviour",["stress","anxiety","behaviour","behavior"]]
      ]
    };

    function matchingItems(keys){
      return all.filter(x => {
        const t=textOf(x);
        return keys.some(k=>t.includes(k));
      });
    }

    function makeConceptName(subName, items, keyword){
      const corpus = items.map(textOf).join(" ");
      const candidates = [
        ["Fresh vs Fermented",["fermented","fresh","soaked","overnight"]],
        ["Food / Fat connection",["fat","oil","food","meal"]],
        ["Morning Light",["morning","light","sunlight","circadian"]],
        ["Gut / Microbiome connection",["microbiome","gut","probiotic","bacteria"]],
        ["Symptom vs Cause",["cause","symptom","why"]],
        ["Test vs Meaning",["test","report","result","marker"]],
        ["Before vs After",["before","after","result","change"]],
        ["Dose / Timing",["dose","timing","morning","night","when"]],
        ["Myth vs Reality",["myth","true","fake","really","fact"]]
      ];
      let best = null;
      let bestCount = 0;
      for(const [name,keys] of candidates){
        const n=keys.reduce((s,k)=>s+(corpus.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"))||[]).length,0);
        if(n>bestCount){bestCount=n;best=name;}
      }
      return best || `${keyword} — ${subName}`;
    }

    const tree=[];
    for(const family of families){
      const familyItems=matchingItems(family.keys);
      if(familyItems.length<2) continue;

      const subs=[];
      for(const [subName,keys] of (subRules[family.name]||[])){
        const subItems=matchingItems(keys);
        if(subItems.length<2) continue;

        const concept=makeConceptName(subName,subItems,keyword);
        subs.push({
          name:subName,
          children:[{
            name:concept,
            signal:subItems.length>=12?"HIGH":subItems.length>=5?"RISING":"EMERGING",
            items:subItems.length,
            reason:"Concept label derived from repeated language in current live results",
            samples:subItems.slice(0,10).map(x=>({
              title:x.title||"Source signal",
              text:x.text||"",
              source:x.source||"Live source",
              url:x.url||null
            }))
          }]
        });
      }

      if(subs.length){
        tree.push({
          name:family.name,
          reason:family.reason,
          children:subs
        });
      }
    }

    // For small/obscure subjects, fall back to transparent recurring-term branches.
    if(tree.length<2){
      const stop=new Set(("the and for with from that this what when where how why are was has have into about health healthy treatment symptoms symptom india indian people their your you they these those does can could should will after before best home medicine medical disease condition".split(" ")));
      const counts=new Map();
      for(const item of all){
        const words=textOf(item).match(/[a-z][a-z-]{3,}/g)||[];
        for(const w of words){
          if(w===keyword.toLowerCase() || stop.has(w)) continue;
          counts.set(w,(counts.get(w)||0)+1);
        }
      }
      const recurring=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
      for(const [term,count] of recurring){
        const items=all.filter(x=>textOf(x).includes(term));
        if(items.length>=2){
          tree.push({
            name:term.charAt(0).toUpperCase()+term.slice(1),
            reason:"Recurring term extracted from current live source material",
            children:[{
              name:"Repeated discussion",
              children:[{
                name:`${term.charAt(0).toUpperCase()+term.slice(1)} — recurring questions`,
                signal:count>=10?"HIGH":count>=5?"RISING":"EMERGING",
                items:items.length,
                samples:items.slice(0,8).map(x=>({title:x.title||"Source signal",text:x.text||"",source:x.source||"Live source",url:x.url||null}))
              }]
            }]
          });
        }
      }
    }

    const questions=all.map(x=>clean(x.text||x.title))
      .filter(Boolean)
      .filter(t=>/[?]|why|how|what|kya|kyun|kaise|can i|should i|does|is it/i.test(t))
      .slice(0,15);

    const score=scoreSignals(all,keyword);

    res.json({
      mode:"LIVE HIERARCHICAL TERRITORY DISCOVERY",
      keyword,
      timestamp:new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}),
      signalStrength:score>=75?"VERY HIGH":score>=55?"HIGH":score>=35?"RISING":"EARLY",
      signalScore:score,
      sources:uniq([
        process.env.YOUTUBE_API_KEY?"YouTube Search":null,
        "Reddit public search",
        "Google News RSS"
      ]),
      rawCounts:{youtube:yt.length,reddit:rd.length,news:nw.length,total:all.length},
      tree:tree.slice(0,8),
      questions
    });
  }catch(err){
    console.error(err);
    res.status(500).send(err.message||"Discovery error");
  }
});


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
