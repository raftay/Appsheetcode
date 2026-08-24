# TP01 Transfer Price — the report sends itself

**Status: IN PROGRESS.** The decisions in §10 are made; §9 is the running order.

**Delete this file when the work lands** and fold its durable half into `README.md` — that is
the instruction, and the reason is below.

This file is deliberately temporary. When the work lands, its durable half goes into
`README.md` — §5 (a third mail watch beside the Inventory Report's), §7 (the domain rules
this adds), §10/§11 (the trigger and the session log) — and **this file is deleted**. That is
exactly what happened to `PLAN.md`, and the reason is in `CLAUDE.md`: three documents
describing one codebase is how the three of them drift apart.

---

## 0. What is being automated, in one paragraph

Today a person drops two files on the TP01 page — the weekly SAP TP01/ZIPR export and a
QlikView transfer-pricing export — and the browser does the rest: builds a Concat Key on both
sides, looks the SAP price up against each QlikView row, computes the two revenue columns,
splits by market, finds the exceptions, and mails a per-market Excel file to a remembered
address. **Neither file needs a person any more.** The SAP file arrives by email every
Tuesday, and the QlikView side is not a separate export at all — it is the Aggregates
workbook this app already reads, filtered to `Customer Parent = Amrize Rmx`, restricted to the
current year, and rolled back up to the grain the QlikView export had. So a daily trigger can
do all of it: find the mail, read the attachment, build the other side out of the sheet, run
the same comparison, and send the same email.

---

## 1. The trigger you asked for

**Point the time-driven trigger at `tp01ReportMailCheck`.**

> Triggers ▸ Add trigger ▸ Time-driven ▸ Day timer ▸ (pick an hour, e.g. 6–7am).
> **Add it from the account that deployed the web app.**

Nothing in this repo creates it, and nothing calls that function — the trigger is the only
caller it will ever have. That matches `qlikSyncCheck` and `inventoryReportMailCheck`, the
suite's other two trigger targets, both of which are set by hand for the same reason
(`README.md` §5, and §11 of `script.gs`).

This will be the **third** time-driven trigger. `README.md` §5 currently says there are two
and calls that out twice — both places have to change.

There will also be `tp01ReportMailStatus()`, an editor-only dry run. It answers "what would
the next firing do" and sends, files and marks nothing. Run it before setting the trigger —
see §7, it is the single thing that de-risks most of this.

### Why daily is right even though the mail is weekly

A firing that finds no new mail costs **one Gmail search and nothing else** — no sheet opened,
no comparison built, no mail sent. Six days out of seven the run is that. "New" is by Gmail
message id held in a Script Property, so a mail already reported on is never picked up twice,
however often the trigger fires, and a report re-sent mid-week is picked up the next morning
rather than waiting for the following Tuesday. This is `IRMAIL`'s design and it is proven in
this codebase already.

### Who the trigger runs as — read this before setting it

`appsscript.json` pins `executeAs: USER_DEPLOYING`, and **that governs web requests only.** An
installable trigger runs as *whoever created it in the Triggers UI*. So `tp01ReportMailCheck`
will read **the trigger creator's** mailbox, and `MailApp.sendEmail` inside it will send **as
the trigger creator** — not as the deployer, which is who the TP01 page's manual Send goes out
as. Create the trigger from the deploying account and the two identities are the same one.
This is `README.md` §1's trap, and it is why one design decision below is not negotiable:

> **The automated-email config lives in Script Properties, never User Properties.**
> `TP_getRecipients` / `TP_saveRecipient` use `getUserProperties()`, which resolves to the
> deployer for every *web* user — but inside a trigger it resolves to the *trigger creator*.
> If those two accounts ever diverge, a config saved from the website would be invisible to
> the trigger, silently, and the run would mail nobody. Script Properties are one store for
> both. `INVENTORY_REPORT_SOURCE` and `INVENTORY_REPORT_MAIL_SEEN` are already there for
> exactly this reason.

---

## 2. The pipeline

