/*****************************************************************************
 * Deck_Backend.gs - Google Slides deck builder (PHASE 0: server plumbing)
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 *   The server half of the Deck Builder page. It copies a TEMPLATE deck, then
 *   builds report slides into the copy one at a time. Titles and comment boxes
 *   stay REAL, EDITABLE Slides text; only the table / chart goes in as a
 *   picture. That is the whole point - it is not the current PNG export, which
 *   flattens the title and the comment band into the image.
 *
 * THE TEMPLATE CONTRACT (two dumb mechanisms, so the template stays editable)
 *   1. LAYOUT ID  - every template slide carries "LAYOUT: <id>" in its SPEAKER
 *                   NOTES. That is how a slide is found. Reorder or restyle the
 *                   template freely; nothing here cares about slide order.
 *   2. TOKENS     - {{TITLE}} {{COMMENT}} {{IMAGE}} {{IMAGE2}} {{LABEL1}}
 *                   {{LABEL2}} {{PAGE}} {{DECK_TITLE}} {{DECK_SUB}}
 *                   Each token is the text OF A SHAPE, never a text box laid
 *                   over a rectangle. An image slot is ONE shape: this code
 *                   reads its geometry, deletes it, and fits the picture into
 *                   exactly that rectangle.
 *
 *   Moving or resizing a box in the template moves the picture. No code change.
 *
 * ADDING A LAYOUT
 *   Copy a layout slide, resize its boxes, give it a NEW id in the speaker
 *   notes, and point a recipe row at that id. Nothing here needs editing:
 *   layouts are discovered, never listed. {{IMAGE2}}, {{LABEL1}} and {{LABEL2}}
 *   stay supported for that reason, even though no shipped layout uses them.
 *   Run DECK_validateTemplate() after any edit.
 *
 * WHY THE PICTURE IS FITTED, NEVER STRETCHED
 *   scale = min(boxW/imgW, boxH/imgH), then centred in the box. A short wide
 *   table leaves space above and below rather than distorting. The caller sends
 *   the capture's PIXEL dimensions; only their RATIO is used, so the units on
 *   either side never have to agree.
 *
 * HOW A GENERATED SLIDE IS TELLABLE FROM A LAYOUT
 *   A duplicated slide inherits the template's speaker notes, so DECK_addSlide
 *   OVERWRITES them with "SLIDE: <recipeId>". That single move buys three
 *   things: DECK_finish can delete every slide still saying "LAYOUT:",
 *   DECK_status can report what already landed, and a re-run can skip slides
 *   that are already there.
 *
 * ONE SLIDE PER CALL - DELIBERATE
 *   The 6-minute limit is per execution, not per deck. One slide per call keeps
 *   every call at 2-4s, makes a failure cost one slide instead of the deck, and
 *   lets the page show honest progress. Do not "optimise" this into a batch.
 *
 * PHASE 0 SCOPE
 *   Server only. No page yet. Run DECK_smokeTest() from the editor to prove the
 *   geometry against the real template before anything is built on top.
 *
 * SETUP (once)
 *   1. Upload Amrize_Deck_Template.pptx to Drive and open it with Google
 *      Slides ("Open with > Google Slides") so it becomes a real Slides file.
 *   2. Put that file's ID in DECK_CONFIG.TEMPLATE_ID below.
 *   3. Put the destination folder's ID in DECK_CONFIG.FOLDER_ID. That folder
 *      must be shared as EDITOR with everyone who will build decks.
 *   4. Run DECK_validateTemplate(), then DECK_smokeTest(). The second
 *      prints a deck URL. Open it.
 *
 * SCOPES: Slides + Drive. Deploy EXECUTE AS USER, so the deck belongs to
 * whoever pressed the button (same deployment TP01 already uses).
 *****************************************************************************/

