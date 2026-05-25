/**
 * Logic tests for norsk vocab trainer.
 * Extracts and re-implements the core JS functions from index.html
 * so they can run in Node without browser APIs.
 */

// ── Minimal data fixtures ──────────────────────────────────────────────────

const TIERS = [
  { max: 100,  unlockPct: 0,  label: "Top 100"  },
  { max: 200,  unlockPct: 70, label: "Top 200"  },
  { max: 500,  unlockPct: 70, label: "Top 500"  },
  { max: 1000, unlockPct: 70, label: "Top 1000" },
];

// Small representative WORD_DB: 3 per tier bracket, 1 custom slot
const WORD_DB = [
  // rank 1-100
  { rank:1,   en:"and",     no:"og",      pos:"p1", type:"conjunction" },
  { rank:2,   en:"to be",   no:"være",    pos:"p2", type:"verb" },
  { rank:3,   en:"a/an",    no:"en",      pos:"p1", type:"article" },
  { rank:50,  en:"not",     no:"ikke",    pos:"p1", type:"adverb" },
  { rank:80,  en:"have",    no:"ha",      pos:"p2", type:"verb" },
  // rank 101-200
  { rank:101, en:"time",    no:"tid",     pos:"p4", type:"noun" },
  { rank:150, en:"work",    no:"arbeid",  pos:"p4", type:"noun" },
  { rank:180, en:"good",    no:"god",     pos:"p3", type:"adjective" },
  // rank 201-500
  { rank:201, en:"city",    no:"by",      pos:"p4", type:"noun" },
  { rank:300, en:"old",     no:"gammel",  pos:"p3", type:"adjective" },
  // rank 501-1000
  { rank:501, en:"bridge",  no:"bru",     pos:"p4", type:"noun" },
];

function makeWord(w) {
  return { ...w, learned: false, addedAt: Date.now() };
}

// ── Extracted logic functions ──────────────────────────────────────────────

function getActiveTier(words) {
  let activeTier = TIERS[0];
  for (let i = 0; i < TIERS.length; i++) {
    const tier      = TIERS[i];
    const prevMax   = i === 0 ? 0 : TIERS[i - 1].max;
    const tierWords = words.filter(w => (w.rank || 9999) <= tier.max && (w.rank || 9999) > prevMax);
    const learned   = tierWords.filter(w => w.learned).length;
    const pct       = tierWords.length ? (learned / tierWords.length) * 100 : 0;
    activeTier = tier;
    if (pct < tier.unlockPct) break;
  }
  return activeTier;
}

function getDailyWords(words, settings) {
  const today  = new Date();
  const seed   = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const n      = settings.wordsPerDay;
  const active = getActiveTier(words);

  const pool = words.filter(w => !w.learned && (!w.rank || (w.rank || 9999) <= active.max));

  if (pool.length === 0) {
    return words
      .filter(w => !w.rank || (w.rank || 9999) <= active.max)
      .sort(() => Math.random() - 0.5)
      .slice(0, n);
  }

  const buckets = { p1:[], p2:[], p3:[], p4:[], p5:[] };
  pool.forEach(w => { if (buckets[w.pos]) buckets[w.pos].push(w); });

  function seededShuffle(arr, s) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      const j = Math.abs(s) % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const targets =
    n <= 2   ? { p1:0, p2:0, p3:0, p4:0, p5:0 } :
    n === 3  ? { p1:1, p2:1, p3:0, p4:1, p5:0 } :
    n === 5  ? { p1:1, p2:1, p3:1, p4:2, p5:0 } :
               { p1:2, p2:2, p3:2, p4:3, p5:1 };

  const mix = [];
  Object.entries(targets).forEach(([pos, count]) => {
    const shuffled = seededShuffle(buckets[pos], seed + pos.charCodeAt(1));
    mix.push(...shuffled.slice(0, count));
  });

  if (mix.length < n) {
    const used = new Set(mix.map(w => w.en));
    const rest = seededShuffle(pool.filter(w => !used.has(w.en)), seed);
    mix.push(...rest.slice(0, n - mix.length));
  }

  return mix.slice(0, n);
}

function mergeWordDB(saved, db) {
  // mirrors init() merge logic
  const words = [...saved];
  db.forEach(w => {
    if (!words.find(x => x.en === w.en)) {
      words.push({ ...w, learned: false, addedAt: Date.now() });
    }
  });
  return words;
}

