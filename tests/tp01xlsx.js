#!/usr/bin/env node
/* =============================================================================
 * tests/tp01xlsx.js — the .xlsx TPXLSX writes is one Excel can read
 * -----------------------------------------------------------------------------
 * TPXLSX (script.gs §10) writes an .xlsx by hand, because a trigger has no
 * browser and Apps Script cannot load SheetJS. Its banner has the argument for
 * doing it that way; this is the reason it was affordable. A writer that builds
 * XML strings can be checked off-platform, and the alternative it was chosen
 * over — a temp Google Sheet exported through Drive — could not have been
 * checked at all.
 *
 * WHAT "CHECKED" MEANS HERE, because a self-consistent check would be worthless.
 * The parts are zipped with Node's own zlib and read back by a reader written
 * against the OOXML shape rather than against the writer: it resolves a cell's
 * number format the way a consumer has to — cell, to its style index, to
 * cellXfs, to a numFmtId, to either a built-in or the numFmts table — instead of
 * looking at the string the writer emitted.
 *
 * Utilities.zip is stubbed, because all it does is put named blobs in a zip and
 * the XML is the part that can be wrong.
 *
 * WHAT IT CLAIMS:
 *   1  package    every required part is in the container and declared
 *   2  cells      strings stay strings, numbers stay numbers, XML-special
 *                 characters survive
 *   3  rounding   a "0" column is ROUNDED, not merely formatted — a display
 *                 format on 404.21 would still sum as 404.21
 *   4  styles     the money columns resolve to "$"#,##0.00 through the cellXfs
 *                 indirection, and a blank money cell keeps its format
 *   5  table      the table's column names EQUAL the header cells; Excel
 *                 silently rewrites a file where they do not
 *   6  duplicates two columns sharing a name means NO table and an AutoFilter,
 *                 which is what stops Excel repairing the file
 *   7  names      sheet, table and column names are sanitised
 *   8  control    a control character never reaches the XML
 *
 * Run:  node tests/tp01xlsx.js
 * ===========================================================================*/
'use strict';
const vm = require('vm');
const zlib = require('zlib');
const { region } = require('./scriptgs.js');

let failures = 0, checks = 0;
function ok(name, cond, detail) {
  checks++;
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '\n       ' + detail : ''));
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     'got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want));
}

/* ---------------------------------------------------------------------------
 * The region, with the one Google call it makes stubbed to what it does.
 * APP_log is installed first for the reason scriptgs.js gives.
 * ------------------------------------------------------------------------- */
const logs = [];
const ctx = {
  console,
  APP_log: (level, src, msg, d) => logs.push({ level, src, msg, d }),
  MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
  Utilities: {
    newBlob: (content, type, name) => ({ content, type, name }),
    zip: (blobs, name) => ({ blobs, name, setContentType() { return this; } })
  }
};
vm.createContext(ctx);
vm.runInContext(region('TP01_Xlsx.gs'), ctx, { filename: 'script.gs §10 TP01_Xlsx.gs' });
const TPXLSX = ctx.TPXLSX;

/* ---------------------------------------------------------------------------
 * A ZIP writer and reader, so the parts make a round trip through the container
 * format rather than being inspected as loose strings.
 * ------------------------------------------------------------------------- */
