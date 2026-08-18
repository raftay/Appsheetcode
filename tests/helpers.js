#!/usr/bin/env node
/* =============================================================================
 * tests/helpers.js — the drifted helpers, pinned  (PLAN.md chunk 15)
 * -----------------------------------------------------------------------------
 *   node tests/helpers.js
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A REFACTOR
 *
 * PLAN.md §10 held `toNum_` / `norm_` / `gk_` out of the merge because they had
 * drifted and they "sit under every number the business reconciles against
 * Qlik". Chunk 15 was to diff them and unify only what is provably equivalent.
 *
 * The diff is in PLAN.md. The short version is that there are not three copies,
 * there are FOURTEEN definitions across seven namespaces, and — this is the part
 * that decided the chunk — **neither dialect is a superset of the other. Each is
 * right exactly where the other is wrong.**
 *
 *   · PV reads the text "5%" as 0.05. FSC / RFSC / RMX / SASK read it as 5.
 *     PV is right: a percent-FORMATTED cell comes back from Apps Script as the
 *     number 0.05 already, so a "5%" that reaches toNum_ is TEXT and means 5%.
 *   · FSC / RFSC / RMX / SASK read the text "(1,234)" as -1234. PV reads it as
 *     ZERO — the parenthesis survives its strip, parseFloat gives NaN, and NaN
 *     becomes 0. They are right: an accounting export writes negatives that way.
 *
 * So "unify them" has no safe direction. Picking PV's breaks every parenthesised
 * negative in Fuel Recovery and Ready-Mix; picking the others multiplies every
 * text percentage in Price & Volume by a hundred. Both would be silent, both
 * would land under 144 call sites, and neither would fail a single harness that
 * existed before this one.
 *
 * WHAT LANDS INSTEAD OF A MERGE: this. Every dialect's behaviour is written down
 * as a table of inputs and expected outputs, taken from the code as it actually
 * is. It is a CHARACTERISATION test — it does not claim any of these answers is
 * correct, only that this is what the suite does today. Change one on purpose
 * and this fails with the input that moved, which is precisely the warning that
 * did not exist while they were "three small private helpers nobody touches".
 *
 * The definitions are read out of app.gs by namespace, so a copy that is quietly
 * deleted, renamed or re-pointed fails here rather than at a customer's month
 * end.
 * ===========================================================================*/
'use strict';
const { region } = require('./appgs.js');

let failures = 0;
const fail = (what, msg) => { failures++; console.log(`  ✗ ${what}: ${msg}`); };
const pass = (what, msg) => console.log(`  ✓ ${what}${msg ? ': ' + msg : ''}`);

/* ---------------------------------------------------------------- extraction
   Brace-match the named function out of one merged region and evaluate it on
   its own. These helpers are pure — they close over nothing — which is the one
   property that makes lifting them out legitimate, and it is asserted below
   rather than assumed: a copy that starts reading its namespace's state stops
   being liftable, and that is a fact worth failing on. */
function extract(file, name) {
  const src = region(file);
  const re = new RegExp('(^|\\n)\\s*function\\s+' + name + '\\s*\\(', 'g');
  const hits = [];
  let m;
  while ((m = re.exec(src))) hits.push(m.index + m[1].length);
  if (hits.length !== 1)
    throw new Error(`${file}: expected exactly 1 definition of ${name}, found ${hits.length}`);

  let i = src.indexOf('{', hits[0]);
  let depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`${file}: ${name} does not close`);
  const text = src.slice(hits[0], end);
  /* Evaluated in a bare scope: if the body reached for anything from its
     namespace, this throws on first call rather than picking up a global. */
  return { fn: new Function('return (' + text.replace(/^\s*function\s+\w+/, 'function') + ');')(),
           text };
}

/* -------------------------------------------------------------------- toNum_
   Four dialects. The columns marked ← are the ones that differ, and the note
   beside each is what the difference DOES, not what it looks like. */
const TONUM = [
  { file: 'PV_Backend.gs',   ns: 'PV'        },
  { file: 'PV_Lookup.gs',    ns: 'PVLOOK'    },
  { file: 'FSC_Backend.gs',  ns: 'FSC'       },
  { file: 'Sask_Backend.gs', ns: 'SASKRATES' },
  { file: 'RMX_Backend.gs',  ns: 'RMX'       },
  { file: 'RFSC_Backend.gs', ns: 'RFSC'      },
];