```
  tp01ReportMailCheck()                              §11, the trigger target
        │
        ├─ TPMAIL.run()                              §10, new
        │     1. Gmail search: subject sentence + attachment + window + from
        │     2. skip every message id already in TP01_REPORT_MAIL_SEEN
        │     3. newest unseen message → its .xlsx attachment
        │     4. attachment → Drive → convert to a temp Google Sheet → read → trash
        │
        ├─ TPSAP.read(grid)                          §10, new — the SAP half
        │     TP01 tab + ZIPR tab, header row located on 'CnTy',
        │     report date off the file's OWN date cell (never new Date()),
        │     Concat Key = Plant + Ship-To(minus 1st char) + Material
        │
        ├─ TPQLK.build()                             §10, new — the QlikView half
        │     PV.rawEnriched()                       (already cached, already
        │       ├─ filter Customer Parent = 'Amrize Rmx'      market-enriched)
        │       ├─ keep the current year's figures (CY columns; year off the data)
        │       ├─ roll up to Market × Month × Plant × Material × Sold To
        │       └─ ASP ex-Works = Σ revenue ÷ Σ volume   (recomputed after the roll-up)
        │     → a grid shaped exactly like the QlikView export the page eats
        │
        ├─ TPCOMP.compare(sap, qlk)                  §10, new — the port of the page
        │     the same key match, the same two revenue columns, the same
        │     market split, the same exception rule, the same email HTML
        │
        ├─ TPXLSX.write(headers, rows)               §10, new — .xlsx without SheetJS
        │
        └─ MailApp.sendEmail(...)                    to whoever TP01_AUTOMAIL names
```

---

## 3. The QlikView half is the Aggregates sheet — and it needs no new sheet reading

`PV.rawEnriched()` (`script.gs` §6, exported at the bottom of `PV`) already returns exactly
the fields this needs, per raw row, off the cached `Combined Data CPI Raw` tab:

| field | comes from | note |
|---|---|---|
| `custParent` | `Customer Parent` | **the filter** |
| `soldTo` | `Sold To` | part of the Concat Key |
| `plant` | `Plant` | part of the Concat Key |
| `material` | `Material` | part of the Concat Key |
| `month` | `Month` | bare `Jul` — the tab keeps the year separately |
| `market` | **REGION LOOKUP**, keyed on Plant, col 11 | this is the "market through the lookuptable" you asked for — it is already done |
| `cyVol` | `CY Volume` / `2026 Volume`, whichever the tab uses | picked by `APP_yearCols_` |
| `cyRev` | `CY Rev exWorks` / `2026 Rev exWorks` | same |
| `.cyYear` | the **Year column**, not the calendar | `APP_dataCyYear_` |

So the whole "filter the agg sheet" job is one pass over an array this app already holds.
**No new tab, no new sheet id, no new setting, and nothing added to §6.** `TPQLK` lives in §10
beside the rest of TP01 and calls `PV.rawEnriched()`.

### The roll-up

The AGG tab is drilled down further than the QlikView export — it also carries Plant Type,
Material Family, Product Class, Product Application and Cust Segment. Group by
**Market × Month × Plant × Material × Sold To**, sum `cyVol` and `cyRev`, then

```
ASP ex-Works = Σ revenue ÷ Σ volume        (0 volume → blank, never 0 and never Infinity)
```

recomputed **after** the sum, never averaged from the row-level ASPs. That is the same
revenue-weighted rule the Price & Volume pivots use ("Pivot ASP is revenue-weighted (Sum Rev /
Sum Vol)", `script.gs` §6 header) and it is what makes
`Additional Revenue to Post = (SAP TP − ASP) × Volume` come out right at the rolled grain.

**Month stays in the grain** because the QlikView export has a Month column and the page
inserts Concat Key immediately after it. The SAP file carries one price per key, so the same
price applies to every month and the year-to-date figure is the sum of the months — which is
what the export did. Dropping Month (one YTD row per key) is a one-line change if you want it;
say so and it is done.

### The columns the synthetic grid emits, and why the header names matter

```
Market │ Customer Parent │ Sold To │ Plant │ Material │ Month │
    <YEAR> Volume │ <YEAR> Revenue ex-Works │ <YEAR> ASP ex-Works
```

`<YEAR>` is the year taken off the data (`rawEnriched().cyYear`), so 2026 today and 2027 next
year with no edit. Two things about those two header names are load-bearing:

- The page finds them with `iYearCol(headers, 'Volume')` and
  `iYearCol(headers, 'ASP ex-Works')`, which matches the period token by **shape** — `CY`,
  `PY` or a four-digit year at either end. `2026 Volume` and `2026 ASP ex-Works` both match.
- `iYearCol` compares the remainder **literally**, and unlike `APP_hdrNorm_` it does **not**
  fold `ex-Works` / `exWorks` / `ex Works` together. Spell it `ASP ex-Works`, with the hyphen.
  A near-miss returns −1, and the page then builds a workbook full of blank revenue and
  downloads it without complaining — this is `README.md` §7's "never name a period back at a
  column header", and the comment above `iYearCol` in `app.html` is the account of the day it
  happened.

`Total Standard Production Costs` is in the real QlikView export and not in the AGG sheet.
It is used for **one thing** — currency formatting in `applyNumberFormats` — and that call
already filters out `-1`, so its absence costs nothing. Confirmed by reading the code, not
assumed.

### About the "source plant" column

You said the AGG sheet has no source-plant column and that you did not think it was part of
the key. Confirmed from the code: the key is built from **Plant**, **Sold To** and
**Material** on the QlikView side (`buildQLKKey`) and from **S Plant**, **Ship-to / Partner
PC** and **Material** on the SAP side (`buildSAPKey`). `S Plant` in the SAP file *is* the
plant that matches AGG's `Plant`. Nothing else is needed.

**These were open questions and they are now answered**, off the real workbook that landed on
`main` (`CPI Combined CENTRAL CANADA AGG PRICE & VOLUME REPORT (1).xlsx`), not guessed:

| | value in the sheet | what the key rule makes of it |
|---|---|---|
| `Customer Parent` | **`Amrize RMX`** | exact, normalised equality. `Metrix RMX` is also in that column, so a `contains 'RMX'` test would be wrong |
| `Cust Segment [Rock]` | `INTERNAL RMX` on the same rows | a second, independent way to see the same set — useful in the status report, not used as the filter |
| `Sold To` | `BURLINGTON READY MIX - P4Q01` | code **last**. `extractSoldToCode` → `P4Q01`, `.slice(1)` → `4Q01` |
| `Plant` | `3P02 - DUNDAS QUARRY` | code **first**. `extractCode` → `3P02` |
| `Material` | `9160 - LI,40-20MM,CLEAR` | code **first** → `9160`. The comma in the description is not a `" - "`, so the split is safe |
| `Year` | `2026` / `2025`, one per row | **a row carries one year.** A 2025 row has its figures in the PY columns and zeros in CY; a 2026 row the other way round. So "2026 only" is `Year === cyYear` **and** the CY columns — both halves, not either |
| REGION LOOKUP | `3G00 - STONEWALL QUARRY` → `Manitoba` | the Central Canada rows carry the spaced `code - name` form the raw tab uses, so the market resolves. (The US rows in the same tab use an unspaced `3223-MESA…`; not ours, but do not "fix" the lookup on the strength of them) |

Against the SAP side that makes the key `3P02` + `4Q01` + `9160`, and the SAP file's
`3G00` + `64G00`→`4G00` + `9023` is the same shape: **both sides drop a one-character prefix
from the ship-to / sold-to and the remaining four characters are the plant space.** The
existing key rule needs no change.

The match *rate* still has to be measured against a real SAP file, and
`tp01ReportMailStatus()` (§7) is what measures it.

---

## 4. Everything that gets written, and where

Section numbers are `script.gs`'s. New regions follow the file's own
`/* ---- Name.gs ---- */` banner convention.

### `script.gs` §1 — CONFIG

```js
/* WHERE THE WEEKLY TRANSFER-PRICE FILE COMES FROM BY ITSELF. */
TP01_MAIL: {
  SUBJECT:  'TP01 - ZIPR Report ECAN Plants 3Q, 3P, 3R, 3G and 3L',
  FROM:     'amrize.com',
  WINDOW_DAYS: 21,
  CUSTOMER_PARENT: 'Amrize Rmx',   // the AGG filter, normalised before comparing
}
```

- `SUBJECT` is the **whole sentence**, as you asked. Gmail's `subject:"…"` term matches words
  in any order, so it is only the cheap filter; the real test is that the subject, once `Re:`
  / `Fwd:` markers are stripped, **contains that entire sentence**. Your screenshot is a
  forward, so marker-stripping is not theoretical.
