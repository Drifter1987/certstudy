/* CertStudy - ISTQB study web app.
   Plain ES2017, no dependencies, no build step. */
(function () {
  'use strict';

  var STORE_KEY = 'certstudy.v1';
  var DATA = 'data/';

  var CHAPTERS = {
    '1': 'Fundamentals of testing',
    '2': 'Testing throughout the SDLC',
    '3': 'Static testing',
    '4': 'Test analysis and design',
    '5': 'Managing the test activities',
    '6': 'Test tools'
  };

  var viewEl = document.getElementById('view');
  var chipEl = document.getElementById('certChip');
  var toastEl = document.getElementById('toast');
  var themeBtn = document.getElementById('themeBtn');

  var catalog = null;
  var setCache = {};
  var session = null;
  var tickId = null;
  var toastId = null;
  var state = loadState();

  /* -------------------------------------------------------------- state */

  function defaultState() {
    return { v: 1, certId: 'ctfl', theme: 'dark', progress: {}, marks: {}, sessions: [], active: null };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      var p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return defaultState();
      var d = defaultState();
      d.certId = typeof p.certId === 'string' ? p.certId : d.certId;
      d.theme = p.theme === 'light' ? 'light' : 'dark';
      d.progress = p.progress && typeof p.progress === 'object' ? p.progress : {};
      d.marks = p.marks && typeof p.marks === 'object' ? p.marks : {};
      d.sessions = Array.isArray(p.sessions) ? p.sessions : [];
      d.active = p.active && typeof p.active === 'object' ? p.active : null;
      return d;
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore quota or privacy mode */ }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'light' ? '#F2F5F2' : '#07100D');
  }

  /* ------------------------------------------------------------ helpers */

  function h(tag, opts, kids) {
    var e = document.createElement(tag);
    opts = opts || {};
    if (opts.class) e.className = opts.class;
    if (opts.text !== undefined && opts.text !== null) e.textContent = String(opts.text);
    if (opts.href) e.setAttribute('href', opts.href);
    if (opts.src) e.setAttribute('src', opts.src);
    if (opts.type) e.setAttribute('type', opts.type);
    if (opts.id) e.setAttribute('id', opts.id);
    if (opts.value !== undefined) e.value = opts.value;
    if (opts.placeholder) e.setAttribute('placeholder', opts.placeholder);
    if (opts.target) e.setAttribute('target', opts.target);
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) {
        var v = opts.attrs[k];
        if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
      });
    }
    if (opts.on) {
      Object.keys(opts.on).forEach(function (k) { e.addEventListener(k, opts.on[k]); });
    }
    if (kids && kids.length) {
      kids.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    window.clearTimeout(toastId);
    toastId = window.setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  function uid() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function fmtDate(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleDateString(); } catch (e) { return ''; }
  }

  var views = {};

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var okBtn = h('button', {
        class: 'btn ' + (opts.danger === false ? 'primary' : 'danger'),
        attrs: { type: 'button' },
        text: opts.confirmLabel || 'Confirm'
      });
      var cancelBtn = h('button', { class: 'btn ghost', attrs: { type: 'button' }, text: opts.cancelLabel || 'Cancel' });
      var modal = h('div', { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true' } }, [
        h('div', { class: 'modal-card' }, [
          h('h2', { class: 'h2', text: opts.title || 'Are you sure?' }),
          opts.message ? h('p', { class: 'small muted', text: opts.message }) : null,
          h('div', { class: 'row tight' }, [cancelBtn, okBtn])
        ])
      ]);
      function close(result) {
        document.removeEventListener('keydown', onKey);
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        resolve(result);
      }
      function onKey(ev) { if (ev.key === 'Escape') close(false); }
      okBtn.addEventListener('click', function () { close(true); });
      cancelBtn.addEventListener('click', function () { close(false); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(modal);
      window.setTimeout(function () { try { okBtn.focus(); } catch (e) { } }, 20);
    });
  }

  function fetchJSON(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + path + ' (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
  }

  function chapterOf(lo) {
    var m = /^FL-(\d)/.exec(lo || '');
    return m ? m[1] : null;
  }

  function chapterName(lo) {
    var c = chapterOf(lo);
    return c && CHAPTERS[c] ? CHAPTERS[c] : 'General';
  }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function certById(id) {
    if (!catalog || !Array.isArray(catalog.levels)) return null;
    for (var i = 0; i < catalog.levels.length; i++) {
      if (catalog.levels[i].id === id) return catalog.levels[i];
    }
    return null;
  }

  function activeCert() {
    var c = certById(state.certId);
    return c || (catalog && catalog.levels.length ? catalog.levels[0] : null);
  }

  function bankSetIds() {
    var c = certById('ctfl');
    return c && c.bank && Array.isArray(c.bank.sets) ? c.bank.sets.slice() : [];
  }

  function setCached(id) { return setCache[id] || null; }

  function ensureSet(id) {
    if (setCache[id]) return Promise.resolve(setCache[id]);
    return fetchJSON(DATA + 'ctfl/set-' + id + '.json').then(function (data) {
      if (!data || !Array.isArray(data.questions)) throw new Error('Question set ' + id + ' is malformed');
      setCache[id] = data;
      return data;
    });
  }

  function ensureAllSets() {
    return Promise.all(bankSetIds().map(ensureSet)).then(function () { return setCache; });
  }

  function refsForSet(setId) {
    var data = setCached(setId);
    if (!data) return [];
    return data.questions.map(function (q) {
      return { key: setId + '.' + q.n, sid: setId, q: q };
    });
  }

  function allRefs() {
    var out = [];
    bankSetIds().forEach(function (sid) {
      var data = setCached(sid);
      if (!data) return;
      data.questions.forEach(function (q) {
        out.push({ key: sid + '.' + q.n, sid: sid, q: q });
      });
    });
    return out;
  }

  function refByKey(key) {
    var parts = String(key).split('.');
    var sid = parts[0];
    var data = setCached(sid);
    if (!data) return null;
    var n = parts.slice(1).join('.');
    var q = data.questions.filter(function (x) { return String(x.n) === n; })[0];
    return q ? { key: key, sid: sid, q: q } : null;
  }

  function examRefs(setId) {
    if (setId === 'mix') {
      var pool = allRefs().filter(function (r) { return r.q.s === 'exam'; });
      return shuffle(pool).slice(0, 40);
    }
    return refsForSet(setId).filter(function (r) { return r.q.s === 'exam'; });
  }

  function isCorrect(ref, chosen) {
    var want = ref.q.a.slice().sort().join('');
    var got = (chosen || []).slice().sort().join('');
    return want === got && got.length > 0;
  }

  function statsFor(refs) {
    var answered = 0, ok = 0;
    refs.forEach(function (r) {
      var p = state.progress[r.key];
      if (p) {
        answered++;
        if (p.ok) ok++;
      }
    });
    return { answered: answered, ok: ok, total: refs.length, accuracy: answered ? Math.round((ok / answered) * 100) : 0 };
  }

  function record(ref, chosen, ok) {
    state.progress[ref.key] = { c: (chosen || []).slice(), ok: !!ok, t: Date.now() };
    save();
  }

  function isMarked(key) { return !!state.marks[key]; }

  function toggleMark(key) {
    if (state.marks[key]) delete state.marks[key];
    else state.marks[key] = Date.now();
    save();
  }

  function examMinutes() {
    var c = certById('ctfl');
    return c && c.exam && c.exam.minutes ? c.exam.minutes : 60;
  }

  function passMark() {
    var c = certById('ctfl');
    return c && c.exam && c.exam.passMark ? c.exam.passMark : 26;
  }

  /* ------------------------------------------------------------ routing */

  function route() {
    var hash = window.location.hash.replace(/^#/, '');
    return hash || '/home';
  }

  function parts() {
    return route().split('/').filter(function (x) { return x.length > 0; });
  }

  function navigate(path) {
    var next = path.charAt(0) === '#' ? path : '#' + path;
    if (window.location.hash !== next) window.location.hash = next;
    render(true);
  }

  function go(path) { navigate(path); }

  function goBackTo(title, text, hash, label) {
    return h('div', { class: 'wrap' }, [
      h('div', { class: 'card' }, [
        h('h2', { class: 'h2', text: title }),
        h('p', { class: 'small muted', text: text }),
        h('button', {
          class: 'btn small primary', attrs: { type: 'button' }, text: label,
          on: { click: function () { go(hash); } }
        })
      ])
    ]);
  }

  function navActive(name) {
    var links = document.querySelectorAll('.dock a');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-nav') === name) links[i].classList.add('active');
      else links[i].classList.remove('active');
    }
  }

  function refreshChip() {
    if (!chipEl) return;
    var c = activeCert();
    chipEl.textContent = c ? c.code : 'ISTQB';
    if (c && c.bank && c.bank.sets && c.bank.sets.length) chipEl.classList.add('on');
    else chipEl.classList.remove('on');
  }

  function stopTimer() {
    if (tickId) { window.clearInterval(tickId); tickId = null; }
  }

  function mmss(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ------------------------------------------------------- shared pieces */

  function ringNode(value, caption, C, off) {
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'ring');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', caption + ': ' + value + ' percent');
    var track = document.createElementNS(svgNS, 'circle');
    track.setAttribute('class', 'track');
    track.setAttribute('cx', '50');
    track.setAttribute('cy', '50');
    track.setAttribute('r', '42');
    var val = document.createElementNS(svgNS, 'circle');
    val.setAttribute('class', 'value');
    val.setAttribute('cx', '50');
    val.setAttribute('cy', '50');
    val.setAttribute('r', '42');
    val.setAttribute('stroke-dasharray', C.toFixed(2));
    val.setAttribute('stroke-dashoffset', off.toFixed(2));
    var txt = document.createElementNS(svgNS, 'text');
    txt.setAttribute('x', '50');
    txt.setAttribute('y', '57');
    txt.textContent = value + '%';
    svg.appendChild(track);
    svg.appendChild(val);
    svg.appendChild(txt);
    return svg;
  }

  function statCard(num, label) {
    return h('div', { class: 'stat' }, [
      h('div', { class: 'stat-num', text: num }),
      h('div', { class: 'stat-lbl', text: label })
    ]);
  }

  function progressBar(percent) {
    var value = Math.max(0, Math.min(100, percent));
    var fill = h('i', { attrs: { 'data-w': String(value) } });
    window.setTimeout(function () { fill.style.width = value + '%'; }, 0);
    return h('div', { class: 'progress' }, [fill]);
  }

  function heroCard() {
    var refs = allRefs();
    var s = statsFor(refs);
    var C = 2 * Math.PI * 42;
    return h('section', { class: 'card hero' }, [
      h('div', { class: 'stack' }, [
        h('span', { class: 'eyebrow', text: 'Certified Tester Foundation Level' }),
        h('h2', { class: 'h1', text: 'Sample exam trainer' }),
        h('p', { class: 'lede', text: refs.length + ' official CTFL v4.0 sample questions in ' + bankSetIds().length + ' sets, each with the ISTQB answer and a short explanation.' }),
        h('div', { class: 'row tight' }, [
          h('button', { class: 'btn primary', attrs: { type: 'button' }, text: 'Start practising', on: { click: function () { go('#/practice'); } } }),
          h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Mock exam', on: { click: function () { go('#/exam'); } } })
        ])
      ]),
      ringNode(s.accuracy, 'Accuracy so far', C, C * (1 - s.accuracy / 100))
    ]);
  }

  function statsGrid() {
    var refs = allRefs();
    var s = statsFor(refs);
    var marks = refs.filter(function (r) { return isMarked(r.key); }).length;
    var exams = state.sessions.filter(function (x) { return x.kind === 'exam'; }).length;
    return h('section', { class: 'grid grid-3' }, [
      statCard(String(s.answered), 'Answered'),
      statCard(s.accuracy + '%', 'Accuracy'),
      statCard(String(marks), 'Bookmarked'),
      statCard(String(exams), 'Mock exams')
    ]);
  }

  function certRow(c) {
    var ready = !!(c.bank && c.bank.sets && c.bank.sets.length);
    return h('a', { class: 'pick', href: '#/cert/' + c.id }, [
      h('div', { class: 'pick-top' }, [
        h('span', { class: 'pick-code', text: c.code }),
        ready
          ? h('span', { class: 'badge ready', text: 'Questions ready' })
          : h('span', { class: 'badge soon', text: 'No questions yet' })
      ]),
      h('span', { class: 'pick-name', text: c.name }),
      h('span', { class: 'small muted', text: c.short })
    ]);
  }

  function footerNote() {
    return h('footer', { class: 'foot' }, [
      h('p', { text: catalog.copyright }),
      h('p', {}, [
        h('span', { text: 'Primary source: ' }),
        h('a', { href: 'https://istqb.org/certifications/', attrs: { rel: 'noopener' }, text: 'istqb.org/certifications' })
      ])
    ]);
  }

  function feeFor(group) {
    var f = catalog.fees || {};
    var range = (f.groups && f.groups[group]) || '';
    return 'ISTQB does not set exam prices: your Member Board or an accredited exam provider does (' + range + ').';
  }

  function setCard(sid) {
    var refs = refsForSet(sid);
    var s = statsFor(refs);
    var data = setCached(sid);
    var label = data ? data.label : ('Set ' + sid.toUpperCase());
    var version = data ? data.version : '';
    return h('div', { class: 'bankcard' }, [
      h('div', { class: 'pick-top' }, [
        h('strong', { text: label }),
        h('span', { class: 'badge', text: 'v' + version })
      ]),
      h('div', { class: 'metric', text: refs.length + ' questions · ' + examRefsCount(sid) + ' exam-shaped · ' + s.answered + ' answered · ' + s.accuracy + '% correct' }),
      h('div', { class: 'row tight' }, [
        h('button', { class: 'btn small primary', attrs: { type: 'button' }, text: 'Practise', on: { click: function () { startPractice(sid); } } }),
        h('button', { class: 'btn small', attrs: { type: 'button' }, text: 'Mock exam', on: { click: function () { startExam(sid); } } })
      ])
    ]);
  }

  /* -------------------------------------------------------------- views */

  function viewHome() {
    navActive('home');
    document.title = 'CertStudy - ISTQB CTFL practice';
    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Your study desk' }),
        h('h1', { class: 'h1', text: 'Pass the ISTQB exam with the official questions' })
      ])
    ]);
    if (state.active) wrap.appendChild(resumeBanner());
    wrap.appendChild(heroCard());
    wrap.appendChild(statsGrid());
    wrap.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'row' }, [
        h('h2', { class: 'h2', text: 'Choose your certification' }),
        h('a', { class: 'small', href: '#/exams', text: 'All certifications' })
      ]),
      h('p', { class: 'small muted', text: 'CTFL v4.0 has its full sample exam bank. Every other certification can be selected and shows its audience, prerequisites and fee guidance; their questions are added in a later phase.' }),
      h('div', { class: 'stack' }, catalog.levels.slice(0, 3).map(certRow))
    ]));
    wrap.appendChild(footerNote());
    return wrap;
  }

  function resumeBanner() {
    var a = state.active;
    var left = a.deadline ? Math.max(0, Math.ceil((a.deadline - Date.now()) / 60000)) : 0;
    return h('div', { class: 'notice' }, [
      h('div', { class: 'stack' }, [
        h('strong', { text: 'A mock exam is in progress' }),
        h('span', { class: 'small muted', text: (a.keys ? a.keys.length : 0) + ' questions, about ' + left + ' minutes left.' }),
        h('div', { class: 'row tight' }, [
          h('button', { class: 'btn small primary', attrs: { type: 'button' }, text: 'Resume exam', on: { click: function () { go('#/exam/run'); } } }),
          h('button', { class: 'btn small ghost', attrs: { type: 'button' }, text: 'Discard', on: { click: function () { state.active = null; save(); render(); } } })
        ])
      ])
    ]);
  }

  function viewExams() {
    navActive('exams');
    document.title = 'Exams and sample tests - CertStudy';
    var sets = bankSetIds();
    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Everything for the CTFL exam' }),
        h('h1', { class: 'h1', text: 'Exams and sample tests' }),
        h('p', { class: 'lede', text: 'Official sample tests, the official PDF papers and the exam rules, in one section.' })
      ])
    ]);

    var tests = h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Official sample tests' }),
      h('p', { class: 'small muted', text: '186 ISTQB sample questions from the four published sets. Practise with explanations, or sit a set as a timed 40-question paper.' })
    ]);
    sets.forEach(function (sid) {
      var data = setCached(sid);
      var st = statsFor(refsForSet(sid));
      tests.appendChild(h('div', { class: 'deckrow' }, [
        h('div', { class: 'stack' }, [
          h('strong', { text: data ? data.label : 'Set ' + sid.toUpperCase() }),
          h('span', { class: 'small muted', text: refsForSet(sid).length + ' questions · ' + examRefsCount(sid) + ' in the timed paper · ' + st.answered + ' answered' })
        ]),
        h('div', { class: 'row tight' }, [
          h('button', { class: 'btn small', attrs: { type: 'button' }, text: 'Practise', on: { click: function () { startPractice(sid); } } }),
          h('button', { class: 'btn small primary', attrs: { type: 'button' }, text: 'Mock exam', on: { click: function () { startExam(sid); } } })
        ])
      ]));
    });
    tests.appendChild(h('div', { class: 'row tight' }, [
      h('button', { class: 'btn small', attrs: { type: 'button' }, text: 'Mixed practice, all sets', on: { click: function () { startPractice('mix'); } } }),
      h('button', { class: 'btn small', attrs: { type: 'button' }, text: 'Random 40-question paper', on: { click: function () { startExam('mix'); } } })
    ]));
    wrap.appendChild(tests);

    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Official exam papers' }),
      h('p', { class: 'small muted', text: 'The ISTQB PDFs, readable in the app: questions, answers with justifications, and the syllabus.' }),
      h('div', { class: 'grid grid-2' }, sets.map(function (sid) { return docRow(sid + '-questions'); })),
      h('div', { class: 'grid grid-2' }, sets.map(function (sid) { return docRow(sid + '-answers'); })),
      h('div', { class: 'row tight' }, [docRow('syllabus')])
    ]));

    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Exam rules' }),
      h('dl', { class: 'kv' }, [
        h('dt', { text: 'Questions' }), h('dd', { text: '40, one point each' }),
        h('dt', { text: 'Pass mark' }), h('dd', { text: passMark() + ' of 40' }),
        h('dt', { text: 'Time' }), h('dd', { text: examMinutes() + ' minutes, plus 25% when the exam language is not your first language' }),
        h('dt', { text: 'Scoring' }), h('dd', { text: 'No partial credit: a two-option question scores only when both are right' }),
        h('dt', { text: 'How official is a sample test?' }), h('dd', { text: 'The ISTQB sample exams are practice papers, and ISTQB states they cannot be used as-is in an official examination.' })
      ])
    ]));

    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Other certifications' }),
      h('p', { class: 'small muted', text: 'Every ISTQB certification is listed with its audience, prerequisites and fee guidance.' }),
      h('a', { class: 'btn small', href: '#/certs', text: 'Browse all certifications' })
    ]));

    wrap.appendChild(footerNote());
    return wrap;
  }

  function viewCerts() {
    navActive('exams');
    document.title = 'Certifications - CertStudy';
    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'The ISTQB scheme' }),
        h('h1', { class: 'h1', text: 'Every certification in one place' }),
        h('p', { class: 'lede', text: 'Select a certification to read who it is for, what it requires and how exam fees work. CTFL v4.0 comes with the full sample exam bank loaded.' })
      ])
    ]);
    ['Foundation', 'Advanced', 'Specialist', 'Expert'].forEach(function (group) {
      var list = catalog.levels.filter(function (c) { return c.group === group; });
      if (!list.length) return;
      wrap.appendChild(h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: group }),
        h('p', { class: 'small muted', text: feeFor(group) }),
        h('div', { class: 'stack' }, list.map(certRow))
      ]));
    });
    wrap.appendChild(footerNote());
    return wrap;
  }

  function viewCert(id) {
    navActive('exams');
    var c = certById(id);
    if (!c) return h('div', { class: 'wrap' }, [h('p', { text: 'Unknown certification.' })]);
    document.title = c.name + ' - CertStudy';
    var ready = !!(c.bank && c.bank.sets && c.bank.sets.length);
    if (ready) { state.certId = c.id; save(); }

    var actions = h('div', { class: 'row tight' });
    if (ready) {
      actions.appendChild(h('button', { class: 'btn small primary', attrs: { type: 'button' }, text: 'Practise questions', on: { click: function () { go('#/practice'); } } }));
      actions.appendChild(h('button', { class: 'btn small', attrs: { type: 'button' }, text: 'Mock exam', on: { click: function () { go('#/exam'); } } }));
    } else {
      actions.appendChild(h('span', { class: 'badge soon', text: 'Questions in a later phase' }));
    }

    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('a', { class: 'small', href: '#/exams', text: 'Back to all certifications' }),
        h('span', { class: 'eyebrow', text: c.group + ' level' }),
        h('h1', { class: 'h1', text: c.name }),
        h('p', { class: 'lede', text: c.short })
      ]),
      h('section', { class: 'card' }, [
        h('div', { class: 'row' }, [
          h('div', { class: 'stack' }, [
            h('span', { class: 'pick-code', text: c.code }),
            h('strong', { text: c.name })
          ]),
          actions
        ])
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'About this certification' }),
        h('dl', { class: 'kv' }, [
          h('dt', { text: 'Audience' }),
          h('dd', { text: c.audience || 'See the official certification page.' }),
          h('dt', { text: 'Prerequisites' }),
          h('dd', { text: c.prerequisites || 'See the official certification page.' }),
          h('dt', { text: 'Exam structure' }),
          h('dd', { text: c.exam ? (c.exam.questions + ' questions, ' + c.exam.points + ' points, pass mark ' + c.exam.passMark + ', ' + c.exam.minutes + ' minutes. ' + (c.exam.extraTime || '')) : 'Set per syllabus; see the official Exam Structure and Rules document on istqb.org.' }),
          h('dt', { text: 'Exam fee' }),
          h('dd', { text: feeFor(c.group) + ' ' + ((catalog.fees && catalog.fees.retake) || '') }),
          h('dt', { text: 'Questions here' }),
          h('dd', { text: ready ? (c.bank.total + ' official sample questions in ' + c.bank.sets.length + ' sets') : 'None yet. This certification is selectable now so the full scheme is visible; its bank arrives in a later phase.' })
        ])
      ])
    ]);

    if (ready) {
      wrap.appendChild(h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'Sample exam sets' }),
        h('p', { class: 'small muted', text: 'Each ISTQB set holds 40 exam-shaped questions plus its additional questions, with the official answers and a short explanation.' }),
        h('div', { class: 'grid grid-2' }, bankSetIds().map(setCard))
      ]));
    }
    wrap.appendChild(footerNote());
    return wrap;
  }

  function viewPractice() {
    navActive('practice');
    document.title = 'Practise - CertStudy';
    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Active recall' }),
        h('h1', { class: 'h1', text: 'Practise with explanations' }),
        h('p', { class: 'lede', text: 'Pick a set. Every question shows the official answer and why the other options are wrong, right after you check.' })
      ])
    ]);

    var onlyWrong = h('input', { attrs: { type: 'checkbox', id: 'onlyWrong' } });
    var doShuffle = h('input', { attrs: { type: 'checkbox', id: 'doShuffle', checked: 'checked' } });
    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Session options' }),
      h('label', { class: 'row tight', attrs: { for: 'onlyWrong' } }, [onlyWrong, h('span', { class: 'small muted', text: 'Only questions I have not answered correctly yet' })]),
      h('label', { class: 'row tight', attrs: { for: 'doShuffle' } }, [doShuffle, h('span', { class: 'small muted', text: 'Shuffle the question order' })])
    ]));

    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Question sets' }),
      h('div', { class: 'grid grid-2' }, bankSetIds().map(setCard)),
      h('div', { class: 'row tight' }, [
        h('button', {
          class: 'btn small', attrs: { type: 'button' }, text: 'Mixed practice across all sets',
          on: { click: function () { startPractice('mix'); } }
        })
      ])
    ]));

    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Source documents' }),
      h('p', { class: 'small muted', text: 'The official ISTQB PDFs, converted page by page and readable inside the app with scroll. Opening a question reference jumps straight to it.' }),
      h('div', { class: 'grid grid-2' }, [
        docRow('a-questions'), docRow('a-answers'),
        docRow('b-questions'), docRow('b-answers'),
        docRow('c-questions'), docRow('c-answers'),
        docRow('d-questions'), docRow('d-answers'),
        docRow('syllabus')
      ].filter(Boolean))
    ]));

    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Where the questions come from' }),
      h('p', { class: 'small muted', text: 'All four CTFL v4.0 sample exams published on istqb.org (sets A to D) are in this database: the 40 exam-shaped questions of each set and the additional questions ISTQB publishes with them.' })
    ]));
    wrap.appendChild(footerNote());

    wrap.__opts = function () {
      return { onlyWrong: onlyWrong.checked, shuffle: doShuffle.checked };
    };
    return wrap;
  }

  function startPractice(setId) {
    var opts = { onlyWrong: false, shuffle: true };
    var host = document.getElementById('view');
    var ow = host.querySelector('#onlyWrong');
    var sh = host.querySelector('#doShuffle');
    if (ow) opts.onlyWrong = ow.checked;
    if (sh) opts.shuffle = sh.checked;

    var refs = setId === 'mix' ? allRefs() : refsForSet(setId);
    if (opts.onlyWrong) {
      refs = refs.filter(function (r) {
        var p = state.progress[r.key];
        return !p || !p.ok;
      });
    }
    if (!refs.length) {
      toast('Nothing left in that filter. Nice work!');
      return;
    }
    if (opts.shuffle) refs = shuffle(refs);

    session = { kind: 'practice', setId: setId, refs: refs, index: 0, answers: {}, checked: {} };
    go('#/practice/run');
  }

  function viewPracticeRun() {
    navActive('practice');
    if (!session || session.kind !== 'practice' || !session.refs.length) {
      return goBackTo('No practice session yet', 'Pick a question set to start practising.', '#/practice', 'Choose a set');
    }
    var total = session.refs.length;
    var i = Math.max(0, Math.min(session.index, total - 1));
    session.index = i;
    var ref = session.refs[i];
    var q = ref.q;
    var chosen = session.answers[ref.key] || [];
    var checked = !!session.checked[ref.key];
    var multi = q.a.length > 1;
    document.title = 'Question ' + (i + 1) + ' of ' + total + ' - CertStudy';

    var wrap = h('div', { class: 'wrap' });

    wrap.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'qhead' }, [
        h('span', { class: 'qno', text: 'Question ' + (i + 1) + ' of ' + total + ' · ' + (q.s === 'exam' ? 'Exam set' : 'Additional') + ' · ' + (q.p || 1) + ' point' }),
        h('div', { class: 'row tight' }, [
          h('span', { class: 'tiny muted', text: q.lo + ' · ' + q.k }),
          h('button', {
            class: 'btn small ghost', attrs: { type: 'button' },
            text: isMarked(ref.key) ? 'Bookmarked' : 'Bookmark',
            on: {
              click: function () {
                toggleMark(ref.key);
                toast(isMarked(ref.key) ? 'Saved to your review list' : 'Removed from bookmarks');
                render();
              }
            }
          })
        ])
      ]),
      progressBar(pct(i, total)),
      h('p', { class: 'qstem', text: q.q }),
      multi ? h('p', { class: 'qhint', text: 'Select ' + (q.a.length === 2 ? 'TWO' : q.a.length) + ' options.' }) : null,
      optionsBlock(ref, chosen, checked, multi, function (key) {
        var list = (session.answers[ref.key] || []).slice();
        var at = list.indexOf(key);
        if (at >= 0) list.splice(at, 1);
        else {
          if (multi) { if (list.length < q.a.length) list.push(key); }
          else list = [key];
        }
        session.answers[ref.key] = list;
        render();
      }),
      feedbackBlock(ref, chosen, checked),
      actionsBlock(ref, chosen, checked, i, total)
    ]));

    wrap.appendChild(h('div', { class: 'card tight' }, [
      h('div', { class: 'row tight' }, [
        h('span', { class: 'small muted', text: 'Answers revealed' }),
        h('span', { class: 'small', text: countCheckedCorrect() + ' correct of ' + countChecked() + ' shown' })
      ]),
      h('p', { class: 'tiny muted', text: 'Choosing an option never reveals the answer. Use Show answer when you are ready. Keyboard: 1 to 5 to choose, Enter to show the answer, Enter again for the next question.' })
    ]));
    return wrap;
  }

  function optionsBlock(ref, chosen, checked, multi, onPick) {
    var q = ref.q;
    var list = h('div', { class: 'opts', attrs: { role: 'group', 'aria-label': 'Answer options' } });
    q.o.forEach(function (o, idx) {
      var key = o[0];
      var isSel = chosen.indexOf(key) >= 0;
      var cls = 'opt';
      if (checked) {
        if (q.a.indexOf(key) >= 0) cls += ' correct';
        else if (isSel) cls += ' wrong';
        else cls += ' dim';
      } else if (isSel) {
        cls += ' sel';
      }
      list.appendChild(h('button', {
        class: cls,
        attrs: { type: 'button', 'aria-pressed': isSel ? 'true' : 'false', 'aria-label': 'Option ' + key },
        on: { click: function () { if (!checked) onPick(key); } }
      }, [
        h('span', { class: 'key', text: key }),
        h('span', { class: 'txt', text: o[1] })
      ]));
    });
    return list;
  }

  /* ---------------------------------------------------- source documents */

  var DOCS = {
    'a-questions': { kind: 'questions', sid: 'a', title: 'CTFL sample exam A - Questions', file: 'docs/ctfl/set-a-questions.pdf', note: 'ISTQB CTFL v4.0 sample exam set A, questions v1.7, shown from the official PDF.' },
    'a-answers': { kind: 'answers', sid: 'a', title: 'CTFL sample exam A - Answers', file: 'docs/ctfl/set-a-answers.pdf', note: 'ISTQB CTFL v4.0 sample exam set A, answers and justifications v1.7, shown from the official PDF.' },
    'b-questions': { kind: 'questions', sid: 'b', title: 'CTFL sample exam B - Questions', file: 'docs/ctfl/set-b-questions.pdf', note: 'ISTQB CTFL v4.0 sample exam set B, questions v1.7, shown from the official PDF.' },
    'b-answers': { kind: 'answers', sid: 'b', title: 'CTFL sample exam B - Answers', file: 'docs/ctfl/set-b-answers.pdf', note: 'ISTQB CTFL v4.0 sample exam set B, answers and justifications v1.7, shown from the official PDF.' },
    'c-questions': { kind: 'questions', sid: 'c', title: 'CTFL sample exam C - Questions', file: 'docs/ctfl/set-c-questions.pdf', note: 'ISTQB CTFL v4.0 sample exam set C, questions v1.6, shown from the official PDF.' },
    'c-answers': { kind: 'answers', sid: 'c', title: 'CTFL sample exam C - Answers', file: 'docs/ctfl/set-c-answers.pdf', note: 'ISTQB CTFL v4.0 sample exam set C, answers and justifications v1.6, shown from the official PDF.' },
    'd-questions': { kind: 'questions', sid: 'd', title: 'CTFL sample exam D - Questions', file: 'docs/ctfl/set-d-questions.pdf', note: 'ISTQB CTFL v4.0 sample exam set D, questions v1.5, shown from the official PDF.' },
    'd-answers': { kind: 'answers', sid: 'd', title: 'CTFL sample exam D - Answers', file: 'docs/ctfl/set-d-answers.pdf', note: 'ISTQB CTFL v4.0 sample exam set D, answers and justifications v1.5, shown from the official PDF.' },
    'syllabus': { kind: 'syllabus', sid: 'ctfl', title: 'CTFL syllabus v4.0.1', file: 'docs/ctfl/syllabus-v4.0.1.pdf', note: 'The ISTQB Certified Tester Foundation Level syllabus, version 4.0.1, shown from the official PDF.' }
  };

  var pdfLibPromise = null;
  var docToken = 0;
  var docObserver = null;

  function docsCleanup() {
    docToken += 1;
    if (docObserver) {
      try { docObserver.disconnect(); } catch (e) { /* ignore */ }
      docObserver = null;
    }
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'assets/vendor/pdfjs/pdf.min.js';
      script.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('The PDF viewer did not start')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      script.onerror = function () { reject(new Error('The PDF viewer could not be loaded')); };
      document.head.appendChild(script);
    });
    return pdfLibPromise;
  }

  function escapeRe(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function looksLikeIndexPage(text) {
    return /\.{8,}/.test(text) || /table of contents/i.test(text);
  }

  function findPage(pdf, matcher, token, needle) {
    var index = 1;
    function step() {
      if (token !== docToken) return Promise.resolve(null);
      if (index > pdf.numPages) return Promise.resolve(null);
      var n = index;
      index += 1;
      return pdf.getPage(n).then(function (page) {
        return Promise.all([page.getTextContent(), Promise.resolve(page.getViewport({ scale: 1 }).height)]);
      }).then(function (res) {
        var content = res[0];
        var height = res[1] || 792;
        var text = '';
        var baseline = null;
        content.items.forEach(function (item) {
          text += (item.str || '') + ' ';
          if (baseline === null && needle && typeof item.str === 'string' && item.str.indexOf(needle) >= 0) {
            if (item.transform && typeof item.transform[5] === 'number') baseline = item.transform[5];
          }
        });
        if (!matcher.test(text) || looksLikeIndexPage(text)) return step();
        var fraction = 0;
        if (baseline !== null) fraction = Math.max(0, Math.min(0.9, 1 - (baseline / height)));
        return { page: n, fraction: fraction };
      });
    }
    return step();
  }

  function docHref(docId, target) {
    return '#/doc/' + docId + (target ? '/' + encodeURIComponent(target) : '');
  }

  function docRow(docId) {
    var doc = DOCS[docId];
    if (!doc) return null;
    return h('a', { class: 'pick', href: docHref(docId) }, [
      h('div', { class: 'pick-top' }, [
        h('span', { class: 'pick-code', text: doc.kind === 'syllabus' ? 'Syllabus' : 'Sample exam' }),
        h('span', { class: 'badge', text: 'PDF' })
      ]),
      h('span', { class: 'pick-name', text: doc.title })
    ]);
  }

  function viewDoc(docId, target) {
    var doc = DOCS[docId];
    if (!doc) {
      return goBackTo('Document not found', 'That source document is not part of this app.', '#/practice', 'Back to practice');
    }
    navActive('practice');
    document.title = doc.title + ' - CertStudy';
    var token = ++docToken;

    var status = h('div', { class: 'pdf-status', text: 'Loading the document…' });
    var counter = h('span', { class: 'small muted', text: '' });
    var zoomLabel = h('span', { class: 'small muted', text: '100%' });
    var viewEl2 = h('div', { class: 'pdf-view' });
    var zoom = 1;
    var hooks = { rerender: function () { } };

    function setZoom(delta) {
      zoom = Math.max(0.6, Math.min(2.4, Math.round((zoom + delta) * 100) / 100));
      zoomLabel.textContent = Math.round(zoom * 100) + '%';
      hooks.rerender();
    }

    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('a', { class: 'small', href: '#/practice', text: 'Back to practice' }),
        h('span', { class: 'eyebrow', text: 'ISTQB source document' }),
        h('h1', { class: 'h1', text: doc.title }),
        h('p', { class: 'small muted', text: doc.note })
      ]),
      h('div', { class: 'pdf-toolbar' }, [
        counter,
        h('div', { class: 'row tight' }, [
          h('button', { class: 'btn small', attrs: { type: 'button', 'aria-label': 'Zoom out' }, text: '−', on: { click: function () { setZoom(-0.15); } } }),
          zoomLabel,
          h('button', { class: 'btn small', attrs: { type: 'button', 'aria-label': 'Zoom in' }, text: '+', on: { click: function () { setZoom(0.15); } } }),
          h('a', { class: 'btn small ghost', href: doc.file, attrs: { target: '_blank', rel: 'noopener' }, text: 'Open PDF' })
        ])
      ]),
      status,
      viewEl2,
      h('p', { class: 'tiny muted', text: 'Rendered from the official ISTQB PDF. Scrolling loads pages as you need them.' }),
      footerNote()
    ]);

    window.setTimeout(function () {
      if (token !== docToken) return;
      loadPdfJs().then(function (lib) {
        return lib.getDocument({ url: doc.file, isEvalSupported: false, enableXfa: false }).promise;
      }).then(function (pdf) {
        if (token !== docToken) return;
        status.textContent = '';
        counter.textContent = pdf.numPages + ' pages';
        hooks = buildDocPages(pdf, viewEl2, doc, target, token, function () { return zoom; });
      }).catch(function (err) {
        if (token !== docToken) return;
        status.textContent = 'This document could not be displayed in the app: ' + ((err && err.message) || err) + ' ';
        status.appendChild(h('a', { href: doc.file, attrs: { target: '_blank', rel: 'noopener' }, text: 'Open the PDF directly' }));
      });
    }, 0);

    return wrap;
  }

  function buildDocPages(pdf, host, doc, target, token, getZoom) {
    var boxes = [];
    var hooks = { rerender: function () { } };

    function renderBox(box) {
      if (box.__rendered || box.__busy) return;
      box.__busy = true;
      var n = box.__pageNumber;
      pdf.getPage(n).then(function (page) {
        if (token !== docToken) return null;
        var base = page.getViewport({ scale: 1 });
        var width = host.clientWidth || 360;
        var scale = (width / base.width) * getZoom();
        var vp = page.getViewport({ scale: scale });
        var canvas = box.__canvas;
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        var ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise;
      }).then(function () {
        box.__rendered = true;
        box.__busy = false;
      }).catch(function () {
        box.__busy = false;
      });
    }

    function releaseBox(box) {
      if (!box.__rendered) return;
      box.__canvas.width = 0;
      box.__canvas.height = 0;
      box.__rendered = false;
    }

    function farAway(box) {
      var rect = box.getBoundingClientRect();
      return rect.bottom < -2600 || rect.top > (window.innerHeight + 2600);
    }

    function nearView(box) {
      var rect = box.getBoundingClientRect();
      return rect.bottom > -700 && rect.top < (window.innerHeight + 700);
    }

    function rerenderNear() {
      boxes.forEach(function (box) {
        if (nearView(box)) {
          releaseBox(box);
          renderBox(box);
        }
      });
    }
    hooks.rerender = rerenderNear;

    pdf.getPage(1).then(function (page) {
      if (token !== docToken) return null;
      var vp = page.getViewport({ scale: 1 });
      var ratio = vp.width + ' / ' + vp.height;
      for (var i = 1; i <= pdf.numPages; i++) {
        var box = h('div', { class: 'pdf-page', attrs: { 'data-page': String(i), 'aria-label': 'Page ' + i } });
        try { box.style.aspectRatio = ratio; } catch (e) { /* older engine */ }
        box.style.minHeight = '240px';
        var canvas = h('canvas');
        box.appendChild(canvas);
        box.__canvas = canvas;
        box.__pageNumber = i;
        box.__rendered = false;
        box.__busy = false;
        boxes.push(box);
        host.appendChild(box);
      }

      if ('IntersectionObserver' in window) {
        var io = new window.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (token !== docToken) return;
            if (entry.isIntersecting) renderBox(entry.target);
            else if (farAway(entry.target)) releaseBox(entry.target);
          });
        }, { rootMargin: '700px 0px' });
        boxes.forEach(function (box) { io.observe(box); });
        docObserver = io;
      } else {
        boxes.forEach(renderBox);
      }

      if (!target) return null;
      var matcher;
      var needle;
      if (doc.kind === 'questions') {
        matcher = new RegExp('Question\\s*#\\s*' + escapeRe(target) + '\\b');
        needle = '#' + target;
      } else {
        needle = String(target).replace(/^FL-/, '');
        matcher = new RegExp('\\b' + escapeRe(needle) + '\\b');
      }
      return findPage(pdf, matcher, token, needle).then(function (found) {
        if (!found || !found.page || token !== docToken) return;
        var hit = boxes[found.page - 1];
        if (!hit) return;
        hit.classList.add('hit');
        renderBox(hit);
        window.setTimeout(function () {
          if (token !== docToken) return;
          try { hit.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { }
          var fraction = found.fraction || 0;
          if (fraction > 0.02) {
            window.setTimeout(function () {
              if (token !== docToken) return;
              var extra = Math.round(hit.offsetHeight * fraction) - 88;
              if (extra > 0) window.scrollBy({ top: extra, behavior: 'smooth' });
            }, 400);
          }
        }, 150);
      });
    });

    return hooks;
  }

  function referenceNode(ref) {
    var sid = ref.sid;
    var data = setCached(sid);
    var setLabel = data && data.label ? data.label.replace('Sample Exam Set ', '') : sid.toUpperCase();
    var n = String(ref.q.n);
    var lo = ref.q.lo || '';
    var loNum = lo.replace(/^FL-/, '');
    var out = h('div', { class: 'ref' }, [h('span', { text: 'Source: ' })]);
    out.appendChild(h('a', {
      href: docHref(sid + '-questions', n),
      text: 'Exam ' + setLabel + ' questions, Q' + n
    }));
    out.appendChild(h('span', { text: ' · ' }));
    out.appendChild(h('a', {
      href: docHref(sid + '-answers'),
      text: 'Answers'
    }));
    if (lo) {
      out.appendChild(h('span', { text: ' · ' }));
      out.appendChild(h('a', {
        href: docHref('syllabus', loNum),
        text: 'Syllabus ' + lo
      }));
    }
    out.appendChild(h('span', { text: ' · ' + ref.q.k + ' · ' + chapterName(ref.q.lo) }));
    return out;
  }

  function feedbackBlock(ref, chosen, checked) {
    if (!checked) return null;
    var ok = isCorrect(ref, chosen);
    var joined = ref.q.a.join(', ');
    var verdict = ok ? 'Correct' : (chosen.length ? 'Not quite - the answer is ' + joined : 'The answer is ' + joined);
    return h('div', { class: 'feedback ' + (ok ? 'ok' : 'no'), attrs: { role: 'status' } }, [
      h('div', { class: 'verdict', text: verdict }),
      h('div', { class: 'exp', text: ref.q.e }),
      referenceNode(ref)
    ]);
  }

  function revealAnswer(ref) {
    if (!session || session.kind !== 'practice') return;
    if (session.checked[ref.key]) return;
    session.checked[ref.key] = true;
    var chosen = session.answers[ref.key] || [];
    if (chosen.length) record(ref, chosen, isCorrect(ref, chosen));
    render();
  }

  function actionsBlock(ref, chosen, checked, i, total) {
    return h('div', { class: 'navq' }, [
      h('button', {
        class: 'btn small ghost',
        attrs: { type: 'button', disabled: i === 0 ? 'disabled' : null },
        text: 'Previous',
        on: { click: function () { if (i > 0) { session.index = i - 1; render(); } } }
      }),
      h('div', { class: 'row tight' }, [
        checked
          ? h('span', { class: 'badge ready', text: 'Answer shown' })
          : h('button', {
            class: 'btn small',
            attrs: { type: 'button' },
            text: 'Show answer',
            on: { click: function () { revealAnswer(ref); } }
          }),
        h('button', {
          class: 'btn small primary',
          attrs: { type: 'button' },
          text: i === total - 1 ? 'Finish session' : 'Next',
          on: {
            click: function () {
              if (i === total - 1) go('#/practice/done');
              else { session.index = i + 1; render(); }
            }
          }
        })
      ])
    ]);
  }

  function countChecked() {
    if (!session) return 0;
    return Object.keys(session.checked || {}).length;
  }

  function countCheckedCorrect() {
    if (!session) return 0;
    var n = 0;
    Object.keys(session.checked || {}).forEach(function (k) {
      var p = state.progress[k];
      if (p && p.ok) n++;
    });
    return n;
  }

  function viewPracticeDone() {
    navActive('practice');
    if (!session || session.kind !== 'practice') {
      return goBackTo('No session to summarise', 'Start a practice session to see a summary here.', '#/practice', 'Practise');
    }
    document.title = 'Session summary - CertStudy';
    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Session complete' }),
        h('h1', { class: 'h1', text: countCheckedCorrect() + ' of ' + countChecked() + ' correct' })
      ]),
      h('section', { class: 'card' }, [
        h('p', { class: 'lede', text: 'You checked ' + countChecked() + ' of ' + session.refs.length + ' questions in this session, with ' + pct(countCheckedCorrect(), countChecked()) + '% correct.' }),
        h('div', { class: 'row tight' }, [
          h('button', { class: 'btn primary', attrs: { type: 'button' }, text: 'Review mistakes', on: { click: function () { go('#/review'); } } }),
          h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Another session', on: { click: function () { go('#/practice'); } } }),
          h('button', { class: 'btn ghost', attrs: { type: 'button' }, text: 'Home', on: { click: function () { go('#/home'); } } })
        ])
      ]),
      footerNote()
    ]);
    return wrap;
  }

  function viewExamSetup() {
    navActive('exams');
    document.title = 'Mock exam - CertStudy';
    var refs = allRefs().filter(function (r) { return r.q.s === 'exam'; });
    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Exam simulation' }),
        h('h1', { class: 'h1', text: 'Mock exam' }),
        h('p', { class: 'lede', text: 'The real CTFL exam has 40 questions, 60 minutes and a pass mark of ' + passMark() + '. Answers are hidden until you submit.' })
      ])
    ]);

    var bank = h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Choose a paper' }),
      h('p', { class: 'small muted', text: 'A single ISTQB set gives you its 40 exam-shaped questions in the published order. The mixed paper draws 40 questions at random from the whole bank.' })
    ]);
    var grid = h('div', { class: 'grid grid-2' });
    bankSetIds().forEach(function (sid) {
      var data = setCached(sid);
      var count = examRefsCount(sid);
      grid.appendChild(h('div', { class: 'bankcard' }, [
        h('strong', { text: data ? data.label : 'Set ' + sid.toUpperCase() }),
        h('span', { class: 'metric', text: count + ' questions · 60 minutes' }),
        h('button', { class: 'btn small primary', attrs: { type: 'button' }, text: 'Start this paper', on: { click: function () { startExam(sid); } } })
      ]));
    });
    bank.appendChild(grid);
    bank.appendChild(h('div', { class: 'row tight' }, [
      h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Mixed 40-question paper', on: { click: function () { startExam('mix'); } } })
    ]));
    wrap.appendChild(bank);
    wrap.appendChild(h('section', { class: 'card' }, [
      h('h2', { class: 'h2', text: 'Exam rules' }),
      h('dl', { class: 'kv' }, [
        h('dt', { text: 'Questions' }), h('dd', { text: '40, one point each' }),
        h('dt', { text: 'Pass mark' }), h('dd', { text: passMark() + ' of 40' }),
        h('dt', { text: 'Time' }), h('dd', { text: '60 minutes, plus 25% extra when the exam language is not your first language' }),
        h('dt', { text: 'Scoring' }), h('dd', { text: 'No partial credit: a question that needs two options scores only when both are right' }),
        h('dt', { text: 'Available questions' }), h('dd', { text: refs.length + ' exam-shaped questions across all sets' })
      ])
    ]));
    wrap.appendChild(footerNote());
    return wrap;
  }

  function examRefsCount(sid) {
    return refsForSet(sid).filter(function (r) { return r.q.s === 'exam'; }).length;
  }

  function startExam(setId) {
    var refs = examRefs(setId);
    if (!refs.length) { toast('No questions available for that paper'); return; }
    var mins = examMinutes();
    session = {
      kind: 'exam',
      setId: setId,
      refs: refs,
      index: 0,
      answers: {},
      startedAt: Date.now(),
      deadline: Date.now() + mins * 60000,
      minutes: mins,
      submitted: false
    };
    saveActive();
    go('#/exam/run');
  }

  function saveActive() {
    if (session && session.kind === 'exam' && !session.submitted) {
      state.active = {
        setId: session.setId,
        keys: session.refs.map(function (r) { return r.key; }),
        answers: session.answers,
        index: session.index,
        startedAt: session.startedAt,
        deadline: session.deadline,
        minutes: session.minutes
      };
    } else {
      state.active = null;
    }
    save();
  }

  function restoreActive() {
    var a = state.active;
    if (!a || !Array.isArray(a.keys)) return Promise.resolve(false);
    return ensureAllSets().then(function () {
      var refs = a.keys.map(refByKey).filter(Boolean);
      if (!refs.length) { state.active = null; save(); return false; }
      session = {
        kind: 'exam',
        setId: a.setId,
        refs: refs,
        index: Math.max(0, Math.min(a.index || 0, refs.length - 1)),
        answers: a.answers && typeof a.answers === 'object' ? a.answers : {},
        startedAt: a.startedAt || Date.now(),
        deadline: a.deadline || (Date.now() + (a.minutes || examMinutes()) * 60000),
        minutes: a.minutes || examMinutes(),
        submitted: false
      };
      return true;
    });
  }

  function viewExamRun() {
    navActive('exams');
    if (!session || session.kind !== 'exam' || session.submitted) {
      return goBackTo('No exam in progress', 'Choose a 40-question paper to start a timed mock exam.', '#/exam', 'Choose a paper');
    }
    var total = session.refs.length;
    var i = Math.max(0, Math.min(session.index, total - 1));
    session.index = i;
    var ref = session.refs[i];
    var q = ref.q;
    var chosen = session.answers[ref.key] || [];
    var multi = q.a.length > 1;
    document.title = 'Mock exam ' + (i + 1) + '/' + total + ' - CertStudy';

    var wrap = h('div', { class: 'wrap' });
    var card = h('div', { class: 'card' }, [
      h('div', { class: 'qhead' }, [
        h('span', { class: 'qno', text: 'Question ' + (i + 1) + ' of ' + total }),
        h('span', { class: 'timer', attrs: { id: 'timer' }, text: mmss(session.deadline - Date.now()) })
      ]),
      h('p', { class: 'qstem', text: q.q }),
      multi ? h('p', { class: 'qhint', text: 'Select ' + (q.a.length === 2 ? 'TWO' : String(q.a.length)) + ' options.' }) : null,
      optionsBlock(ref, chosen, false, multi, function (key) {
        var list = (session.answers[ref.key] || []).slice();
        var at = list.indexOf(key);
        if (at >= 0) list.splice(at, 1);
        else {
          if (multi) { if (list.length < q.a.length) list.push(key); }
          else list = [key];
        }
        session.answers[ref.key] = list;
        saveActive();
        render();
      }),
      h('div', { class: 'navq' }, [
        h('button', {
          class: 'btn small ghost', attrs: { type: 'button' }, text: 'Previous',
          on: { click: function () { if (i > 0) { session.index = i - 1; saveActive(); render(); } } }
        }),
        h('div', { class: 'row tight' }, [
          h('button', {
            class: 'btn small', attrs: { type: 'button' }, text: 'Submit exam',
            on: { click: function () { askSubmit(); } }
          }),
          h('button', {
            class: 'btn small primary', attrs: { type: 'button' },
            text: i === total - 1 ? 'Go to first' : 'Next',
            on: {
              click: function () {
                session.index = i === total - 1 ? 0 : i + 1;
                saveActive();
                render();
              }
            }
          })
        ])
      ]),
      h('div', { class: 'qdots' }, session.refs.map(function (r, idx) {
        var answered = (session.answers[r.key] || []).length > 0;
        return h('button', {
          class: 'qdot' + (answered ? ' done' : '') + (idx === i ? ' here' : ''),
          attrs: { type: 'button', 'aria-label': 'Go to question ' + (idx + 1) },
          text: String(idx + 1),
          on: { click: function () { session.index = idx; saveActive(); render(); } }
        });
      }))
    ]);
    wrap.appendChild(card);
    wrap.appendChild(h('p', { class: 'tiny muted', text: 'Answered ' + answeredCount() + ' of ' + total + '. Your answers are saved on this device until you submit.' }));
    return wrap;
  }

  function answeredCount() {
    if (!session) return 0;
    return session.refs.filter(function (r) { return (session.answers[r.key] || []).length > 0; }).length;
  }

  function startExamTimer() {
    stopTimer();
    if (!session || session.kind !== 'exam') return;
    tickId = window.setInterval(function () {
      var node = document.getElementById('timer');
      if (!node || !session || session.kind !== 'exam') { stopTimer(); return; }
      var left = session.deadline - Date.now();
      node.textContent = mmss(left);
      if (left <= 300000) node.classList.add('warn');
      if (left <= 0) {
        stopTimer();
        toast('Time is up - submitting your exam');
        submit(true);
      }
    }, 1000);
  }

  function askExamSubmit() {
    if (!session || session.kind !== 'exam') return;
    var unanswered = session.refs.length - answeredCountCountSafe();
    if (unanswered > 0) {
      confirmDialog({
        title: 'Submit with ' + unanswered + ' unanswered?',
        message: 'Questions left blank score zero.',
        confirmLabel: 'Submit exam',
        danger: false
      }).then(function (ok) { if (ok) submit(); });
      return;
    }
    submit();
  }

  function askSubmit() { askExamSubmit(); }

  function answeredCountCountSafe() {
    if (!session) return 0;
    return session.answers ? Object.keys(session.answers).filter(function (k) {
      return session.answers[k] && session.answers[k].length > 0;
    }).length : 0;
  }

  function submit(auto) {
    if (!session || session.kind !== 'exam') return;
    var score = 0, totalPoints = 0;
    session.refs.forEach(function (r) {
      var chosen = session.answers[r.key] || [];
      var ok = isCorrect(r, chosen);
      var pts = r.q.p || 1;
      totalPoints += pts;
      if (ok) score += pts;
      if (chosen.length) record(r, chosen, ok);
    });
    session.submitted = true;
    session.score = score;
    session.totalPoints = totalPoints;
    session.finishedAt = Date.now();
    session.autoSubmitted = !!auto;
    state.sessions.unshift({
      kind: 'exam',
      setId: session.setId,
      date: session.finishedAt,
      score: score,
      total: totalPoints,
      passed: score >= passMark()
    });
    state.sessions = state.sessions.slice(0, 30);
    state.active = null;
    session.kind = 'exam-result';
    save();
    go('#/exam/result');
  }

  function viewExamResult() {
    navActive('exams');
    if (!session || (typeof session.score !== 'number')) {
      return goBackTo('No result to show', 'Finish a mock exam to see your score and chapter breakdown.', '#/exam', 'Take a mock exam');
    }
    var passed = session.score >= passMark();
    document.title = 'Exam result - CertStudy';
    var byChapter = {};
    session.refs.forEach(function (r) {
      var c = chapterOf(r.q.lo) || 'other';
      if (!byChapter[c]) byChapter[c] = { right: 0, total: 0 };
      byChapter[c].total += (r.q.p || 1);
      if (isCorrect(r, session.answers[r.key] || [])) byChapter[c].right += (r.q.p || 1);
    });
    var wrong = session.refs.filter(function (r) { return !isCorrect(r, session.answers[r.key] || []); });

    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Result' }),
        h('h1', { class: 'h1 verdict-big ' + (passed ? 'pass' : 'fail'), text: passed ? 'Pass' : 'Not yet' }),
        h('p', { class: 'lede', text: session.score + ' of ' + session.totalPoints + ' points. Pass mark ' + passMark() + (session.autoSubmitted ? '. The timer ran out, so the exam was submitted for you.' : '.') })
      ]),
      h('section', { class: 'card' }, [
        h('div', { class: 'grid grid-3' }, [
          statCard(String(session.score), 'Points'),
          statCard(pct(session.score, session.totalPoints) + '%', 'Score'),
          statCard(String(wrong.length), 'To review')
        ])
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'By chapter' }),
        chapterBars(byChapter)
      ]),
      wrong.length ? h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'Questions to revisit' }),
        h('div', {}, wrong.map(function (r) {
          return h('div', { class: 'revitem' }, [
            h('div', { class: 'rq', text: 'Q' + r.q.n + ' · ' + chapterName(r.q.lo) }),
            h('div', { class: 'ra', text: 'Your answer: ' + (session.answers[r.key] && session.answers[r.key].length ? session.answers[r.key].join(', ') : 'none') + ' · Correct: ' + r.q.a.join(', ') }),
            h('div', { class: 'small', text: r.q.e })
          ]);
        }))
      ]) : null,
      h('div', { class: 'row tight' }, [
        h('button', { class: 'btn primary', attrs: { type: 'button' }, text: 'Review bookmarks and mistakes', on: { click: function () { go('#/review'); } } }),
        h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Another exam', on: { click: function () { go('#/exam'); } } }),
        h('button', { class: 'btn ghost', attrs: { type: 'button' }, text: 'Home', on: { click: function () { go('#/home'); } } })
      ]),
      footerNote()
    ]);
    return wrap;
  }

  function chapterBars(byChapter) {
    var keys = Object.keys(byChapter).sort();
    var box = h('div', { class: 'bars' });
    keys.forEach(function (k) {
      var row = byChapter[k];
      var p = pct(row.right, row.total);
      box.appendChild(h('div', { class: 'bar-item' }, [
        h('div', { class: 'bar-head' }, [
          h('span', { text: (CHAPTERS[k] || 'Other') }),
          h('span', { class: 'pct', text: row.right + '/' + row.total + ' · ' + p + '%' })
        ]),
        progressBar(p)
      ]));
    });
    return box;
  }

  function viewReview() {
    navActive('review');
    document.title = 'Review - CertStudy';
    var refs = allRefs();
    var marks = refs.filter(function (r) { return isMarked(r.key); });
    var wrong = refs.filter(function (r) {
      var p = state.progress[r.key];
      return p && !p.ok;
    });

    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Spaced review' }),
        h('h1', { class: 'h1', text: 'Review' }),
        h('p', { class: 'lede', text: 'Bookmarked questions and every question you have got wrong so far, with the explanation open.' })
      ])
    ]);

    wrap.appendChild(reviewSection('Bookmarked', marks, 'You have not bookmarked anything yet. Use the Bookmark button while practising.'));
    wrap.appendChild(reviewSection('Answered incorrectly', wrong, 'No wrong answers recorded yet.'));
    wrap.appendChild(footerNote());
    return wrap;
  }

  function reviewSection(title, refs, emptyText) {
    var card = h('section', { class: 'card' }, [h('h2', { class: 'h2', text: title + ' (' + refs.length + ')' })]);
    if (!refs.length) {
      card.appendChild(h('p', { class: 'small muted', text: emptyText }));
      return card;
    }
    var box = h('div', {});
    refs.slice(0, 60).forEach(function (r) {
      box.appendChild(h('div', { class: 'revitem' }, [
        h('div', { class: 'rq', text: r.q.q }),
        h('div', { class: 'ra' }, [
          h('span', { text: 'Correct: ' }),
          h('b', { text: r.q.a.join(', ') }),
          h('span', { text: ' · ' + chapterName(r.q.lo) + ' · ' + r.q.lo })
        ]),
        h('div', { class: 'small', text: r.q.e }),
        referenceNode(r),
        h('div', { class: 'row tight' }, [
          h('button', {
            class: 'btn small ghost', attrs: { type: 'button' },
            text: isMarked(r.key) ? 'Remove bookmark' : 'Bookmark',
            on: { click: function () { toggleMark(r.key); render(); } }
          })
        ])
      ]));
    });
    if (refs.length > 60) {
      box.appendChild(h('p', { class: 'small muted', text: 'Showing the first 60 of ' + refs.length + '.' }));
    }
    card.appendChild(box);
    return card;
  }

  function viewStats() {
    navActive('stats');
    document.title = 'Stats - CertStudy';
    var refs = allRefs();
    var s = statsFor(refs);

    var byChapter = {};
    refs.forEach(function (r) {
      var c = chapterOf(r.q.lo) || 'other';
      if (!byChapter[c]) byChapter[c] = { right: 0, total: 0 };
      byChapter[c].total += 1;
      var p = state.progress[r.key];
      if (p && p.ok) byChapter[c].right += 1;
    });

    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Progress' }),
        h('h1', { class: 'h1', text: 'Your study statistics' }),
        h('p', { class: 'lede', text: 'Everything is stored on this device only. No account, no tracking, nothing sent anywhere.' })
      ]),
      h('section', { class: 'grid grid-3' }, [
        statCard(String(s.answered), 'Answered'),
        statCard(s.accuracy + '%', 'Accuracy'),
        statCard(String(refs.length - s.answered), 'Left to answer')
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'By chapter' }),
        chapterBars(byChapter)
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'By set' }),
        h('div', { class: 'stack' }, bankSetIds().map(function (sid) {
          var st = statsFor(refsForSet(sid));
          var data = setCached(sid);
          return h('div', { class: 'row tight' }, [
            h('span', { text: (data ? data.label : 'Set ' + sid.toUpperCase()) }),
            h('span', { class: 'small muted', text: st.ok + '/' + st.answered + ' correct · ' + st.total + ' questions' })
          ]);
        }))
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'Mock exams' }),
        state.sessions.length
          ? h('div', { class: 'stack' }, state.sessions.slice(0, 10).map(function (x) {
            return h('div', { class: 'row tight' }, [
              h('span', { class: 'small', text: new Date(x.date).toLocaleDateString() + ' · ' + (x.kind === 'exam' ? 'Mock exam' : 'Session') }),
              h('span', { class: 'small ' + (x.passed ? '' : 'muted'), text: x.score + '/' + x.total + (x.passed ? ' pass' : '') })
            ]);
          }))
          : h('p', { class: 'small muted', text: 'No mock exam yet. A 40-question, 60-minute paper is waiting under Exams.' })
      ]),
      wrapRowSettings(),
      footerNote()
    ]);
    return wrap;
  }

  function viewSettings() {
    document.title = 'Settings - CertStudy';
    navActive('home');
    var wrap = h('div', { class: 'wrap' }, [
      h('div', { class: 'head' }, [
        h('span', { class: 'eyebrow', text: 'Appearance and data' }),
        h('h1', { class: 'h1', text: 'Settings' })
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'Appearance' }),
        h('div', { class: 'row tight' }, [
          h('span', { class: 'small muted', text: 'Theme' }),
          h('button', {
            class: 'btn small', attrs: { type: 'button' },
            text: state.theme === 'dark' ? 'Dark (switch to light)' : 'Light (switch to dark)',
            on: {
              click: function () {
                state.theme = state.theme === 'dark' ? 'light' : 'dark';
                applyTheme(); save(); render();
              }
            }
          })
        ])
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'Your data' }),
        h('p', { class: 'small muted', text: 'Progress, bookmarks and exam history live in this browser\u2019s local storage. Export a copy before clearing site data.' }),
        h('div', { class: 'row tight' }, [
          h('button', { class: 'btn small', attrs: { type: 'button' }, text: 'Export progress', on: { click: exportData } }),
          h('button', {
            class: 'btn small danger', attrs: { type: 'button' }, text: 'Reset everything',
            on: {
              click: function () {
                confirmDialog({
                  title: 'Reset all progress?',
                  message: 'This removes answered questions, bookmarks and exam history on this device. Flashcards and notes are kept.',
                  confirmLabel: 'Reset'
                }).then(function (ok) {
                  if (!ok) return;
                  state.progress = {};
                  state.marks = {};
                  state.sessions = [];
                  state.active = null;
                  save();
                  toast('Progress cleared');
                  navigate('#/home');
                });
              }
            }
          })
        ])
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'h2', text: 'About' }),
        h('p', { class: 'small muted', text: 'CertStudy is an unofficial study tool for the ISTQB Certified Tester certifications. It is not affiliated with, endorsed by or accredited by ISTQB or any Member Board.' }),
        h('p', { class: 'small muted', text: 'Questions, answers and justifications are the copyright of the International Software Testing Qualifications Board and are used here for non-commercial study with the source acknowledged. Check the ISTQB terms of use before using this material in any commercial product.' })
      ]),
      footerNote()
    ]);
    return wrap;
  }

  function wrapRowSettings() {
    return h('div', { class: 'row tight' }, [
      h('a', { class: 'btn small ghost', href: '#/settings', text: 'Settings and data' })
    ]);
  }

  function exportData() {
    try {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'certstudy-progress.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Progress exported');
    } catch (e) {
      toast('Export is not available in this browser');
    }
  }

  /* ------------------------------------------------------------ dispatch */

  var lastRouteRendered = null;
  var lastRenderAt = 0;

  function render(force) {
    var current = route();
    var now = Date.now();
    if (!force && current === lastRouteRendered && now - lastRenderAt < 150) return Promise.resolve();
    lastRouteRendered = current;
    lastRenderAt = now;
    stopTimer();
    docsCleanup();
    if (!catalog) return Promise.resolve();

    var p = parts();
    var work;

    if (views[p[0]]) {
      work = Promise.resolve().then(function () { return views[p[0]](p); });
    } else if (p[0] === 'practice') {
      work = ensureAllSets().then(function () {
        if (p[1] === 'run') return viewPracticeRun();
        if (p[1] === 'done') return viewPracticeDone();
        return viewPractice();
      });
    } else if (p[0] === 'exam') {
      work = ensureAllSets().then(function () {
        if (p[1] === 'run') {
          var ready = session ? Promise.resolve(true) : restoreActive();
          return ready.then(function () { return viewExamRun(); });
        }
        if (p[1] === 'result') return viewExamResult();
        return viewExamSetup();
      });
    } else if (p[0] === 'review') {
      work = ensureAllSets().then(viewReview);
    } else if (p[0] === 'stats') {
      work = ensureAllSets().then(viewStats);
    } else if (p[0] === 'settings') {
      work = Promise.resolve(viewSettings());
    } else if (p[0] === 'doc') {
      work = Promise.resolve(viewDoc(p[1], p[2]));
    } else if (p[0] === 'cert') {
      work = ensureAllSets().then(function () { return viewCert(p[1]); });
    } else if (p[0] === 'certs') {
      work = ensureAllSets().then(viewCerts);
    } else if (p[0] === 'exams') {
      work = ensureAllSets().then(viewExams);
    } else {
      work = ensureAllSets().then(viewHome);
    }

    return work.then(function (node) {
      clear(viewEl);
      viewEl.appendChild(node || h('div', { class: 'wrap' }));
      refreshChip();
      if (p[0] === 'exam' && p[1] === 'run') startExamTimer();
      window.scrollTo(0, 0);
    }).catch(function (err) {
      clear(viewEl);
      viewEl.appendChild(h('div', { class: 'wrap' }, [
        h('div', { class: 'card' }, [
          h('h2', { class: 'h2', text: 'Something went wrong' }),
          h('p', { class: 'small muted', text: String((err && err.message) || err) }),
          h('button', { class: 'btn small primary', attrs: { type: 'button' }, text: 'Reload', on: { click: function () { window.location.reload(); } } })
        ])
      ]));
    });
  }

  var booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    applyTheme();
    fetchJSON(DATA + 'certifications.json').then(function (data) {
      catalog = data;
      if (!certById(state.certId)) state.certId = 'ctfl';
      render();
    }).catch(function (err) {
      clear(viewEl);
      viewEl.appendChild(h('div', { class: 'wrap' }, [
        h('div', { class: 'card' }, [
          h('h2', { class: 'h2', text: 'Could not load the study data' }),
          h('p', { class: 'small muted', text: String((err && err.message) || err) }),
          h('p', { class: 'small muted', text: 'Open the site over http(s) rather than from the file system, then reload.' })
        ])
      ]));
    });
  }

  /* -------------------------------------------------------------- events */

  window.addEventListener('hashchange', function () { render(); });

  document.addEventListener('click', function (ev) {
    var link = ev.target && ev.target.closest ? ev.target.closest('a[href^="#/"], [data-go]') : null;
    if (!link) return;
    ev.preventDefault();
    var target = link.getAttribute('data-go') || link.getAttribute('href');
    if (target) navigate(target);
  });

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      save();
    });
  }

  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    var inPractice = session && session.kind === 'practice' && parts()[0] === 'practice' && parts()[1] === 'run';
    var inExam = session && session.kind === 'exam' && parts()[0] === 'exam' && parts()[1] === 'run';
    if (!inPractice && !inExam) return;

    if (/^[1-5]$/.test(ev.key)) {
      var idx = parseInt(ev.key, 10) - 1;
      var ref = session.refs[session.index];
      if (!ref || !ref.q.o[idx]) return;
      if (inPractice && session.checked[ref.key]) return;
      ev.preventDefault();
      var key = ref.q.o[idx][0];
      var list = (session.answers[ref.key] || []).slice();
      var at = list.indexOf(key);
      var multi = ref.q.a.length > 1;
      if (at >= 0) list.splice(at, 1);
      else if (multi) { if (list.length < ref.q.a.length) list.push(key); }
      else list = [key];
      session.answers[ref.key] = list;
      if (inExam) saveActive();
      render();
      return;
    }

    if (ev.key === 'Enter') {
      var current = session.refs[session.index];
      if (!current) return;
      ev.preventDefault();
      if (inPractice && !session.checked[current.key]) {
        ev.preventDefault();
        revealAnswer(current);
        return;
      } else if (inPractice && session.index < session.refs.length - 1) {
        session.index += 1;
        render();
      } else if (inExam && session.index < session.refs.length - 1) {
        session.index += 1;
        saveActive();
        render();
      }
    }
  });

  window.CS = {
    h: h,
    clear: clear,
    toast: toast,
    uid: uid,
    fmtDate: fmtDate,
    pct: pct,
    state: function () { return state; },
    save: save,
    catalog: function () { return catalog; },
    views: views,
    navigate: navigate,
    render: function () { render(true); },
    route: route,
    parts: parts,
    nav: navActive,
    confirmDialog: confirmDialog,
    chapterOf: chapterOf,
    chapterName: chapterName
  };

  /* ---------------------------------------------------------------- boot */

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState === 'complete') boot();
})();