/*  input            PV     PVLOOK  FSC     SASK    RMX     RFSC          */
const TONUM_TABLE = [
  ['',                0,     0,      0,      0,      0,      0],
  [null,              0,     0,      0,      0,      0,      0],
  [undefined,         0,     0,      0,      0,      0,      0],
  [42,                42,    42,     42,     42,     42,     42],
  [-1.5,              -1.5,  -1.5,   -1.5,   -1.5,   -1.5,   -1.5],
  ['  7  ',           7,     7,      7,      7,      7,      7],
  ['1,234',           1234,  1234,   1234,   1234,   1234,   1234],
  ['$1,234.56',       1234.56, 1234.56, 1234.56, 1234.56, 1234.56, 1234.56],
  ['-',               0,     0,      0,      0,      0,      0],
  ['abc',             0,     0,      0,      0,      0,      0],
  /* ← THE PERCENT DIVIDE. Only PV and PVLOOK scale a text percentage. */
  ['5%',              0.05,  0.05,   5,      5,      5,      5],
  ['-12.5%',          -0.125,-0.125, -12.5,  -12.5,  -12.5,  -12.5],
  /* ← THE ACCOUNTING NEGATIVE. Everyone except PV reads it as negative;
       PV silently reads it as ZERO, which is a dropped figure, not a
       rounding difference. */
  ['(1,234)',         0,     0,      -1234,  -1234,  -1234,  -1234],
  ['($99.50)',        0,     0,      -99.5,  -99.5,  -99.5,  -99.5],
  /* ← SASKRATES ALONE does not strip '%', so a leading one stops parseFloat
       dead where the others have already removed it. And note PV: it tests for
       a '%' ANYWHERE, not a trailing one, so it scales this too. Both of those
       were predicted wrong when this table was first written and the harness
       is what corrected them — which is the argument for having it. */
  ['%12',             0.12,  0.12,   12,     0,      12,     12],
  /* ← RFSC ALONE guards a non-finite number argument. The others hand it
       straight back, and it then propagates through every sum it lands in. */
  [Infinity,          Infinity, Infinity, Infinity, Infinity, Infinity, 0],
  [NaN,               NaN,   NaN,    NaN,    NaN,    NaN,    0],
];

/* --------------------------------------------------------------------- norm_
   Also four dialects, and the gap between them is much wider than toNum_'s:
   PV's is not a whitespace normaliser at all, it is a punctuation shredder. */
const NORM = [
  { file: 'QlikSync.gs',     ns: 'QLIKSYNC'  },
  { file: 'PV_Backend.gs',   ns: 'PV'        },
  { file: 'PV_Lookup.gs',    ns: 'PVLOOK'    },
  { file: 'FSC_Backend.gs',  ns: 'FSC'       },
  { file: 'RMX_Backend.gs',  ns: 'RMX'       },
  { file: 'RFSC_Backend.gs', ns: 'RFSC'      },
];

/*  input                    QLIKSYNC     PV            PVLOOK        FSC          RMX          RFSC       */
const NORM_TABLE = [
  ['',                       '',          '',           '',           '',          '',          ''],
  [null,                     '',          '',           '',           '',          '',          ''],
  ['  Mixed  Case  ',        'mixed case','mixed case', 'mixed case', 'mixed case','mixed case','mixed case'],
  /* ← PUNCTUATION. PV and PVLOOK replace runs of [\s_.\[\]()%#/-] with ONE
       space; the others leave every one of those characters alone. A key
       normalised by one and looked up with the other cannot match. */
  ['Ready-Mix',              'ready-mix', 'ready mix',  'ready mix',  'ready-mix', 'ready-mix', 'ready-mix'],
  ['A_B.C',                  'a_b.c',     'a b c',      'a b c',      'a_b.c',     'a_b.c',     'a_b.c'],
  ['Rev (CY) [%]',           'rev (cy) [%]','rev cy',   'rev cy',     'rev (cy) [%]','rev (cy) [%]','rev (cy) [%]'],
  /* ← THE SHEETS TEXT MARKER and the invisible characters. RMX alone strips a
       leading apostrophe, zero-width characters and a BOM, and straightens
       curly quotes. Everywhere else they stay in the key. */
  ["'0123",                  "'0123",     "'0123",      "'0123",      "'0123",     '0123',      "'0123"],
  ['Ab​Cd',             'ab​cd','ab​cd', 'ab​cd', 'ab​cd','abcd',      'ab​cd'],
  /* RMX strips LEADING curly/straight apostrophes before it straightens the
     rest, so the opening quote is removed outright and only the closing one
     survives as a straight quote. Measured, not guessed. */
  ['‘Quoted’',     '‘quoted’','‘quoted’','‘quoted’',
                             '‘quoted’',"quoted'",'‘quoted’'],
  /* A non-breaking space is handled by every one of them — \s matches it in
     JavaScript, so even the copies with no explicit   rule collapse it. */
  ['A  B',         'a b',       'a b',        'a b',        'a b',       'a b',       'a b'],
];

