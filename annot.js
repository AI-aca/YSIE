/**
 * [2026-11-25 v3] 자소서 첨삭 표시(색·메모) — C비서
 * - 입력칸 안에서 바로 색이 보임 (입력칸 뒤에 같은 글을 한 겹 깔고 그 위에만 색을 칠함)
 *   · 학생 글(입력칸의 글자)·글자수·저장·불러오기는 전혀 건드리지 않음. 색은 별도 표 ps_annotations 에만 저장
 * - 선생님(교사·관리자): 입력칸에서 문장을 드래그 → 색(빨강·초록·파랑) + 메모 저장, [첨삭 메모] 탭에서 수정·삭제
 * - 학생: 색과 메모를 보기만 함
 * - 위치는 "선택한 문장 + 몇 번째로 나오는지"로 기억 → 문장이 바뀌면 색은 사라지고 목록에 '원문 수정됨' 표시
 */
(function () {
  'use strict';
  var TABLE = 'ps_annotations';
  var SEP = '[상세분할]';
  var COLORS = {
    red: { bg: 'rgba(239, 68, 68, 0.38)', line: '#ef4444', text: '#fca5a5' },
    green: { bg: 'rgba(34, 197, 94, 0.36)', line: '#22c55e', text: '#86efac' },
    blue: { bg: 'rgba(59, 130, 246, 0.40)', line: '#3b82f6', text: '#93c5fd' }
  };
  var state = { all: [], loadedFor: null, pending: null, editingId: null, overlays: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isStaff() { return (typeof CURRENT_ROLE !== 'undefined') && (CURRENT_ROLE === '관리자' || CURRENT_ROLE === '교사'); }
  function studentLink() { return (typeof ACTIVE_PS_STUDENT !== 'undefined' && ACTIVE_PS_STUDENT) ? String(ACTIVE_PS_STUDENT) : ''; }
  function nq(q) { return window.normalizeQNum ? window.normalizeQNum(q) : String(q || '').replace(/^문항\s*/, '').replace(/\s+/g, '').trim(); }
  function modalOpen() { var m = $('modal-ps-editor'); return !!(m && m.classList.contains('open')); }

  // ---------- 현재 문항과 글 ----------
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
  // 지금 보이는 입력칸들과, 각 칸이 전체 글(저장 형식)의 어디에 해당하는지
  function segments() {
    var dyn = $('ps-dynamic-details-container');
    if (dyn && dyn.style.display !== 'none') {
      var tas = Array.prototype.slice.call(dyn.querySelectorAll('.dynamic-ps-textarea'));
      var base = 0, out = [];
      tas.forEach(function (ta, i) {
        var v = ta.value, t = v.trim(), lead = v.length - v.replace(/^\s+/, '').length;
        out.push({ ta: ta, base: base, lead: lead, len: t.length });
        base += t.length + (i < tas.length - 1 ? SEP.length : 0);
      });
      return out;
    }
    var area = $('ps-content-textarea');
    return area ? [{ ta: area, base: 0, lead: 0, len: area.value.length, single: true }] : [];
  }
  function fullText() {
    var segs = segments();
    if (segs.length && !segs[0].single) return segs.map(function (s) { return s.ta.value.trim(); }).join(SEP);
    return segs.length ? segs[0].ta.value : '';
  }
  function nthIndex(text, quote, n) { var i = -1; for (var k = 0; k <= n; k++) { i = text.indexOf(quote, i + 1); if (i < 0) return -1; } return i; }
  function occurrenceBefore(text, quote, start) { var n = 0, i = text.indexOf(quote); while (i >= 0 && i < start) { n++; i = text.indexOf(quote, i + 1); } return n; }
  function itemsForCurrent() {
    var k = currentKey(); if (!k) return [];
    return state.all.filter(function (a) { return nq(a.question_no) === nq(k.q) && String(a.version_label || '').trim() === k.label; });
  }
  // [2026-11-25] 지금 문항의 글이 마지막 저장본과 다른지 (선생님이 고치고 아직 [저장하기]를 안 누른 상태)
  function hasUnsavedText() {
    var h = window.PS_CURRENT_HISTORY, o = window.PS_ORIGINAL_HISTORY_CURRENT, k = currentKey();
    if (!h || !h.current || !o || !k) return false;
    var nameEl = $('ps-school-name'); var ui = nameEl ? nameEl.textContent.replace('지원 학교: ', '').trim() : '';
    var c = h.current.find(function (x) { var cv = String(x.version_label || '').trim(); return nq(x.qNum) === nq(k.q) && (cv === k.label || (!cv && k.label === ui)); });
    if (!c) return false;
    var orig = o.find(function (x) { return x.qNum === c.qNum && x.version_label === c.version_label; });
    var cur = window.getCurrentPsText ? window.getCurrentPsText(false) : fullText();
    return cur !== (orig ? orig.text : '');
  }
  // 색칠 위치·번호 (앞에서부터 1,2,3…, 원문이 바뀐 것은 뒤로)
  function layout(text) {
    var items = itemsForCurrent().map(function (a) { var s = nthIndex(text, a.quote, a.occurrence || 0); return { a: a, s: s, e: s >= 0 ? s + a.quote.length : -1 }; });
    var found = items.filter(function (x) { return x.s >= 0; }).sort(function (x, y) { return x.s - y.s || y.e - x.e; });
    var lost = items.filter(function (x) { return x.s < 0; }).sort(function (x, y) { return String(x.a.created_at).localeCompare(String(y.a.created_at)); });
    var shown = [], end = -1;
    found.forEach(function (x) { x.overlap = x.s < end; if (!x.overlap) { shown.push(x); end = x.e; } });
    var ordered = found.concat(lost); ordered.forEach(function (x, i) { x.no = i + 1; });
    return { shown: shown, ordered: ordered };
  }

  // ---------- 입력칸 뒤 색칠 층 ----------
  var COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'tabSize',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'boxSizing'];
  function overlayFor(ta) {
    var o = state.overlays.find(function (x) { return x.ta === ta; });
    if (o && o.bd.isConnected) return o;
    var parent = ta.parentNode; if (!parent) return null;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    var bd = document.createElement('div');
    bd.className = 'annot-bd'; bd.setAttribute('aria-hidden', 'true');
    var inner = document.createElement('div'); inner.className = 'annot-bd-inner'; bd.appendChild(inner);
    parent.insertBefore(bd, ta);
    o = { ta: ta, bd: bd, inner: inner, bg: null, key: '' };
    state.overlays = state.overlays.filter(function (x) { return x.bd.isConnected; });
    state.overlays.push(o);
    ta.addEventListener('scroll', function () { syncScroll(o); });
    return o;
  }
  function syncScroll(o) { o.inner.style.transform = 'translateY(' + (-o.ta.scrollTop) + 'px)'; }
  function styleOverlay(o) {
    var ta = o.ta, cs = getComputedStyle(ta), bd = o.bd;
    if (o.bg === null) { o.bg = ta.getAttribute('data-annot-bg') || cs.backgroundColor; ta.setAttribute('data-annot-bg', o.bg); }
    var visible = cs.display !== 'none' && ta.offsetParent !== null;
    if (!visible) { bd.style.display = 'none'; return false; }
    COPY.forEach(function (p) { bd.style[p] = cs[p]; });
    bd.style.display = 'block'; bd.style.position = 'absolute'; bd.style.overflow = 'hidden';
    bd.style.borderStyle = 'solid'; bd.style.borderColor = 'transparent';
    bd.style.left = ta.offsetLeft + 'px'; bd.style.top = ta.offsetTop + 'px';
    var bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
    var sb = ta.offsetWidth - ta.clientWidth - bl - br; // 세로 스크롤바 폭
    bd.style.width = (ta.offsetWidth - Math.max(0, sb)) + 'px'; bd.style.height = ta.offsetHeight + 'px';
    bd.style.background = o.bg; bd.style.color = 'transparent'; bd.style.pointerEvents = 'none'; bd.style.zIndex = '0';
    o.inner.style.whiteSpace = 'pre-wrap'; o.inner.style.overflowWrap = 'break-word'; o.inner.style.wordBreak = cs.wordBreak;
    if (ta.style.background !== 'transparent') { ta.style.background = 'transparent'; }
    if (getComputedStyle(ta).position === 'static') ta.style.position = 'relative';
    ta.style.zIndex = '1';
    return true;
  }
  function render() {
    if (!modalOpen()) return;
    var segs = segments(); var text = fullText(); var L = layout(text);
    // 사용하지 않는 칸의 색칠 층은 숨김
    state.overlays.forEach(function (o) { if (!segs.some(function (s) { return s.ta === o.ta; })) o.bd.style.display = 'none'; });
    segs.forEach(function (seg) {
      var o = overlayFor(seg.ta); if (!o) return;
      if (!styleOverlay(o)) return;
      var v = seg.ta.value, html = '', pos = 0;
      L.shown.forEach(function (x) {
        var s = x.s - seg.base, e = x.e - seg.base;
        if (e <= 0 || s >= seg.len) return;
        s = Math.max(0, s) + seg.lead; e = Math.min(seg.len, e) + seg.lead;
        var c = COLORS[x.a.color] || COLORS.red;
        html += esc(v.slice(pos, s)) + '<mark data-id="' + esc(x.a.id) + '" style="background:' + c.bg + ';color:transparent;border-radius:2px;box-shadow:inset 0 -2px 0 ' + c.line + '">' + esc(v.slice(s, e)) + '</mark>';
        pos = e;
      });
      html += esc(v.slice(pos));
      if (/\n$/.test(v) || v === '') html += ' ';
      if (o.inner.innerHTML !== html) o.inner.innerHTML = html;
      syncScroll(o);
    });
    updateTabCount();
  }

  // 입력칸 위치 → 전체 글 위치
  function toFull(seg, pos) {
    if (seg.single) return pos;
    var p = Math.max(0, Math.min(seg.len, pos - seg.lead));
    return seg.base + p;
  }
  // 입력칸 안 특정 글자의 화면 위치 (색칠 층으로 계산)
  function caretRect(o, pos) {
    var v = o.ta.value; var save = o.inner.innerHTML;
    o.inner.innerHTML = esc(v.slice(0, pos)) + '<span id="annot-caret-probe">​</span>' + esc(v.slice(pos)) + ' ';
    var sp = $('annot-caret-probe'); var r = sp ? sp.getBoundingClientRect() : o.ta.getBoundingClientRect();
    o.inner.innerHTML = save; return r;
  }

  // ---------- 선생님: 드래그 → 색·메모 ----------
  function onSelectEnd(e) {
    if (!isStaff() || !modalOpen()) return;
    var ta = e.target; if (!ta || ta.tagName !== 'TEXTAREA') return;
    var segs = segments(); var seg = segs.find(function (s) { return s.ta === ta; }); if (!seg) return;
    setTimeout(function () {
      var a = ta.selectionStart, b = ta.selectionEnd; if (b <= a) { return; }
      var text = fullText();
      var s = toFull(seg, a), t = toFull(seg, b);
      while (s < t && /\s/.test(text.charAt(s))) s++;
      while (t > s && /\s/.test(text.charAt(t - 1))) t--;
      var quote = text.slice(s, t); if (!quote) return;
      if (quote.indexOf(SEP) >= 0) return;
      if (quote.length > 2000) { alert('한 번에 2,000자까지 선택할 수 있습니다.'); return; }
      state.pending = { quote: quote, occurrence: occurrenceBefore(text, quote, s) }; state.editingId = null;
      var o = overlayFor(ta); styleOverlay(o);
      var r = caretRect(o, b);
      openToolbar(r.left, r.bottom + 6, '', 'red', '"' + (quote.length > 30 ? quote.slice(0, 30) + '…' : quote) + '"');
    }, 0);
  }
  function openToolbar(x, y, memo, color, title) {
    var tb = $('ps-annot-toolbar');
    tb.innerHTML = '<div class="annot-tb-title">' + esc(title) + '</div>' +
      '<div class="annot-colors">' + Object.keys(COLORS).map(function (k) {
        return '<button type="button" class="annot-color' + (k === color ? ' sel' : '') + '" data-color="' + k + '" style="background:' + COLORS[k].line + '"></button>';
      }).join('') + '</div>' +
      '<textarea id="annot-memo-input" placeholder="메모 (비워도 됩니다)">' + esc(memo || '') + '</textarea>' +
      '<div class="annot-tb-btns"><button type="button" class="annot-tb" id="annot-tb-cancel">취소</button><button type="button" class="annot-tb annot-tb-save" id="annot-tb-save">바로 저장</button></div>';
    tb.setAttribute('data-color', color);
    tb.style.display = 'block';
    var w = 280, h = tb.offsetHeight || 150;
    var left = Math.max(8, Math.min(x, window.innerWidth - w - 8)); var top = y; if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 30);
    tb.style.left = left + 'px'; tb.style.top = top + 'px';
    tb.querySelectorAll('.annot-color').forEach(function (bt) {
      bt.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      bt.addEventListener('click', function () { tb.querySelectorAll('.annot-color').forEach(function (z) { z.classList.remove('sel'); }); bt.classList.add('sel'); tb.setAttribute('data-color', bt.getAttribute('data-color')); });
    });
    $('annot-tb-cancel').addEventListener('click', hideToolbar);
    $('annot-tb-save').addEventListener('click', saveToolbar);
  }
  // 첨삭 저장·수정·삭제 후 잠깐 보이는 알림 (아래 [저장하기]와 별개로 바로 저장되었음을 알림)
  var toastTimer = null;
  function toast(msg) {
    var el = $('ps-annot-toast');
    if (!el) { el = document.createElement('div'); el.id = 'ps-annot-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }
  function hideToolbar() { var tb = $('ps-annot-toolbar'); if (tb) { tb.style.display = 'none'; tb.innerHTML = ''; } state.pending = null; state.editingId = null; }
  async function saveToolbar() {
    var tb = $('ps-annot-toolbar'); var color = tb.getAttribute('data-color') || 'red';
    var memo = ($('annot-memo-input') ? $('annot-memo-input').value : '').slice(0, 2000);
    var btn = $('annot-tb-save'); if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    var wasEdit = !!state.editingId;
    // [2026-11-25] 누른 순간의 선택 문장·문항을 먼저 기억 (아래에서 자소서를 저장하는 동안 화면이 다시 그려져도 그대로 사용)
    var editId = state.editingId, p = state.pending, k = currentKey();
    try {
      // [2026-11-25] 선생님이 자소서를 고치고 아직 저장하지 않았으면, 고친 글도 함께 저장할지 물음 (기존 [저장하기] 버튼을 그대로 눌러 줌)
      if (!wasEdit && hasUnsavedText()) {
        if (confirm('고친 자소서도 지금 함께 저장할까요?\n\n[확인] 고친 글을 먼저 저장한 뒤 색을 저장합니다. (저장 확인창이 한 번 더 뜹니다)\n[취소] 색만 저장합니다. 고친 부분의 색은 글을 저장해야 학생에게 보입니다.')) {
          var sb = $('btn-save-ps');
          if (sb && typeof sb.onclick === 'function') { await sb.onclick(); }
          if (hasUnsavedText()) { // 저장 확인창에서 취소했거나 저장하지 못함 → 색도 저장하지 않고 멈춤
            if (btn) { btn.disabled = false; btn.textContent = '바로 저장'; }
            return;
          }
        }
      }
      if (editId) {
        var r1 = await window.supabaseClient.from(TABLE).update({ color: color, memo: memo, updated_at: new Date().toISOString() }).eq('id', editId).select('id');
        if (r1.error) throw r1.error;
        if (!r1.data || !r1.data.length) throw new Error('권한이 없거나 이미 삭제된 첨삭입니다. 다시 로그인한 뒤 시도해 주세요.');
      } else {
        if (!k || !p) throw new Error('선택한 문장을 찾지 못했습니다. 다시 드래그해 주세요.');
        var row = { student_link: studentLink(), version_label: k.label, question_no: k.q, quote: p.quote, occurrence: p.occurrence, color: color, memo: memo, created_by: (typeof CURRENT_ROLE !== 'undefined' ? CURRENT_ROLE : '') };
        var r2 = await window.supabaseClient.from(TABLE).insert(row).select('id');
        if (r2.error) throw r2.error;
      }
      hideToolbar();
      toast(wasEdit ? '✓ 첨삭 수정됨 (자동 저장)' : '✓ 첨삭 저장됨 (자동 저장)');
      await load(true); render(); renderList();
    } catch (err) {
      alert('첨삭 저장 실패: ' + ((err && err.message) || err));
      if (btn) { btn.disabled = false; btn.textContent = '바로 저장'; }
    }
  }
  async function removeItem(id) {
    if (!confirm('이 첨삭(색·메모)을 삭제할까요? 학생 글은 바뀌지 않습니다.')) return;
    var r = await window.supabaseClient.from(TABLE).delete().eq('id', id).select('id');
    if (r.error || !r.data || !r.data.length) { alert('삭제 실패: ' + ((r.error && r.error.message) || '권한이 없거나 이미 삭제되었습니다.')); return; }
    toast('✓ 첨삭 삭제됨');
    await load(true); render(); renderList();
  }

  // ---------- 커서가 색칠한 곳에 있으면 메모를 작게 보여 줌 ----------
  function onCaret(e) {
    var ta = e.target; if (!ta || ta.tagName !== 'TEXTAREA' || !modalOpen()) return;
    var tip = $('ps-annot-tip');
    var segs = segments(); var seg = segs.find(function (s) { return s.ta === ta; });
    if (!seg || ta.selectionStart !== ta.selectionEnd) { tip.style.display = 'none'; return; }
    var pos = toFull(seg, ta.selectionStart); var L = layout(fullText());
    var hit = L.shown.find(function (x) { return pos >= x.s && pos <= x.e; });
    if (!hit) { tip.style.display = 'none'; return; }
    var c = COLORS[hit.a.color] || COLORS.red;
    tip.innerHTML = '<b style="color:' + c.line + '">' + hit.no + '</b> ' + (hit.a.memo ? esc(hit.a.memo) : '<span style="opacity:.7">(메모 없음)</span>');
    var o = overlayFor(ta); var r = caretRect(o, ta.selectionStart);
    tip.style.display = 'block';
    tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px'; tip.style.top = (r.bottom + 6) + 'px';
  }

  // ---------- 오른쪽 [첨삭 메모] 탭 (간단한 목록) ----------
  function renderList() {
    var box = $('annot-list'); if (!box) return;
    var L = layout(fullText());
    if (!L.ordered.length) {
      box.innerHTML = '<div class="annot-empty">이 문항에는 아직 첨삭이 없습니다.' + (isStaff() ? '<br>자소서 칸에서 문장을 드래그하면 색과 메모를 달 수 있습니다.' : '') + '</div>';
      updateTabCount(); return;
    }
    box.innerHTML = L.ordered.map(function (x) {
      var c = COLORS[x.a.color] || COLORS.red;
      var q = x.a.quote.length > 120 ? x.a.quote.slice(0, 120) + '…' : x.a.quote;
      var tag = x.s < 0 ? '<span class="annot-tag">원문 수정됨</span>' : (x.overlap ? '<span class="annot-tag">겹침</span>' : '');
      return '<div class="annot-item" data-id="' + esc(x.a.id) + '">' +
        '<div class="annot-q"><span class="annot-no" style="background:' + c.line + '">' + x.no + '</span><span style="color:' + c.text + '">' + esc(q) + '</span>' + tag + '</div>' +
        '<div class="annot-row"><span class="annot-memo">' + (x.a.memo ? esc(x.a.memo) : '<span class="annot-muted">(메모 없음)</span>') + '</span>' +
        (isStaff() ? '<span class="annot-actions"><button type="button" data-act="edit">수정</button><button type="button" data-act="del">삭제</button></span>' : '') + '</div></div>';
    }).join('');
    box.querySelectorAll('.annot-item').forEach(function (el) {
      var id = el.getAttribute('data-id');
      el.addEventListener('click', function (ev) {
        var act = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-act') : null;
        if (act === 'del') { ev.stopPropagation(); removeItem(id); return; }
        if (act === 'edit') { ev.stopPropagation(); startEdit(id, el); return; }
        goTo(id);
      });
    });
    updateTabCount();
  }
  function startEdit(id, el) {
    var a = state.all.find(function (x) { return String(x.id) === String(id); }); if (!a) return;
    var r = el.getBoundingClientRect();
    state.pending = null;
    openToolbar(r.left, r.bottom + 4, a.memo, a.color, '첨삭 수정 · "' + (a.quote.length > 30 ? a.quote.slice(0, 30) + '…' : a.quote) + '"');
    state.editingId = a.id;
  }
  // 목록을 누르면 본문의 그 문장으로 이동해 선택
  function goTo(id) {
    var L = layout(fullText()); var x = L.shown.find(function (z) { return String(z.a.id) === String(id); }); if (!x) return;
    var segs = segments(); var seg = segs.find(function (s) { return x.s >= s.base && x.s <= s.base + s.len; }); if (!seg) return;
    var a = seg.single ? x.s : x.s - seg.base + seg.lead, b = seg.single ? x.e : Math.min(seg.len, x.e - seg.base) + seg.lead;
    seg.ta.focus(); seg.ta.setSelectionRange(a, b);
    var o = overlayFor(seg.ta); var r = caretRect(o, a); var tr = seg.ta.getBoundingClientRect();
    seg.ta.scrollTop += (r.top - tr.top) - seg.ta.clientHeight / 3; syncScroll(o);
  }
  function updateTabCount() { var t = $('tab-btn-annot'); if (!t) return; var n = itemsForCurrent().length; t.textContent = '🖍 첨삭 메모' + (n ? ' (' + n + ')' : ''); }

  // ---------- 화면 준비 ----------
  function injectUi() {
    if ($('tab-btn-annot')) return true;
    var tabBar = document.querySelector('#ps-feedback-pane .tab-navbar'); var aiContent = $('tab-content-ai');
    if (!tabBar || !aiContent) return false;
    var st = document.createElement('style');
    st.textContent =
      '.annot-bd mark{color:transparent}' +
      '#modal-ps-editor .char-counter{z-index:3}' + // [2026-11-25] 글자수 표시가 색칠 층에 가려지지 않게 맨 위로
      '#ps-annot-toolbar{position:fixed;z-index:10050;display:none;background:#0f172a;border:1px solid #facc15;border-radius:8px;padding:8px;box-shadow:0 6px 18px rgba(0,0,0,.5);width:280px;box-sizing:border-box}' +
      '#ps-annot-toolbar .annot-tb-title{font-size:12px;color:#fde68a;margin-bottom:6px;word-break:break-all}' +
      '#ps-annot-toolbar .annot-colors{display:flex;gap:8px;margin-bottom:6px}' +
      '#ps-annot-toolbar .annot-color{width:28px;height:28px;border-radius:50%;border:3px solid transparent;cursor:pointer;padding:0}' +
      '#ps-annot-toolbar .annot-color.sel{border-color:#fff}' +
      '#ps-annot-toolbar textarea{width:100%;box-sizing:border-box;height:52px;resize:vertical;font-size:13px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:#1e293b;color:var(--text-main)}' +
      '#ps-annot-toolbar .annot-tb-btns{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}' +
      '#ps-annot-toolbar .annot-tb{border:none;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer;font-weight:600;background:#475569;color:#fff}' +
      '#ps-annot-toolbar .annot-tb-save{background:#facc15;color:#0f172a}' +
      '#ps-annot-tip{position:fixed;z-index:10040;display:none;max-width:290px;background:#0f172a;border:1px solid #475569;border-radius:6px;padding:5px 8px;font-size:12.5px;color:#e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none;white-space:pre-wrap;word-break:break-all}' +
      '#annot-list .annot-item{padding:6px 8px;margin-bottom:6px;border-radius:6px;background:rgba(15,23,42,.35);border:1px solid var(--border-color);cursor:pointer}' +
      '#annot-list .annot-q{font-size:13px;line-height:1.45;word-break:break-all}' +
      '#annot-list .annot-no{display:inline-block;min-width:16px;text-align:center;font-size:11px;font-weight:700;color:#0f172a;border-radius:8px;padding:0 4px;margin-right:6px}' +
      '#annot-list .annot-row{display:flex;align-items:flex-start;gap:6px;margin-top:3px}' +
      '#annot-list .annot-memo{flex:1;font-size:13px;color:var(--text-main);white-space:pre-wrap;word-break:break-all}' +
      '#annot-list .annot-muted{color:var(--text-muted)}' +
      '#annot-list .annot-actions{flex-shrink:0;display:flex;gap:4px}' +
      '#annot-list .annot-actions button{border:1px solid var(--border-color);background:transparent;color:var(--text-muted);border-radius:5px;padding:0 6px;font-size:11.5px;line-height:18px;cursor:pointer}' +
      '#annot-list .annot-tag{display:inline-block;font-size:10.5px;padding:0 5px;border-radius:7px;margin-left:6px;background:#b45309;color:#fff;vertical-align:1px}' +
      '#ps-annot-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%) translateY(10px);z-index:10060;background:#0f766e;color:#fff;font-size:14px;font-weight:600;padding:9px 18px;border-radius:20px;box-shadow:0 6px 18px rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}' +
      '#ps-annot-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}' +
      '#annot-list .annot-empty{font-size:13.5px;color:var(--text-muted);padding:8px 2px;line-height:1.6}';
    document.head.appendChild(st);
    var tb = document.createElement('div'); tb.id = 'ps-annot-toolbar'; document.body.appendChild(tb);
    var tip = document.createElement('div'); tip.id = 'ps-annot-tip'; document.body.appendChild(tip);
    var tab = document.createElement('div'); tab.className = 'tab-nav-item'; tab.id = 'tab-btn-annot'; tab.textContent = '🖍 첨삭 메모';
    tabBar.insertBefore(tab, $('tab-btn-ai-feedback') || null);
    var pane = document.createElement('div'); pane.className = 'tab-pane-content'; pane.id = 'tab-content-annot'; pane.style.cssText = 'flex: 1; overflow-y: auto;';
    pane.innerHTML = '<div id="annot-list" style="margin-top:6px;"></div>';
    aiContent.parentNode.insertBefore(pane, aiContent);
    tab.addEventListener('click', showAnnotTab);
    ['tab-btn-manual-feedback', 'tab-btn-ai-feedback'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', hideAnnotTab); });
    // 입력칸 이벤트 (기존 입력 처리와 별개로 동작, 글은 건드리지 않음)
    var modal = $('modal-ps-editor');
    modal.addEventListener('mouseup', onSelectEnd);
    modal.addEventListener('keyup', function (e) { if (e.shiftKey) onSelectEnd(e); onCaret(e); });
    modal.addEventListener('click', onCaret);
    modal.addEventListener('input', function (e) { if (e.target && e.target.tagName === 'TEXTAREA') { hideToolbar(); $('ps-annot-tip').style.display = 'none'; render(); if ($('tab-content-annot').classList.contains('active')) renderList(); } }, true);
    document.addEventListener('mousedown', function (e) {
      var t = $('ps-annot-toolbar'); if (t.style.display === 'block' && !t.contains(e.target)) hideToolbar();
    });
    var qs = $('ps-question-selector'); if (qs) qs.addEventListener('change', function () { setTimeout(function () { render(); renderList(); }, 120); });
    if (window.MutationObserver) {
      var wasOpen = modal.classList.contains('open');
      new MutationObserver(function () { var open = modal.classList.contains('open'); if (open && !wasOpen) onModalOpen(); if (!open && wasOpen) onModalClose(); wasOpen = open; }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
    // 글이 코드로 바뀌는 경우(과거 버전 선택 등)·창 크기 변화에도 색칠 위치를 맞춤
    var last = '';
    setInterval(function () {
      if (!modalOpen()) return;
      var segs = segments();
      var sig = fullText() + '|' + segs.map(function (s) { return s.ta.offsetWidth + 'x' + s.ta.offsetHeight + '@' + s.ta.offsetLeft + ',' + s.ta.offsetTop + ':' + getComputedStyle(s.ta).display; }).join(';') + '|' + state.all.length;
      if (sig !== last) { last = sig; render(); }
    }, 400);
    window.addEventListener('resize', function () { render(); });
    return true;
  }
  function showAnnotTab() {
    ['tab-btn-manual-feedback', 'tab-btn-ai-feedback'].forEach(function (id) { var b = $(id); if (b) b.classList.remove('active'); });
    ['tab-content-manual', 'tab-content-ai'].forEach(function (id) { var c = $(id); if (c) c.classList.remove('active'); });
    $('tab-btn-annot').classList.add('active'); $('tab-content-annot').classList.add('active');
    renderList();
  }
  function hideAnnotTab() { var b = $('tab-btn-annot'), c = $('tab-content-annot'); if (b) b.classList.remove('active'); if (c) c.classList.remove('active'); }
  async function load(force) {
    var link = studentLink(); if (!link || !window.supabaseClient) { state.all = []; return; }
    if (!force && state.loadedFor === link) return;
    var r = await window.supabaseClient.from(TABLE).select('*').eq('student_link', link).order('created_at', { ascending: true });
    if (r.error) { console.warn('첨삭 불러오기 실패:', r.error); state.all = []; } else state.all = r.data || [];
    state.loadedFor = link;
  }
  async function onModalOpen() {
    if (!injectUi()) return;
    hideAnnotTab(); hideToolbar(); $('ps-annot-tip').style.display = 'none';
    var tm = $('tab-btn-manual-feedback'), cm = $('tab-content-manual');
    if (tm && !document.querySelector('#ps-feedback-pane .tab-nav-item.active')) { tm.classList.add('active'); if (cm) cm.classList.add('active'); }
    state.all = []; state.loadedFor = null; render();
    await load(true);
    setTimeout(function () { render(); renderList(); }, 200);
  }
  function onModalClose() { hideToolbar(); var t = $('ps-annot-tip'); if (t) t.style.display = 'none'; }

  window.PsAnnot = { _state: state, load: load, render: render, renderList: renderList, layout: layout, fullText: fullText, segments: segments, onModalOpen: onModalOpen };
  function boot() { injectUi(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