- `FROM` is `amrize.com` rather than `nabs.customermaster@amrize.com` deliberately: the mail
  that reaches the mailbox was forwarded by a colleague, so the sender is theirs, not the SAP
  robot's. `README.md` §5 already says why `FROM` matters — a subject line is not a
  credential, and this is the only narrowing Gmail offers.
- `WINDOW_DAYS: 21` covers three weekly sends. A longer window costs nothing and buys nothing,
  because the seen-list is what stops re-sends.

Also in §1: the config-key roster at the top of the section gains two lines, matching the
existing `INVENTORY_MAIL` entries.

### `script.gs` §10 — `/* ---- TP01_Auto.gs ---- */` (new region)

Four namespaces, all of them **pure JavaScript with no Google service in them**, which is what
makes them testable off-platform:

| namespace | what it is |
|---|---|
| `TPSAP` | the SAP file reader — the port of `loadSAPFile`. Locates the header row on `CnTy`, maps both tabs' differing column names to the eleven common ones, builds the Concat Key, and takes the report date off the file's own date cell. |
| `TPQLK` | §3 above: `PV.rawEnriched()` → filter → roll up → recompute ASP → grid. (This one touches PV, so it is pure only below its first line.) |
| `TPCOMP` | the port of `buildComparison` + `storeMarketData` + `daysOutstanding` + `makeMarketWB` + `buildEmailBody`. Same key match, same `round4`, same insert position, same exception rule (`TP − ASP` in whole cents, exception only when **below** by more than a cent), same aging sort, same email HTML. |
| `TPXLSX` | writes a real `.xlsx` — see below. |

### `script.gs` §10 — `/* ---- TP01_MailWatch.gs ---- */` (new region)

`TPMAIL`, modelled directly on `IRMAIL` and reusing its proven decisions:

- `query()`, exposed so §4's permission probe can run the real query rather than a lookalike.
- `stripMarkers_` / `subjectMatches_` — `Re:`/`Fwd:` in any combination, then the whole
  sentence must be present.
- `TP01_REPORT_MAIL_SEEN`, a capped list of Gmail message ids in Script Properties. **Never a
  Gmail label** — that is what keeps the grant at `gmail.readonly`, and `README.md` §1 spells
  out that this is the widest scope in the manifest and is narrowed by nothing but `FROM`.
- A message that fails on the Drive or sheet side is **not** marked seen, so tomorrow retries
  it. A message that can never work (no spreadsheet attachment) **is** marked, so it stops
  logging forever. Same split as `IRMAIL`.
- `status()` — the dry run. See §7.
- Attachment → temp Google Sheet → read → trash, in a `finally`. It will carry the
  **`~qliksync temp` prefix on purpose**, so §5's existing `sweepTemps_` clears anything a
  runtime kill strands. Its comment must say so, and §5's sweep comment gains a line saying it
  is no longer the only engine making them.

### `script.gs` §10 — the config record

```js
TP01_AUTOMAIL          // ScriptProperty, JSON
{
  enabled: false,
  to:  [], cc: [],                       // typed on the website, never in code
  send: { breakdown: 'one', exceptions: 'one' },   // 'off' | 'one' | 'per-market'
  updatedAt: '', updatedBy: ''
}
TP01_AUTOMAIL_STATE    // ScriptProperty, JSON — last run, last subject, counts, last error
```

with `TP_getAutoConfig()` / `TP_saveAutoConfig(cfg)` as the two `google.script.run` entry
points. **No address is hardcoded anywhere** — yours goes in through the panel, which is also
how "more recipients later" costs nothing.

### `script.gs` §11 — the trigger entry points

```js
function tp01ReportMailCheck()  { return TPMAIL.run(); }
function tp01ReportMailStatus() { return TPMAIL.status(); }
```

with the same kind of banner `inventoryReportMailCheck` carries: set ONE day timer, add it
from the deploying account, run the status function first.

### `script.gs` §4 — PERMISSIONS

