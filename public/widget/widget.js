/* Business OS Receptionist Widget — vanilla JS, no deps, < 45 KB */
!(function () {
  'use strict';

  // ── Guard against duplicate loads ────────────────────────────────────────
  if (window.__BOS_LOADED__) return;
  window.__BOS_LOADED__ = true;

  // ── Locate our own <script> tag and extract config ───────────────────────
  var $s = document.currentScript;
  if (!$s) {
    var all = document.querySelectorAll('script[data-client-id]');
    $s = all[all.length - 1] || null;
  }

  var CLIENT_ID = $s && $s.getAttribute('data-client-id');
  if (!CLIENT_ID) {
    typeof console !== 'undefined' && console.warn('[BOS Widget] Missing data-client-id on <script> tag');
    return;
  }

  var API_ORIGIN = ($s && $s.src) ? new URL($s.src).origin : location.origin;

  // ── Session storage keys ─────────────────────────────────────────────────
  var K_SID  = 'bos_sid_'  + CLIENT_ID;
  var K_CONV = 'bos_conv_' + CLIENT_ID;

  function ss(key, val) {
    try {
      if (val === undefined) return sessionStorage.getItem(key);
      sessionStorage.setItem(key, val);
    } catch (_) {}
    return null;
  }

  var SID = ss(K_SID);
  if (!SID) {
    SID = Date.now().toString(36) + Math.random().toString(36).slice(2);
    ss(K_SID, SID);
  }

  // ── State ────────────────────────────────────────────────────────────────
  var open    = false;
  var busy    = false;
  var history = [];

  try { var h = ss(K_CONV); if (h) history = JSON.parse(h); } catch (_) {}

  var cfg = { name: 'Assistant', color: '#2563EB', greeting: null, booking_url: null };

  // ── Tiny DOM helper ──────────────────────────────────────────────────────
  function $id(i) { return document.getElementById(i); }

  // ── HTML-escape (never use innerHTML with user text) ─────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Persist history ──────────────────────────────────────────────────────
  function saveHistory() {
    try { ss(K_CONV, JSON.stringify(history.slice(-40))); } catch (_) {}
  }

  // ── Fetch brand config from server ───────────────────────────────────────
  function loadConfig() {
    fetch(API_ORIGIN + '/api/widget/config?client_id=' + CLIENT_ID)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (d.company_name)        cfg.name        = d.company_name;
        if (d.brand_color_primary) cfg.color       = d.brand_color_primary;
        if (d.greeting_text)       cfg.greeting    = d.greeting_text;
        if (d.booking_url)         cfg.booking_url = d.booking_url;
        applyTheme();
      })
      .catch(function () {});
  }

  function applyTheme() {
    var els = {
      btn:  $id('bos-btn'),
      hd:   $id('bos-hd'),
      snd:  $id('bos-snd'),
      nm:   $id('bos-name'),
      av:   $id('bos-av'),
    };
    if (els.btn) els.btn.style.background  = cfg.color;
    if (els.hd)  els.hd.style.background   = cfg.color;
    if (els.snd) els.snd.style.background  = cfg.color;
    if (els.nm)  els.nm.textContent        = esc(cfg.name);
    if (els.av)  els.av.textContent        = cfg.name.charAt(0).toUpperCase();
  }

  // ── Scroll messages to bottom ────────────────────────────────────────────
  function scrollEnd() {
    var m = $id('bos-msgs');
    if (m) requestAnimationFrame(function () { m.scrollTop = m.scrollHeight; });
  }

  // ── Append a chat bubble ─────────────────────────────────────────────────
  function addMsg(role, text, persist) {
    var msgs = $id('bos-msgs');
    if (!msgs) return;

    var isUser = (role === 'user');
    var wrap   = document.createElement('div');
    wrap.className = isUser ? 'bos-mw bos-mu' : 'bos-mw bos-ma';

    // AI avatar chip
    if (!isUser) {
      var av2 = document.createElement('div');
      av2.className = 'bos-av2';
      av2.style.background = cfg.color;
      av2.textContent = cfg.name.charAt(0).toUpperCase();
      wrap.appendChild(av2);
    }

    // Text bubble — use textContent, NOT innerHTML
    var bbl = document.createElement('div');
    bbl.className = 'bos-bbl';
    bbl.textContent = text;
    wrap.appendChild(bbl);

    msgs.appendChild(wrap);

    if (persist !== false) {
      history.push({ role: role, content: text });
      saveHistory();
    }
    scrollEnd();
  }

  // ── Re-render all history ────────────────────────────────────────────────
  function renderHistory() {
    var msgs = $id('bos-msgs');
    if (!msgs) return;
    msgs.innerHTML = '';
    for (var i = 0; i < history.length; i++) {
      addMsg(history[i].role, history[i].content, false);
    }
    scrollEnd();
  }

  // ── Typing indicator ─────────────────────────────────────────────────────
  function setTyping(show) {
    var t = $id('bos-typing');
    if (t) t.style.display = show ? 'flex' : 'none';
    if (show) scrollEnd();
  }

  // ── Booking offer card ───────────────────────────────────────────────────
  function showBookingCard() {
    var msgs = $id('bos-msgs');
    if (!msgs) return;
    var url = esc(cfg.booking_url || 'https://calendly.com');
    var card = document.createElement('div');
    card.className = 'bos-book';
    // Safe: url is already escaped; button text is static
    var p = document.createElement('p');
    p.className = 'bos-book-t';
    p.textContent = 'Would you like to schedule a call with our team?';
    var a = document.createElement('a');
    a.className = 'bos-book-a';
    a.href = cfg.booking_url || 'https://calendly.com';
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.textContent = '📅 Book a Call';
    card.appendChild(p);
    card.appendChild(a);
    msgs.appendChild(card);
    scrollEnd();
  }

  // ── Open / close panel ───────────────────────────────────────────────────
  function toggle() {
    open = !open;
    var panel = $id('bos-panel');
    var btn   = $id('bos-btn');
    if (!panel || !btn) return;

    if (open) {
      panel.removeAttribute('hidden');
      // Force reflow before adding class so CSS transition fires
      void panel.offsetWidth;
      panel.classList.add('bos-on');
      btn.innerHTML = ICON_X;
      btn.setAttribute('aria-label', 'Close chat');
      renderHistory();
      if (!history.length) {
        var g = cfg.greeting || ("Hi! I’m " + cfg.name + "'s assistant. How can I help?");
        addMsg('assistant', g, false);
      }
      setTimeout(function () { var i = $id('bos-inp'); if (i) i.focus(); }, 260);
    } else {
      panel.classList.remove('bos-on');
      setTimeout(function () { panel.setAttribute('hidden', ''); }, 240);
      btn.innerHTML = ICON_CHAT;
      btn.setAttribute('aria-label', 'Open chat');
    }
  }

  // ── Send a message ───────────────────────────────────────────────────────
  function send() {
    var inp = $id('bos-inp');
    var snd = $id('bos-snd');
    if (!inp || busy) return;

    var text = inp.value.trim();
    if (!text) return;

    inp.value = '';
    inp.style.height = '';
    inp.disabled = true;
    if (snd) snd.disabled = true;
    busy = true;

    addMsg('user', text, true);
    setTyping(true);

    var payload = JSON.stringify({
      client_id:            CLIENT_ID,
      session_id:           SID,
      message:              text,
      conversation_history: history.slice(-10),
    });

    fetch(API_ORIGIN + '/api/widget/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payload,
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        setTyping(false);
        addMsg('assistant', d.response || 'Sorry, I could not understand that.', true);
        // Show booking card for qualified prospects after a few turns
        if (d.classification === 'qualified_prospect' && history.length > 4) {
          setTimeout(showBookingCard, 400);
        }
      })
      .catch(function () {
        setTyping(false);
        addMsg('assistant', "I’m having trouble connecting right now. Please try again in a moment.", true);
      })
      .finally(function () {
        busy = false;
        inp.disabled = false;
        if (snd) snd.disabled = false;
        inp.focus();
      });
  }

  // ── Inline SVG icons ─────────────────────────────────────────────────────
  var ICON_CHAT = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_X    = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_SEND = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  // ── Create DOM ───────────────────────────────────────────────────────────
  function buildDOM() {
    // Inject styles once
    if (!$id('bos-css')) {
      var styleEl = document.createElement('style');
      styleEl.id  = 'bos-css';
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }

    // ── Toggle button ────────────────────────────────────────────────────
    var btn = document.createElement('button');
    btn.id        = 'bos-btn';
    btn.innerHTML = ICON_CHAT;
    btn.setAttribute('aria-label', 'Open chat');
    btn.style.background = cfg.color;
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);

    // ── Panel ────────────────────────────────────────────────────────────
    var panel = document.createElement('div');
    panel.id = 'bos-panel';
    panel.setAttribute('hidden', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with ' + cfg.name);

    // Header
    var hd  = document.createElement('div');
    hd.id   = 'bos-hd';
    hd.style.background = cfg.color;

    var av  = document.createElement('div');
    av.id   = 'bos-av';
    av.textContent = cfg.name.charAt(0).toUpperCase();

    var info = document.createElement('div');
    var nm   = document.createElement('div');
    nm.id    = 'bos-name';
    nm.textContent = cfg.name;
    var sts  = document.createElement('div');
    sts.className  = 'bos-sts';
    sts.textContent = '● Online · AI powered';
    info.appendChild(nm);
    info.appendChild(sts);

    var cls = document.createElement('button');
    cls.id  = 'bos-cls';
    cls.setAttribute('aria-label', 'Close chat');
    cls.textContent = '×';
    cls.addEventListener('click', toggle);

    hd.appendChild(av);
    hd.appendChild(info);
    hd.appendChild(cls);
    panel.appendChild(hd);

    // Messages
    var msgs = document.createElement('div');
    msgs.id   = 'bos-msgs';
    msgs.setAttribute('role', 'log');
    msgs.setAttribute('aria-live', 'polite');
    panel.appendChild(msgs);

    // Typing indicator
    var typ = document.createElement('div');
    typ.id  = 'bos-typing';
    typ.style.display = 'none';

    var av2 = document.createElement('div');
    av2.className = 'bos-av2';
    av2.style.background = cfg.color;
    av2.textContent = cfg.name.charAt(0).toUpperCase();

    var dots = document.createElement('div');
    dots.className = 'bos-dots';
    dots.innerHTML = '<span></span><span></span><span></span>';

    typ.appendChild(av2);
    typ.appendChild(dots);
    panel.appendChild(typ);

    // Footer / input area
    var foot = document.createElement('div');
    foot.id  = 'bos-foot';

    var inp  = document.createElement('textarea');
    inp.id   = 'bos-inp';
    inp.setAttribute('placeholder', 'Type a message…');
    inp.setAttribute('rows', '1');
    inp.setAttribute('aria-label', 'Chat message');
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inp.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    var snd = document.createElement('button');
    snd.id  = 'bos-snd';
    snd.setAttribute('aria-label', 'Send message');
    snd.innerHTML = ICON_SEND;
    snd.style.background = cfg.color;
    snd.addEventListener('click', send);

    foot.appendChild(inp);
    foot.appendChild(snd);
    panel.appendChild(foot);

    document.body.appendChild(panel);
  }

  // ── CSS (scoped to #bos-btn and #bos-panel) ──────────────────────────────
  var CSS = [
    /* Reset only widget elements */
    '#bos-btn,#bos-btn *,#bos-panel,#bos-panel *{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}',

    /* Toggle button */
    '#bos-btn{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.35);z-index:2147483646;transition:transform .2s ease,box-shadow .2s ease;outline:none}',
    '#bos-btn:hover{transform:scale(1.09);box-shadow:0 6px 28px rgba(0,0,0,.45)}',
    '#bos-btn:focus-visible{outline:3px solid rgba(255,255,255,.5);outline-offset:2px}',

    /* Panel */
    '#bos-panel{position:fixed;bottom:96px;right:24px;width:380px;height:580px;background:#0f172a;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 48px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.07);z-index:2147483645;opacity:0;transform:translateY(16px) scale(.97);transition:opacity .22s ease,transform .22s ease;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '#bos-panel[hidden]{display:flex!important}',
    '#bos-panel.bos-on{opacity:1;transform:none;pointer-events:all}',

    /* Mobile: full screen */
    '@media(max-width:500px){#bos-panel{bottom:0;right:0;left:0;width:100%;height:100%;border-radius:0;border:none}#bos-btn{bottom:16px;right:16px}}',

    /* Header */
    '#bos-hd{display:flex;align-items:center;gap:10px;padding:13px 14px;flex-shrink:0}',
    '#bos-av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0}',
    '#bos-name{color:#fff;font-weight:600;font-size:14px;line-height:1.3}',
    '.bos-sts{color:rgba(255,255,255,.7);font-size:11px;margin-top:1px}',
    '#bos-cls{margin-left:auto;background:transparent;border:none;color:rgba(255,255,255,.75);cursor:pointer;font-size:18px;line-height:1;padding:4px 7px;border-radius:6px;transition:background .15s,color .15s;outline:none;flex-shrink:0}',
    '#bos-cls:hover{background:rgba(255,255,255,.15);color:#fff}',

    /* Messages scroll area */
    '#bos-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}',
    '#bos-msgs::-webkit-scrollbar{width:4px}',
    '#bos-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}',

    /* Bubbles */
    '.bos-mw{display:flex;align-items:flex-end;gap:7px;max-width:86%}',
    '.bos-mu{align-self:flex-end;flex-direction:row-reverse}',
    '.bos-ma{align-self:flex-start}',
    '.bos-av2{width:27px;height:27px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}',
    '.bos-bbl{padding:9px 13px;border-radius:18px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap}',
    '.bos-mu .bos-bbl{background:#2563eb;color:#fff;border-bottom-right-radius:4px}',
    '.bos-ma .bos-bbl{background:#1e293b;color:#e2e8f0;border:1px solid rgba(255,255,255,.06);border-bottom-left-radius:4px}',

    /* Typing indicator */
    '#bos-typing{padding:0 14px 8px;display:flex;align-items:flex-end;gap:7px;flex-shrink:0}',
    '.bos-dots{display:inline-flex;align-items:center;gap:4px;background:#1e293b;border:1px solid rgba(255,255,255,.06);border-radius:18px;border-bottom-left-radius:4px;padding:11px 15px}',
    '.bos-dots span{display:block;width:7px;height:7px;border-radius:50%;background:#475569;animation:bos-b 1.3s ease infinite}',
    '.bos-dots span:nth-child(2){animation-delay:.18s}',
    '.bos-dots span:nth-child(3){animation-delay:.36s}',
    '@keyframes bos-b{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-6px);opacity:1}}',

    /* Input footer */
    '#bos-foot{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.06);background:#0f172a;flex-shrink:0}',
    '#bos-inp{flex:1;background:#1e293b;border:1px solid rgba(255,255,255,.1);border-radius:18px;color:#e2e8f0;font-size:14px;font-family:inherit;padding:9px 14px;resize:none;min-height:40px;max-height:120px;line-height:1.45;outline:none;transition:border-color .15s}',
    '#bos-inp:focus{border-color:rgba(37,99,235,.55)}',
    '#bos-inp::placeholder{color:#475569}',
    '#bos-inp:disabled{opacity:.55;cursor:not-allowed}',
    '#bos-snd{width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s;outline:none}',
    '#bos-snd:hover{opacity:.84}',
    '#bos-snd:disabled{opacity:.38;cursor:not-allowed}',

    /* Booking card */
    '.bos-book{background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.22);border-radius:12px;padding:14px;text-align:center}',
    '.bos-book-t{color:#94a3b8;font-size:13px;margin-bottom:10px!important;line-height:1.4}',
    '.bos-book-a{display:inline-block;background:#2563eb;color:#fff!important;text-decoration:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;transition:opacity .15s}',
    '.bos-book-a:hover{opacity:.85}',
  ].join('');

  // ── Bootstrap ────────────────────────────────────────────────────────────
  function init() {
    buildDOM();
    loadConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