var DECK_CONFIG = {

  /* The template deck, as a GOOGLE SLIDES file (not the .pptx). */
  TEMPLATE_ID: 'PUT_TEMPLATE_FILE_ID_HERE',

  /* Every generated deck is moved here. Share as Editor with the team. */
  FOLDER_ID: 'PUT_DECK_FOLDER_ID_HERE',

  /* Script Property overrides, so the ⚙ Settings modal can point these
     somewhere else later without a code push. Same pattern as the per-page
     sheet IDs in Config.gs. */
  PROP_TEMPLATE: 'DECK_TEMPLATE_ID',
  PROP_FOLDER: 'DECK_FOLDER_ID',

  /* Tokens. Kept in one place so the page and the server cannot drift. */
  TOKENS: {
    title: '{{TITLE}}',
    comment: '{{COMMENT}}',
    image: '{{IMAGE}}',
    image2: '{{IMAGE2}}',
    label1: '{{LABEL1}}',
    label2: '{{LABEL2}}',
    page: '{{PAGE}}',
    deckTitle: '{{DECK_TITLE}}',
    deckSub: '{{DECK_SUB}}'
  },

  /* Speaker-note prefixes. */
  LAYOUT_TAG: 'LAYOUT:',
  SLIDE_TAG: 'SLIDE:',

  /* Layouts that are documentation, never used to build a slide. */
  DOC_LAYOUTS: ['L_README'],

  /* The cover. It is a layout like any other, but it is FILLED IN PLACE by
     create() rather than duplicated by addSlide, so it is not something a
     recipe row can point at. readTemplate still returns it (tagged
     role:'cover') so the page can preview it; the page builds its recipe
     picker from role:'report' only. It also carries {{DECK_TITLE}} /
     {{DECK_SUB}} instead of {{TITLE}}, which is why validateTemplate judges
     it against a different checklist. */
  COVER_LAYOUT: 'L_COVER',

  /* Capture resolution the page should aim for, expressed as pixels per POINT
     of slot width. Slides renders a 720pt-wide slide to ~1920px on a big
     screen (2.67 px/pt), so 4 leaves headroom without bloating the payload.
     DECK_readTemplate returns a suggested pixel width per slot using this. */
  CAPTURE_PX_PER_PT: 4,

  /* Hard ceiling on a single capture, so one huge table cannot blow up the
     request. The page should downscale to fit rather than send more. */
  CAPTURE_MAX_PX: 2400
};