The `GmailApp` check's `usedFor` becomes "the Inventory Report's mail watch and TP01's", and
its probe runs **both** `IRMAIL.query()` and `TPMAIL.query()`. A probe that proves a different
query than the trigger runs proves the wrong thing — that sentence is already in the file.
`MailApp`'s `usedFor` line changes too: TP01 mail is no longer only sent by a person pressing
a button.

**No new OAuth scope is needed.** Every service this touches — `GmailApp`, `DriveApp`,
`UrlFetchApp` + Drive REST, `SpreadsheetApp`, `MailApp`, `PropertiesService` — is already in
`appsscript.json`, and each was traced to a real call in `README.md` §1. Worth stating
explicitly because §1 also warns that adding a service without its scope throws for every
user with nothing warning you.

### `app.html` — the config panel

A fourth panel on the TP01 page, under Exceptions: **Automated weekly email**.

- an on/off switch, a recipients box (comma-separated, same `parseEmails` shape as the
  existing "always send to"), a cc box, and two selects — what to send for the market
  breakdown and for the exceptions (`off` / one combined email / one per market)
- a read-only status line: last run, the subject and date of the last SAP mail it used, rows
  matched, emails sent, and the last error if there was one
- copy that says plainly **who the mail is from** (the trigger creator, i.e. the deploying
  account — not whoever is looking at the page) and that the setting is shared with everyone,
  because the existing panel's copy had to be corrected once for saying the opposite, and that
  correction is called out in the page's own port banner
- CSS goes in §A4's `tp01` block. New ids must be unique **within the tp01 template**;
  `tests/merge.js` is the gate for that and for every `getElementById` target existing in the
  page's own template.

The page's compute path does not change. The manual two-file flow keeps working exactly as it
does now, and the automation is a second entrance to the same machine.

---

## 5. The one genuinely new piece of engineering: writing .xlsx on the server

The page builds its attachments with SheetJS in the browser. Apps Script has no SheetJS and
cannot load one. Two ways out:

**(a) Round-trip through Drive.** Create a temp Google Sheet, write the values, set number
formats, export it as `.xlsx` through the Drive export endpoint, trash it. ~50 lines, uses
only what is already scoped. **Costs:** one Drive file created, exported and trashed **per
market per panel** — up to sixteen files, sixteen HTTP fetches and a good part of a minute on
every run, against a 6-minute execution ceiling that this codebase has already been killed by
once (`README.md` §5, the run-at-a-time formula batching). And it cannot reproduce the Excel
*table* (`TableStyleMedium2` banded ListObject) the page's files carry.

**(b) Write the .xlsx directly — `TPXLSX`.** An `.xlsx` is a zip of XML, and `Utilities.zip`
makes zips. Seven small parts: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`,
`xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/worksheets/sheet1.xml` and
`xl/tables/table1.xml`. Inline strings, no shared-string table, three number formats
(`0` for volume, `"$"#,##0.00` for the money columns, text for the rest). ~250 lines, no
network, no Drive file, milliseconds instead of a minute — and it is **pure JavaScript, so it
can be tested in Node**, which (a) cannot.

**Recommendation: (b), with (a) written down as the fallback** if the writer turns out to
fight Excel. The gate that makes (b) safe is in §8: write a workbook with `TPXLSX`, read it
back with SheetJS in Node, and assert it is cell-for-cell what the page's SheetJS would have
produced from the same rows. That is a round trip through the *actual* consumer, not a
self-consistent check.

---

## 6. The rules this must not break

Each of these is in `README.md` for a reason, and each has a way of being broken here
specifically.

1. **Never name a period back at a column header** (§7). Applies twice: to the synthetic
   grid's `<YEAR> Volume` / `<YEAR> ASP ex-Works` headers, and to picking the AGG sheet's CY
   columns — which must come from `APP_yearCols_` with the year taken off the **Year column**,
   never from `new Date().getFullYear()`. A page that publishes zeroes under correct headings
   is the failure mode, and it does not announce itself.
2. **The period comes off the data, never off the calendar** (§5, the Inventory Report's
   version of the same rule). The report date stamped on every file and in every email subject
   is the SAP file's **own** date cell. A file re-sent late must carry its own date, not the
   day the trigger happened to fire. Fall back to the message's send date and **warn**; never
   to today, silently.