function crc32(buf) {
  let table = crc32.t, c;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function zip(parts) {
  const files = [], central = [];
  let offset = 0;
  for (const name of Object.keys(parts)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(parts[name], 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    files.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const body = Buffer.concat(files), dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dir, end]);
}

function unzip(buf) {
  const out = {};
  let p = 0;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const compSize = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8');
    const start = p + 30 + nameLen + extraLen;
    const raw = buf.slice(start, start + compSize);
    out[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    p = start + compSize;
  }
  return out;
}

/* Read a cell the way a consumer must: its style index into cellXfs, that xf's
   numFmtId, and then either a built-in code or the numFmts table. */
function readSheet(parts) {
  const sheet = parts['xl/worksheets/sheet1.xml'];
  const styles = parts['xl/styles.xml'];

  const numFmts = {};
  const fmtRe = /<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\/>/g;
  let m;
  while ((m = fmtRe.exec(styles))) numFmts[m[1]] = m[2].replace(/&quot;/g, '"');
  const BUILTIN = { '0': 'General', '1': '0' };

  const xfs = [];
  const xfBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)[1];
  const xfRe = /<xf [^>]*numFmtId="(\d+)"[^>]*\/>/g;
  while ((m = xfRe.exec(xfBlock))) xfs.push(m[1]);

  const rows = {};
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  while ((m = rowRe.exec(sheet))) {
    const cells = {};
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cellRe.exec(m[2]))) {
      const attrs = c[3] || '', inner = c[4] || '';
      const sIdx = /s="(\d+)"/.exec(attrs);
      const fmtId = sIdx ? xfs[Number(sIdx[1])] : '0';
      const fmt = numFmts[fmtId] !== undefined ? numFmts[fmtId] : (BUILTIN[fmtId] || ('#' + fmtId));
      let v = null;
      if (/t="inlineStr"/.test(attrs)) {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        v = t ? t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '';
      } else {
        const t = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (t) v = Number(t[1]);
      }
      cells[c[1]] = { v: v, fmt: fmt };
    }
    rows[Number(m[1])] = cells;
  }
  return rows;
}

function buildAndRead(grid, opts) {
  const blob = TPXLSX.build(grid, opts);
  const parts = {};
  for (const b of blob.blobs) parts[b.name] = b.content;
  return { parts: unzip(zip(parts)), filename: blob.name };
}

console.log('tp01xlsx.js — TPXLSX, sliced out of script.gs §10\n');

/* ---- 1 / 2 / 3 / 4 / 5 : the ordinary workbook -------------------------- */
{
  const grid = {
    headers: ['Market', 'Sold To', 'Month', '2026 Volume', '2026 ASP ex-Works',
              'SAP Transfer Price', 'Additional Revenue to Post', 'SAP Valid From'],
    rows: [
      ['Manitoba', 'G&L Group <Hamilton> - P4Q01', 'Jan', 404.21, 25.675416, 25, -1000, '2026-01-01'],
      ['Saskatchewan', 'REGINA READY MIX - P4L01', 'Feb', 10, 10, '', '', '']
    ]
  };
  const fmts = { 3: '0', 4: '"$"#,##0.00', 5: '"$"#,##0.00', 6: '"$"#,##0.00' };
  const { parts, filename } = buildAndRead(grid,
    { sheetName: 'Exceptions', tableName: 'Exceptions', formats: fmts,
      filename: 'Transfer_Price_Exceptions_All_Markets_2026-07-14' });

  const required = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
                    'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
                    'xl/worksheets/sheet1.xml', 'xl/tables/table1.xml',
                    'xl/worksheets/_rels/sheet1.xml.rels'];
  eq('1  package: every required part is in the container',
     required.filter(p => !(p in parts)), []);

  /* Node has no XML parser, so rather than pretend to validate a schema this
     checks the two things that actually break a package: an unclosed element
     and a raw ampersand. */
  const malformed = [];
  for (const p of Object.keys(parts)) {
    const body = parts[p];
    if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(body)) malformed.push(p + ' (raw ampersand)');
    /* Self-closing tags are not openings. Splitting it this way rather than
       with one clever regex is deliberate: the clever one missed <v> and <t>,
       because a single-letter tag has nothing between the name and the >. */
    const tags = body.match(/<[a-zA-Z][^>]*>/g) || [];
    const opens = tags.filter(t => !/\/>$/.test(t)).length;
    const closes = (body.match(/<\/[a-zA-Z]/g) || []).length;
    if (opens !== closes) malformed.push(p + ' (' + opens + ' open, ' + closes + ' closed)');
  }
  eq('1  package: nothing unbalanced and no unescaped ampersand', malformed, []);
  ok('1  package: the table part is declared in [Content_Types].xml',
     parts['[Content_Types].xml'].indexOf('/xl/tables/table1.xml') >= 0);

  const cells = readSheet(parts);
  eq('2  cells: the header row is the headers',
     Object.keys(cells[1]).map(k => cells[1][k].v), grid.headers);
  eq('2  cells: XML-special characters survive the round trip',
     cells[2].B.v, 'G&L Group <Hamilton> - P4Q01');
  eq('2  cells: a number is a number and a date string stays a string',
     [cells[2].F.v, cells[2].H.v], [25, '2026-01-01']);

  eq('3  rounding: a "0" column is rounded, not merely formatted', cells[2].D.v, 404);
  eq('3  rounding: an unformatted-as-integer column keeps its precision',
     cells[2].E.v, 25.675416);

  eq('4  styles: the money columns resolve through cellXfs to the currency format',
     [cells[2].E.fmt, cells[2].F.fmt, cells[2].G.fmt],
     ['"$"#,##0.00', '"$"#,##0.00', '"$"#,##0.00']);
  eq('4  styles: the volume column resolves to the whole-number format', cells[2].D.fmt, '0');
  eq('4  styles: a blank money cell still carries its format', cells[3].F.fmt, '"$"#,##0.00');

  const table = parts['xl/tables/table1.xml'];
  const names = (table.match(/<tableColumn id="\d+" name="([^"]*)"\/>/g) || [])
    .map(t => /name="([^"]*)"/.exec(t)[1].replace(/&amp;/g, '&'));
  eq('5  table: the column names EQUAL the header cells', names, grid.headers);
  ok('5  table: the ref covers the header row and both data rows', /ref="A1:H3"/.test(table));
  ok('5  table: banded, TableStyleMedium2, like the page’s files',
     /TableStyleMedium2/.test(table) && /showRowStripes="1"/.test(table));
  eq('   the filename gains its extension', filename,
     'Transfer_Price_Exceptions_All_Markets_2026-07-14.xlsx');
}

