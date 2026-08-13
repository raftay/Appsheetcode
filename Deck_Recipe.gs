/*****************************************************************************
 * Deck_Recipe.gs - WHICH slides the monthly deck contains, and in what order.
 * ---------------------------------------------------------------------------
 * THIS FILE IS CONFIG, NOT CODE. Adding, removing or reordering a slide is an
 * edit to the array below - nothing else in the suite needs to change. The
 * Deck Builder page reads it, shows it as a checklist, and builds it top to
 * bottom.
 *
 * It was transcribed from the July 2026 pack ("AGG - CENTRAL CANADA - MTDYTD
 * Prep.pdf", 43 slides at 720 x 405 pt), so the default output matches the
 * deck that is built by hand today.
 *
 * EVERY ROW
 *   id       unique, stable. It is written into the generated slide's speaker
 *            notes as "SLIDE: <id>", which is how DECK_status knows what
 *            already landed and how a single failed slide is retried without
 *            rebuilding the deck. NEVER reuse an id for a different slide.
 *   source   which page produces the content block. Must match an id passed to
 *            AmrDeckSource.register() - see Deck_Sources.html.
 *   market   passed straight through to that source. The spelling is the one
 *            THAT PAGE uses, which is not the same across pages: the Southwest
 *            is 'Southwest' to Price & Volume and 'HNS_SW' to Ready-Mix. The
 *            canonical mapping lives in OVERVIEW.MARKETS (Config.gs).
 *   period   'MTD' | 'YTD'. Omitted where the slide shows both.
 *   layout   a LAYOUT id from the template's speaker notes.
 *   title    the real, editable Slides heading. NOT baked into the picture.
 *   optional true = shown unticked in the Plan stage, so it is only built when
 *            someone asks for it that month.
 *
 * WHY THE TOP 10 CUSTOMER SLIDES ARE L_FULL_IMAGE
 *   That slide is two stacked tables, MTD over YTD. The Price & Volume page
 *   already exports both as ONE content block, so one picture in the full-width
 *   slot reproduces it exactly and needs no new layout. The alternative - two
 *   pictures in an L_FULL_STACK with {{LABEL1}} / {{LABEL2}} - is supported by
 *   Deck_Backend.gs but that layout is NOT in the shipped template. To switch:
 *   add the layout to the template, then change 'layout' on these five rows.
 *
 * MARKET COVERAGE NOTE
 *   The source pack has no AGG summary slide for North, and no Top 10 slide for
 *   Central Canada. That is copied faithfully rather than "corrected" - if the
 *   business wants them, add the rows.
 *****************************************************************************/