var DECK = (function () {

  /* ======================================================================
   * small helpers
   * ==================================================================== */

  function cfg_(key, prop) {
    var v = '';
    try { v = PropertiesService.getScriptProperties().getProperty(prop) || ''; }
    catch (e) { v = ''; }
    return v || DECK_CONFIG[key] || '';
  }
  function templateId_() { return cfg_('TEMPLATE_ID', DECK_CONFIG.PROP_TEMPLATE); }
  function folderId_() { return cfg_('FOLDER_ID', DECK_CONFIG.PROP_FOLDER); }

  function fail_(msg) { throw new Error(msg); }

  /* Speaker notes of a slide, '' when the slide has none. Guarded because a
     notes page or its shape can legitimately be absent. */
  function notes_(slide) {
    try {
      var np = slide.getNotesPage(); if (!np) return '';
      var sh = np.getSpeakerNotesShape(); if (!sh) return '';
      return sh.getText().asString() || '';
    } catch (e) { return ''; }
  }
  function setNotes_(slide, text) {
    try {
      var np = slide.getNotesPage(); if (!np) return;
      var sh = np.getSpeakerNotesShape(); if (!sh) return;
      sh.getText().setText(String(text == null ? '' : text));
    } catch (e) { /* notes are metadata; never fail a slide over them */ }
  }

  /* "LAYOUT: L_FULL_IMAGE" -> "L_FULL_IMAGE". '' when absent. */
  function layoutIdOf_(slide) {
    var m = String(notes_(slide)).match(/LAYOUT:\s*([A-Za-z0-9_\-]+)/);
    return m ? m[1] : '';
  }
  function recipeIdOf_(slide) {
    var m = String(notes_(slide)).match(/SLIDE:\s*(\S+)/);
    return m ? m[1] : '';
  }

  function isDocLayout_(id) {
    return DECK_CONFIG.DOC_LAYOUTS.indexOf(id) !== -1;
  }
  function isCoverLayout_(id) {
    return !!id && id === DECK_CONFIG.COVER_LAYOUT;
  }

  /* Text of a shape, '' when it has none. Shapes, images and lines all live in
     getShapes()/getPageElements(), and only some carry text. */
  function shapeText_(shape) {
    try {
      var t = shape.getText(); if (!t) return '';
      return t.asString() || '';
    } catch (e) { return ''; }
  }

  /* The ONE shape whose text carries a token. Returns null when absent - an
     optional slot (a layout with no {{COMMENT}}) is not an error. */
  function findTokenShape_(slide, token) {
    var shapes = slide.getShapes();
    for (var i = 0; i < shapes.length; i++) {
      if (shapeText_(shapes[i]).indexOf(token) !== -1) return shapes[i];
    }
    return null;
  }

  /* How many shapes on this slide carry the token. Anything but 0 or 1 is a
     template mistake worth naming out loud. */
  function countTokenShapes_(slide, token) {
    var shapes = slide.getShapes(), n = 0;
    for (var i = 0; i < shapes.length; i++) {
      if (shapeText_(shapes[i]).indexOf(token) !== -1) n++;
    }
    return n;
  }

  function rectOf_(shape) {
    return {
      x: shape.getLeft(), y: shape.getTop(),
      w: shape.getWidth(), h: shape.getHeight()
    };
  }

  /* Fit-and-centre. Ratio only, so px in / pt out is fine. */
  function fitRect_(box, imgW, imgH) {
    var iw = Number(imgW) || 0, ih = Number(imgH) || 0;
    if (!(iw > 0 && ih > 0)) { iw = box.w; ih = box.h; }
    var s = Math.min(box.w / iw, box.h / ih);
    var w = iw * s, h = ih * s;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w: w, h: h };
  }

  /* Accepts a bare base64 string or a full data: URL. */
  function pngBlob_(b64, name) {
    var s = String(b64 || '');
    var comma = s.indexOf(',');
    if (s.slice(0, 5) === 'data:' && comma !== -1) s = s.slice(comma + 1);
    s = s.replace(/\s+/g, '');
    if (!s) fail_('Empty image payload for ' + (name || 'slide'));
    return Utilities.newBlob(Utilities.base64Decode(s), 'image/png',
      (name || 'slide') + '.png');
  }

  /* replaceAllText keeps the formatting of the run it replaces, which is why
     titles keep the template's font. Empty string is a legal replacement and
     is how a comment box is left blank but still styled. */
  function setToken_(slide, token, value) {
    if (!token) return;
    try { slide.replaceAllText(token, String(value == null ? '' : value)); }
    catch (e) { /* token simply absent from this layout */ }
  }


  /* ======================================================================
   * DECK_readTemplate - what layouts exist, and where their slots sit
   * ----------------------------------------------------------------------
   * The page draws its previews from this. Returning real geometry in points
   * means the in-page preview is a faithful mock of the generated slide, and
   * it follows the template when someone moves a box.
   * ==================================================================== */
  function readTemplate(templateId) {
    var id = templateId || templateId_();
    if (!id || id.indexOf('PUT_') === 0) {
      fail_('No template set. Put the Google Slides file ID in ' +
        'DECK_CONFIG.TEMPLATE_ID (see the header of Deck_Backend.gs).');
    }

    var pres;
    try { pres = SlidesApp.openById(id); }
    catch (e) {
      fail_('Cannot open the template (' + id + '). Check the ID, and that it ' +
        'is a Google Slides file rather than an unconverted .pptx.');
    }

    var pw = pres.getPageWidth(), ph = pres.getPageHeight();
    var slides = pres.getSlides();
    var layouts = [];

    for (var i = 0; i < slides.length; i++) {
      var lid = layoutIdOf_(slides[i]);
      if (!lid) continue;                       // not a tagged layout
      if (isDocLayout_(lid)) continue;          // the README

      var slots = {}, order = [];
      var TOK = DECK_CONFIG.TOKENS;
      for (var k in TOK) {
        if (!TOK.hasOwnProperty(k)) continue;
        var sh = findTokenShape_(slides[i], TOK[k]);
        if (!sh) continue;
        var r = rectOf_(sh);
        if (k === 'image' || k === 'image2') {
          /* Tell the page how big to capture, so nobody has to guess. */
          r.capturePx = Math.min(DECK_CONFIG.CAPTURE_MAX_PX,
            Math.round(r.w * DECK_CONFIG.CAPTURE_PX_PER_PT));
        }
        slots[k] = r;
        order.push(k);
      }

      layouts.push({
        layoutId: lid,
        index: i,
        /* 'cover' is filled in place by create(); only 'report' layouts can be
           duplicated by addSlide, so only they belong in a recipe. */
        role: isCoverLayout_(lid) ? 'cover' : 'report',
        slots: slots,
        has: {
          title: !!slots.title, comment: !!slots.comment,
          image: !!slots.image, image2: !!slots.image2,
          label1: !!slots.label1, label2: !!slots.label2
        },
        tokens: order
      });
    }

    if (!layouts.length) {
      fail_('The template has no layout slides. Every layout slide needs ' +
        '"LAYOUT: <id>" in its speaker notes.');
    }

    var reportCount = 0;
    for (var r = 0; r < layouts.length; r++) {
      if (layouts[r].role === 'report') reportCount++;
    }
    if (!reportCount) {
      fail_('The template has a cover but no report layouts, so there is ' +
        'nothing for a recipe row to point at. Add at least one slide with ' +
        '"LAYOUT: <id>" in its speaker notes and an ' +
        DECK_CONFIG.TOKENS.image + ' box on it.');
    }

    return {
      templateId: id,
      name: pres.getName(),
      pageWidth: pw, pageHeight: ph,      // points; 720 x 405 for 16:9
      layouts: layouts,
      reportCount: reportCount,
      slideCount: slides.length
    };
  }


  /* ======================================================================
   * DECK_create - copy the template, fill the cover, park it in the folder
   * ----------------------------------------------------------------------
   * The layout slides are deliberately LEFT IN at this stage; addSlide needs
   * them to duplicate from. DECK_finish removes them at the end.
   * ==================================================================== */
  function create(opts) {
    opts = opts || {};
    var tid = opts.templateId || templateId_();
    var fid = opts.folderId || folderId_();
    if (!fid || fid.indexOf('PUT_') === 0) {
      fail_('No deck folder set. Put the Drive folder ID in ' +
        'DECK_CONFIG.FOLDER_ID (see the header of Deck_Backend.gs).');
    }

    /* Check folder access BEFORE copying, so a permissions problem does not
       leave a stray half-built deck in someone's My Drive. */
    var folder;
    try { folder = DriveApp.getFolderById(fid); folder.getName(); }
    catch (e) {
      fail_('You do not have access to the deck folder (' + fid + '). Ask for ' +
        'Editor access, then try again.');
    }

    var name = opts.name || ('Amrize Commercial Deck - ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM yyyy'));

    var copy;
    try { copy = DriveApp.getFileById(tid).makeCopy(name); }
    catch (e) { fail_('Could not copy the template: ' + e.message); }

    try { copy.moveTo(folder); }
    catch (e) {
      fail_('The deck was created but could not be moved into the deck ' +
        'folder - Editor access is needed on that folder. It is in your My ' +
        'Drive as "' + name + '".');
    }

    var deckId = copy.getId();
    var pres = SlidesApp.openById(deckId);
    var slides = pres.getSlides();

    /* Fill the cover in place; it is a layout like any other, so it is tagged
       SLIDE: __cover__ to survive the cleanup in finish(). */
    for (var i = 0; i < slides.length; i++) {
      if (layoutIdOf_(slides[i]) !== 'L_COVER') continue;
      setToken_(slides[i], DECK_CONFIG.TOKENS.deckTitle, opts.deckTitle || name);
      setToken_(slides[i], DECK_CONFIG.TOKENS.deckSub, opts.deckSub || '');
      setNotes_(slides[i], DECK_CONFIG.SLIDE_TAG + ' __cover__');
      break;
    }
    pres.saveAndClose();

    return {
      deckId: deckId,
      url: 'https://docs.google.com/presentation/d/' + deckId + '/edit',
      name: name
    };
  }


  /* ======================================================================
   * DECK_addSlide - ONE report slide
   * ----------------------------------------------------------------------
   * spec: { recipeId, layoutId, title, comment, label1, label2,
   *         png, imgW, imgH, png2, img2W, img2H }
   * ==================================================================== */
  function addSlide(deckId, spec) {
    spec = spec || {};
    if (!deckId) fail_('addSlide called without a deckId.');
    if (!spec.layoutId) fail_('addSlide called without a layoutId.');

    var pres = SlidesApp.openById(deckId);
    var slides = pres.getSlides();

    /* Find the layout to duplicate. Only ever match a LAYOUT: slide - never a
       SLIDE: one, or the second Fuel Recovery slide would clone the first. */
    var src = null;
    for (var i = 0; i < slides.length; i++) {
      if (layoutIdOf_(slides[i]) === spec.layoutId) { src = slides[i]; break; }
    }
    if (!src) {
      pres.saveAndClose();
      fail_('Layout "' + spec.layoutId + '" is not in this deck. Check the ' +
        'LAYOUT: line in the template\'s speaker notes.');
    }

    var slide = src.duplicate();
    slide.move(pres.getSlides().length - 1);      // duplicate lands next to src

    /* Claim it immediately: if a later step throws, finish() will not mistake
       this half-built slide for a layout and the page can retry by id. */
    setNotes_(slide, DECK_CONFIG.SLIDE_TAG + ' ' + (spec.recipeId || 'unnamed'));

    var T = DECK_CONFIG.TOKENS;
    setToken_(slide, T.title, spec.title || '');
    setToken_(slide, T.comment, spec.comment || '');   // '' = blank but styled
    setToken_(slide, T.label1, spec.label1 || '');
    setToken_(slide, T.label2, spec.label2 || '');
    setToken_(slide, T.deckSub, spec.subtitle || '');  // section dividers use it
    /* {{PAGE}} is left alone here - it is stamped in finish(), when the final
       slide order is actually known. */

    placeImage_(slide, T.image, spec.png, spec.imgW, spec.imgH, spec.recipeId);
    placeImage_(slide, T.image2, spec.png2, spec.img2W, spec.img2H, spec.recipeId);

    /* Blank every token the recipe did not fill, so a literal "{{TOKEN}}" can
       never reach the finished deck. This is not hypothetical: L_SECTION
       carries {{DECK_SUB}}, and create() only fills that on the cover - so a
       divider slide used to ship the raw token text to the meeting.
       {{PAGE}} is the one exception; finish() stamps it once the order is
       final. The image tokens are already gone - placeImage_ removes the
       shape whether or not a picture was supplied. */
    for (var t in T) {
      if (!T.hasOwnProperty(t) || t === 'page') continue;
      setToken_(slide, T[t], '');
    }

    /* Read the index BEFORE closing. A Presentation cannot be touched after
       saveAndClose() - getSlides() on a closed presentation throws, which used
       to turn every successful slide into a failed one. */
    var slideIndex = pres.getSlides().length - 1;
    pres.saveAndClose();

    return {
      recipeId: spec.recipeId || '',
      layoutId: spec.layoutId,
      slideIndex: slideIndex
    };
  }

  /* Read the slot, delete it, drop the fitted picture in its place. A slot
     with no picture supplied is emptied rather than left showing a dashed
     placeholder box in the finished deck. */
  function placeImage_(slide, token, b64, w, h, name) {
    var shape = findTokenShape_(slide, token);
    if (!shape) return;                      // layout has no such slot

    if (!b64) { shape.remove(); return; }

    var box = rectOf_(shape);
    shape.remove();

    var img = slide.insertImage(pngBlob_(b64, name));
    var r = fitRect_(box, w || img.getWidth(), h || img.getHeight());
    img.setLeft(r.x).setTop(r.y).setWidth(r.w).setHeight(r.h);
    return img;
  }


  /* ======================================================================
   * DECK_finish - drop everything that is not a built slide, number the pages
   * ==================================================================== */
  function finish(deckId) {
    if (!deckId) fail_('finish called without a deckId.');
    var pres = SlidesApp.openById(deckId);

    /* Keep ONLY slides this builder made - every one of them carries
       "SLIDE: <id>". Deleting by the absence of that tag rather than by the
       presence of "LAYOUT:" also sweeps out any untagged slide someone left in
       the template, which would otherwise survive into every deck.
       Backwards, so removing one does not shift the next index to check. */
    var slides = pres.getSlides();
    var removed = 0;
    for (var i = slides.length - 1; i >= 0; i--) {
      if (!recipeIdOf_(slides[i])) { slides[i].remove(); removed++; }
    }

    /* Now the order is final, so {{PAGE}} can mean something. */
    slides = pres.getSlides();
    for (var j = 0; j < slides.length; j++) {
      setToken_(slides[j], DECK_CONFIG.TOKENS.page, String(j + 1));
    }
    pres.saveAndClose();

    return {
      deckId: deckId,
      url: 'https://docs.google.com/presentation/d/' + deckId + '/edit',
      slides: slides.length,
      templateSlidesRemoved: removed
    };
  }


  /* ======================================================================
   * DECK_status - what already landed (drives resume + retry)
   * ==================================================================== */
  function status(deckId) {
    if (!deckId) fail_('status called without a deckId.');
    var pres = SlidesApp.openById(deckId);
    var slides = pres.getSlides();
    var built = [], layouts = [];
    for (var i = 0; i < slides.length; i++) {
      var lid = layoutIdOf_(slides[i]);
      if (lid) { layouts.push(lid); continue; }
      var rid = recipeIdOf_(slides[i]);
      if (rid && rid !== '__cover__') built.push({ recipeId: rid, index: i });
    }
    return {
      deckId: deckId,
      url: 'https://docs.google.com/presentation/d/' + deckId + '/edit',
      built: built,
      layoutsRemaining: layouts,
      total: slides.length
    };
  }

  /* ======================================================================
   * DECK_validateTemplate - check a template BEFORE building 43 slides on it
   * ----------------------------------------------------------------------
   * Anyone can edit the template, and every edit is a chance to break the two
   * things the builder relies on: a unique LAYOUT id per slide, and a token
   * living in exactly one shape. Both fail in ways that are baffling after the
   * fact - a layout silently never used, or a picture landing in the wrong
   * box. Naming them here turns a mystery into a sentence.
   * ==================================================================== */
  function validateTemplate(templateId) {
    var id = templateId || templateId_();
    var pres;
    try { pres = SlidesApp.openById(id); }
    catch (e) {
      return {
        ok: false, templateId: id, layouts: [],
        errors: ['Cannot open the template (' + id + '). Check the ID, and ' +
          'that it is a Google Slides file rather than an unconverted .pptx.'],
        warnings: []
      };
    }

    var slides = pres.getSlides();
    var errors = [], warnings = [], layouts = [], seen = {};
    var TOK = DECK_CONFIG.TOKENS;

    for (var i = 0; i < slides.length; i++) {
      var at = 'slide ' + (i + 1);
      var lid = layoutIdOf_(slides[i]);

      if (!lid) {
        warnings.push(at + ' has no "LAYOUT: <id>" in its speaker notes. It is ' +
          'ignored, and it is removed from every generated deck.');
        continue;
      }
      if (seen[lid]) {
        errors.push('Layout id "' + lid + '" is on slide ' + seen[lid] + ' AND ' +
          at + '. Ids must be unique - the builder uses the first and the ' +
          'other is never reached.');
      } else {
        seen[lid] = i + 1;
      }
      if (isDocLayout_(lid)) continue;

      var tokens = [];
      for (var k in TOK) {
        if (!TOK.hasOwnProperty(k)) continue;
        var n = countTokenShapes_(slides[i], TOK[k]);
        if (!n) continue;
        tokens.push(k);
        if (n > 1) {
          errors.push(TOK[k] + ' appears in ' + n + ' shapes on ' + at +
            ' (' + lid + '). It must be in exactly one, or the builder cannot ' +
            'tell which box the picture belongs in.');
        }
      }

      /* The cover is judged against a different checklist: it is filled in
         place by create(), never duplicated, so {{TITLE}} and {{PAGE}} are not
         things it is missing - they are things it should not have. */
      if (isCoverLayout_(lid)) {
        if (tokens.indexOf('deckTitle') === -1) {
          warnings.push(lid + ' (' + at + ') has no ' + TOK.deckTitle +
            ', so the deck name will not appear on the cover.');
        }
        if (tokens.indexOf('image') !== -1) {
          warnings.push(lid + ' (' + at + ') has an ' + TOK.image + ' box. ' +
            'The cover is never given a picture, so that box is deleted and ' +
            'leaves a gap. Remove it from the template.');
        }
      } else {
        if (tokens.indexOf('title') === -1) {
          warnings.push(lid + ' (' + at + ') has no ' + TOK.title +
            ', so its slides will have no heading.');
        }
        if (tokens.indexOf('image2') !== -1 && tokens.indexOf('image') === -1) {
          warnings.push(lid + ' (' + at + ') has ' + TOK.image2 + ' but no ' +
            TOK.image + '. Fill the first slot before adding a second.');
        }
        if (tokens.indexOf('page') === -1) {
          warnings.push(lid + ' (' + at + ') has no ' + TOK.page +
            ', so its slides will not be numbered.');
        }
      }

      layouts.push({
        layoutId: lid, slide: i + 1, tokens: tokens,
        role: isCoverLayout_(lid) ? 'cover' : 'report'
      });
    }

    if (!layouts.length) {
      errors.push('No usable layouts. Every layout slide needs ' +
        '"LAYOUT: <id>" in its speaker notes.');
    }

    var report = {
      ok: errors.length === 0, templateId: id, name: pres.getName(),
      pageWidth: pres.getPageWidth(), pageHeight: pres.getPageHeight(),
      layouts: layouts, errors: errors, warnings: warnings
    };

    Logger.log('Template "%s"  %s x %s pt', report.name,
      report.pageWidth, report.pageHeight);
    for (var a = 0; a < layouts.length; a++) {
      Logger.log('  %s  (slide %s)  tokens: %s', layouts[a].layoutId,
        layouts[a].slide, layouts[a].tokens.join(', ') || 'none');
    }
    for (var b = 0; b < errors.length; b++) Logger.log('  ERROR   %s', errors[b]);
    for (var c = 0; c < warnings.length; c++) Logger.log('  warning %s', warnings[c]);
    Logger.log(report.ok ? 'Template is usable.' : 'Template has errors - fix before building.');

    return report;
  }

  return {
    readTemplate: readTemplate, validateTemplate: validateTemplate,
    create: create, addSlide: addSlide, finish: finish, status: status
  };
})();