/* ---- 6 : two columns sharing a name -------------------------------------- */
{
  logs.length = 0;
  const { parts } = buildAndRead(
    { headers: ['Plant', 'Volume', 'Plant'], rows: [['a', 1, 'b']] },
    { sheetName: 'Dup', tableName: 'Dup' });
  ok('6  duplicates: no table part is written', !('xl/tables/table1.xml' in parts));
  ok('6  duplicates: an AutoFilter takes its place',
     /<autoFilter ref="A1:C2"\/>/.test(parts['xl/worksheets/sheet1.xml']));
  ok('6  duplicates: and it says so rather than silently dropping the table',
     logs.some(l => l.level === 'warn' && /share a name/.test(l.msg)),
     JSON.stringify(logs.map(l => l.msg)));
}

/* ---- 7 / 8 : names and control characters -------------------------------- */
{
  eq('7  names: a table name keeps only what Excel allows',
     TPXLSX.tableName('Exceptions - GTA / Innocon'), 'Exceptions_GTA_Innocon');
  eq('7  names: one starting with a digit is prefixed', TPXLSX.tableName('2026 rows'), 'T_2026_rows');
  eq('7  names: column letters past Z', [0, 25, 26, 27].map(TPXLSX.colName), ['A', 'Z', 'AA', 'AB']);

  /* A BEL, built rather than typed, because a control character in a source
     file is exactly as invisible as one in a spreadsheet cell. It is not legal
     in XML 1.0 at all, and one arriving from a sheet is what turns "Excel
     cannot open this file" into an afternoon. */
  const bel = String.fromCharCode(7);
  const { parts } = buildAndRead(
    { headers: ['A'], rows: [['ok' + bel + 'bell']] }, { sheetName: 'S', formats: {} });
  ok('8  control: a control character never reaches the XML',
     parts['xl/worksheets/sheet1.xml'].indexOf(bel) < 0);
  eq('8  control: and the rest of the value survives', readSheet(parts)[2].A.v, 'okbell');
}

console.log('\n' + checks + ' checks, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