const show = v => (typeof v === 'string' ? JSON.stringify(v)
                 : Number.isNaN(v) ? 'NaN' : String(v));

function runTable(label, defs, table) {
  const fns = defs.map(d => {
    try { return { ...d, ...extract(d.file, label) }; }
    catch (e) { fail(label, `${d.ns}: ${e.message}`); return null; }
  });
  if (fns.some(f => !f)) return;

  let bad = 0;
  for (const row of table) {
    const input = row[0];
    for (let i = 0; i < fns.length; i++) {
      const want = row[i + 1];
      let got;
      try { got = fns[i].fn(input); }
      catch (e) {
        fail(label, `${fns[i].ns}(${show(input)}) threw: ${e.message} — this helper is no longer ` +
                    `pure, so it can no longer be reasoned about on its own`);
        bad++; continue;
      }
      const same = (typeof want === 'number' && Number.isNaN(want))
        ? (typeof got === 'number' && Number.isNaN(got)) : got === want;
      if (!same) {
        fail(label, `${fns[i].ns}.${label}(${show(input)}) is ${show(got)}, was ${show(want)}.\n` +
             `        This helper's behaviour changed. It is not a style question: ${label} sits ` +
             `under\n        every number the suite reconciles against Qlik. If the change is ` +
             `deliberate, update\n        the table AND say in PLAN.md what moved and why.`);
        bad++;
      }
    }
  }
  if (!bad) pass(label, `${fns.length} copies × ${table.length} inputs — every dialect answers as recorded`);

  /* The count itself is load-bearing: a copy quietly added or deleted changes
     which namespace a call site is reading, and nothing else would notice. */
  return fns;
}

console.log('the drifted helpers, pinned as they are — not as they ought to be\n');
const tn = runTable('toNum_', TONUM, TONUM_TABLE);
const nm = runTable('norm_',  NORM,  NORM_TABLE);

/* ------------------------------------------------------------------ gk_
   Two copies, both in the Price & Volume family, both building CacheService
   keys — and they are not the same key. PV's carries SCHEMA_; PVLOOK's does
   not, so a schema bump invalidates one cache and leaves the other serving
   rows shaped the old way. Asserted on source text, because what matters is
   which INPUTS go into the key, and a key builder that stopped reading one of
   them would still return a plausible string. */
{
  const pv     = extract('PV_Backend.gs', 'gk_').text;
  const pvlook = extract('PV_Lookup.gs',  'gk_').text;
  if (!/SCHEMA_/.test(pv))
    fail('gk_', 'PV.gk_ no longer mixes SCHEMA_ into its cache key — a schema bump ' +
                'will stop invalidating the Price & Volume cache');
  else if (/SCHEMA_/.test(pvlook))
    fail('gk_', 'PVLOOK.gk_ now mixes in SCHEMA_ and PV.gk_ already did. That may well be ' +
                'the right fix, but it changes every existing cache key: say so in PLAN.md ' +
                'and update this check.');
  else
    pass('gk_', 'PV keys on generation+SCHEMA_, PVLOOK on generation alone — recorded, ' +
                'and PLAN.md chunk 15 says why that gap is a finding rather than a tidy');
}

/* ------------------------------------------------- the census cannot drift
   PLAN.md §10 said "three namespaces". It is seven, and being wrong about that
   is what made "just unify them" sound cheap. */
if (tn && nm) {
  if (tn.length !== 6 || nm.length !== 6)
    fail('census', `expected 6 copies of each, found ${tn.length} toNum_ and ${nm.length} norm_`);
  else
    pass('census', '6 toNum_, 6 norm_, 2 gk_ across 7 namespaces — not the 3 the plan assumed');
}

console.log(failures ? `\n${failures} failure(s)`
                     : '\nhelpers.js: every dialect still answers exactly as recorded');
process.exit(failures ? 1 : 0);