3. **Two implementations of one rule will drift** — this is the single biggest risk in the
   whole plan. `TPCOMP` is a second copy of arithmetic that already exists in `app.html`, and
   nothing at runtime will ever tell you they disagree. §8's parity harness is the answer, and
   it is not optional.
4. **`script.gs` and `app.html` are LF throughout** (§0). Any scripted edit opens with
   `newline=''`.
5. **Apps Script runs every `<? … ?>` in an HTML file** and a stray style-element closing tag
   is eaten silently (§7). The new panel's copy must not write either as a literal.
6. **Scoping a CSS rule raises its specificity** (§7). New §A4 rules use
   `:where(body[data-page="tp01"])` where weight matters.
7. **Nothing gets deleted on a hunch** (§9). The one deletion this plan proposes — the `tp01`
   case in `tests/pageparity.js`, if it comes to that — has its justification written out in
   §8 and gets a §11 log entry.
8. **A run that finds nothing must do nothing** (§5). No sheet read, no cache warmed, no
   property written on the six quiet days.

---

## 7. `tp01ReportMailStatus()` — the function that answers the open questions

Written **first**, before any of the send path, because it converts every unknown in this plan
into one editor run against live data. It reads only: it publishes nothing, sends nothing,
files nothing and marks nothing seen.

It reports:

**The mail side** — the exact Gmail query; every matching message with its subject, sender,
date, attachment names and whether it has already been seen; and for the newest unseen one,
the tab names inside the attachment and the report date read off it.

**The AGG side** — the detected current year and where it came from; the row count before and
after the `Customer Parent` filter, **with the distinct Customer Parent values it actually
saw**, so a spelling of `Amrize Rmx` that does not match is visible instead of silently
producing zero rows; the rolled row count; the markets found and any rows whose plant is
missing from REGION LOOKUP; and a sample of ten `Sold To` / `Plant` / `Material` values **with
the Concat Key each one would generate** — which is what settles §3's open question about the
shape of `Sold To`.

**The join** — the match rate between the two sides, and ten unmatched keys from each side.
If that number is not close to what the page reports on the same week's files, the automation
is wrong and this says so before anything is emailed to anybody.

**The send side** — who would be mailed, how many emails, and what each subject would be.

---

## 8. Verification — and it comes last, on purpose

Per your instruction: **no test runs until the functionality is built.** When it is:

**New harnesses**

| harness | what it claims |
|---|---|
| `tests/tp01parity.js` | **the important one.** `TPCOMP` (sliced out of `script.gs`) and the tp01 page's compute (sliced out of `app.html`) run over one hand-built fixture, and produce identical output headers, rows, market split, exception set, aging order and email HTML. This is what stops rule 6.3 from happening. |
| `tests/tp01qlk.js` | `TPQLK` over a fixture set of enriched rows: the Customer Parent filter, the year selection off the Year column, the roll-up grain, the revenue-weighted ASP, the zero-volume guard, and the header names `iYearCol` has to find. |
| `tests/tp01xlsx.js` | `TPXLSX` writes a workbook; SheetJS reads it back in Node; the cells, the number formats and the table definition are what the page's SheetJS would have written. `npm install xlsx`. |

Both readers already exist — `tests/scriptgs.js` slices a region of `script.gs`,
`tests/apphtml.js` slices a page out of `app.html`. **`tests/scriptgs.js`'s `ORDER` array must
gain `TP01_Auto.gs` and `TP01_MailWatch.gs`**, or the new regions are not addressable. (It is
already missing `IR_MailWatch.gs`, which is why `region('IR_Backend.gs')` currently returns
both — worth fixing in the same pass.)

**Existing harnesses to re-run**

`merge.js` (structural — new ids, new CSS, the scriptlet traps), `pageswitch.js` (mount and
teardown), `configcheck.js` (the new `APP_CONFIG` block), `threefiles.js` (still three files).

**`tests/pageparity.js` needs a decision.** It boots the deleted `Page_TP01.html` out of git
next to the merged page and diffs them, with `google.script.run` stubbed. The new panel calls
`TP_getAutoConfig` at boot, which is not in `serverStubs`, and the legacy page has no panel to
diff against.