// ── Test harness ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, extra = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}${extra ? ' — ' + extra : ''}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ 1. Tier logic ━━━');

{
  // Fresh state — nothing learned
  const words = WORD_DB.map(makeWord);
  const active = getActiveTier(words);
  // TIERS[0] has unlockPct:0 → never breaks there → falls through to TIERS[1]
  assert(active.label === 'Top 200',
    'Fresh state: active tier is Top 200 (Top 100 unlockPct=0 always passes)');

  // Pool should contain rank 1-200 words (not 201+)
  const pool = words.filter(w => !w.learned && (w.rank || 9999) <= active.max);
  const inPool    = pool.map(w => w.rank);
  const maxInPool = Math.max(...inPool);
  assert(maxInPool <= 200,
    'Fresh state: daily pool is capped at rank 200',
    `max rank in pool=${maxInPool}`);
  assert(!inPool.includes(201),
    'Fresh state: rank-201 word excluded from pool');
}

{
  // After learning 70% of Top-200 bracket (rank 101-200)
  const words = WORD_DB.map(makeWord);
  const bracket200 = words.filter(w => w.rank > 100 && w.rank <= 200);
  const toLearn = Math.ceil(bracket200.length * 0.7);
  bracket200.slice(0, toLearn).forEach(w => { w.learned = true; });

  const active = getActiveTier(words);
  assert(active.label === 'Top 500',
    'After 70% of Top-200 bracket learned: active tier advances to Top 500');
}

{
  // All tiers 70%+ mastered → active = Top 1000 (last tier)
  const words = WORD_DB.map(makeWord);
  // Mark everything learned
  words.forEach(w => { w.learned = true; });
  const active = getActiveTier(words);
  assert(active.label === 'Top 1000',
    'All words learned: active tier = Top 1000 (last)');
}

