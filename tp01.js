var _x = AMR.page('tp01', {
  title: 'Amrize · Transfer Price Tool',
  /* SheetJS still, and only for the two things a browser is better at than a
     server: reading a dropped workbook, and writing the files the Download and
     Send buttons produce. Every NUMBER comes from the server now. */
  libs: ['xlsx'],
  help:
    '<h3>What is this?</h3><p>Compares SAP transfer prices (TP01-ZIPR) against the Ready-Mix aggregate purchases and calculates the revenue corrections.</p>'+
    '<h3>How to use it</h3><p><b>1.</b> Drop the weekly SAP file (must contain TP01 and ZIPR tabs). That is all that is needed — the other side of the comparison is built from the Aggregates workbook this suite already reads.<br>'+
    '<b>2.</b> Optionally drop a QlikView transfer-pricing export as well. If you do, <b>it is used instead</b> of the Aggregates sheet.</p>'+
    '<h3>Where the Aggregates side comes from</h3><p>Rows whose <b>Customer Parent</b> is <b>Amrize RMX</b>, for the current year, rolled up to plant × material × customer × month, with the ASP ex-Works recalculated as revenue ÷ volume. The market comes from the plant lookup.</p>'+
    '<h3>Exceptions</h3><p>Below the market breakdown, the Exceptions panel lists matched rows where the SAP Transfer Price is lower than the ASP ex-Works by more than a cent (higher prices and ±$0.01 differences are ignored). Each market’s exceptions can be downloaded or emailed separately, with its own remembered recipient. Exception files and previews are sorted by urgency &mdash; how many days the price has been at an incorrect value (report date minus the SAP price’s Valid From).</p>'+
    '<h3>Emailing</h3><p>Type each market’s recipient once &mdash; it is remembered for everyone, not just you. '+
    'The <b>always send to</b> box next to each Send All button appends its addresses (comma-separated) to every email in that panel; '+
    'markets with no recipient of their own still go out to just those addresses. '+
    'Use <b>Send All</b> to email every market that has at least one recipient. '+
    '<b>Send As One</b> instead sends a single email to just the always-send-to addresses, with every market’s file attached and the breakdowns stacked in the body. '+
    'Emails are sent from the account that <b>deployed</b> the app, not from yours.</p>'+
    '<h3>The weekly report</h3><p>The <b>Automated email</b> panel at the bottom sends the exceptions on its own, every time the weekly SAP file arrives by mail. Nobody has to open this page for it to go out. <b>Preview</b> shows what the next run would find without sending anything.</p>',

  boot: function(root){

    /* The header's Home / Help buttons, by delegation. */
    root.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      switch (b.getAttribute('data-act')){
        case 'home': AMR.nav.home();  break;
        case 'help': AMR.openHelp();  break;
      }
    });

  /* THE PAGE HOLDS NO ARITHMETIC ANY MORE.
     It used to hold all of it: the SAP read, the Concat Key on both sides, the
     two revenue columns, the market split, the exception rule, the aging and
     the email HTML. All of that is script.gs §10's TPE now, because the weekly
     trigger needs the same numbers and a trigger has no browser - and the only
     alternative was two copies of one set of rules with nothing at run time
     ever reporting that they had drifted.

     What is left here is presentation and file writing. `cmp` is whatever the
     server last returned; every field on it is read, never recomputed. */
  let sapTabs = null;          // { TP01: grid, ZIPR: grid } as SheetJS read them
  let qlkGrid = null;          // optional override: { headers, rows }
  let qlkName = '';
  let cmp     = null;          // the whole server answer, including its token
  let savedRecips = {};        // recipient key -> email, from User Properties
                               // (market breakdown = market name; exceptions = 'EXC::' + market)

  const $ = id => document.getElementById(id);
  function showStatus(type, msg) { $('status').className='status '+type; $('status').innerHTML=msg; }
  function slug(s){ return String(s).replace(/[^a-zA-Z0-9]/g,'_'); }
  const sapDate = () => (cmp && cmp.reportDate) || '';

  // ── Recipients: stored in Script User Properties, shared by everyone ───────
  (function loadSavedRecipients(){
    try {
      google.script.run
        .withSuccessHandler(function(r){
          savedRecips = r || {};
          $('alwaysto-mkt').value = savedRecips['ALL::mkt'] || '';
          $('alwaysto-exc').value = savedRecips['ALL::exc'] || '';
          if (cmp) renderPanels();
        })
        .withFailureHandler(function(e){ console.warn('Could not load saved recipients', e); })
        .TP_getRecipients();
    } catch(e){}
  })();

  // kind: 'mkt' (market breakdown) or 'exc' (exceptions) — each keeps its own recipient
  function recipKey(kind, market) { return kind === 'exc' ? 'EXC::' + market : market; }

  // "always send to" — addresses appended to EVERY email in a panel.
  function parseEmails(s) {
    return String(s || '').split(/[,;]/).map(x => x.trim()).filter(x => x.includes('@'));
  }
  function alwaysList(kind) { return parseEmails($('alwaysto-' + kind)?.value); }

  function onAlwaysToChange(kind, inputEl) {
    const key = 'ALL::' + kind;
    const val = inputEl.value.trim();
    savedRecips[key] = val;
    google.script.run
      .withFailureHandler(function(e){ console.warn('Could not save always-send list', e); })
      .TP_saveRecipient(key, val);
  }

  // Full recipient list for one market's email: its own address (if any) plus
  // the panel's always-send addresses, deduped case-insensitively.
  function recipientsFor(kind, market) {
    const own = parseEmails($('recip-' + kind + '-' + slug(market))?.value);
    const seen = new Set(), out = [];
    for (const e of [...own, ...alwaysList(kind)]) {
      const k = e.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
    return out;
  }

  function onRecipChange(kind, market, inputEl) {
    const email = inputEl.value.trim();
    savedRecips[recipKey(kind, market)] = email;
    google.script.run
      .withFailureHandler(function(e){ console.warn('Could not save recipient', e); })
      .TP_saveRecipient(recipKey(kind, market), email);
  }

  // ── Reading a dropped workbook ─────────────────────────────────────────────
  function readFile(file, cb) {
    const r = new FileReader();
    r.onload = e => cb(new Uint8Array(e.target.result));
    r.readAsArrayBuffer(file);
  }

  /* Dates arrive from SheetJS as Date objects and would be posted to the server
     as ISO strings in a different timezone. They are flattened here, where the
     Date object still exists, using the same YYYY-MM-DD the server produces. */
  function flat(v) {
    if (v instanceof Date) {
      return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0') + '-' +
             String(v.getDate()).padStart(2,'0');
    }
    return v;
  }
  function gridOf(ws) {
    return XLSX.utils.sheet_to_json(ws, { header:1, defval:'' }).map(r => r.map(flat));
  }

  function setupDrop(dropId, inputId, fnameId, handler) {
    const dz=$(dropId), inp=$(inputId);
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragging'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragging'); if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0], dropId, fnameId); });
    inp.addEventListener('change', () => { if (inp.files[0]) handler(inp.files[0], dropId, fnameId); });
  }
  setupDrop('drop1','file1','fname1', loadSAPFile);
  setupDrop('drop2','file2','fname2', loadQLKFile);

  // ── Load SAP ───────────────────────────────────────────────────────────────
  function loadSAPFile(file, dropId, fnameId) {
    if (!file.name.match(/\.xlsx?$/i)) { showStatus('error','&#10060; Please upload an .xlsx file.'); return; }
    showStatus('info','<span class="spinner sm"></span> Reading SAP file&hellip;');
    readFile(file, bytes => {
      try {
        const wb = XLSX.read(bytes, { type:'array', cellDates:true });
        if (!wb.SheetNames.includes('TP01') || !wb.SheetNames.includes('ZIPR')) {
          showStatus('error','&#10060; Could not find TP01 and ZIPR tabs. Is this the SAP file?'); return;
        }
        sapTabs = { TP01: gridOf(wb.Sheets['TP01']), ZIPR: gridOf(wb.Sheets['ZIPR']) };
        $(dropId).classList.add('loaded');
        $(fnameId).textContent = '✓ ' + file.name;
        $('block1').classList.add('ready');
        build();
      } catch(e) { showStatus('error','&#10060; SAP error: '+e.message); console.error(e); }
    });
  }

  // ── Load QlikView (optional — it overrides the Aggregates sheet) ────────────
  function loadQLKFile(file, dropId, fnameId) {
    if (!file.name.match(/\.xlsx?$/i)) { showStatus('error','&#10060; Please upload an .xlsx file.'); return; }
    showStatus('info','<span class="spinner sm"></span> Reading QlikView file&hellip;');
    readFile(file, bytes => {
      try {
        const wb = XLSX.read(bytes, { type:'array', cellDates:true });
        const sheetName = wb.SheetNames.includes('Sheet1') ? 'Sheet1' : wb.SheetNames[0];
        const grid = gridOf(wb.Sheets[sheetName]);
        const hStr = (grid[0]||[]).map(h => String(h ?? '').trim());
        if (!hStr.includes('Sold To')||!hStr.includes('Plant')||!hStr.includes('Material')) {
          showStatus('error','&#10060; Could not find Sold To / Plant / Material columns. Is this the QlikView file?'); return;
        }
        qlkGrid = { headers: hStr, rows: grid.slice(1).filter(r => r.some(c => c !== '')) };
        qlkName = file.name;
        $(dropId).classList.add('loaded');
        $(fnameId).textContent = '✓ ' + file.name;
        $('block2').classList.add('ready');
        build();
      } catch(e) { showStatus('error','&#10060; QlikView error: '+e.message); console.error(e); }
    });
  }

  // ── The one server call that produces every number on this page ────────────
  function build() {
    if (!sapTabs) { showStatus('info','&#9989; Drop the weekly SAP file to begin.'); return; }
    showStatus('info','<span class="spinner sm"></span> Comparing against ' +
      (qlkGrid ? AMR.esc(qlkName) : 'the Aggregates data') + '&hellip;');
    $('btnSAP').disabled = true; $('btnComp').disabled = true;

    if (!AMR.live) { showStatus('warn','The comparison runs on the server, so it only works inside the live web app.'); return; }
    const t0 = Date.now();
    google.script.run
      .withSuccessHandler(function(r){
        cmp = r;
        AMR.log('info', 'TP.getComparison', 'compared', {
          ms: Date.now() - t0, source: r.source, rows: r.rows.length,
          matched: r.matched, unmatched: r.unmatched });
        render();
      })
      .withFailureHandler(function(e){
        cmp = null;
        AMR.log('error', 'TP.getComparison', 'failed', { ms: Date.now() - t0, error: String(e) });
        showStatus('error','&#10060; ' + AMR.esc((e && e.message) || String(e)));
        renderPanels();
      })
      .TP_getComparison({ sap: sapTabs, qlk: qlkGrid });
  }

  // ── Render what came back ──────────────────────────────────────────────────
  function render() {
    const pills = cmp.headers.map((h, i) => {
      const isNew = ['Concat Key','SAP Transfer Price','Additional Revenue to Post','Total Corrected Revenue ex-Works'].includes(h);
      const letter = i < 26 ? String.fromCharCode(65+i) : 'A'+String.fromCharCode(65+i-26);
      return `<span class="col-pill ${isNew?'new':''}">${letter}: ${AMR.esc(h)}</span>`;
    }).join('');
    $('colPills').innerHTML = pills;

    $('sSAP').textContent     = cmp.sapRows.toLocaleString();
    $('sQLK').textContent     = cmp.rows.length.toLocaleString();
    $('sMatch').textContent   = cmp.matched.toLocaleString();
    $('sNoMatch').textContent = cmp.unmatched.toLocaleString();

    renderPanels();
    $('btnSAP').disabled  = false;
    $('btnComp').disabled = false;

    /* Where the other side came from is a fact about the numbers on screen, so
       it is said on screen rather than only in the log. */
    const from = cmp.source === 'upload'
      ? `the QlikView file <b>${AMR.esc(qlkName)}</b>`
      : `the Aggregates data &mdash; <b>${AMR.esc(cmp.meta.customerParent || '')}</b>, ${AMR.esc(String(cmp.meta.cyYear || ''))}, ${(cmp.meta.rolledRows||0).toLocaleString()} rows`;
    const dateNote = cmp.dateSource === 'file' ? '' :
      ' &middot; <b>the SAP file carried no date</b>, so ' + AMR.esc(cmp.reportDate) + ' is a guess';
    const tail = `<br><span style="opacity:.8">Report date ${AMR.esc(cmp.reportDate)}${dateNote} &middot; compared against ${from}.</span>`;

    const pct = cmp.rows.length > 0 ? Math.round(cmp.matched/cmp.rows.length*100) : 0;
    if (cmp.matched === 0) {
      showStatus('warn', `&#9888;&#65039; <strong>0 rows matched.</strong> The Concat Keys didn't line up &mdash; check that both sides cover the same plants and customers.${tail}`);
    } else if (cmp.unmatched > 0) {
      showStatus('warn', `&#9888;&#65039; <strong>${cmp.matched} of ${cmp.rows.length} rows matched</strong> (${pct}%). ${cmp.unmatched} rows had no SAP price &mdash; check those Concat Keys.${tail}`);
    } else {
      showStatus('success', `&#9989; All <strong>${cmp.matched} rows matched</strong> &mdash; comparison ready to download!${tail}`);
    }
  }

  const PANELS = {
    mkt: { map: () => (cmp && cmp.markets)    || {}, listId: 'marketList', panelId: 'mktPanel' },
    exc: { map: () => (cmp && cmp.exceptions) || {}, listId: 'excList',    panelId: 'excPanel' }
  };

  function renderPanels() { renderPanelList('mkt'); renderPanelList('exc'); }

  function renderPanelList(kind) {
    const cfg = PANELS[kind];
    const dataMap = cfg.map();
    const listEl = $(cfg.listId);
    listEl.innerHTML = '';
    const markets = Object.keys(dataMap).sort();
    for (const market of markets) {
      const rows = dataMap[market];
      const recipient = savedRecips[recipKey(kind, market)] || '';
      const s = kind + '-' + slug(market);
      const mAttr = AMR.escAttr(market);
      listEl.innerHTML += `
      <div class="market-row">
        <div style="min-width:110px">
          <div class="market-name">${AMR.esc(market)}</div>
          <div class="market-rows">${rows.length} row${rows.length!==1?'s':''}</div>
        </div>
        <input type="email" id="recip-${s}" value="${AMR.escAttr(recipient)}"
               placeholder="name@amrize.com"
               data-tp-act="recip" data-tp-kind="${kind}" data-tp-market="${mAttr}">
        <button class="mbtn" title="Download this file"
                data-tp-act="dl" data-tp-kind="${kind}" data-tp-market="${mAttr}">&#11015;</button>
        <button class="mbtn send" id="msend-${s}"
                data-tp-act="mail" data-tp-kind="${kind}" data-tp-market="${mAttr}">&#9993; Send</button>
        <div class="market-status" id="mstatus-${s}"></div>
      </div>`;
    }
    if (kind === 'exc') {
      // Empty exceptions after a successful build = good news, not "waiting".
      if (cmp && !markets.length) {
        listEl.innerHTML = '<div class="exc-empty">&#9989; No exceptions — every matched SAP Transfer Price is at or above its ASP ex-Works.</div>';
      } else if (!cmp) {
        listEl.innerHTML = '<div class="exc-empty" style="color:var(--muted)">Drop the SAP file to check for exceptions.</div>';
      }
    } else if (!cmp) {
      listEl.innerHTML = '<div class="exc-empty" style="color:var(--muted)">Drop the SAP file to see the per-market breakdown.</div>';
    }
    $('sendall-' + kind).style.display = markets.length ? '' : 'none';
    $('sendone-' + kind).style.display = markets.length ? '' : 'none';
  }

  // ── Writing files. THE ONLY THING LEFT THAT TOUCHES A NUMBER, and it does
  //    not compute one: the rows, the headers and the number formats all come
  //    from the server, and this arranges them into a workbook. ──────────────
  function applyFormats(ws, fmts, nRows, nCols) {
    for (const c of Object.keys(fmts)) {
      const col = Number(c), z = fmts[c];
      for (let r = 1; r <= nRows; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: col });
        if (!ws[addr] || ws[addr].v === '') continue;
        ws[addr].z = z;
        /* Rounded, not merely formatted - a "0" on 404.21 shows 404 and still
           sums as 404.21, so a column of them does not add up to what it shows.
           TPXLSX does the same thing on the server side. */
        if (z === '0' && typeof ws[addr].v === 'number') ws[addr].v = Math.round(ws[addr].v);
      }
    }
  }

  function book(headers, rows, sheetName, tableName, fmts) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(() => ({ wch: 22 }));
    applyFormats(ws, fmts || {}, rows.length, headers.length);
    ws['!tables'] = [{
      name: tableName,
      ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}`,
      headerRow: true, totalsRow: false,
      style: { name: 'TableStyleMedium2', showRowStripes: true },
      columns: headers.map(h => ({ name: h }))
    }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    return wb;
  }

  /* One market's workbook. Exceptions carry two extra columns - when the SAP
     price took effect and how long it has been wrong - and both values come
     back with the comparison rather than being worked out here. */
  function makeMarketWB(kind, market) {
    const isExc = kind === 'exc';
    const list = PANELS[kind].map()[market] || [];
    const headers = isExc ? [...cmp.headers, 'SAP Valid From', 'Days at Incorrect Price'] : cmp.headers;
    const rows = list.map(i => isExc
      ? [...cmp.rows[i], cmp.vfrom[i] || '', cmp.days[i] === null ? '' : cmp.days[i]]
      : cmp.rows[i]);
    return book(headers, rows, isExc ? 'Exceptions' : market,
                (isExc ? 'Exceptions_' : 'Market_') + slug(market),
                cmp.formats[isExc ? 'exc' : 'mkt']);
  }

  function marketFilename(kind, market) {
    return kind === 'exc'
      ? `Transfer_Price_Exceptions_${slug(market)}_${sapDate()}.xlsx`
      : `Transfer_Price_${slug(market)}_${sapDate()}.xlsx`;
  }

  function downloadSAP() {
    if (!cmp) return;
    XLSX.writeFile(book(cmp.sapGrid.headers, cmp.sapGrid.rows, 'Consolidated', 'SAP_Consolidated', {}),
                   `Transfer_Prices_TP01-ZIPR_Consolidated_${sapDate()}.xlsx`);
  }
  function downloadComparison() {
    if (!cmp) return;
    XLSX.writeFile(book(cmp.headers, cmp.rows, 'Comparison', 'TransferPriceComparison', cmp.formats.mkt),
                   `Transfer_Price_Comparison_${sapDate()}.xlsx`);
  }
  function downloadMarket(kind, market) {
    if (!cmp || !PANELS[kind].map()[market]) return;
    XLSX.writeFile(makeMarketWB(kind, market), marketFilename(kind, market));
    const st = $('mstatus-' + kind + '-' + slug(market));
    st.className = 'market-status sent'; st.textContent = '✓ Saved';
  }

  // ── Send. The subject and the body are built on the SERVER, off the cached
  //    comparison, so a market mail and the combined one cannot end up
  //    describing different weeks. This sends the file and says which rows. ──
  function emailMarket(kind, market) {
    const s   = kind + '-' + slug(market);
    const st  = $('mstatus-' + s);
    const btn = $('msend-' + s);
    const toList = recipientsFor(kind, market);

    if (!toList.length) {
      st.className = 'market-status warn'; st.textContent = 'Enter an email first';
      $('recip-' + s)?.focus();
      return Promise.resolve(false);
    }

    btn.disabled = true;
    st.className = 'market-status sending'; st.textContent = 'Sending…';

    const wbout = XLSX.write(makeMarketWB(kind, market), { bookType:'xlsx', type:'base64' });
    return new Promise(function(resolve){
      google.script.run
        .withSuccessHandler(function(){
          btn.disabled = false;
          st.className = 'market-status sent'; st.textContent = '✓ Sent';
          resolve(true);
        })
        .withFailureHandler(function(e){
          btn.disabled = false;
          st.className = 'market-status err'; st.textContent = '✗ Failed';
          showStatus('error', '&#10060; Could not send ' + AMR.esc(market) + ': ' + AMR.esc((e && e.message) || 'unknown error'));
          console.error('Email failed for ' + market, e);
          resolve(false);
        })
        .TP_sendMarketEmail({
          token: cmp.token, kind: kind, market: market,
          to: toList.join(','),
          filename: marketFilename(kind, market),
          xlsxB64: wbout
        });
    });
  }

  // ── Send ALL markets in a panel (sequential queue) ─────────────────────────
  async function sendAll(kind) {
    const btn = $('sendall-' + kind);
    const markets = Object.keys(PANELS[kind].map()).sort();
    if (!markets.length) return;

    const ready = [], missing = [];
    for (const market of markets) {
      if (recipientsFor(kind, market).length) ready.push(market);
      else {
        missing.push(market);
        const st = $('mstatus-' + kind + '-' + slug(market));
        if (st) { st.className = 'market-status warn'; st.textContent = 'No email'; }
      }
    }
    if (!ready.length) {
      showStatus('warn', '&#9888;&#65039; No recipients entered yet &mdash; add a market email or an "always send to" address first.');
      return;
    }

    btn.disabled = true;
    const orig = btn.innerHTML;
    let sent = 0;
    for (let i = 0; i < ready.length; i++) {
      btn.innerHTML = `Sending ${i + 1}/${ready.length}…`;
      if (await emailMarket(kind, ready[i])) sent++;
    }
    btn.disabled = false;
    btn.innerHTML = orig;

    const skippedNote = missing.length ? ` ${missing.length} skipped (no email).` : '';
    if (sent === ready.length) showStatus('success', `&#9989; Sent ${sent} of ${ready.length} email${ready.length!==1?'s':''}.${skippedNote}`);
    else                       showStatus('warn', `&#9888;&#65039; Sent ${sent} of ${ready.length} &mdash; check the rows marked Failed.${skippedNote}`);
  }

  // ── Send ALL markets as ONE email ─────────────────────────────────────────
  function sendAsOne(kind) {
    const btn = $('sendone-' + kind);
    const markets = Object.keys(PANELS[kind].map()).sort();
    if (!markets.length) return;

    const toList = alwaysList(kind);
    if (!toList.length) {
      showStatus('warn', '&#9888;&#65039; Send As One goes to the <b>always send to</b> addresses &mdash; add at least one first.');
      $('alwaysto-' + kind)?.focus();
      return;
    }

    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = 'Building…';

    try {
      const files = markets.map(m => ({
        filename: marketFilename(kind, m),
        xlsxB64: XLSX.write(makeMarketWB(kind, m), { bookType: 'xlsx', type: 'base64' })
      }));

      btn.innerHTML = 'Sending…';
      google.script.run
        .withSuccessHandler(function () {
          btn.disabled = false; btn.innerHTML = orig;
          showStatus('success', `&#9989; Sent one email with ${files.length} attachment${files.length !== 1 ? 's' : ''} to ${AMR.esc(toList.join(', '))}.`);
        })
        .withFailureHandler(function (e) {
          btn.disabled = false; btn.innerHTML = orig;
          showStatus('error', '&#10060; Combined email failed: ' + AMR.esc((e && e.message) || 'unknown error'));
          console.error('Combined email failed', e);
        })
        .TP_sendCombinedEmail({ token: cmp.token, kind: kind, to: toList.join(','), files: files });
    } catch (e) {
      btn.disabled = false; btn.innerHTML = orig;
      showStatus('error', '&#10060; Could not build the combined email: ' + AMR.esc(e.message));
    }
  }

  /* ── THE AUTOMATED WEEKLY REPORT ────────────────────────────────────────────
     Nothing on this panel touches the comparison above it. It reads and writes
     one Script Property, and the trigger reads the same one - which is the
     point: a SCRIPT property is visible to both the deployer (who serves this
     page) and the trigger's creator (who runs the weekly job), and a USER
     property would not be. script.gs §10 has the whole of that argument. */
  let autoCfg = null;

  function autoRender(r) {
    autoCfg = (r && r.config) || { enabled:false, to:[], cc:[], sendWhenEmpty:true };
    const st = (r && r.state) || null;
    $('auto-on').checked   = !!autoCfg.enabled;
    $('auto-to').value     = (autoCfg.to || []).join(', ');
    $('auto-cc').value     = (autoCfg.cc || []).join(', ');
    $('auto-empty').checked = autoCfg.sendWhenEmpty !== false;

    let line;
    if (!st) {
      line = 'It has not run yet.';
    } else if (st.error) {
      line = `<b style="color:var(--neg)">Last run failed</b> &middot; ${AMR.esc(st.at || '')} &middot; ${AMR.esc(st.error)}`;
    } else if (st.mailed) {
      line = `<b style="color:var(--pos)">Last sent</b> ${AMR.esc(st.at || '')} &middot; SAP file dated ${AMR.esc(st.reportDate || '')} &middot; ` +
             `${st.exceptions} exception${st.exceptions === 1 ? '' : 's'} across ${st.markets} market${st.markets === 1 ? '' : 's'} &middot; ` +
             `${st.matched} of ${(st.matched||0)+(st.unmatched||0)} rows matched &middot; to ${AMR.esc(st.to || '')}`;
    } else {
      line = `Last ran ${AMR.esc(st.at || '')} &middot; nothing to send.`;
    }
    if (autoCfg.updatedAt) line += `<br><span style="opacity:.75">Settings saved ${AMR.esc(autoCfg.updatedAt)}${autoCfg.updatedBy ? ' by ' + AMR.esc(autoCfg.updatedBy) : ''}.</span>`;
    $('auto-state').innerHTML = line;
  }

  function autoLoad() {
    if (!AMR.live) { $('auto-state').textContent = 'The automated email can only be set up inside the live web app.'; return; }
    google.script.run
      .withSuccessHandler(autoRender)
      .withFailureHandler(function(e){ $('auto-state').innerHTML = '<b style="color:var(--neg)">Could not read the settings:</b> ' + AMR.esc(String(e && e.message || e)); })
      .TP_getAutoConfig();
  }

  function autoSave() {
    if (!AMR.live) return;
    const btn = $('auto-save'), out = $('auto-msg');
    btn.disabled = true;
    out.className = 'market-status sending'; out.textContent = 'Saving…';
    google.script.run
      .withSuccessHandler(function(r){
        btn.disabled = false;
        out.className = 'market-status sent'; out.textContent = '✓ Saved';
        autoRender(r);
      })
      .withFailureHandler(function(e){
        btn.disabled = false;
        out.className = 'market-status err'; out.textContent = (e && e.message) || 'Failed';
      })
      .TP_saveAutoConfig({
        enabled: $('auto-on').checked,
        to: $('auto-to').value,
        cc: $('auto-cc').value,
        sendWhenEmpty: $('auto-empty').checked
      });
  }

  /* Preview runs the whole check and sends nothing. It is the answer to "is it
     going to work on Tuesday", asked on a Thursday. */
  function autoPreview() {
    if (!AMR.live) return;
    const btn = $('auto-preview'), out = $('auto-preview-out');
    btn.disabled = true;
    out.innerHTML = '<span class="spinner sm"></span> Looking&hellip; this reads the mailbox and the Aggregates sheet, and can take a minute.';
    google.script.run
      .withSuccessHandler(function(s){ btn.disabled = false; out.innerHTML = autoPreviewHtml(s); })
      .withFailureHandler(function(e){ btn.disabled = false; out.innerHTML = '<b style="color:var(--neg)">Preview failed:</b> ' + AMR.esc(String(e && e.message || e)); })
      .TP_autoStatus();
  }

  function autoPreviewHtml(s) {
    if (!s) return 'Nothing came back.';
    const esc = AMR.esc, rows = [];
    const kv = (k, v) => `<div><b>${esc(k)}</b> ${v}</div>`;
    if (s.error) return '<b style="color:var(--neg)">' + esc(s.error) + '</b>';

    (s.notes || []).forEach(n => rows.push(`<div style="color:#B45309">&#9888;&#65039; ${esc(n)}</div>`));

    rows.push(kv('Mail matching', (s.mail || []).length + ' message(s)'));
    (s.mail || []).slice(-3).forEach(m => rows.push(
      `<div style="padding-left:14px">${m.unreported ? '&#9679; ' : '&#9675; '}${esc(m.sent)} &middot; ${esc(m.from)} &middot; ${esc(m.attachment)}</div>`));

    if (s.sheet && !s.sheet.error) {
      rows.push(kv('Aggregates', `${esc(String(s.sheet.customerParent))} &middot; ${esc(String(s.sheet.year))} &middot; ` +
        `${s.sheet.rowsForThatParent} raw rows &rarr; ${s.sheet.rolledRows} rolled`));
      const mk = s.sheet.markets || {};
      rows.push(kv('Markets', Object.keys(mk).map(k => esc(k) + ' (' + mk[k] + ')').join(', ') || 'none'));
    } else if (s.sheet) {
      rows.push(`<div style="color:var(--neg)"><b>Aggregates</b> ${esc(s.sheet.error)}</div>`);
    }

    if (s.join && !s.join.error) {
      rows.push(kv('Match rate', `${s.join.matched} of ${s.join.comparedRows} (${esc(s.join.matchRate)}) &middot; ` +
        `report date ${esc(s.join.reportDate)}${s.join.dateSource === 'file' ? '' : ' (guessed)'}`));
      rows.push(kv('Exceptions', `${s.join.exceptions} across ${(s.join.exceptionMarkets||[]).length} market(s)`));
    } else if (s.join) {
      rows.push(`<div style="color:var(--neg)"><b>Comparison</b> ${esc(s.join.error)}</div>`);
    }

    if (s.wouldSend) {
      rows.push(kv('Would send', `${esc(s.wouldSend.subject)}<br><span style="padding-left:14px">to ${esc(s.wouldSend.to || '(nobody)')} &middot; ${esc(s.wouldSend.attachment)}</span>`));
    }
    return rows.join('');
  }

    /* The controls that live in the template and are never redrawn. */
    document.getElementById('btnSAP').addEventListener('click', downloadSAP);
    document.getElementById('btnComp').addEventListener('click', downloadComparison);
    ['mkt', 'exc'].forEach(function(kind){
      document.getElementById('alwaysto-' + kind)
        .addEventListener('change', function(){ onAlwaysToChange(kind, this); });
      document.getElementById('sendall-' + kind).addEventListener('click', function(){ sendAll(kind); });
      document.getElementById('sendone-' + kind).addEventListener('click', function(){ sendAsOne(kind); });
    });
    document.getElementById('auto-save').addEventListener('click', autoSave);
    document.getElementById('auto-preview').addEventListener('click', autoPreview);

    /* Both market lists are rewritten wholesale by renderPanels(), so their
       per-row controls are delegated on the host that survives it. */
    ['marketList', 'excList'].forEach(function(hostId){
      var host = document.getElementById(hostId);
      function actOf(e){
        var t = e.target.closest ? e.target.closest('[data-tp-act]') : null;
        return t ? { el:t, act:t.getAttribute('data-tp-act'),
                     kind:t.getAttribute('data-tp-kind'),
                     market:t.getAttribute('data-tp-market') } : null;
      }
      host.addEventListener('change', function(e){
        var a = actOf(e);
        if (a && a.act === 'recip') onRecipChange(a.kind, a.market, a.el);
      });
      host.addEventListener('click', function(e){
        var a = actOf(e);
        if (!a) return;
        if (a.act === 'dl')   downloadMarket(a.kind, a.market);
        if (a.act === 'mail') emailMarket(a.kind, a.market);
      });
    });

    /* One guide, where there were seven copies. This page has no upload panel
       to hand it, so no `extra`. */
    AmrQlikGuide.mount({
      title: 'Download from QlikView',
      fabLabel: '&#128229; QlikView Guide',
      steps: [
        { text: 'Step 1 — Select the displayed fields and selections from QlikView and then export to excel  (TP01-ZIPR QlikView export). This is OPTIONAL now: with no QlikView file the comparison is built from the Aggregates data the suite already holds.',
          img: 'https://drive.google.com/file/d/1DLqOg5TfdK_ImR0SoCvolzNtlA_KYDr7/view?usp=sharing' }
      ]
    });

    autoLoad();
  }
});
