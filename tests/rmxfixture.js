/* =============================================================================
 * tests/rmxfixture.js — the Ready-Mix server model, shared by two harnesses
 * -----------------------------------------------------------------------------
 * NOT a harness. `pageparity.js` and `cssparity.js` both need the Ready-Mix page
 * to render its real tables, and they need it to render the SAME ones: the whole
 * point of cssparity is that any difference it finds is a cascade difference,
 * which only holds while both sides are looking at identical markup. Two copies
 * of this model would drift and the guarantee would quietly stop being true.
 *
 * The shape is `RMX_prepare`'s: a manifest that also carries every market's
 * keys payload, which is what lets a market switch cost no server call. Two key
 * rows is enough — the audit is about which RULE wins on a <td>, not how many
 * of them there are.
 * ===========================================================================*/
'use strict';

const RMX_MARKETS = ['HNS_SW', 'Innocon', 'Manitoba', 'North', 'Saskatchewan'];

function rmxKeysPayload(o) {
  o = o || {};
  return {
    ok: true, market: o.market || '__ALL__', period: o.period || 'YTD',
    month: 7, latestMonth: 7,
    months: { all: [1, 2, 3, 4, 5, 6, 7], cy: [1, 2, 3, 4, 5, 6, 7] },
    markets: RMX_MARKETS, allMarkets: '__ALL__', build: 'b1', generation: 'g1',
    breakdowns: [{ key: 'SUBMARKET', label: 'Submarket' },
                 { key: 'STRENGTH', label: 'Strength Class' },
                 { key: 'PLANT', label: 'Top 10 Plants' },
                 { key: 'PROD_CLASS', label: 'Product Class' }],
    keys: [
      { dims: { submarket: 'SM1', segment: 'ICI', app: 'Slab', cls: 'Standard', strength: '25 MPa' },
        pyVol: 1000, cyVol: 1200, baseCY: 240000, basePY: 190000 },
      { dims: { submarket: 'SM2', segment: 'Civil', app: 'Wall', cls: 'Standard', strength: '32 MPa' },
        pyVol: 820, cyVol: 910, baseCY: 201000, basePY: 168000 },
    ],
    ppi: { total: { w: 1, f: 0.02 }, SUBMARKET: { SM1: { w: 1, f: 0.02 }, SM2: { w: 1, f: 0.03 } },
           STRENGTH: { '25 MPa': { w: 1, f: 0.02 }, '32 MPa': { w: 1, f: 0.03 } },
           PROD_CLASS: { Standard: { w: 1, f: 0.02 } }, PLANT: { P100: { w: 1, f: 0.02 } } },
    plants: [{ label: 'P100', pyVol: 1000, cyVol: 1200, baseCY: 240000, basePY: 190000 }],
  };
}

function rmxModel() {
  const man = Object.assign({}, rmxKeysPayload({}), { warmed: 26, want: 'keys', ms: 9000 });
  man.payloads = {};
  ['MTD', 'YTD'].forEach(per => ['__ALL__'].concat(RMX_MARKETS).forEach(m => {
    man.payloads['keys|' + m + '|' + per] = rmxKeysPayload({ market: m, period: per });
  }));
  man.payload = man.payloads['keys|__ALL__|YTD'];
  return man;
}

module.exports = { RMX_MARKETS, rmxKeysPayload, rmxModel };