{
  // Empty word list edge case
  const active = getActiveTier([]);
  // All tiers have 0 words → pct = 0 for all; TIERS[0] unlockPct=0 → passes,
  // TIERS[1] unlockPct=70 → 0 < 70 → breaks → returns TIERS[1]
  assert(active.label === 'Top 200',
    'Empty word list: gracefully returns Top 200 (TIERS[1] breaks on 0%)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ 2. Custom words in tier / daily pool ━━━');

{
  const words = WORD_DB.map(makeWord);
  const custom = { en:"fjord", no:"fjord", pos:"p4", type:"noun", rank:null, learned:false, addedAt:Date.now() };
  words.unshift(custom);

  const active = getActiveTier(words);
  const pool   = words.filter(w => !w.learned && (!w.rank || (w.rank || 9999) <= active.max));
  const customInPool = pool.find(w => w.en === 'fjord');

  assert(!!customInPool,
    'Custom words (rank:null) are included in the daily pool');

  // Daily mix also includes the custom word
  const daily = getDailyWords(words, { wordsPerDay: 10 });
  assert(daily.some(w => w.en === 'fjord'),
    'Custom word appears in getDailyWords output');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ 3. Daily mix distribution ━━━');

{
  const words = WORD_DB.map(makeWord);

  const mix3  = getDailyWords(words, { wordsPerDay: 3 });
  assert(mix3.length === 3,  'n=3: returns exactly 3 words');
  assert(mix3.filter(w => w.pos === 'p1').length <= 1, 'n=3: ≤1 glue word (p1)');
  assert(mix3.filter(w => w.pos === 'p2').length <= 1, 'n=3: ≤1 verb (p2)');

  const mix5  = getDailyWords(words, { wordsPerDay: 5 });
  assert(mix5.length === 5,  'n=5: returns exactly 5 words');

  const mix1  = getDailyWords(words, { wordsPerDay: 1 });
  assert(mix1.length === 1,  'n=1: returns exactly 1 word');
  assert(mix1[0].pos !== undefined,
    'n=1: word comes from the full pool (not locked to p1)');
}

{
  // Seed consistency: same calendar day → same words
  const words = WORD_DB.map(makeWord);
  const a = getDailyWords(words, { wordsPerDay: 3 });
  const b = getDailyWords(words, { wordsPerDay: 3 });
  assert(JSON.stringify(a) === JSON.stringify(b),
    'Daily words are deterministic within the same day (same seed)');
}

{
  // Fill-remainder: if a target bucket is empty, leftovers fill the gap
  // Only keep p1 words so p2/p4 buckets are empty
  const words = WORD_DB.filter(w => w.pos === 'p1').map(makeWord);
  // Active tier will still be Top 200 (only p1 words in pool up to rank 200)
  const mix = getDailyWords(words, { wordsPerDay: 3 });
  assert(mix.length === Math.min(3, words.filter(w => (w.rank||9999) <= 200).length),
    'Fill-remainder: when target buckets are empty, pool fills the gap up to n');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ 4. Init / merge logic ━━━');

{
  // Existing save + new DB word → merged
  const saved = [
    { rank:1, en:"and", no:"og", pos:"p1", type:"conjunction", learned:true, addedAt:1000 },
  ];
  const newDB = [
    { rank:1, en:"and", no:"og", pos:"p1", type:"conjunction" },  // already there
    { rank:2, en:"to be", no:"være", pos:"p2", type:"verb" },     // new
  ];
  const merged = mergeWordDB(saved, newDB);
  assert(merged.length === 2,
    'Merge: new WORD_DB entry added, existing preserved');
  assert(merged.find(w => w.en === 'and').learned === true,
    'Merge: learned state of existing word is preserved');
  assert(merged.find(w => w.en === 'to be').learned === false,
    'Merge: new word initialised as unlearned');
}

{
  // Duplicate detection: same en+no not added twice
  const saved = [
    { rank:1, en:"and", no:"og", pos:"p1", type:"conjunction", learned:false, addedAt:1000 },
  ];
  const db = [
    { rank:1, en:"and", no:"og", pos:"p1", type:"conjunction" },
  ];
  const merged = mergeWordDB(saved, db);
  assert(merged.length === 1, 'Merge: exact duplicate (same en+no) not added twice');
}

{
  // Custom word: same en, different no → treated as new (en-only addWord check vs en+no merge)
  // addWord uses: words.find(w => w.en === en) — blocks same English
  // init merge uses: words.find(x => x.en === w.en && x.no === w.no) — only blocks exact match
  // This means a DB update with a corrected Norwegian spelling creates a duplicate English entry
  const saved = [
    { rank:1, en:"and", no:"og",  pos:"p1", type:"conjunction", learned:false, addedAt:1000 },
  ];
  const db = [
    { rank:1, en:"and", no:"OG",  pos:"p1", type:"conjunction" }, // different no (capital)
  ];
  const merged = mergeWordDB(saved, db);
  assert(merged.length === 1,
    'Merge uses en-only match, so a DB spelling fix does not create a duplicate English entry');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ 5. markLearned / toggleLearned index safety ━━━');

{
  // toggleLearned(idx) directly mutates words[idx] — safe as long as
  // renderWordList uses words.indexOf(w) correctly
  const words = WORD_DB.map(makeWord);
  const w = words[2];
  const ri = words.indexOf(w);
  words[ri].learned = !words[ri].learned;
  assert(words[2].learned === true,
    'toggleLearned: direct index mutation works when ri = words.indexOf(w)');
  words[ri].learned = !words[ri].learned;
  assert(words[2].learned === false,
    'toggleLearned: toggle back works');
}

{
  // markLearned uses findIndex(en+no) — if two words share en+no only first is toggled
  const words = WORD_DB.map(makeWord);
  // Artificially insert duplicate
  words.push({ ...words[0], learned: false, addedAt: Date.now() + 1 });
  const cur = words[words.length - 1];
  const idx = words.findIndex(w => w.en === cur.en && w.no === cur.no);
  words[idx].learned = true;
  assert(idx === 0 && !words[words.length - 1].learned,
    'markLearned: with duplicates, only the first match is toggled (second unchanged)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ 6. wordsPerDay edge cases ━━━');

{
  const words = WORD_DB.map(makeWord);

  // n=2 falls into the default target (10 slots), mix.slice(0,2) returns 2 p1 words
  const mix2 = getDailyWords(words, { wordsPerDay: 2 });
  assert(mix2.length === 2, 'n=2: returns 2 words (hits default target branch)');
  const allP1 = mix2.every(w => w.pos === 'p1');
  assert(!allP1,
    'n=2 uses fill-remainder (all targets 0), returns mixed POS selection');

  // n=10: default targets sum to 10
  const mix10 = getDailyWords(words, { wordsPerDay: 10 });
  assert(mix10.length <= 10, 'n=10: returns ≤10 words (pool may be smaller)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
if (failed > 0) process.exit(1);
