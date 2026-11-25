/**
 * [2026-11-25] 자소서 첨삭 표시(색·메모) 기능 — C비서
 * - 학생 글(personal_statements)은 읽기만 하고 절대 수정하지 않음. 첨삭은 별도 표 ps_annotations 에 저장
 * - 선생님(교사·관리자): [첨삭 보기]에서 문장을 드래그 → 색(빨강·초록·파랑) + 메모 저장, 수정·삭제
 * - 학생: [첨삭 보기]와 [첨삭 메모] 탭을 보기만 함
 * - 위치는 "선택한 문장 + 그 문장이 몇 번째로 나오는지"로 기억 → 학생이 문장을 고치면 '원문 수정됨'으로 표시
 */
(function () {
  'use strict';
  var TABLE = 'ps_annotations';
  var SEP = '[상세분할]';
  var COLORS = {
    red: { name: '빨강', label: '고칠 곳', bg: 'rgba(239, 68, 68, 0.32)', line: '#ef4444' },
    green: { name: '초록', label: '좋은 곳', bg: 'rgba(34, 197, 94, 0.30)', line: '#22c55e' },
    blue: { name: '파랑', label: '보충할 곳', bg: 'rgba(59, 130, 246, 0.32)', line: '#3b82f6' }
  };
  var state = { mode: 'edit', all: [], loadedFor: null, savedDisplay: null, lastText: null, pending: null, editingId: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isStaff() { return (typeof CURRENT_ROLE !== 'undefined') && (CURRENT_ROLE === '관리자' || CURRENT_ROLE === '교사'); }
  function studentLink() { return (typeof ACTIVE_PS_STUDENT !== 'undefined' && ACTIVE_PS_STUDENT) ? String(ACTIVE_PS_STUDENT) : ''; }
  function nq(q) { return window.normalizeQNum ? window.normalizeQNum(q) : String(q || '').replace(/^문항\s*/, '').replace(/\s+/g, '').trim(); }

  // 현재 문항(학교 꼬리표 + 문항번호)
  function currentKey() {
    var sel = $('ps-question-selector'); var nameEl = $('ps-school-name');
    if (!sel) return null;
    var v = sel.value || '';
    var ui = nameEl ? nameEl.textContent.replace('지원 학교: ', '') : '';
    var parts = v.indexOf('|') >= 0 ? v.split('|') : [ui, v];
    var school = String(parts[0] || '').trim(), q = String(parts[1] || '').trim();
    var h = window.PS_CURRENT_HISTORY;
    if (h && h.current) {
      var c = h.current.find(function (x) {
        var cv = String(x.version_label || '').trim();
        return nq(x.qNum) === nq(q) && (cv === school || (!cv && school === String(ui).trim()));
      });
      if (c) return { label: String(c.version_label || '').trim() || school, q: String(c.qNum) };
    }
    return { label: school, q: q };
  }
  function currentText() {
    try { return window.getCurrentPsText ? window.getCurrentPsText(false) : ($('ps-content-textarea') ? $('ps-content-textarea').value : ''); }
    catch (e) { return $('ps-content-textarea') ? $('ps-content-textarea').value : ''; }
  }
  function nthIndex(text, quote, n) {
    var i = -1;
    for (var k = 0; k <= n; k++) { i = text.indexOf(quote, i + 1); if (i < 0) return -1; }
    return i;
  }
  function occurrenceBefore(text, quote, start) {
    var n = 0, i = text.indexOf(quote);
    while (i >= 0 && i < start) { n++; i = text.indexOf(quote, i + 1); }
    return n;
  }
  function itemsForCurrent() {
    var k = currentKey(); if (!k) return [];
    return state.all.filter(function (a) { return nq(a.question_no) === nq(k.q) && String(a.version_label || '').trim() === k.label; });
  }

  // 위치 계산: 화면에 칠할 위치 + 번호 (앞에서부터 1,2,3…, 원문이 바뀐 것은 뒤로)
  function layout(text) {
    var items = itemsForCurrent().map(function (a) {
      var s = nthIndex(text, a.quote, a.occurrence || 0);
      return { a: a, s: s, e: s >= 0 ? s + a.quote.length : -1 };
    });
    var found = items.filter(function (x) { return x.s >= 0; }).sort(function (x, y) { return x.s - y.s || y.e - x.e; });
    var lost = items.filter(function (x) { return x.s < 0; }).sort(function (x, y) { return String(x.a.created_at).localeCompare(String(y.a.created_at)); });
    var shown = [], end = -1;
    found.forEach(function (x) { x.overlap = x.s < end; if (!x.overlap) { shown.push(x); end = x.e; } });
    var ordered = found.concat(lost);
    ordered.forEach(function (x, i) { x.no = i + 1; });
    return { shown: shown, ordered: ordered };
  }

  // ---------- 화면 만들기 ----------
  function injectUi() {
    if ($('ps-annot-view')) return true;
    var area = $('ps-content-textarea'); var wrap = area ? area.parentNode : null;
    var counter = $('ps-main-char-counter-wrap');
    var tabBar = document.querySelector('#ps-feedback-pane .tab-navbar');
    var aiContent = $('tab-content-ai');
    if (!area || !wrap || !counter || !tabBar || !aiContent) return false;

    var st = document.createElement('style');
    st.textContent =
      '.annot-mode-btns{display:flex;gap:6px;margin-right:auto;align-items:center}' +
      '.annot-mode-btn{background:transparent;border:1px solid var(--border-color);color:var(--text-muted);padding:3px 10px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600}' +
      '.annot-mode-btn.active{background:rgba(250,204,21,.15);color:#fde68a;border-color:#facc15}' +
      '#ps-annot-view{display:none;flex:1;min-height:0;overflow-y:auto;white-space:pre-wrap;word-break:break-all;line-height:1.8;font-size:15px;padding:12px 14px;border:1px solid #facc15;border-radius:6px;background:rgba(0,0,0,.25);color:var(--text-main);position:relative}' +
      '#ps-annot-view mark.annot-mark{color:inherit;border-radius:3px;padding:1px 0;border-bottom:2px solid;cursor:pointer}' +
      '#ps-annot-view mark.annot-flash{outline:2px solid #fde68a}' +
      '#ps-annot-view sup.annot-no{user-select:none;-webkit-user-select:none;font-size:11px;font-weight:700;margin-left:1px;padding:0 4px;border-radius:8px;color:#0f172a}' +
      '#ps-annot-view .annot-sep{display:block;user-select:none;-webkit-user-select:none;text-align:center;color:#64748b;font-size:12px;margin:8px 0}' +
      '#ps-annot-view .annot-sep::before{content:"──── 다음 칸 ────"}' +
      '#ps-annot-view .annot-hint{display:block;user-select:none;-webkit-user-select:none;font-size:12px;color:#fde68a;margin-bottom:8px}' +
      '#ps-annot-toolbar{position:absolute;z-index:50;display:none;background:#0f172a;border:1px solid #facc15;border-radius:8px;padding:8px;box-shadow:0 6px 18px rgba(0,0,0,.5);width:300px;white-space:normal}' +
      '#ps-annot-toolbar .annot-colors{display:flex;gap:6px;margin-bottom:6px}' +
      '#ps-annot-toolbar .annot-color{flex:1;border:2px solid transparent;border-radius:6px;padding:4px 0;font-size:13px;cursor:pointer;color:#fff;font-weight:600}' +
      '#ps-annot-toolbar .annot-color.sel{border-color:#fff}' +
      '#ps-annot-toolbar textarea{width:100%;box-sizing:border-box;height:56px;resize:vertical;font-size:13px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:#1e293b;color:var(--text-main)}' +
      '#ps-annot-toolbar .annot-tb-btns{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}' +
      '#ps-annot-toolbar button.annot-tb{border:none;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer;font-weight:600}' +
      '#tab-content-annot .annot-item{border:1px solid var(--border-color);border-left-width:4px;border-radius:6px;padding:8px 10px;margin-bottom:8px;background:rgba(15,23,42,.35);cursor:pointer}' +
      '#tab-content-annot .annot-item .annot-q{font-size:12px;color:#94a3b8;margin:2px 0 4px 0;word-break:break-all}' +
      '#tab-content-annot .annot-item .annot-memo{font-size:14px;color:var(--text-main);white-space:pre-wrap;word-break:break-all}' +
      '#tab-content-annot .annot-tag{display:inline-block;font-size:11px;padding:0 6px;border-radius:8px;margin-left:6px;background:#475569;color:#fff}' +
      '#tab-content-annot .annot-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:6px}' +
      '#tab-content-annot .annot-actions button{border:1px solid var(--border-color);background:transparent;color:var(--text-muted);border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer}' +
      '#tab-content-annot .annot-empty{font-size:14px;color:var(--text-muted);padding:10px 2px;line-height:1.6}';
    document.head.appendChild(st);

    // 본문 위: [작성] [첨삭 보기] 전환 버튼 (글자수 표시 줄 왼쪽)
    var btns = document.createElement('div');
    btns.className = 'annot-mode-btns';
    btns.innerHTML = '<button type="button" class="annot-mode-btn active" id="btn-annot-mode-edit">✏️ 작성</button>' +
      '<button type="button" class="annot-mode-btn" id="btn-annot-mode-view">🖍 첨삭 보기</button>';
    var counterRow = counter.parentNode;
    counterRow.style.justifyContent = 'space-between';
    counterRow.style.alignItems = 'center';
    counterRow.insertBefore(btns, counter);

    // 첨삭 보기 화면 (입력칸 자리)
    var view = document.createElement('div');
    view.id = 'ps-annot-view';
    wrap.insertBefore(view, area.nextSibling);
    var tb = document.createElement('div');
    tb.id = 'ps-annot-toolbar';
    wrap.style.position = 'relative';
    wrap.appendChild(tb);

    // 오른쪽 탭: 첨삭 메모
    var tab = document.createElement('div');
    tab.className = 'tab-nav-item'; tab.id = 'tab-btn-annot'; tab.textContent = '🖍 첨삭 메모';
    var aiBtn = $('tab-btn-ai-feedback');
    tabBar.insertBefore(tab, aiBtn || null);
    var pane = document.createElement('div');
    pane.className = 'tab-pane-content'; pane.id = 'tab-content-annot'; pane.style.cssText = 'flex: 1; overflow-y: auto;';
    pane.innerHTML = '<div class="ps-control-bar"><span class="desc-text" style="font-size: 14px; color: var(--text-muted);">본문의 번호와 같은 번호의 첨삭 메모입니다.</span></div><div id="annot-list" style="margin-top:10px;"></div>';
    aiContent.parentNode.insertBefore(pane, aiContent);

    $('btn-annot-mode-edit').addEventListener('click', function () { setMode('edit'); });
    $('btn-annot-mode-view').addEventListener('click', function () { setMode('view'); });
    tab.addEventListener('click', showAnnotTab);
    ['tab-btn-manual-feedback', 'tab-btn-ai-feedback'].forEach(function (id) {
      var b = $(id); if (b) b.addEventListener('click', function () { hideAnnotTab(); });
    });
    view.addEventListener('mouseup', onSelect);
    view.addEventListener('click', function (e) {
      var m = e.target.closest ? e.target.closest('mark.annot-mark') : null;
      if (m) { showAnnotTab(); focusItem(m.getAttribute('data-id'), false); }
    });
    document.addEventListener('mousedown', function (e) {
      var t = $('ps-annot-toolbar');
      if (t && t.style.display === 'block' && !t.contains(e.target) && !$('ps-annot-view').contains(e.target)) hideToolbar();
    });
    var qs = $('ps-question-selector'); if (qs) qs.addEventListener('change', function () { setTimeout(refreshAfterBind, 80); });
    var hs = $('ps-history-selector'); if (hs) hs.addEventListener('change', function () { setTimeout(refreshAfterBind, 80); });
    var modal = $('modal-ps-editor');
    if (modal && window.MutationObserver) {
      var wasOpen = modal.classList.contains('open');
      new MutationObserver(function () {
        var open = modal.classList.contains('open');
        if (open && !wasOpen) onModalOpen();
        if (!open && wasOpen) onModalClose();
        wasOpen = open;
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
    // 첨삭 보기 중 글이 바뀌면(이력 선택 등) 다시 그림
    setInterval(function () { if (state.mode === 'view' && $('modal-ps-editor') && $('modal-ps-editor').classList.contains('open')) { var t = currentText(); if (t !== state.lastText) renderView(); } }, 800);
    return true;
  }

  function showAnnotTab() {
    ['tab-btn-manual-feedback', 'tab-btn-ai-feedback'].forEach(function (id) { var b = $(id); if (b) b.classList.remove('active'); });
    ['tab-content-manual', 'tab-content-ai'].forEach(function (id) { var c = $(id); if (c) c.classList.remove('active'); });
    $('tab-btn-annot').classList.add('active'); $('tab-content-annot').classList.add('active');
    renderList();
  }
  function hideAnnotTab() {
    var b = $('tab-btn-annot'), c = $('tab-content-annot');
    if (b) b.classList.remove('active'); if (c) c.classList.remove('active');
  }

  function setMode(mode) {
    var area = $('ps-content-textarea'), dyn = $('ps-dynamic-details-container'), view = $('ps-annot-view');
    if (!area || !view) return;
    if (mode === 'view') {
      if (state.mode !== 'view') state.savedDisplay = { area: area.style.display, dyn: dyn ? dyn.style.display : null };
      state.mode = 'view';
      area.style.display = 'none'; if (dyn) dyn.style.display = 'none';
      view.style.display = 'block';
      renderView();
    } else {
      state.mode = 'edit';
      hideToolbar();
      view.style.display = 'none';
      if (state.savedDisplay) {
        area.style.display = state.savedDisplay.area; if (dyn && state.savedDisplay.dyn !== null) dyn.style.display = state.savedDisplay.dyn;
      }
      state.savedDisplay = null;
    }
    $('btn-annot-mode-edit').classList.toggle('active', state.mode === 'edit');
    $('btn-annot-mode-view').classList.toggle('active', state.mode === 'view');
  }

  // 문항을 바꾸면 기존 화면 코드가 입력칸 표시를 다시 정하므로, 첨삭 보기 중이면 다시 숨김
  function refreshAfterBind() {
    if (state.mode === 'view') {
      var area = $('ps-content-textarea'), dyn = $('ps-dynamic-details-container');
      state.savedDisplay = { area: area.style.display === 'none' ? '' : area.style.display, dyn: dyn ? dyn.style.display : null };
      if (dyn && dyn.style.display === 'none') state.savedDisplay.dyn = 'none';
      area.style.display = 'none'; if (dyn) dyn.style.display = 'none';
      renderView();
    }
    renderList(); updateTabCount();
  }

  function renderView() {
    var view = $('ps-annot-view'); if (!view) return;
    hideToolbar();
    var text = currentText() || ''; state.lastText = text;
    var L = layout(text);
    var html = '<span class="annot-hint" data-skip="1">' + (isStaff() ? '🖍 문장을 드래그하면 색과 메모를 달 수 있습니다. (이 화면에서는 글을 고칠 수 없습니다)' : '🖍 선생님 첨삭 표시입니다. 글을 고치려면 [✏️ 작성]을 누르세요.') + '</span>';
    var pos = 0;
    function plain(s, base) {
      // [상세분할] 구분자는 화면에서만 구분선으로 보여 줌 (원문 위치 계산은 그대로 유지)
      var out = '', i = 0;
      while (true) {
        var j = s.indexOf(SEP, i);
        if (j < 0) { out += '<span data-s="' + (base + i) + '">' + esc(s.slice(i)) + '</span>'; break; }
        out += '<span data-s="' + (base + i) + '">' + esc(s.slice(i, j)) + '</span><span class="annot-sep" data-raw="' + SEP.length + '" data-s="' + (base + j) + '"></span>';
        i = j + SEP.length;
      }
      return out;
    }
    L.shown.forEach(function (x) {
      var c = COLORS[x.a.color] || COLORS.red;
      html += plain(text.slice(pos, x.s), pos);
      html += '<mark class="annot-mark" data-id="' + esc(x.a.id) + '" style="background:' + c.bg + ';border-bottom-color:' + c.line + '">' + plain(text.slice(x.s, x.e), x.s) + '</mark>' +
        '<sup class="annot-no" data-skip="1" style="background:' + c.line + '">' + x.no + '</sup>';
      pos = x.e;
    });
    html += plain(text.slice(pos), pos);
    if (!text.trim()) html += '<span data-skip="1" style="color:var(--text-muted)">(작성된 글이 없습니다)</span>';
    view.innerHTML = html;
    updateTabCount();
  }

  // 화면에서 드래그한 위치 → 원문 글자 위치
  function rawOffset(node, offset) {
    var el = node.nodeType === 3 ? node.parentNode : node;
    if (node.nodeType !== 3) {
      // 요소 경계: 자식 기준으로 앞/뒤 텍스트 찾기
      var child = node.childNodes[offset];
      if (child) { var r = firstRaw(child); if (r !== null) return r; }
      var prev = offset > 0 ? node.childNodes[offset - 1] : null;
      if (prev) { var p = lastRaw(prev); if (p !== null) return p; }
      return null;
    }
    var span = el.closest ? el.closest('[data-s]') : null;
    if (!span || span.hasAttribute('data-raw')) return null;
    return parseInt(span.getAttribute('data-s'), 10) + offset;
  }
  function firstRaw(n) {
    if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-skip')) return null;
    if (n.nodeType === 1 && n.hasAttribute('data-s')) return parseInt(n.getAttribute('data-s'), 10);
    for (var i = 0; i < (n.childNodes || []).length; i++) { var r = firstRaw(n.childNodes[i]); if (r !== null) return r; }
    return null;
  }
  function lastRaw(n) {
    if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-skip')) return null;
    if (n.nodeType === 1 && n.hasAttribute('data-raw')) return parseInt(n.getAttribute('data-s'), 10) + parseInt(n.getAttribute('data-raw'), 10);
    if (n.nodeType === 1 && n.hasAttribute('data-s') && !n.querySelector('[data-s]')) return parseInt(n.getAttribute('data-s'), 10) + n.textContent.length;
    for (var i = (n.childNodes || []).length - 1; i >= 0; i--) { var r = lastRaw(n.childNodes[i]); if (r !== null) return r; }
    return null;
  }

  function onSelect() {
    if (!isStaff() || state.mode !== 'view') return;
    setTimeout(function () {
      var sel = window.getSelection(); var view = $('ps-annot-view');
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      var rg = sel.getRangeAt(0);
      if (!view.contains(rg.startContainer) || !view.contains(rg.endContainer)) return;
      var s = rawOffset(rg.startContainer, rg.startOffset), e = rawOffset(rg.endContainer, rg.endOffset);
      if (s === null || e === null || e <= s) return;
      var text = state.lastText || '';
      while (s < e && /\s/.test(text.charAt(s))) s++;
      while (e > s && /\s/.test(text.charAt(e - 1))) e--;
      var quote = text.slice(s, e);
      if (!quote || quote.indexOf(SEP) >= 0) { if (quote.indexOf(SEP) >= 0) alert('칸 구분선을 넘어서 선택할 수 없습니다. 한 칸 안에서 선택해 주세요.'); return; }
      if (quote.length > 2000) { alert('한 번에 2,000자까지 선택할 수 있습니다.'); return; }
      state.pending = { quote: quote, occurrence: occurrenceBefore(text, quote, s), color: 'red' };
      state.editingId = null;
      var vr = view.getBoundingClientRect(), r = rg.getBoundingClientRect(), wr = view.parentNode.getBoundingClientRect();
      openToolbar(r.left - wr.left, r.bottom - wr.top + view.parentNode.scrollTop + 6, '', 'red', '새 첨삭 · "' + (quote.length > 24 ? quote.slice(0, 24) + '…' : quote) + '"');
    }, 0);
  }

  function openToolbar(x, y, memo, color, title) {
    var tb = $('ps-annot-toolbar'); var wrap = tb.parentNode;
    var maxX = Math.max(0, wrap.clientWidth - 310);
    tb.style.left = Math.max(0, Math.min(x, maxX)) + 'px'; tb.style.top = Math.max(0, y) + 'px';
    tb.innerHTML = '<div style="font-size:12px;color:#fde68a;margin-bottom:6px;word-break:break-all">' + esc(title) + '</div>' +
      '<div class="annot-colors">' + Object.keys(COLORS).map(function (k) {
        return '<button type="button" class="annot-color' + (k === color ? ' sel' : '') + '" data-color="' + k + '" style="background:' + COLORS[k].line + '">' + COLORS[k].name + '</button>';
      }).join('') + '</div>' +
      '<textarea id="annot-memo-input" placeholder="메모 (비워도 됩니다)">' + esc(memo || '') + '</textarea>' +
      '<div class="annot-tb-btns"><button type="button" class="annot-tb" id="annot-tb-cancel" style="background:#475569;color:#fff">취소</button>' +
      '<button type="button" class="annot-tb" id="annot-tb-save" style="background:#facc15;color:#0f172a">저장</button></div>';
    tb.style.display = 'block';
    tb.querySelectorAll('.annot-color').forEach(function (b) {
      b.addEventListener('click', function () {
        tb.querySelectorAll('.annot-color').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        if (state.pending) state.pending.color = b.getAttribute('data-color');
        tb.setAttribute('data-color', b.getAttribute('data-color'));
      });
    });
    tb.setAttribute('data-color', color);
    $('annot-tb-cancel').addEventListener('click', hideToolbar);
    $('annot-tb-save').addEventListener('click', saveToolbar);
    setTimeout(function () { var m = $('annot-memo-input'); if (m) m.focus(); }, 0);
  }
  function hideToolbar() { var tb = $('ps-annot-toolbar'); if (tb) { tb.style.display = 'none'; tb.innerHTML = ''; } state.pending = null; state.editingId = null; }

  async function saveToolbar() {
    var tb = $('ps-annot-toolbar'); var color = tb.getAttribute('data-color') || 'red';
    var memo = ($('annot-memo-input') ? $('annot-memo-input').value : '').slice(0, 2000);
    var btn = $('annot-tb-save'); if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    try {
      if (state.editingId) {
        var r1 = await window.supabaseClient.from(TABLE).update({ color: color, memo: memo, updated_at: new Date().toISOString() }).eq('id', state.editingId).select('id');
        if (r1.error) throw r1.error;
        if (!r1.data || !r1.data.length) throw new Error('권한이 없거나 이미 삭제된 첨삭입니다. 다시 로그인한 뒤 시도해 주세요.');
      } else {
        var k = currentKey(); var p = state.pending;
        if (!k || !p) throw new Error('선택한 문장을 찾지 못했습니다. 다시 드래그해 주세요.');
        var row = { student_link: studentLink(), version_label: k.label, question_no: k.q, quote: p.quote, occurrence: p.occurrence, color: color, memo: memo, created_by: (typeof CURRENT_ROLE !== 'undefined' ? CURRENT_ROLE : '') };
        var r2 = await window.supabaseClient.from(TABLE).insert(row).select('id');
        if (r2.error) throw r2.error;
      }
      hideToolbar();
      try { window.getSelection().removeAllRanges(); } catch (e) {}
      await load(true);
      renderView(); renderList(); showAnnotTab();
    } catch (err) {
      alert('첨삭 저장 실패: ' + ((err && err.message) || err));
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
    }
  }

  async function removeItem(id) {
    if (!confirm('이 첨삭(색·메모)을 삭제할까요? 학생 글은 바뀌지 않습니다.')) return;
    var r = await window.supabaseClient.from(TABLE).delete().eq('id', id).select('id');
    if (r.error || !r.data || !r.data.length) { alert('삭제 실패: ' + ((r.error && r.error.message) || '권한이 없거나 이미 삭제되었습니다.')); return; }
    await load(true); renderView(); renderList();
  }

  function renderList() {
    var box = $('annot-list'); if (!box) return;
    var text = state.mode === 'view' ? (state.lastText || '') : currentText();
    var L = layout(text);
    if (!L.ordered.length) {
      box.innerHTML = '<div class="annot-empty">이 문항에는 아직 첨삭이 없습니다.' + (isStaff() ? '<br>가운데 [🖍 첨삭 보기]를 누른 뒤 문장을 드래그하면 색과 메모를 달 수 있습니다.' : '') + '</div>';
      updateTabCount(); return;
    }
    box.innerHTML = L.ordered.map(function (x) {
      var c = COLORS[x.a.color] || COLORS.red;
      var tags = (x.s < 0 ? '<span class="annot-tag" style="background:#b45309">원문 수정됨</span>' : '') + (x.overlap ? '<span class="annot-tag">겹침</span>' : '');
      var q = x.a.quote.length > 80 ? x.a.quote.slice(0, 80) + '…' : x.a.quote;
      return '<div class="annot-item" data-id="' + esc(x.a.id) + '" style="border-left-color:' + c.line + '">' +
        '<div style="font-size:13px;font-weight:700;color:' + c.line + '">' + x.no + '. ' + c.name + ' · ' + c.label + tags + '</div>' +
        '<div class="annot-q">“' + esc(q) + '”</div>' +
        '<div class="annot-memo">' + (x.a.memo ? esc(x.a.memo) : '<span style="color:var(--text-muted)">(메모 없음)</span>') + '</div>' +
        (isStaff() ? '<div class="annot-actions"><button type="button" data-act="edit">수정</button><button type="button" data-act="del">삭제</button></div>' : '') +
        '</div>';
    }).join('');
    box.querySelectorAll('.annot-item').forEach(function (el) {
      var id = el.getAttribute('data-id');
      el.addEventListener('click', function (e) {
        var act = e.target && e.target.getAttribute ? e.target.getAttribute('data-act') : null;
        if (act === 'del') { e.stopPropagation(); removeItem(id); return; }
        if (act === 'edit') { e.stopPropagation(); startEdit(id); return; }
        focusItem(id, true);
      });
    });
    updateTabCount();
  }

  function startEdit(id) {
    var a = state.all.find(function (x) { return String(x.id) === String(id); }); if (!a) return;
    if (state.mode !== 'view') setMode('view');
    var m = document.querySelector('#ps-annot-view mark.annot-mark[data-id="' + id + '"]');
    var wrap = $('ps-annot-toolbar').parentNode; var wr = wrap.getBoundingClientRect();
    var x = 10, y = 40;
    if (m) { var r = m.getBoundingClientRect(); x = r.left - wr.left; y = r.bottom - wr.top + wrap.scrollTop + 6; m.scrollIntoView({ block: 'center' }); }
    state.pending = null;
    openToolbar(x, y, a.memo, a.color, '첨삭 수정 · "' + (a.quote.length > 24 ? a.quote.slice(0, 24) + '…' : a.quote) + '"');
    state.editingId = a.id;
  }

  function focusItem(id, scrollText) {
    document.querySelectorAll('#tab-content-annot .annot-item').forEach(function (el) {
      el.style.boxShadow = el.getAttribute('data-id') === String(id) ? '0 0 0 2px #fde68a' : '';
      if (el.getAttribute('data-id') === String(id) && !scrollText) el.scrollIntoView({ block: 'nearest' });
    });
    if (scrollText) {
      if (state.mode !== 'view') setMode('view');
      var m = document.querySelector('#ps-annot-view mark.annot-mark[data-id="' + id + '"]');
      if (m) { m.scrollIntoView({ block: 'center' }); m.classList.add('annot-flash'); setTimeout(function () { m.classList.remove('annot-flash'); }, 1500); }
    }
  }

  function updateTabCount() {
    var t = $('tab-btn-annot'); if (!t) return;
    var n = itemsForCurrent().length;
    t.textContent = '🖍 첨삭 메모' + (n ? ' (' + n + ')' : '');
  }

  async function load(force) {
    var link = studentLink(); if (!link || !window.supabaseClient) { state.all = []; return; }
    if (!force && state.loadedFor === link) return;
    var r = await window.supabaseClient.from(TABLE).select('*').eq('student_link', link).order('created_at', { ascending: true });
    if (r.error) { console.warn('첨삭 불러오기 실패:', r.error); state.all = []; }
    else state.all = r.data || [];
    state.loadedFor = link;
  }

  async function onModalOpen() {
    if (!injectUi()) return;
    if (state.mode === 'view') setMode('edit');
    hideAnnotTab();
    var tabManual = $('tab-btn-manual-feedback'), cManual = $('tab-content-manual');
    if (tabManual && !document.querySelector('#ps-feedback-pane .tab-nav-item.active')) { tabManual.classList.add('active'); if (cManual) cManual.classList.add('active'); }
    state.loadedFor = null;
    await load(true);
    setTimeout(function () { renderList(); updateTabCount(); }, 300);
  }
  function onModalClose() { if (state.mode === 'view') setMode('edit'); hideToolbar(); }

  window.PsAnnot = { _state: state, load: load, setMode: setMode, renderView: renderView, renderList: renderList, onModalOpen: onModalOpen, layout: layout, _rawOffset: rawOffset };

  function boot() { injectUi(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