var DECK_RECIPE = [

  /* ---- Fuel Recovery (4) ------------------------------------------------ */
  { id:'fsc_mtd',   source:'fsc',  period:'MTD', layout:'L_FULL_IMAGE',
    group:'Fuel Recovery', title:'Agg - Fuel Recovery MTD' },
  { id:'fsc_ytd',   source:'fsc',  period:'YTD', layout:'L_FULL_IMAGE',
    group:'Fuel Recovery', title:'Agg - Fuel Recovery YTD' },
  { id:'rfsc_mtd',  source:'rfsc', period:'MTD', layout:'L_FULL_IMAGE',
    group:'Fuel Recovery', title:'Rmx - Fuel Recovery MTD' },
  { id:'rfsc_ytd',  source:'rfsc', period:'YTD', layout:'L_FULL_IMAGE',
    group:'Fuel Recovery', title:'Rmx - Fuel Recovery YTD' },

  /* ---- AGG Price & Volume, with the Top 10 slide after each market ------ */
  { id:'pv_cc_mtd',   source:'pv', market:'Central Canada', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - CENTRAL CANADA - MTD' },
  { id:'pv_cc_ytd',   source:'pv', market:'Central Canada', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - CENTRAL CANADA - YTD' },

  { id:'pv_sk_mtd',   source:'pv', market:'Saskatchewan', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - SASKATCHEWAN - MTD' },
  { id:'pv_sk_ytd',   source:'pv', market:'Saskatchewan', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - SASKATCHEWAN - YTD' },
  { id:'cust_sk',     source:'cust', market:'Saskatchewan',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - Saskatchewan' },

  { id:'pv_mb_mtd',   source:'pv', market:'Manitoba', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - MANITOBA - MTD' },
  { id:'pv_mb_ytd',   source:'pv', market:'Manitoba', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - MANITOBA - YTD' },
  { id:'cust_mb',     source:'cust', market:'Manitoba',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - Manitoba' },

  { id:'pv_gta_mtd',  source:'pv', market:'Greater Toronto Area', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - GTA COMMERCIAL - MTD' },
  { id:'pv_gta_ytd',  source:'pv', market:'Greater Toronto Area', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - GTA COMMERCIAL - YTD' },
  { id:'cust_gta',    source:'cust', market:'Greater Toronto Area',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - GTA' },

  { id:'pv_sw_mtd',   source:'pv', market:'Southwest', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - Southwest - MTD' },
  { id:'pv_sw_ytd',   source:'pv', market:'Southwest', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - Southwest - YTD' },

  /* Land and Docks are a Southwest breakdown, not every month's story. They
     are in the pack, so they are here - but unticked by default. */
  { id:'pv_swland_mtd',  source:'pv', market:'Southwest Land', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', optional:true,
    title:'AGG - Southwest Land - MTD' },
  { id:'pv_swland_ytd',  source:'pv', market:'Southwest Land', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', optional:true,
    title:'AGG - Southwest Land - YTD' },
  { id:'pv_swdocks_mtd', source:'pv', market:'Southwest Docks', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', optional:true,
    title:'AGG - Southwest Docks - MTD' },
  { id:'pv_swdocks_ytd', source:'pv', market:'Southwest Docks', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', optional:true,
    title:'AGG - Southwest Docks - YTD' },

  { id:'cust_sw',     source:'cust', market:'Southwest',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - SW' },

  /* ---- Ready-Mix. Per market: Segment/Product (commented), then P&V ----- */
  { id:'seg_sk_mtd',  source:'seg', market:'SASKATCHEWAN', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - SASKATCHEWAN - Commercial MTD' },
  { id:'seg_sk_ytd',  source:'seg', market:'SASKATCHEWAN', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - SASKATCHEWAN - Commercial YTD' },
  { id:'rmx_sk_mtd',  source:'rmx', market:'SASKATCHEWAN', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Saskatchewan - Commercial MTD' },
  { id:'rmx_sk_ytd',  source:'rmx', market:'SASKATCHEWAN', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Saskatchewan - Commercial YTD' },

  { id:'seg_mb_mtd',  source:'seg', market:'MANITOBA', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - MANITOBA - Commercial MTD' },
  { id:'seg_mb_ytd',  source:'seg', market:'MANITOBA', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - MANITOBA - Commercial YTD' },
  { id:'rmx_mb_mtd',  source:'rmx', market:'MANITOBA', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Manitoba - Commercial MTD' },
  { id:'rmx_mb_ytd',  source:'rmx', market:'MANITOBA', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Manitoba - Commercial YTD' },

  { id:'seg_sw_mtd',  source:'seg', market:'HNS_SW', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - HNS SW - Commercial MTD' },
  { id:'seg_sw_ytd',  source:'seg', market:'HNS_SW', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - HNS SW - Commercial YTD' },
  { id:'rmx_sw_mtd',  source:'rmx', market:'HNS_SW', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - HNS_SW - Commercial MTD' },
  { id:'rmx_sw_ytd',  source:'rmx', market:'HNS_SW', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - HNS_SW - Commercial YTD' },

  { id:'seg_inn_mtd', source:'seg', market:'Innocon', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - INNOCON - Commercial MTD' },
  { id:'seg_inn_ytd', source:'seg', market:'Innocon', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - INNOCON - Commercial YTD' },
  { id:'rmx_inn_mtd', source:'rmx', market:'Innocon', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Innocon - Commercial MTD' },
  { id:'rmx_inn_ytd', source:'rmx', market:'Innocon', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Innocon - Commercial YTD' },

  { id:'seg_no_mtd',  source:'seg', market:'North', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - NORTH - Commercial MTD' },
  { id:'seg_no_ytd',  source:'seg', market:'North', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - NORTH - Commercial YTD' },
  { id:'rmx_no_mtd',  source:'rmx', market:'North', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - North - Commercial MTD' },
  { id:'rmx_no_ytd',  source:'rmx', market:'North', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - North - Commercial YTD' },

  { id:'cust_no',     source:'cust', market:'North',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - North' }
];


/*****************************************************************************
 * DECK_getRecipe - the recipe, checked, for the page.
 * ---------------------------------------------------------------------------
 * The checking is the point. A duplicate id silently overwrites another
 * slide's status and makes a retry fix the wrong row; a row with no layout
 * fails at slide 30 of 43. Both are cheap to catch here and baffling to
 * diagnose later.
 *****************************************************************************/
function DECK_getRecipe() {
  var seen = {}, problems = [], rows = [];

  for (var i = 0; i < DECK_RECIPE.length; i++) {
    var r = DECK_RECIPE[i], at = 'row ' + (i + 1);

    if (!r.id) { problems.push(at + ' has no id.'); continue; }
    if (seen[r.id]) {
      problems.push('Duplicate id "' + r.id + '" (' + at + ' and row ' +
        seen[r.id] + '). Ids must be unique - they are what a retry targets.');
      continue;
    }
    seen[r.id] = i + 1;

    if (!r.source) problems.push(r.id + ' has no source.');
    if (!r.layout) problems.push(r.id + ' has no layout.');
    if (!r.title)  problems.push(r.id + ' has no title.');
    if (r.period && r.period !== 'MTD' && r.period !== 'YTD') {
      problems.push(r.id + ' has period "' + r.period + '" - expected MTD or YTD.');
    }

    rows.push({
      id: r.id, source: r.source, market: r.market || '',
      period: r.period || '', layout: r.layout, title: r.title,
      subtitle: r.subtitle || '', group: r.group || 'Other',
      optional: !!r.optional
    });
  }

  return { rows: rows, count: rows.length, problems: problems };
}