/*****************************************************************************
 * Thin globals - google.script.run can only reach top-level functions.
 * Same wrapper pattern as PV_Backend.gs / RMX_Backend.gs.
 *****************************************************************************/
function DECK_readTemplate(templateId) { return DECK.readTemplate(templateId); }
function DECK_validateTemplate(templateId) { return DECK.validateTemplate(templateId); }
function DECK_create(opts) { return DECK.create(opts); }
function DECK_addSlide(deckId, spec) { return DECK.addSlide(deckId, spec); }
function DECK_finish(deckId) { return DECK.finish(deckId); }
function DECK_status(deckId) { return DECK.status(deckId); }


/*****************************************************************************
 * DECK_smokeTest - run this from the Apps Script editor, before any UI exists.
 * ---------------------------------------------------------------------------
 * Builds a 3-slide deck using a 4x4 solid-blue PNG stretched to the aspect
 * ratio a real capture would have. The point is not the picture - it is WHERE
 * the picture lands. A solid rectangle makes the fitted box unmistakable:
 *
 *   slide 1  wide + short (a Fuel Recovery table)   -> letterboxed, centred
 *   slide 2  tall (a stacked customer table)        -> pillarboxed, centred
 *   slide 3  comment layout, no picture at all      -> slot removed cleanly
 *
 * Check in the generated deck: the title is REAL TEXT you can click and edit,
 * the comment box is empty and typeable, the blue rectangle never crosses the
 * title or the comment panel, and the README and layout slides are gone.
 *****************************************************************************/