- **Preferred:** keep the case. Add `TP_getAutoConfig` / `TP_saveAutoConfig` to `serverStubs`,
  keep the new panel out of the diffed hosts (`marketList`, `excList`, `colPills`,
  `statsGrid`, `status`), and assert the panel **merged-side only**, in `chrome` — which is
  exactly how the shared guide and the hint modal are already handled there.
- **Fallback:** if the panel has to live inside a diffed host, **retire the `tp01` case** —
  remove it, do not weaken it. `tests/README.md` states the rule outright: the legacy half of
  a comparison retires when a page is *deliberately* changed, and a gate that can only be
  weakened should be deleted instead. Either way it gets a note in `tests/README.md` and a
  `README.md` §11 row.

**What cannot be tested off-platform, and must be walked through on the live deployment:**
Gmail search and attachment read, the Drive convert-and-trash, `MailApp` with attachments, the
Script Properties round trip, and the trigger firing as the right identity.
`tp01ReportMailStatus()` covers the first, second and fourth of those from the editor without
sending anything.

---

## 9. Order of work

Each step is one commit, per `README.md` §10.

| # | step | why here |
|---|---|---|
| 1 | `APP_CONFIG.TP01_MAIL` + `TPQLK` + `tp01ReportMailStatus()`'s **AGG half** | answers the Sold To / Customer Parent / market questions against live data before anything depends on the answers |
| 2 | `TPSAP` + `TPMAIL`'s read path + the **mail half** of the status function | proves the mailbox, the subject rule and the attachment convert — still sending nothing |
| 3 | `TPCOMP` | the port. Nothing new is invented here; it is `app.html`'s arithmetic moved, and it stays diffable |
| 4 | `TPXLSX` | the only real engineering. Fallback (a) is written down and reachable if it fights |
| 5 | `TP01_AUTOMAIL` + `TP_getAutoConfig` / `TP_saveAutoConfig` + the page panel | the config has to exist before the send path can read it |
| 6 | `TPMAIL.run()` + `tp01ReportMailCheck` + §4's probe + §11's banner | the send path, last |
| 7 | the three new harnesses, `scriptgs.js`'s `ORDER`, the `pageparity` decision | **tests, at the very end, as you asked** |
| 8 | `README.md` — §1 scope table, §5 (a third trigger; the two places that say "two" and "the only other one"), §7, §11 session log; **delete this file** | the durable half goes home |

---

## 10. The decisions, made

1. **Only the exceptions report is emailed.** The market breakdown is not sent. `TPMAIL` still
   computes it — the comparison is one pass and the breakdown is what the exception rule reads
   — it simply does not mail it. Turning it back on later is one config value.
2. **Send As One.** A single email, every market's exceptions stacked in the body, per-market
   breakdowns in the order the page shows them.
3. **One combined attachment**, not one file per market: a single `.xlsx` holding every
   market's exception rows, sorted longest-outstanding first, with `Market` as a column. This
   is the one place the automated output is deliberately *not* the shape the page produces,
   and `TPXLSX` is where that shape is defined.
4. **The QlikView drop zone stays, as an override.** The page keeps both drop zones. Drop only
   the SAP file and the QlikView side is built from the Aggregates sheet; drop a QlikView file
   as well and it wins. The backend takes either input and the comparison downstream of it is
   the same code, so this is two *inputs*, not two pipelines.
5. **The calculations move to the backend.** This is the change that makes the rest safe. The
   comparison arithmetic and the email HTML exist **once**, in `script.gs`, and both the page
   and the trigger call it. The browser keeps two jobs it is better at and which are not
   calculations: parsing a dropped workbook (SheetJS), and writing the `.xlsx` files the
   manual Download and Send buttons produce. `TPXLSX` exists only because a trigger has no
   browser to do that second job.
6. **A week with no exceptions still sends.** A short "no exceptions" email with no
   attachment. A pipeline that is silent when it works is indistinguishable from one that has
   stopped, and this one runs unattended.
7. **Your address goes in through the panel**, never into code.

## 11. One note on the branch

`CLAUDE.md` says all work happens on `merging-files`. This session was handed
`claude/tp01-report-automation-plan-f7h7kr`, which is 99 commits ahead of `origin/main` and
carries the Inventory Report mail watch, so it is the live tip. This plan is committed there.
If the work should land on `merging-files` instead, say so before step 1 — it is one branch
command, and it is not mine to decide.
