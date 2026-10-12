(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = n => String(Math.floor(n)).padStart(2, '0');
  const hms = t => `${pad(t / 3600)}:${pad((t % 3600) / 60)}:${pad(t % 60)}`;
  const ms = t => `${pad(t / 60)}:${pad(t % 60)}`;
  const parse = s => s.split(':').reduce((a, v) => a * 60 + (+v || 0), 0);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const h = (tag, cls = '', txt = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; };
  const icon = id => { const w = h('span'); w.innerHTML = `<svg class="icon"><use href="#${id}"/></svg>`; return w.firstChild; };

  $('svg defs').insertAdjacentHTML('beforeend',
    '<symbol id="i-pause" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></symbol>' +
    '<symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></symbol>');

  /* ===== Ajustes (salvos no navegador) ===== */
  const KEY = 'framo.settings';
  const DEF = { q: 1080, fps: 30, safe: true, thirds: true, count: 5, maxlen: 45, auto: true };
  const cfg = { ...DEF };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY))); } catch { /* sem armazenamento */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignora */ } };

  /* ===== Estado ===== */
  const S = { dur: 1458, t: 772, video: null, url: null, id: null, name: 'podcast-entrevista.mp4', playing: false, last: 0,
    zoom: 100, undo: [], redo: [], uid: 1, n: 1, sel: 1, busy: false,
    cuts: [{ id: 1, name: 'Corte 01', start: 760, end: 795, format: '9:16' }] };
  const cur = () => S.cuts.find(c => c.id === S.sel);
  const pct = t => 1 + (t / S.dur) * 98;

  const el = {
    screen: $('.screen'), view: $('.monitor__view'), canvas: $('.tl__canvas'), head: $('.playhead'),
    tc: $('.timecode'), tcEnd: $('.timecode small'), caption: $('.caption'), zoom: $('.zoom'),
    name: $$('.field input')[0], inStart: $$('.field input.mono')[0], inEnd: $$('.field input.mono')[1],
    dur: $('.duration strong'), playIcon: $('.play use'), vlane: $$('.lane')[0], alane: $$('.lane')[1],
    list: $('#cut-list'), lib: $('.library'), wiz: $('#wizard')
  };
  $$('.clip--cut').forEach(c => c.remove());
  el.view.style.containerType = 'size';

  function toast(msg, sticky) {
    let t = $('#toast');
    if (!t) {
      t = h('div'); t.id = 'toast'; t.setAttribute('role', 'status');
      t.style.cssText = 'position:fixed;left:50%;bottom:44px;transform:translateX(-50%);padding:9px 16px;border-radius:8px;background:#20202a;border:1px solid #32323f;color:#ececf2;font:600 12.5px Manrope,system-ui,sans-serif;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,.5)';
      document.body.append(t);
    }
    t.textContent = msg; clearTimeout(toast.id);
    if (!sticky) toast.id = setTimeout(() => t.remove(), 3000);
  }

  /* ===== Renderização ===== */
  const focused = i => document.activeElement === i;
  function render() {
    const c = cur();
    $$('.clip--cut').forEach(x => x.remove());
    S.cuts.forEach(k => {
      const sel = k.id === S.sel, l = pct(k.start), w = pct(k.end) - l;
      [el.vlane, el.alane].forEach((lane, i) => {
        const d = h('div', 'clip clip--cut' + (sel ? ' is-selected' : ''));
        d.dataset.id = k.id; d.style.cssText = `left:${l}%;width:${w}%;z-index:${sel ? 3 : 2}`;
        if (i === 0) d.append(h('span', 'clip__name', k.name), h('i', 'clip__frames'), h('i', 'handle handle--l'), h('i', 'handle handle--r'));
        else d.append(h('i', 'wave'));
        lane.append(d);
      });
    });
    el.head.style.left = pct(S.t) + '%';
    el.tc.firstChild.nodeValue = hms(S.t);
    el.tcEnd.textContent = ' / ' + hms(c.end);
    el.dur.textContent = ms(c.end - c.start);
    if (!focused(el.inStart)) el.inStart.value = hms(c.start);
    if (!focused(el.inEnd)) el.inEnd.value = hms(c.end);
    if (!focused(el.name)) el.name.value = c.name;
    $('.selected-row strong').textContent = c.name;
    $('.rec-badge').textContent = c.name;
    $('.crumbs [aria-current]').textContent = c.name;
    const total = S.cuts.reduce((a, k) => a + k.end - k.start, 0);
    const sum = `${S.cuts.length} ${S.cuts.length === 1 ? 'corte' : 'cortes'} · ${ms(total)} no total`;
    $('#cuts-sum').textContent = sum;
    $('#status-note').textContent = sum;
    renderList();
  }
  function renderList() {
    el.list.replaceChildren();
    S.cuts.forEach((k, i) => {
      const li = h('li', 'cut-card' + (k.id === S.sel ? ' is-active' : ''));
      li.dataset.id = k.id; li.tabIndex = 0;
      const info = h('div', 'cut-card__info');
      info.append(h('strong', '', k.name), h('small', '', `${hms(k.start)} → ${hms(k.end)} · ${ms(k.end - k.start)} · ${k.format}`));
      const btn = (act, ic, label) => { const b = h('button', 'icon-btn'); b.type = 'button'; b.dataset.act = act; b.title = label; b.setAttribute('aria-label', label); b.append(icon(ic)); return b; };
      li.append(h('span', 'cut-card__num', String(i + 1)), info, btn('export', 'i-export', 'Exportar este corte'), btn('del', 'i-trash', 'Excluir corte'));
      el.list.append(li);
    });
  }
  function ruler() { $$('.ruler span').forEach((s, i) => { s.textContent = ms(Math.max(0, ((i * 12.5 - 1) / 98) * S.dur)); }); }

  /* ===== Formato, qualidade e FPS ===== */
  const RATIO = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] };
  const res = k => RATIO[k].map(v => Math.round(v * cfg.q / 1080)).join(' × ');
  function applyFormat() {
    const k = cur().format, [w, hh] = RATIO[k];
    $$('.format').forEach(b => b.classList.toggle('is-active', $('b', b).textContent === k));
    el.screen.style.aspectRatio = String(w / hh);
    el.screen.style.height = `min(100cqh, calc(100cqw / ${w / hh}))`;
    $('.tag--accent').textContent = k;
    $$('.tag')[1].textContent = res(k);
    $$('.tag')[2].textContent = cfg.fps + ' fps';
    $$('.specs dd')[0].textContent = cfg.q === 1080 ? 'Full HD — 1080p' : 'HD — 720p';
    $$('.specs dd')[2].textContent = cfg.fps + ' FPS';
  }
  $$('.format').forEach(b => b.addEventListener('click', () => { snap(); cur().format = $('b', b).textContent; applyFormat(); render(); }));

  /* ===== Reprodução (toca o corte selecionado) ===== */
  function seek(t) { S.t = clamp(t, 0, S.dur); if (S.video) S.video.currentTime = S.t; render(); }
  function tick(now) {
    if (!S.playing) return;
    S.t = S.video ? S.video.currentTime : S.t + (now - S.last) / 1000;
    S.last = now;
    if (S.t >= cur().end) { pause(); seek(cur().start); return; }
    render(); requestAnimationFrame(tick);
  }
  function play() {
    if (S.t < cur().start || S.t >= cur().end) seek(cur().start);
    S.playing = true; S.last = performance.now();
    if (S.video) S.video.play();
    el.playIcon.setAttribute('href', '#i-pause'); requestAnimationFrame(tick);
  }
  function pause() { S.playing = false; if (S.video) S.video.pause(); el.playIcon.setAttribute('href', '#i-play'); render(); }
  const toggle = () => (S.playing ? pause() : play());
  $('.play').addEventListener('click', toggle);
  $('[aria-label="Retroceder"]').addEventListener('click', () => seek(S.t - 5));
  $('[aria-label="Avançar"]').addEventListener('click', () => seek(S.t + 5));
  addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|SELECT|BUTTON|LI|TEXTAREA/.test(e.target.tagName) && !e.target.closest('dialog')) { e.preventDefault(); toggle(); }
  });

  /* ===== Desfazer / Refazer ===== */
  const state = () => JSON.stringify({ c: S.cuts, s: S.sel, n: S.n });
  function snap() { S.undo.push(state()); S.redo = []; if (S.undo.length > 50) S.undo.shift(); }
  function restore(from, to) {
    if (!from.length) return;
    to.push(state());
    const o = JSON.parse(from.pop());
    S.cuts = o.c; S.sel = o.s; S.n = o.n; S.t = clamp(S.t, cur().start, cur().end);
    applyFormat(); render();
  }
  $('[aria-label="Desfazer"]').addEventListener('click', () => restore(S.undo, S.redo));
  $('[aria-label="Refazer"]').addEventListener('click', () => restore(S.redo, S.undo));
  addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || /INPUT|SELECT/.test(e.target.tagName)) return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); restore(e.shiftKey ? S.redo : S.undo, e.shiftKey ? S.undo : S.redo); }
  });

  /* ===== Cortes: criar, selecionar, excluir ===== */
  const nm = n => `Corte ${pad(n)}`;
  function addCut() {
    snap();
    const s = clamp(S.t, 0, S.dur - 1);
    const k = { id: ++S.uid, name: nm(++S.n), start: s, end: Math.min(S.dur, s + cfg.maxlen), format: cur().format };
    S.cuts.push(k); S.sel = k.id; applyFormat(); render(); toast(`${k.name} criado`);
  }
  function select(id) {
    if (id === S.sel) return;
    if (S.playing) pause();
    S.sel = id; S.t = cur().start; if (S.video) S.video.currentTime = S.t;
    applyFormat(); render();
  }
  function removeCut(id) {
    if (S.cuts.length === 1) return toast('O projeto precisa ter pelo menos um corte.');
    snap();
    S.cuts = S.cuts.filter(c => c.id !== id);
    if (S.sel === id) { S.sel = S.cuts[0].id; S.t = cur().start; }
    applyFormat(); render();
  }
  $('#add-cut').addEventListener('click', addCut);
  $('.inspector__foot .btn').addEventListener('click', addCut);
  el.list.addEventListener('click', e => {
    const li = e.target.closest('.cut-card'); if (!li) return;
    const id = +li.dataset.id, act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') return exportCuts([S.cuts.find(c => c.id === id)]);
    if (act === 'del') return removeCut(id);
    select(id);
  });
  el.list.addEventListener('keydown', e => { const li = e.target.closest('.cut-card'); if (li && e.key === 'Enter') select(+li.dataset.id); });

  /* ===== Gerador de cortes (pergunta quantos e o tamanho máximo) ===== */
  const W = { count: $('#w-count'), max: $('#w-max'), mode: $('#w-mode'), fmt: $('#w-format'), rep: $('#w-replace'), sum: $('#w-sum') };
  function plan() {
    const n0 = clamp(Math.round(+W.count.value) || 1, 1, 30), d = S.dur;
    const L = clamp(+W.max.value || 5, 1, Math.max(1, d));
    let n = n0, note = '', list = [];
    if (W.mode.value === 'seq') {
      const fit = Math.max(1, Math.floor(d / L));
      if (n > fit) { n = fit; note = `O vídeo comporta só ${fit} ${fit === 1 ? 'corte' : 'cortes'} seguidos de ${Math.round(L)}s.`; }
      for (let i = 0; i < n; i++) list.push([i * L, (i + 1) * L]);
    } else {
      const maxN = Math.max(1, Math.floor(d));
      if (n > maxN) { n = maxN; note = 'Há mais cortes do que segundos no vídeo.'; }
      const seg = d / n, len = Math.min(L, seg);
      for (let i = 0; i < n; i++) { const s = i * seg + (seg - len) / 2; list.push([s, s + len]); }
    }
    return { list, note };
  }
  function wizSummary() {
    const { list, note } = plan();
    const len = list[0][1] - list[0][0];
    W.sum.innerHTML = `Serão <b>${list.length} ${list.length === 1 ? 'corte' : 'cortes'}</b> de até <b>${Math.round(len)}s</b> (${ms(list.length * len)} no total). ${note}`;
    $$('#w-chips button').forEach(b => b.classList.toggle('is-active', +b.dataset.v === +W.max.value));
  }
  function openWizard() {
    W.count.value = cfg.count; W.max.value = cfg.maxlen; W.fmt.value = cur().format;
    $('#w-info').textContent = `Vídeo de ${ms(S.dur)}. Diga quantos cortes você quer e o tamanho máximo de cada um.`;
    wizSummary();
    if (el.wiz.showModal && !el.wiz.open) el.wiz.showModal();
  }
  [W.count, W.max, W.mode].forEach(i => i.addEventListener('input', wizSummary));
  $$('#w-chips button').forEach(b => b.addEventListener('click', () => { W.max.value = b.dataset.v; wizSummary(); }));
  $('#w-cancel').addEventListener('click', () => el.wiz.close());
  $$('.js-wizard').forEach(b => b.addEventListener('click', openWizard));
  $('#wizard-form').addEventListener('submit', e => {
    e.preventDefault();
    const { list } = plan();
    snap();
    if (W.rep.checked) { S.cuts = []; S.n = 0; }
    const made = list.map(([s, en]) => ({ id: ++S.uid, name: nm(++S.n), start: s, end: en, format: W.fmt.value }));
    S.cuts.push(...made);
    S.sel = made[0].id; S.t = made[0].start; if (S.video) S.video.currentTime = S.t;
    cfg.count = list.length; cfg.maxlen = Math.round(+W.max.value); save(); syncSettings();
    el.wiz.close(); applyFormat(); render();
    $('.rail__item:nth-child(2)').click();
    toast(`${made.length} ${made.length === 1 ? 'corte gerado' : 'cortes gerados'}. Ajuste o que quiser e exporte.`);
  });

  /* ===== Timeline: buscar, selecionar, mover e redimensionar ===== */
  const tFromX = x => { const r = el.canvas.getBoundingClientRect(); return clamp((((x - r.left) / r.width) * 100 - 1) / 98 * S.dur, 0, S.dur); };
  let drag = null;
  el.canvas.addEventListener('pointerdown', e => {
    const clip = e.target.closest('.clip--cut'), hd = e.target.closest('.handle');
    const m = hd ? (hd.classList.contains('handle--l') ? 'l' : 'r') : clip ? 'm' : 'seek';
    if (clip && +clip.dataset.id !== S.sel) { if (S.playing) pause(); S.sel = +clip.dataset.id; applyFormat(); render(); }
    const c = cur();
    drag = { m, t0: tFromX(e.clientX), s: c.start, e: c.end, before: state(), moved: false };
    if (m === 'seek') seek(drag.t0);
    e.preventDefault();
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    const t = tFromX(e.clientX), d = t - drag.t0, c = cur();
    if (drag.m === 'seek') return seek(t);
    if (!drag.moved) { S.undo.push(drag.before); S.redo = []; drag.moved = true; }
    if (drag.m === 'l') c.start = clamp(drag.s + d, 0, c.end - 1);
    if (drag.m === 'r') c.end = clamp(drag.e + d, c.start + 1, S.dur);
    if (drag.m === 'm') { const len = drag.e - drag.s, s = clamp(drag.s + d, 0, S.dur - len); c.start = s; c.end = s + len; }
    seek(clamp(S.t, c.start, c.end));
  });
  addEventListener('pointerup', () => { drag = null; });

  function setZoom(z) { S.zoom = clamp(z, 50, 400); el.canvas.style.minWidth = (760 * S.zoom) / 100 + 'px'; el.zoom.textContent = S.zoom + '%'; }
  $('[aria-label="Aumentar zoom"]').addEventListener('click', () => setZoom(S.zoom + 25));
  $('[aria-label="Diminuir zoom"]').addEventListener('click', () => setZoom(S.zoom - 25));

  /* ===== Inspetor ===== */
  [el.inStart, el.inEnd, el.name].forEach(i => (i.readOnly = false));
  el.inStart.addEventListener('change', () => { snap(); const c = cur(); c.start = clamp(parse(el.inStart.value), 0, c.end - 1); el.inStart.blur(); seek(clamp(S.t, c.start, c.end)); });
  el.inEnd.addEventListener('change', () => { snap(); const c = cur(); c.end = clamp(parse(el.inEnd.value), c.start + 1, S.dur); el.inEnd.blur(); seek(clamp(S.t, c.start, c.end)); });
  el.name.addEventListener('input', () => { cur().name = el.name.value.trim() || 'Corte'; render(); });
  const capSw = $('.inspector .switch');
  capSw.setAttribute('role', 'switch'); capSw.tabIndex = 0;
  const syncCap = () => { const on = capSw.classList.contains('is-on'); capSw.setAttribute('aria-checked', on); el.caption.style.display = on ? '' : 'none'; };
  capSw.addEventListener('click', () => { capSw.classList.toggle('is-on'); syncCap(); });
  capSw.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); capSw.click(); } });
  $('.btn--ghost:not(.btn--block):not(.btn--sm)').addEventListener('click', () => { seek(cur().start); play(); });

  /* ===== Barra lateral: cada item abre um painel ===== */
  const titles = { media: 'Biblioteca de mídia', cuts: 'Cortes', captions: 'Legendas', audio: 'Áudio', settings: 'Ajustes' };
  const keys = { 'Mídia': 'media', 'Cortes': 'cuts', 'Legendas': 'captions', 'Áudio': 'audio', 'Ajustes': 'settings' };
  $$('.rail__item').forEach(b => b.addEventListener('click', () => {
    $$('.rail__item').forEach(x => x.classList.toggle('is-active', x === b));
    const k = keys[$('span', b).textContent];
    el.lib.dataset.view = k; $('.panel__title', el.lib).textContent = titles[k];
  }));
  function bindSwitch(id, fn) {
    const s = $(id);
    s.addEventListener('click', () => { const on = s.classList.toggle('is-on'); s.setAttribute('aria-checked', on); fn(on); });
    return on => { s.classList.toggle('is-on', on); s.setAttribute('aria-checked', on); };
  }

  /* Legendas */
  $$('#cap-styles .opt').forEach(b => b.addEventListener('click', () => {
    $$('#cap-styles .opt').forEach(x => x.classList.toggle('is-active', x === b));
    el.caption.dataset.style = b.dataset.style;
  }));
  $('#cap-size').addEventListener('input', e => { el.caption.style.setProperty('--cap', e.target.value / 100); $('#cap-size-out').textContent = e.target.value + '%'; });
  $('#cap-pos').addEventListener('change', e => { el.caption.style.bottom = e.target.value + '%'; });
  $$('#cap-colors button').forEach(b => b.addEventListener('click', () => {
    $$('#cap-colors button').forEach(x => x.classList.toggle('is-active', x === b));
    el.caption.style.setProperty('--hl', b.dataset.c);
  }));

  /* Áudio */
  function applyAudio() { if (!S.video) return; S.video.volume = $('#vol').value / 100; S.video.muted = $('#mute').classList.contains('is-on'); }
  $('#vol').addEventListener('input', e => { $('#vol-out').textContent = e.target.value + '%'; applyAudio(); });
  bindSwitch('#mute', applyAudio);

  /* Ajustes */
  const setSafe = bindSwitch('#set-safe', on => { cfg.safe = on; save(); $('.guide--safe').style.display = on ? '' : 'none'; $('.transport__hint').textContent = on ? 'Área segura ativa' : 'Área segura oculta'; });
  const setThirds = bindSwitch('#set-thirds', on => { cfg.thirds = on; save(); $('.guide--thirds').style.display = on ? '' : 'none'; });
  const setAuto = bindSwitch('#set-auto', on => { cfg.auto = on; save(); });
  const numIn = (id, key, lo, hi) => $(id).addEventListener('change', e => { cfg[key] = clamp(Math.round(+e.target.value) || DEF[key], lo, hi); e.target.value = cfg[key]; save(); });
  numIn('#set-count', 'count', 1, 30); numIn('#set-max', 'maxlen', 5, 900);
  $('#set-q').addEventListener('change', e => { cfg.q = +e.target.value; save(); applyFormat(); });
  $('#set-fps').addEventListener('change', e => { cfg.fps = +e.target.value; save(); applyFormat(); });
  $('#set-reset').addEventListener('click', () => { Object.assign(cfg, DEF); save(); syncSettings(); toast('Ajustes restaurados.'); });
  function syncSettings() {
    $('#set-q').value = cfg.q; $('#set-fps').value = cfg.fps; $('#set-count').value = cfg.count; $('#set-max').value = cfg.maxlen;
    setSafe(cfg.safe); setThirds(cfg.thirds); setAuto(cfg.auto);
    $('.guide--safe').style.display = cfg.safe ? '' : 'none';
    $('.guide--thirds').style.display = cfg.thirds ? '' : 'none';
    $('.transport__hint').textContent = cfg.safe ? 'Área segura ativa' : 'Área segura oculta';
    applyFormat();
  }

  /* ===== Importação de vídeo ===== */
  const input = Object.assign(h('input'), { type: 'file', accept: 'video/*', hidden: true });
  document.body.append(input);
  const dz = $('.dropzone');
  dz.tabIndex = 0; dz.setAttribute('role', 'button');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { loadFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(n => dz.addEventListener(n, e => { e.preventDefault(); dz.style.borderColor = 'var(--accent-line)'; }));
  ['dragleave', 'drop'].forEach(n => dz.addEventListener(n, () => (dz.style.borderColor = '')));
  dz.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
  ['dragover', 'drop'].forEach(n => addEventListener(n, e => e.preventDefault()));

  function loadFile(f) {
    if (!f || !f.type.startsWith('video/')) return toast('Escolha um arquivo de vídeo.');
    const url = URL.createObjectURL(f), v = h('video');
    v.src = url; v.playsInline = true; v.preload = 'metadata';
    v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000';
    v.addEventListener('error', () => { URL.revokeObjectURL(url); toast('Não foi possível ler este vídeo.'); });
    v.addEventListener('ended', () => { pause(); seek(cur().start); });
    v.addEventListener('loadedmetadata', () => {
      pause();
      if (S.video) S.video.remove();
      if (S.url) URL.revokeObjectURL(S.url);
      S.video = v; S.url = url; S.dur = v.duration; S.t = 0; S.name = f.name;
      el.screen.prepend(v); $('.scene').hidden = true; applyAudio();
      S.cuts = [{ id: ++S.uid, name: nm(1), start: 0, end: Math.min(cfg.maxlen, v.duration), format: '9:16' }];
      S.sel = S.uid; S.n = 1; S.undo = []; S.redo = [];
      $('.media-card h4').textContent = f.name;
      $('.media-card__body p').textContent = `${(f.name.split('.').pop() || 'vídeo').toUpperCase()} · ${v.videoWidth}×${v.videoHeight} · ${(f.size / 1048576).toFixed(1)} MB`;
      $('.thumb__time').textContent = ms(v.duration);
      $('.clip--orig .clip__name').textContent = f.name;
      $('.project__name').textContent = f.name.replace(/\.[^.]+$/, '');
      $('.storage__row span:last-child').textContent = `${(f.size / 1073741824).toFixed(2)} de 10 GB`;
      $('.storage__bar i').style.width = Math.min(100, (f.size / 1.0737e10) * 100) + '%';
      ruler(); applyFormat(); render(); upload(f);
      if (cfg.auto) openWizard(); else toast('Vídeo importado.');
    });
  }

  /* ===== Backend (Python) ===== */
  async function upload(file) {
    const fd = new FormData(); fd.append('file', file); S.id = null;
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!r.ok) throw new Error();
      S.id = (await r.json()).id;
    } catch { toast('Servidor Python indisponível: não será possível exportar.'); }
  }
  const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function exportCuts(cuts) {
    if (S.busy) return toast('Aguarde: já existe uma exportação em andamento.');
    if (!S.id) return toast('Importe um vídeo com o servidor Python ligado.');
    S.busy = true; $('.btn--primary:not(.btn--block)').disabled = true;
    try {
      const done = [];
      for (const [i, k] of cuts.entries()) {
        toast(`Renderizando ${k.name} (${i + 1} de ${cuts.length})…`, true);
        const r = await post('/api/cut', { id: S.id, start: k.start, end: k.end, format: k.format, quality: cfg.q, fps: cfg.fps });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        done.push({ file: d.file, name: k.name, url: d.url });
      }
      let url;
      if (done.length === 1) url = `${done[0].url}?as=${encodeURIComponent(done[0].name)}`;
      else {
        toast('Compactando os cortes…', true);
        const r = await post('/api/zip', { items: done });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        url = d.url;
      }
      Object.assign(h('a'), { href: url, download: '' }).click();
      toast(done.length > 1 ? `${done.length} cortes exportados em um arquivo .zip.` : 'Corte pronto! O download começou.');
    } catch (e) {
      toast(e instanceof TypeError ? 'Servidor Python indisponível.' : (e.message || 'Erro ao exportar.'));
    } finally { S.busy = false; $('.btn--primary:not(.btn--block)').disabled = false; }
  }
  $('.btn--primary:not(.btn--block)').addEventListener('click', () => exportCuts(S.cuts));

  /* ===== Início ===== */
  setZoom(100); syncCap(); ruler(); syncSettings(); render();
})();