function DECK_smokeTest() {
  var PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mPg' +
    '978GRwzEcQDoUxNBpn0QXgAAAABJRU5ErkJggg==';

  var tpl = DECK.readTemplate();
  Logger.log('Template "%s"  %s x %s pt', tpl.name, tpl.pageWidth, tpl.pageHeight);
  for (var i = 0; i < tpl.layouts.length; i++) {
    var L = tpl.layouts[i];
    var im = L.slots.image;
    Logger.log('  %s  slots=[%s]%s', L.layoutId, L.tokens.join(', '),
      im ? ('  image ' + Math.round(im.w) + 'x' + Math.round(im.h) +
        'pt  capture at ' + im.capturePx + 'px wide') : '');
  }

  var deck = DECK.create({
    name: 'DECK SMOKE TEST - ' + new Date().toISOString().slice(0, 16),
    deckTitle: 'Smoke test',
    deckSub: 'Geometry check - safe to delete'
  });
  Logger.log('Created %s', deck.url);

  DECK.addSlide(deck.deckId, {
    recipeId: 'smoke_wide', layoutId: 'L_FULL_IMAGE',
    title: 'Wide + short - should letterbox, centred',
    png: PNG, imgW: 1900, imgH: 620
  });

  DECK.addSlide(deck.deckId, {
    recipeId: 'smoke_tall', layoutId: 'L_FULL_IMAGE',
    title: 'Tall - should pillarbox, centred',
    png: PNG, imgW: 700, imgH: 1400
  });

  DECK.addSlide(deck.deckId, {
    recipeId: 'smoke_nocomment', layoutId: 'L_COMMENT_IMAGE',
    title: 'Comment layout, no picture supplied',
    comment: ''
  });

  var out = DECK.finish(deck.deckId);
  Logger.log('Finished: %s slides, %s template slides removed',
    out.slides, out.templateSlidesRemoved);
  Logger.log('OPEN THIS: %s', out.url);
  return out;
}
