/*
 * app.js — views, routing and chrome for OTel Observatory.
 * Routes: #/overview  #/traces  #/trace/<id>  #/metrics  #/logs  #/concepts
 */
(function () {
  'use strict';
  const { fmt, esc } = Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------------------------------------------------------------- shared bits
  const color = n => { const sv = Sim.svc(n); return sv ? `var(--s${sv.slot})` : 'var(--muted)'; };
  const sw = n => `<i class="sw" style="background:${color(n)}"></i>`;
  const chip = n => `<span class="svc">${sw(n)}${esc(n)}</span>`;
  const SEV_COLOR = { DEBUG: 'var(--muted)', INFO: 'var(--s1)', WARN: 'var(--warning)', ERROR: 'var(--critical)' };
  const SLO = { frontend: 100, checkout: 60, cart: 10, payment: 15, 'product-catalog': 10, recommendation: 25, shipping: 10, 'fraud-detection': 50 };
  const WINDOWS = [[60, '1 min', 2], [300, '5 min', 5], [900, '15 min', 15]];
  const BUCKET_LABELS = Sim.BOUNDS.map(b => '≤' + fmt.ms(b, true)).concat(['>' + fmt.ms(Sim.BOUNDS[Sim.BOUNDS.length - 1], true)]);
  const BUCKET_NAMES = Sim.BOUNDS.map((b, i) => `${i ? fmt.ms(Sim.BOUNDS[i - 1]) : '0 ms'} – ${fmt.ms(b)}`).concat([`> ${fmt.ms(Sim.BOUNDS[Sim.BOUNDS.length - 1])}`]);

  function icon(kind, c) {
    if (kind === 'crit' || kind === 'ERROR') return `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" style="fill:${c || 'var(--critical)'}"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" class="ic-w"/></svg>`;
    if (kind === 'warn' || kind === 'WARN') return `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2L15.2 14.3H.8z" style="fill:${c || 'var(--warning)'}" stroke-linejoin="round"/><path d="M8 6v3.8" class="ic-b"/><circle cx="8" cy="11.9" r="1" class="ic-bf"/></svg>`;
    if (kind === 'good') return `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" style="fill:var(--good)"/><path d="M4.8 8.3l2.2 2.2 4.2-4.6" class="ic-w"/></svg>`;
    if (kind === 'INFO') return `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" style="fill:${SEV_COLOR.INFO}"/><path d="M8 7.2v4.4" class="ic-w"/><circle cx="8" cy="4.9" r="1" class="ic-wf"/></svg>`;
    return `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.6" style="fill:${SEV_COLOR.DEBUG}"/></svg>`;
  }
  const sevBadge = sev => `<span class="sev sev-${sev}">${icon(sev)}${sev}</span>`;
  const HEALTH_LABEL = { good: 'Healthy', warn: 'Degraded', crit: 'Failing', idle: 'Idle' };
  function health(name, st) {
    if (!st || !st.calls) return 'idle';
    if (st.errPct >= 5) return 'crit';
    if (st.errPct >= 1 || (st.p95 || 0) > (SLO[name] || Infinity)) return 'warn';
    return 'good';
  }
  const latencyHealth = (name, st) => !st || st.p95 == null ? 'idle' : st.p95 > SLO[name] ? 'warn' : 'good';
  const healthBadge = h => `<span class="status status-${h}">${h === 'idle' ? '' : icon(h)}${HEALTH_LABEL[h]}</span>`;
  const statusPill = err => err ? `<span class="status status-crit">${icon('crit')}Error</span>` : `<span class="status status-good">${icon('good')}OK</span>`;

  function ago(t) {
    const s = Math.max(0, Math.round((Sim.now() - t) / 1000));
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
  }
  function pageHead(title, lede, extra) {
    return `<div class="page-head"><div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${extra || ''}</div>`;
  }
  function cardHead(o) {
    return `<div class="card-head"><div class="card-title"><h2>${o.title}</h2>${o.sub ? `<p class="sub">${o.sub}</p>` : ''}</div>` +
      `<div class="card-tools">${o.legend || ''}${o.chart ? `<button class="mini" data-toggle="${o.chart}" aria-pressed="false">Table</button>` : ''}</div></div>` +
      (o.query != null ? `<code class="query"${o.qid ? ` id="${o.qid}"` : ''}>${esc(o.query)}</code>` : '');
  }
  const legend = items => `<div class="legend">${items.map(([c, n, shape]) => `<span class="lg"><i class="${shape || 'ln-key'}" style="background:${c}"></i>${esc(n)}</span>`).join('')}</div>`;
  function draw(id, kind, cfg) {
    const el = document.getElementById(id); if (!el) return;
    if (el.dataset.mode === 'table') { el._c = null; el.innerHTML = `<div class="table-wrap">${Charts.table(kind, cfg)}</div>`; return; }
    Charts[kind](el, cfg);
  }
  function tile(label, value, unit, sub, sparkHtml, badge) {
    if (sparkHtml) sparkHtml = sparkHtml.replace('width="120"', 'width="96"');
    return `<div class="tile"><div class="tile-top"><span class="tile-label">${label}</span>${badge || ''}</div>` +
      `<div class="tile-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>` +
      `<div class="tile-foot"><span class="tile-sub">${sub}</span>${sparkHtml || ''}</div></div>`;
  }
  function splitMs(v) { const s = fmt.ms(v); const i = s.lastIndexOf(' '); return i > 0 ? [s.slice(0, i), ' ' + s.slice(i + 1)] : [s, '']; }
  function segmented(id, opts, cur) {
    return `<div class="seg" id="${id}" role="group">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('')}</div>`;
  }
  function onSeg(root, id, fn) {
    $(`#${id}`, root).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      $$(`#${id} button`, root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      fn(b.dataset.v);
    });
  }
  function hoverGuard(el) { const g = { on: false }; el.addEventListener('mouseenter', () => { g.on = true; }); el.addEventListener('mouseleave', () => { g.on = false; }); return g; }

  // ---------------------------------------------------------------- UI state
  const ui = {
    paused: false,
    metrics: { service: 'checkout', window: 300 },
    tf: { service: 'all', status: 'all', min: 0, q: '' },
    lf: { sev: new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']), service: 'all', q: '', trace: '', span: '' },
  };

  // ---------------------------------------------------------------- service map
  const MAP_NODES = {
    'load-generator': { x: 80, y: 320, type: 'ext', sub: 'Locust · simulated users' },
    frontend: { x: 260, y: 320 },
    recommendation: { x: 500, y: 90 },
    'product-catalog': { x: 760, y: 170 },
    postgres: { x: 980, y: 170, type: 'infra' },
    cart: { x: 500, y: 330 },
    valkey: { x: 760, y: 330, type: 'infra' },
    checkout: { x: 500, y: 520 },
    payment: { x: 760, y: 450 },
    shipping: { x: 760, y: 560 },
    kafka: { x: 760, y: 660, type: 'infra' },
    'fraud-detection': { x: 980, y: 660 },
  };
  const MAP_EDGES = [
    ['load-generator', 'frontend'], ['frontend', 'product-catalog'], ['frontend', 'recommendation'], ['frontend', 'cart'],
    ['frontend', 'checkout'], ['recommendation', 'product-catalog'], ['product-catalog', 'postgres'], ['cart', 'valkey'],
    ['checkout', 'cart'], ['checkout', 'product-catalog'], ['checkout', 'payment'], ['checkout', 'shipping'],
    ['checkout', 'kafka'], ['kafka', 'fraud-detection'],
  ];
  const NW = 172, NH = 58;
  const nodeSize = n => (MAP_NODES[n].type ? [140, 52] : [NW, NH]);
  function clip(a, b) {
    const [w, h] = nodeSize(a), A = MAP_NODES[a], B = MAP_NODES[b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const t = Math.min((w / 2 + 4) / Math.abs(dx || 1e-9), (h / 2 + 4) / Math.abs(dy || 1e-9));
    return [A.x + dx * t, A.y + dy * t];
  }

  function ServiceMap(el) {
    const geo = {};
    let edges = '';
    MAP_EDGES.forEach(([a, b]) => {
      const [x1, y1] = clip(a, b), [x2, y2] = clip(b, a), key = a + '>' + b;
      geo[key] = { x1, y1, x2, y2 };
      const d = `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`;
      edges += `<g class="edge" data-edge="${key}"><path class="edge-line" d="${d}" marker-end="url(#m-arrow)"/><path class="edge-hit" d="${d}"/></g>`;
    });
    let nodes = '';
    Object.entries(MAP_NODES).forEach(([name, n]) => {
      const [w, h] = nodeSize(name);
      const sv = Sim.svc(name);
      nodes += `<g class="node node-${n.type || 'svc'}" data-node="${name}" transform="translate(${n.x - w / 2},${n.y - h / 2})" ${sv ? 'tabindex="0" role="link"' : ''} aria-label="${name}">` +
        `<rect class="node-box" width="${w}" height="${h}" rx="${n.type === 'infra' ? 22 : 10}"/>` +
        (sv ? `<circle cx="16" cy="20" r="5" style="fill:${color(name)}"/>` : '') +
        `<text class="node-title" x="${sv ? 28 : 16}" y="24">${name}</text>` +
        `<text class="node-meta" x="16" y="${h - 14}">–</text><g class="node-badge"></g></g>`;
    });
    el.innerHTML = `<svg class="svcmap" viewBox="0 0 1080 710" role="img" aria-label="Service map of the Astronomy Shop">
      <defs><marker id="m-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="arrowhead"/></marker>
      <marker id="m-arrow-err" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="arrowhead-err"/></marker></defs>
      <g class="edges">${edges}</g><g class="particles"></g><g class="nodes">${nodes}</g></svg>`;
    const svg = $('svg', el), pg = $('.particles', svg);
    let stats = {}, estats = {};

    function update() {
      estats = Sim.edgeStats(30);
      stats = {};
      Sim.SERVICES.forEach(s => { stats[s.name] = Sim.serviceStats(s.name, 30); });
      Object.entries(MAP_NODES).forEach(([name, n]) => {
        const g = $(`[data-node="${name}"]`, svg);
        const [w] = nodeSize(name);
        let meta, h = 'good', badge = '';
        if (Sim.svc(name)) {
          const st = stats[name];
          h = health(name, st);
          meta = `${fmt.rate(st.rps)} · p95 ${fmt.ms(st.p95)}`;
          if (h === 'crit' || (h === 'warn' && st.errPct >= 1)) badge = `${fmt.pct(st.errPct)} err`;
          else if (h === 'warn') badge = 'slow';
        } else {
          const inc = MAP_EDGES.filter(e => e[1] === name).map(e => estats[e[0] + '>' + e[1]]).filter(Boolean);
          const rps = inc.reduce((a, e) => a + e.rps, 0);
          const err = inc.reduce((a, e) => a + e.rps * e.errPct, 0) / (rps || 1);
          if (name === 'load-generator') { const e = estats['load-generator>frontend']; meta = `${fmt.rate(e ? e.rps : 0)} requests`; }
          else meta = `${fmt.rate(rps)} ops`;
          if (err >= 5) { h = 'crit'; badge = `${fmt.pct(err)} err`; }
        }
        g.setAttribute('class', `node node-${n.type || 'svc'} h-${h}`);
        $('.node-meta', g).textContent = meta;
        const bg = $('.node-badge', g);
        if (badge) {
          const bw = badge.length * 6.4 + 26;
          bg.innerHTML = `<g transform="translate(${w - bw + 8},-11)"><rect class="badge-bg badge-${h}" width="${bw}" height="22" rx="11"/>` +
            `<g transform="translate(6,3) scale(1)">${icon(h).replace('class="ic"', 'width="16" height="16"')}</g><text class="badge-text badge-text-${h}" x="26" y="15">${badge}</text></g>`;
        } else bg.innerHTML = '';
      });
      MAP_EDGES.forEach(([a, b]) => {
        const key = a + '>' + b, e = estats[key], g = $(`[data-edge="${key}"]`, svg);
        const rps = e ? e.rps : 0, err = e && e.errPct >= 2;
        const line = $('.edge-line', g);
        line.style.strokeWidth = (1.25 + Math.min(3, Math.log2(1 + rps) * 0.7)).toFixed(2);
        g.classList.toggle('err', !!err);
        g.classList.toggle('idle', rps === 0);
        line.setAttribute('marker-end', `url(#${err ? 'm-arrow-err' : 'm-arrow'})`);
      });
    }

    svg.addEventListener('mousemove', e => {
      const n = e.target.closest('[data-node]'), ed = e.target.closest('[data-edge]');
      if (n) {
        const name = n.dataset.node, sv = Sim.svc(name);
        let h = `<div class="tt-h">${esc(name)}</div>`;
        if (sv) {
          const st = stats[name] || {};
          h += `<div class="tt-row"><span class="tt-k">Language</span><b>${esc(sv.label)}</b></div>` +
            `<div class="tt-row"><span class="tt-k">Pod</span><code>${esc(Sim.state.pods[name])}</code></div>` +
            `<div class="tt-row"><span class="tt-k">Requests</span><b>${fmt.rate(st.rps)}</b></div>` +
            `<div class="tt-row"><span class="tt-k">Errors</span><b>${fmt.pct(st.errPct)}</b></div>` +
            `<div class="tt-row"><span class="tt-k">p50 / p95 / p99</span><b>${fmt.ms(st.p50)} / ${fmt.ms(st.p95)} / ${fmt.ms(st.p99)}</b></div>` +
            `<div class="tt-row"><span class="tt-k">SLO (p95)</span><b>${fmt.ms(SLO[name])}</b></div><div class="tt-foot">Click to open metrics</div>`;
        } else {
          const n2 = MAP_NODES[name];
          h += `<div class="tt-row"><span class="tt-k">${n2.type === 'ext' ? 'Client' : 'Uninstrumented'}</span><b>${esc(n2.sub || (Sim.INFRA.find(i => i.name === name) || {}).label || '')}</b></div><div class="tt-foot">Seen through the CLIENT spans of its callers</div>`;
        }
        Charts.showTip(h, e.clientX, e.clientY);
      } else if (ed) {
        const st = estats[ed.dataset.edge] || { rps: 0, errPct: 0, avg: null };
        const [a, b] = ed.dataset.edge.split('>');
        Charts.showTip(`<div class="tt-h">${esc(a)} → ${esc(b)}</div><div class="tt-row"><span class="tt-k">Calls</span><b>${fmt.rate(st.rps)}</b></div><div class="tt-row"><span class="tt-k">Errors</span><b>${fmt.pct(st.errPct)}</b></div><div class="tt-row"><span class="tt-k">Avg duration</span><b>${fmt.ms(st.avg)}</b></div>`, e.clientX, e.clientY);
      } else Charts.hideTip();
    });
    svg.addEventListener('mouseleave', Charts.hideTip);
    const open = name => { if (Sim.svc(name)) location.hash = `#/metrics?service=${name}`; };
    svg.addEventListener('click', e => { const n = e.target.closest('[data-node]'); if (n) open(n.dataset.node); });
    svg.addEventListener('keydown', e => { const n = e.target.closest('[data-node]'); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(n.dataset.node); } });

    // Request particles travel along edges at the moment each span starts.
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pool = [], TRAVEL = 650;
    let raf = 0;
    function frame() {
      const now = Date.now(), ps = Sim.state.particles;
      let used = 0;
      for (let i = ps.length - 1; i >= 0; i--) if (ps[i].at + TRAVEL < now) ps.splice(i, 1);
      if (!ui.paused) {
        for (const p of ps) {
          if (p.at > now) continue;
          const g = geo[p.from + '>' + p.to]; if (!g) continue;
          const f = (now - p.at) / TRAVEL;
          let c = pool[used];
          if (!c) { c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('r', '3.5'); c.setAttribute('class', 'particle'); pg.appendChild(c); pool.push(c); }
          c.setAttribute('cx', (g.x1 + (g.x2 - g.x1) * f).toFixed(1));
          c.setAttribute('cy', (g.y1 + (g.y2 - g.y1) * f).toFixed(1));
          c.style.fill = p.err ? 'var(--critical)' : color(p.svc);
          c.style.display = '';
          used++;
        }
      }
      for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
      raf = requestAnimationFrame(frame);
    }
    if (!reduce) raf = requestAnimationFrame(frame);
    return { update, destroy() { cancelAnimationFrame(raf); } };
  }

  // ---------------------------------------------------------------- views
  const VIEWS = {};

  VIEWS.overview = root => {
    root.innerHTML = pageHead('Live overview',
      'The OpenTelemetry Astronomy Shop: eight instrumented services and three backing stores, with every span, log record and metric generated in your browser. Turn on a <button class="link" data-open-faults>fault</button> and watch it appear in traces, metrics and logs.') +
      `<section class="tiles" id="ov-tiles"></section>
      <div class="ov-grid">
        <section class="card map-card">${cardHead({ title: 'Service map', sub: 'Built from CLIENT → SERVER span pairs over the last 30 s. Dots are requests in flight; click a service to open its metrics.', legend: `<div class="legend">${healthBadge('good')}${healthBadge('warn')}${healthBadge('crit')}</div>` })}
          <div id="ov-map" class="map"></div></section>
        <div class="ov-side">
          <section class="card">${cardHead({ title: 'Telemetry pipeline', sub: 'What the Collector receives and exports, per second' })}<div id="ov-pipe"></div></section>
          <section class="card">${cardHead({ title: 'Recent errors', legend: '<a class="more" href="#/logs?sev=ERROR">All error logs →</a>' })}<ul class="list" id="ov-errors"></ul></section>
          <section class="card">${cardHead({ title: 'Slowest traces', sub: 'Last 2 minutes' })}<ul class="list" id="ov-slow"></ul></section>
        </div>
      </div>`;
    const map = ServiceMap($('#ov-map', root));
    return {
      update() {
        const fe = Sim.serviceStats('frontend', 60), fd = Sim.serviceStats('fraud-detection', 60);
        const s1 = Sim.serviceSeries('frontend', 300, 10), s2 = Sim.serviceSeries('fraud-detection', 300, 10);
        const p95 = splitMs(fe.p95);
        const errH = fe.errPct >= 5 ? 'crit' : fe.errPct >= 1 ? 'warn' : 'good';
        $('#ov-tiles', root).innerHTML =
          tile('Requests', fmt.rate(fe.rps).replace('/s', ''), '/s', 'frontend · last 60 s', Charts.spark(s1.rate)) +
          tile('Error rate', fmt.pct(fe.errPct), '', 'HTTP 5xx at the edge', Charts.spark(s1.errPct), healthBadge(errH)) +
          tile('p95 latency', p95[0], p95[1], `frontend · SLO ${fmt.ms(SLO.frontend)}`, Charts.spark(s1.p95), healthBadge(latencyHealth('frontend', fe))) +
          tile('Orders', fmt.num(fd.rps * 60), '/min', 'via fraud-detection', Charts.spark(s2.rate));
        map.update();

        const sr = Sim.signalRates(5), c = Sim.state.counters;
        const ss = Sim.signalSeries(120, 5);
        $('#ov-pipe', root).innerHTML = [
          ['var(--s1)', 'Traces', `${fmt.num(sr.spans)} spans/s`, `${fmt.num(c.spans)} spans`, 'Jaeger', ss.spans],
          ['var(--s2)', 'Metrics', `${fmt.num(sr.points)} points/s`, `${fmt.num(c.points)} points`, 'Prometheus', ss.points],
          ['var(--s3)', 'Logs', `${fmt.num(sr.logs)} records/s`, `${fmt.num(c.logs)} records`, 'OpenSearch', ss.logs],
        ].map(([col, n, rate, tot, dest, ser]) => `<div class="pipe-row"><span class="pipe-name"><i class="sw" style="background:${col}"></i>${n}</span>` +
          `<span class="pipe-rate">${rate}</span>${Charts.spark(ser, { w: 84, h: 26 })}<span class="pipe-dest">→ ${dest}<small>${tot} total</small></span></div>`).join('');

        const errs = [];
        const L = Sim.logs();
        for (let i = L.length - 1; i >= 0 && errs.length < 6; i--) if (L[i].sev === 'ERROR') errs.push(L[i]);
        errs.sort((a, b) => b.time - a.time);
        $('#ov-errors', root).innerHTML = errs.length ? errs.map(l => `<li class="li" ${l.traceId ? `data-href="#/trace/${l.traceId}?span=${l.spanId}"` : ''}>` +
          `<div class="li-top">${chip(l.service)}<span class="muted small">${ago(l.time)}</span></div><div class="li-body">${esc(l.body)}</div></li>`).join('')
          : `<li class="li-empty">${icon('good')} No errors recently. Try the <button class="link" data-open-faults>fault panel</button></li>`;

        const cut = Sim.now() - 120000;
        const slow = Sim.allTraces().filter(t => t.start > cut).sort((a, b) => b.duration - a.duration).slice(0, 5);
        $('#ov-slow', root).innerHTML = slow.map(t => `<li class="li" data-href="#/trace/${t.traceId}">` +
          `<div class="li-top"><span class="op">${esc(t.name)}</span><b class="mono">${fmt.ms(t.duration)}</b></div>` +
          `<div class="li-meta"><span class="sw-stack">${t.services.map(sw).join('')}</span><span class="muted small">${t.spans.length} spans · ${ago(t.start)}</span>${t.error ? statusPill(true) : ''}</div></li>`).join('');
      },
      destroy() { map.destroy(); },
    };
  };

  // ---------------------------------------------------------------- traces
  function traceMatches(t, f) {
    if (f.service !== 'all' && !t.services.includes(f.service)) return false;
    if (f.status === 'error' && !t.error) return false;
    if (f.status === 'ok' && t.error) return false;
    if (t.duration < f.min) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!t.traceId.startsWith(q) && !t.spans.some(s => s.name.toLowerCase().includes(q))) return false;
    }
    return true;
  }

  VIEWS.traces = (root, r) => {
    const f = ui.tf;
    if (r.q.get('service')) f.service = r.q.get('service');
    if (r.q.get('status')) f.status = r.q.get('status');
    root.innerHTML = pageHead('Traces', 'Every request becomes a trace: a tree of spans that share one <code>trace_id</code>, carried between services in the W3C <code>traceparent</code> header.') +
      `<div class="filters">
        <label class="field"><span>Service</span><select id="tf-svc"><option value="all">All services</option>${Sim.SERVICES.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}</select></label>
        <div class="field"><span>Status</span>${segmented('tf-status', [['all', 'All'], ['ok', 'OK'], ['error', 'Errors']], f.status)}</div>
        <label class="field"><span>Min duration</span><select id="tf-min">${[[0, 'Any'], [10, '≥ 10 ms'], [25, '≥ 25 ms'], [50, '≥ 50 ms'], [100, '≥ 100 ms'], [1000, '≥ 1 s']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field grow"><span>Operation or trace id</span><input id="tf-q" type="search" placeholder="e.g. Charge, GetProduct, /api/cart" autocomplete="off"></label>
      </div>
      <section class="card">${cardHead({ title: 'Trace duration', sub: 'One mark per trace (root span duration, log scale). Click a mark to open the trace.', legend: legend([['var(--s1)', 'OK', 'dot-key'], ['var(--critical)', 'Error', 'dia-key']]) })}
        <div class="chart-box" id="tr-scatter"></div></section>
      <section class="card">${cardHead({ title: '<span id="tr-count">Traces</span>', sub: 'The in-memory store keeps the latest 2,000 traces, plus error traces and metric exemplars for longer, much like a tail-sampling policy.' })}
        <div class="table-wrap" id="tr-table"></div></section>`;
    $('#tf-svc', root).value = f.service;
    $('#tf-min', root).value = String(f.min);
    $('#tf-q', root).value = f.q;
    const refresh = () => view.update(true);
    $('#tf-svc', root).addEventListener('change', e => { f.service = e.target.value; refresh(); });
    $('#tf-min', root).addEventListener('change', e => { f.min = +e.target.value; refresh(); });
    $('#tf-q', root).addEventListener('input', e => { f.q = e.target.value.trim(); refresh(); });
    onSeg(root, 'tf-status', v => { f.status = v; refresh(); });
    const guard = hoverGuard($('#tr-table', root));

    const view = {
      update(force) {
        const all = Sim.allTraces().filter(t => traceMatches(t, f));
        const now = Sim.now();
        const oldest = Sim.state.recent.length ? Sim.state.recent[0].start : now - 180000;
        const t0 = Math.max(now - 180000, oldest);
        const recentPts = all.filter(t => t.start > t0);
        draw('tr-scatter', 'scatter', {
          label: 'Trace durations over time', height: 230, t0, t1: now,
          points: recentPts.map(t => ({ t: t.start, v: Math.max(0.1, t.duration), err: t.error, id: t.traceId, tr: t })),
          tip: p => `<div class="tt-h">${esc(p.tr.name)}</div><div class="tt-row"><span class="tt-k">Duration</span><b>${fmt.ms(p.v)}</b></div>` +
            `<div class="tt-row"><span class="tt-k">Spans</span><b>${p.tr.spans.length}</b></div><div class="tt-row"><span class="tt-k">Status</span><b>${p.err ? 'Error' : 'OK'}</b></div>` +
            `<div class="tt-row"><span class="tt-k">Started</span><b>${fmt.timeMs(p.t)}</b></div><div class="tt-foot">Click to open</div>`,
          onClick: p => { location.hash = `#/trace/${p.id}`; },
        });
        $('#tr-count', root).textContent = `${all.length.toLocaleString()} matching traces`;
        if (guard.on && !force) return;
        const rows = all.sort((a, b) => b.start - a.start).slice(0, 100);
        const maxD = Math.max(1, ...rows.map(t => t.duration));
        $('#tr-table', root).innerHTML = rows.length ? `<table class="data traces"><thead><tr><th>Started</th><th>Root operation</th><th>Services</th><th class="num">Spans</th><th>Duration</th><th>Status</th></tr></thead><tbody>` +
          rows.map(t => `<tr data-href="#/trace/${t.traceId}" tabindex="0"><td class="mono nowrap">${fmt.timeMs(t.start)}</td>` +
            `<td><div class="op">${esc(t.name)}</div><div class="mono muted small">${t.traceId.slice(0, 16)}…</div></td>` +
            `<td><span class="sw-stack" title="${esc(t.services.join(', '))}">${t.services.map(sw).join('')}</span> <span class="muted small">${t.services.length}</span></td>` +
            `<td class="num">${t.spans.length}</td>` +
            `<td><div class="dur"><span class="dur-bar"><i style="width:${(t.duration / maxD * 100).toFixed(1)}%"></i></span><span class="mono">${fmt.ms(t.duration)}</span></div></td>` +
            `<td>${statusPill(t.error)}${t.errorCount > 1 ? ` <span class="muted small">${t.errorCount} spans</span>` : ''}</td></tr>`).join('') + '</tbody></table>'
          : '<div class="chart-empty">No traces match the current filters.</div>';
      },
    };
    return view;
  };

  // ---------------------------------------------------------------- trace detail
  VIEWS.trace = (root, r) => {
    const tr = r.arg === 'latest' ? latestCheckout() : Sim.getTrace(r.arg);
    if (!tr) {
      root.innerHTML = pageHead('Trace not found', `Trace <code>${esc(r.arg || '')}</code> is no longer in the in-memory store. Recent traces are evicted after about two minutes; error and exemplar traces are kept longer.`) +
        '<p><a class="btn" href="#/traces">← Back to traces</a></p>';
      return {};
    }
    const kids = new Map();
    tr.spans.forEach(s => { if (!kids.has(s.parentSpanId)) kids.set(s.parentSpanId, []); kids.get(s.parentSpanId).push(s); });
    kids.forEach(a => a.sort((x, y) => x.start - y.start));
    const order = [];
    (function walk(p, d) { (kids.get(p) || []).forEach(s => { order.push({ s, d, kids: kids.has(s.spanId) ? countDesc(s.spanId) : 0 }); walk(s.spanId, d + 1); }); })('', 0);
    function countDesc(id) { let n = 0; (kids.get(id) || []).forEach(c => { n += 1 + countDesc(c.spanId); }); return n; }
    const T0 = tr.start, total = Math.max(0.001, tr.end - tr.start);
    const collapsed = new Set();
    let selected = r.q.get('span') && tr.spans.find(s => s.spanId === r.q.get('span')) ? r.q.get('span') : tr.root.spanId;
    const logs = Sim.logsForTrace(tr.traceId);
    const bySvc = {};
    tr.spans.forEach(s => { bySvc[s.service] = (bySvc[s.service] || 0) + 1; });

    root.innerHTML = `<div class="crumbs"><a href="#/traces">Traces</a> / <span class="mono">${tr.traceId}</span></div>` +
      pageHead(`${chip(tr.root.service)} <span class="op">${esc(tr.name)}</span>`, null,
        `<div class="head-actions"><button class="btn" data-json-trace="${tr.traceId}">View OTLP/JSON</button><a class="btn" href="#/logs?trace=${tr.traceId}">Logs (${logs.length})</a></div>`) +
      `<div class="facts">
        <div><span>Status</span>${statusPill(tr.error)}</div>
        <div><span>Duration</span><b>${fmt.ms(tr.duration)}</b>${tr.end - tr.root.end > 1 ? `<small class="muted">${fmt.ms(total)} incl. async</small>` : ''}</div>
        <div><span>Started</span><b class="mono">${fmt.timeMs(tr.start)}</b></div>
        <div><span>Spans</span><b>${tr.spans.length}</b>${tr.errorCount ? `<small class="muted">${tr.errorCount} with errors</small>` : ''}</div>
        <div><span>Services</span><b>${tr.services.length}</b></div>
        <div class="grow"><span>Spans by service</span><div class="svc-row">${Object.entries(bySvc).map(([s, n]) => `${chip(s)}<small class="muted">${n}</small>`).join('')}</div></div>
      </div>
      <div class="trace-layout">
        <section class="card wf-card">
          <div class="wf-head"><div class="wf-name">Span</div><div class="wf-axis" id="wf-axis"></div></div>
          <div id="wf" class="wf" role="tree"></div>
        </section>
        <aside class="card span-detail" id="span-detail"></aside>
      </div>
      <section class="card">${cardHead({ title: `Logs in this trace (${logs.length})`, sub: 'Log records carry the active trace_id and span_id, so they join the trace for free. Click one to select its span.' })}
        <div class="log-list compact" id="tr-logs">${logs.map(l => logRowHtml(l, false, true)).join('') || '<div class="chart-empty">No logs were emitted inside this trace.</div>'}</div></section>`;

    const ticks = [0, 0.25, 0.5, 0.75, 1];
    $('#wf-axis', root).innerHTML = ticks.map(f => `<span style="left:${f * 100}%">${fmt.ms(total * f)}</span>`).join('');

    function renderWf() {
      let hide = -1, h = '';
      for (const it of order) {
        if (hide >= 0 && it.d > hide) continue;
        hide = -1;
        const s = it.s, left = (s.start - T0) / total * 100, width = Math.max(0.25, (s.end - s.start) / total * 100);
        const isC = collapsed.has(s.spanId);
        if (isC) hide = it.d;
        const err = s.status.code === 'ERROR';
        const labelRight = left + width < 78;
        h += `<div class="wf-row${s.spanId === selected ? ' sel' : ''}${err ? ' err' : ''}" data-span="${s.spanId}" role="treeitem" tabindex="0" aria-selected="${s.spanId === selected}">` +
          `<div class="wf-name" style="padding-left:${8 + it.d * 16}px">` +
          (it.kids ? `<button class="wf-tog" data-tog="${s.spanId}" aria-label="${isC ? 'Expand' : 'Collapse'}">${isC ? '▸' : '▾'}</button>` : '<span class="wf-tog-sp"></span>') +
          `${sw(s.service)}<span class="wf-svc">${esc(s.service)}</span><span class="wf-op" title="${esc(s.name)}">${esc(s.name.replace(/^oteldemo\./, ''))}</span>${err ? icon('crit') : ''}` +
          `${isC ? `<span class="muted small">+${it.kids}</span>` : ''}<span class="kind kind-${s.kind}">${s.kind}</span></div>` +
          `<div class="wf-track"><div class="wf-bar" style="left:${left}%;width:${width}%;background:${color(s.service)}"></div>` +
          `<span class="wf-dur ${labelRight ? '' : 'left'}" style="${labelRight ? `left:calc(${left + width}% + 6px)` : `right:calc(${100 - left}% + 6px)`}">${fmt.ms(s.end - s.start)}</span>` +
          s.events.map(ev => `<i class="wf-evt" style="left:${(ev.time - T0) / total * 100}%" title="${esc(ev.name)}"></i>`).join('') + '</div></div>';
      }
      $('#wf', root).innerHTML = h;
    }

    function renderDetail() {
      const s = tr.spans.find(x => x.spanId === selected);
      const parent = tr.spans.find(x => x.spanId === s.parentSpanId);
      const kv = obj => `<table class="kv">${Object.entries(obj).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="${typeof v === 'string' ? 'str' : 'val'}">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</td></tr>`).join('')}</table>`;
      const spanLogs = logs.filter(l => l.spanId === s.spanId);
      $('#span-detail', root).innerHTML = `<div class="sd-head"><div>${chip(s.service)} <span class="kind kind-${s.kind}">${s.kind}</span></div><h3 class="op">${esc(s.name)}</h3>` +
        `<div class="sd-facts"><span>Duration <b>${fmt.ms(s.end - s.start)}</b></span><span>Starts at <b>+${fmt.ms(s.start - T0)}</b></span><span>${s.status.code === 'ERROR' ? statusPill(true) : s.status.code === 'UNSET' ? '<span class="status status-idle">Status UNSET</span>' : statusPill(false)}</span></div>` +
        (s.status.message ? `<div class="sd-msg">${icon('crit')}<span>${esc(s.status.message)}</span></div>` : '') + '</div>' +
        `<h4>Identifiers</h4><table class="kv"><tr><th>trace_id</th><td class="mono">${s.traceId}</td></tr><tr><th>span_id</th><td class="mono">${s.spanId}</td></tr>` +
        `<tr><th>parent_span_id</th><td class="mono">${s.parentSpanId ? `<a href="#" data-sel="${s.parentSpanId}">${s.parentSpanId}</a> <span class="muted small">${esc(parent ? parent.service : '')}</span>` : '<span class="muted">— root span</span>'}</td></tr>` +
        `<tr><th>traceparent</th><td class="mono small">00-${s.traceId}-${s.spanId}-01</td></tr></table>` +
        `<h4>Attributes <span class="muted small">${Object.keys(s.attributes).length}</span></h4>${kv(s.attributes)}` +
        (s.events.length ? `<h4>Events <span class="muted small">${s.events.length}</span></h4>` + s.events.map(ev => `<div class="evt"><div class="evt-h">${icon('crit')}<b>${esc(ev.name)}</b><span class="muted small">+${fmt.ms(ev.time - s.start)}</span></div>` +
          `<table class="kv">${Object.entries(ev.attributes).filter(([k]) => k !== 'exception.stacktrace').map(([k, v]) => `<tr><th>${esc(k)}</th><td class="str">${esc(v)}</td></tr>`).join('')}</table>` +
          (ev.attributes['exception.stacktrace'] ? `<pre class="stack">${esc(ev.attributes['exception.stacktrace'])}</pre>` : '') + '</div>').join('') : '') +
        (spanLogs.length ? `<h4>Logs from this span <span class="muted small">${spanLogs.length}</span></h4><div class="log-list compact">${spanLogs.map(l => logRowHtml(l, false, true)).join('')}</div>` : '') +
        `<h4>Resource <span class="muted small">${Object.keys(s.resource).length}</span></h4>${kv(s.resource)}`;
    }

    function select(id) {
      selected = id;
      $$('.wf-row', root).forEach(rw => { const on = rw.dataset.span === id; rw.classList.toggle('sel', on); rw.setAttribute('aria-selected', String(on)); });
      renderDetail();
    }
    $('#wf', root).addEventListener('click', e => {
      const tog = e.target.closest('[data-tog]');
      if (tog) { const id = tog.dataset.tog; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); renderWf(); return; }
      const rw = e.target.closest('[data-span]'); if (rw) select(rw.dataset.span);
    });
    $('#wf', root).addEventListener('keydown', e => {
      const rw = e.target.closest('[data-span]'); if (!rw) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(rw.dataset.span); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const nx = e.key === 'ArrowDown' ? rw.nextElementSibling : rw.previousElementSibling; if (nx) { nx.focus(); select(nx.dataset.span); } }
    });
    root.addEventListener('click', e => {
      const a = e.target.closest('[data-sel]'); if (a) { e.preventDefault(); select(a.dataset.sel); return; }
      const lr = e.target.closest('#tr-logs .log-row'); if (lr && !e.target.closest('a,button') && lr.dataset.span) select(lr.dataset.span);
    });
    renderWf(); renderDetail();
    return {};
  };

  // ---------------------------------------------------------------- metrics
  VIEWS.metrics = (root, r) => {
    const st = ui.metrics;
    if (r.q.get('service') && Sim.svc(r.q.get('service'))) st.service = r.q.get('service');
    root.innerHTML = pageHead('Metrics', 'RED metrics (rate, errors, duration) derived from SERVER and CONSUMER spans by the Collector\'s <code>spanmetrics</code> connector, plus the runtime gauges each SDK reports.') +
      `<div class="filters">
        <div class="field grow"><span>Service</span><div class="chips" id="m-svc" role="group" aria-label="Service">${Sim.SERVICES.map(s => `<button class="chip-btn" data-v="${s.name}" aria-pressed="${s.name === st.service}">${sw(s.name)}${s.name}</button>`).join('')}</div></div>
        <div class="field"><span>Window</span>${segmented('m-win', WINDOWS.map(w => [w[0], w[1]]), st.window)}</div>
      </div>
      <section class="tiles tiles-5" id="m-tiles"></section>
      <div class="grid-2">
        <section class="card">${cardHead({ title: 'Request rate', sub: 'Calls per second, and the share that failed', chart: 'm-rate', qid: 'q-rate', query: '', legend: legend([['var(--s1)', 'Requests'], ['var(--critical)', 'Errors']]) })}<div class="chart-box" id="m-rate"></div></section>
        <section class="card">${cardHead({ title: 'Latency percentiles', sub: 'Estimated from histogram buckets, like <code>histogram_quantile</code>. ◆ exemplars link to the slowest trace in each 10 s window.', chart: 'm-lat', qid: 'q-lat', query: '', legend: legend([['var(--s1)', 'p50'], ['var(--s2)', 'p95'], ['var(--s3)', 'p99'], ['var(--ink-2)', 'Exemplar', 'dia-key']]) })}<div class="chart-box" id="m-lat"></div></section>
        <section class="card span-2">${cardHead({ title: 'Latency distribution', sub: 'Requests per histogram bucket over time. Darker cells hold more requests.', chart: 'm-heat', qid: 'q-heat', query: '', legend: `<div class="legend seq-legend"><span class="muted small">fewer</span>${[1, 2, 3, 4, 5, 6, 7].map(i => `<i style="background:var(--seq-${i})"></i>`).join('')}<span class="muted small">more</span></div>` })}<div class="chart-box" id="m-heat"></div></section>
        <section class="card">${cardHead({ title: 'CPU utilization', sub: 'process.cpu.utilization, percent of one core', chart: 'm-cpu', qid: 'q-cpu', query: '' })}<div class="chart-box" id="m-cpu"></div></section>
        <section class="card">${cardHead({ title: 'Memory usage', sub: 'process.memory.usage (resident set)', chart: 'm-mem', qid: 'q-mem', query: '' })}<div class="chart-box" id="m-mem"></div></section>
        <section class="card span-2">${cardHead({ title: 'p95 latency by service', sub: 'Same window; click a bar to switch service', chart: 'm-bars' })}<div class="chart-box" id="m-bars"></div></section>
      </div>`;
    $('#m-svc', root).addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      setService(b.dataset.v);
    });
    function setService(name) {
      st.service = name;
      $$('#m-svc button', root).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === name)));
      history.replaceState(null, '', `#/metrics?service=${name}`);
      view.update(true);
    }
    onSeg(root, 'm-win', v => { st.window = +v; view.update(true); });

    const view = {
      update() {
        const name = st.service, win = WINDOWS.find(w => w[0] === st.window) || WINDOWS[1];
        const step = win[2], sel = `service_name="${name}"`;
        const s = Sim.serviceSeries(name, win[0], step);
        const k = Sim.serviceStats(name, Math.min(60, win[0]));
        const rt = Sim.runtimeSeries(name, win[0], step);
        const p50 = splitMs(k.p50), p95 = splitMs(k.p95), p99 = splitMs(k.p99);
        const h = latencyHealth(name, k);
        $('#m-tiles', root).innerHTML =
          tile('Request rate', fmt.rate(k.rps).replace('/s', ''), '/s', 'last 60 s', Charts.spark(s.rate.slice(-30))) +
          tile('Error rate', fmt.pct(k.errPct), '', `${Math.round(k.calls * k.errPct / 100)} failed calls`, Charts.spark(s.errPct.slice(-30)), k.errPct >= 1 ? healthBadge(k.errPct >= 5 ? 'crit' : 'warn') : '') +
          tile('p50', p50[0], p50[1], 'median', Charts.spark(s.p50.slice(-30))) +
          tile('p95', p95[0], p95[1], `SLO ${fmt.ms(SLO[name])}`, Charts.spark(s.p95.slice(-30)), healthBadge(h)) +
          tile('p99', p99[0], p99[1], 'tail latency', Charts.spark(s.p99.slice(-30)));

        $('#q-rate', root).textContent = `sum by (status_code) (rate(traces_span_metrics_calls_total{${sel}, span_kind=~"SPAN_KIND_(SERVER|CONSUMER)"}[${step}s]))`;
        $('#q-lat', root).textContent = `histogram_quantile(0.95, sum by (le) (rate(traces_span_metrics_duration_milliseconds_bucket{${sel}}[${step}s])))`;
        $('#q-heat', root).textContent = `sum by (le) (increase(traces_span_metrics_duration_milliseconds_bucket{${sel}}[${step}s]))`;
        $('#q-cpu', root).textContent = `process_cpu_utilization_ratio{${sel}} * 100`;
        $('#q-mem', root).textContent = `process_memory_usage_bytes{${sel}} / 2^20`;

        draw('m-rate', 'line', { label: 'Request rate', times: s.times, format: fmt.rate, area: true, series: [
          { name: 'Requests', short: 'req', color: 'var(--s1)', values: s.rate },
          { name: 'Errors', short: 'err', color: 'var(--critical)', values: s.errRate }] });
        draw('m-lat', 'line', { label: 'Latency percentiles', times: s.times, format: fmt.ms, exemplars: s.exemplars,
          onExemplar: e => { location.hash = `#/trace/${e.traceId}?span=${e.spanId}`; },
          series: [{ name: 'p50', color: 'var(--s1)', values: s.p50 }, { name: 'p95', color: 'var(--s2)', values: s.p95 }, { name: 'p99', color: 'var(--s3)', values: s.p99 }] });
        draw('m-heat', 'heatmap', { label: 'Latency heatmap', times: s.times, step, matrix: s.heat, rowLabels: BUCKET_LABELS, rowNames: BUCKET_NAMES, height: 240 });
        draw('m-cpu', 'line', { label: 'CPU utilization', times: rt.times, format: fmt.cpu, area: true, minMax: 10, series: [{ name: 'CPU', color: 'var(--s1)', values: rt.cpu }] });
        draw('m-mem', 'line', { label: 'Memory usage', times: rt.times, format: fmt.mib, area: true, minMax: 50,
          refLine: name === 'recommendation' ? { value: Sim.MEM_LIMIT, label: `limit ${Sim.MEM_LIMIT} MiB · OOMKill` } : null,
          series: [{ name: 'Memory', color: 'var(--s1)', values: rt.mem }] });
        const items = Sim.SERVICES.map(sv => { const x = Sim.serviceStats(sv.name, win[0]); return { id: sv.name, label: sv.name, value: x.p95 || 0, extra: [['Requests', fmt.rate(x.rps)], ['Errors', fmt.pct(x.errPct)], ['SLO', fmt.ms(SLO[sv.name])]] }; })
          .sort((a, b) => b.value - a.value);
        draw('m-bars', 'hbar', { label: 'p95 by service', items, format: fmt.ms, valueName: 'p95', labelName: 'Service', selected: name, onClick: it => setService(it.id) });
      },
    };
    return view;
  };

  // ---------------------------------------------------------------- logs
  function logRowHtml(l, open, compact) {
    return `<div class="log-row${open ? ' open' : ''}" data-id="${l.id}" data-span="${l.spanId}" tabindex="0">` +
      `<span class="log-time mono">${fmt.timeMs(l.time)}</span>${sevBadge(l.sev)}<span class="log-svc">${chip(l.service)}</span>` +
      `<span class="log-body">${esc(l.body)}</span>` +
      (compact ? '' : `<span class="log-trace">${l.traceId ? `<a class="tid mono" href="#/trace/${l.traceId}?span=${l.spanId}" title="Open trace">${l.traceId.slice(0, 8)}</a>` : '<span class="muted small">no trace</span>'}</span>`) +
      '</div>' + (open ? logDetailHtml(l) : '');
  }
  function logDetailHtml(l) {
    const kv = obj => `<table class="kv">${Object.entries(obj).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="${typeof v === 'string' ? 'str' : 'val'}">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</td></tr>`).join('')}</table>`;
    return `<div class="log-detail"><div class="ld-grid"><div><h4>Body</h4><pre class="body">${esc(l.body)}</pre>` +
      `<h4>Trace context</h4><table class="kv"><tr><th>trace_id</th><td class="mono">${l.traceId || '<span class="muted">—</span>'}</td></tr><tr><th>span_id</th><td class="mono">${l.spanId || '<span class="muted">—</span>'}</td></tr>` +
      `<tr><th>severity_number</th><td class="val">${l.sevNum} (${l.sev})</td></tr></table>` +
      `<div class="ld-actions">${l.traceId ? `<a class="btn" href="#/trace/${l.traceId}?span=${l.spanId}">Open trace</a>` : ''}<button class="btn" data-json-log="${l.id}">View OTLP/JSON</button></div></div>` +
      `<div><h4>Attributes</h4>${Object.keys(l.attributes).length ? kv(l.attributes) : '<p class="muted small">none</p>'}<h4>Resource</h4>${kv({ 'service.name': l.resource['service.name'], 'k8s.pod.name': l.resource['k8s.pod.name'], 'telemetry.sdk.language': l.resource['telemetry.sdk.language'] })}</div></div></div>`;
  }

  VIEWS.logs = (root, r) => {
    const lf = ui.lf;
    lf.trace = r.q.get('trace') || '';
    lf.span = r.q.get('span') || '';
    if (r.q.get('sev')) lf.sev = new Set(r.q.get('sev').split(','));
    if (r.q.get('service')) lf.service = r.q.get('service');
    const expanded = new Set();
    root.innerHTML = pageHead('Logs', 'Log records from every service, exported over OTLP with severity, attributes and resource. Records emitted inside a span carry its <code>trace_id</code> and <code>span_id</code>.') +
      `<div class="filters">
        <div class="field"><span>Severity</span><div class="chips" id="lf-sev">${['DEBUG', 'INFO', 'WARN', 'ERROR'].map(s => `<button class="chip-btn" data-v="${s}" aria-pressed="${lf.sev.has(s)}">${icon(s)}${s}<span class="cnt" data-cnt="${s}"></span></button>`).join('')}</div></div>
        <label class="field"><span>Service</span><select id="lf-svc"><option value="all">All services</option>${Sim.SERVICES.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}</select></label>
        <label class="field grow"><span>Search</span><input id="lf-q" type="search" placeholder="Text in body or attributes, e.g. Invalid token" autocomplete="off"></label>
      </div>
      <div id="lf-trace"></div>
      <section class="card">${cardHead({ title: 'Log volume', sub: 'Records per 5 s, by severity (last 5 minutes, all services)', chart: 'lg-vol', legend: legend([['var(--muted)', 'DEBUG', 'sq-key'], ['var(--s1)', 'INFO', 'sq-key'], ['var(--warning)', 'WARN', 'sq-key'], ['var(--critical)', 'ERROR', 'sq-key']]) })}<div class="chart-box" id="lg-vol"></div></section>
      <section class="card">${cardHead({ title: '<span id="lg-count">Records</span>', sub: 'Newest first. Click a record for details. The list stops updating while your pointer is over it.' })}
        <div class="log-head"><span>Time</span><span>Severity</span><span>Service</span><span>Body</span><span>Trace</span></div>
        <div class="log-list" id="lg-list"></div></section>`;
    $('#lf-svc', root).value = lf.service;
    $('#lf-q', root).value = lf.q;
    const refresh = () => view.update(true);
    $('#lf-sev', root).addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      const v = b.dataset.v; lf.sev.has(v) ? lf.sev.delete(v) : lf.sev.add(v);
      b.setAttribute('aria-pressed', String(lf.sev.has(v))); refresh();
    });
    $('#lf-svc', root).addEventListener('change', e => { lf.service = e.target.value; refresh(); });
    $('#lf-q', root).addEventListener('input', e => { lf.q = e.target.value.trim().toLowerCase(); refresh(); });
    $('#lf-trace', root).addEventListener('click', e => { if (e.target.closest('[data-clear]')) { lf.trace = ''; lf.span = ''; history.replaceState(null, '', '#/logs'); refresh(); } });
    const list = $('#lg-list', root), guard = hoverGuard(list);
    list.addEventListener('click', e => {
      if (e.target.closest('a,button')) return;
      const rw = e.target.closest('.log-row'); if (!rw) return;
      const id = +rw.dataset.id; expanded.has(id) ? expanded.delete(id) : expanded.add(id); refresh();
    });
    list.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('log-row')) e.target.click(); });

    const view = {
      update(force) {
        const v = Sim.logVolume(300, 5);
        draw('lg-vol', 'stack', { label: 'Log volume', times: v.times, step: 5, height: 150, format: fmt.count, series: [
          { name: 'DEBUG', color: 'var(--muted)', values: v.DEBUG }, { name: 'INFO', color: 'var(--s1)', values: v.INFO },
          { name: 'WARN', color: 'var(--warning)', values: v.WARN }, { name: 'ERROR', color: 'var(--critical)', values: v.ERROR }] });
        $('#lf-trace', root).innerHTML = lf.trace ? `<div class="filter-pill">Showing logs for trace <code>${lf.trace.slice(0, 16)}…</code>${lf.span ? ` · span <code>${lf.span}</code>` : ''} <a href="#/trace/${lf.trace}">Open trace</a><button class="mini" data-clear>Clear</button></div>` : '';
        if (guard.on && !force) return;
        const L = Sim.logs(), counts = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 }, out = [];
        for (let i = L.length - 1; i >= 0; i--) {
          const l = L[i];
          if (lf.trace && l.traceId !== lf.trace) continue;
          if (lf.span && l.spanId !== lf.span) continue;
          if (lf.service !== 'all' && l.service !== lf.service) continue;
          if (lf.q && !l.body.toLowerCase().includes(lf.q) && !Object.values(l.attributes).some(x => String(x).toLowerCase().includes(lf.q))) continue;
          counts[l.sev]++;
          if (lf.sev.has(l.sev) && out.length < 250) out.push(l);
        }
        out.sort((a, b) => b.time - a.time);
        Object.entries(counts).forEach(([k, n]) => { const c = $(`[data-cnt="${k}"]`, root); if (c) c.textContent = n.toLocaleString(); });
        const shown = Object.entries(counts).filter(([k]) => lf.sev.has(k)).reduce((a, [, n]) => a + n, 0);
        $('#lg-count', root).textContent = `${shown.toLocaleString()} matching records${shown > out.length ? ` · showing newest ${out.length}` : ''}`;
        list.innerHTML = out.map(l => logRowHtml(l, expanded.has(l.id))).join('') || '<div class="chart-empty">No log records match the current filters.</div>';
      },
    };
    return view;
  };

  // ---------------------------------------------------------------- concepts
  function latestCheckout() {
    const all = Sim.allTraces();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].name === 'POST /api/checkout' && all[i].spans.some(s => s.kind === 'PRODUCER')) return all[i];
    return null;
  }
  function correlationSample() {
    const s = Sim.serviceSeries('checkout', 300, 10);
    const ex = s.exemplars.sort((a, b) => b.t - a.t)[0];
    if (!ex) return null;
    const trace = Sim.getTrace(ex.traceId);
    const lg = Sim.logsForTrace(ex.traceId).find(l => l.service === 'checkout') || Sim.logsForTrace(ex.traceId)[0];
    return { service: 'checkout', v: ex.v, trace, log: lg };
  }
  function hlYaml(src) {
    return esc(src).split('\n').map(l => l
      .replace(/(#.*)$/, '<span class="y-c">$1</span>')
      .replace(/^(\s*-?\s*)([\w/.\-]+)(:)/, '$1<span class="y-k">$2</span>$3')).join('\n');
  }
  function hlCode(src) {
    return esc(src).split('\n').map(l => l.startsWith('//') ? `<span class="y-c">${l}</span>` : l.replace(/(&quot;[^&]*&quot;)/g, '<span class="j-s">$1</span>').replace(/\.(\w+)\(/g, '.<span class="y-k">$1</span>(')).join('\n');
  }

  VIEWS.concepts = root => {
    root.innerHTML = pageHead('Concepts', 'How OpenTelemetry ties this demo together. The diagrams use identifiers from live telemetry in this page.') +
      `<section class="card concept">${cardHead({ title: '1 · How telemetry flows', sub: 'SDKs export OTLP to a Collector, which processes signals and fans them out to backends.', legend: legend([['var(--s1)', 'Traces', 'dot-key'], ['var(--s2)', 'Metrics', 'dot-key'], ['var(--s3)', 'Logs', 'dot-key']]) })}
        <div class="diagram-wrap">${Diagrams.pipeline()}</div>
        <div class="concept-notes">
          <div><h4>API vs SDK</h4><p>Libraries depend only on the vendor-neutral <b>API</b>. The application wires up the <b>SDK</b>, which holds samplers, processors and exporters.</p></div>
          <div><h4>OTLP</h4><p>One protocol for all three signals, over gRPC (4317) or HTTP/protobuf (4318). Every service here, in six languages, speaks it.</p></div>
          <div><h4>Collector</h4><p>Receivers → processors → exporters, per signal. The <b>spanmetrics</b> connector turns spans into RED metrics, which is where this page's Metrics view comes from.</p></div>
        </div></section>

      <section class="card concept">${cardHead({ title: '2 · Context propagation', sub: 'How one trace_id survives gRPC calls and a Kafka hop. Each callee\'s SERVER span takes the caller\'s CLIENT span id as its parent.', legend: '<button class="btn" id="cp-refresh">Use newest checkout trace</button>' })}
        <div class="diagram-wrap" id="cp-diagram"></div>
        <div id="cp-break"></div></section>

      <section class="card concept">${cardHead({ title: '3 · Three signals, one context', sub: 'Exemplars link a metric data point to a trace; log records carry trace_id and span_id; a shared Resource identifies the process. Click a card to follow the link.' })}
        <div class="diagram-wrap" id="corr-diagram"></div></section>

      <div class="grid-2">
        <section class="card">${cardHead({ title: 'Collector configuration', sub: 'otelcol-config.yaml matching the diagram above' })}<pre class="code">${hlYaml(Diagrams.COLLECTOR_YAML)}</pre></section>
        <section class="card">${cardHead({ title: 'SDK setup', sub: 'All three signals in a few lines of .NET' })}<pre class="code">${hlCode(Diagrams.SDK_SNIPPET)}</pre>
          <h4 class="gl-h">Glossary</h4>
          <dl class="glossary">
            <dt>Span</dt><dd>One timed operation with a name, kind, status, attributes and events.</dd>
            <dt>Trace</dt><dd>All spans sharing a trace_id, forming a tree through parent_span_id.</dd>
            <dt>Resource</dt><dd>Attributes of the producing entity: service.name, k8s.pod.name and so on.</dd>
            <dt>Semantic conventions</dt><dd>Standard attribute names such as http.route, rpc.method and db.system.name.</dd>
            <dt>Exemplar</dt><dd>A sample measurement on a metric that keeps the trace_id it came from.</dd>
            <dt>Tail sampling</dt><dd>Deciding what to keep after a trace completes, for example keep every error.</dd>
          </dl></section>
      </div>`;
    function renderProp() {
      const tr = latestCheckout();
      $('#cp-diagram', root).innerHTML = Diagrams.propagation(tr);
      const fe = tr && tr.spans.find(s => s.service === 'frontend' && s.kind === 'CLIENT' && s.peer === 'checkout');
      $('#cp-break', root).innerHTML = fe ? `<div class="tp-break"><div class="tp-title">The header frontend sends with PlaceOrder:</div>
        <code class="tp-code">traceparent: <span class="tps tps-1">00</span>-<span class="tps tps-2">${tr.traceId}</span>-<span class="tps tps-3">${fe.spanId}</span>-<span class="tps tps-4">01</span></code>
        <div class="tp-legend"><div><i class="tps-key tps-1"></i><b>version</b><span>always 00 today</span></div><div><i class="tps-key tps-2"></i><b>trace-id</b><span>16 bytes, the same for every span in the trace</span></div>
        <div><i class="tps-key tps-3"></i><b>parent-id</b><span>8 bytes: the span id of frontend's CLIENT span</span></div><div><i class="tps-key tps-4"></i><b>trace-flags</b><span>01 = sampled</span></div></div>
        <p class="muted small"><a href="#/trace/${tr.traceId}?span=${fe.spanId}">Open this trace →</a></p></div>` : '';
    }
    renderProp();
    $('#corr-diagram', root).innerHTML = Diagrams.correlation(correlationSample());
    $('#cp-refresh', root).addEventListener('click', () => { renderProp(); $('#corr-diagram', root).innerHTML = Diagrams.correlation(correlationSample()); });
    return {};
  };

  // ---------------------------------------------------------------- modal
  function hlJson(obj) {
    return esc(JSON.stringify(obj, null, 2)).replace(/(&quot;(?:[^&\\]|\\.|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/g,
      (m, str, colon, kw) => str ? (colon ? `<span class="j-k">${str}</span>${colon}` : `<span class="j-s">${str}</span>`) : kw ? `<span class="j-b">${kw}</span>` : `<span class="j-n">${m}</span>`);
  }
  let lastFocus = null;
  function openModal(title, sub, obj) {
    const m = $('#modal');
    lastFocus = document.activeElement;
    $('#modal-title').textContent = title;
    $('#modal-sub').textContent = sub;
    $('#modal-body').innerHTML = `<pre class="code json">${hlJson(obj)}</pre>`;
    m._raw = JSON.stringify(obj, null, 2);
    m.hidden = false;
    $('#modal-close').focus();
  }
  function closeModal() { $('#modal').hidden = true; if (lastFocus) lastFocus.focus(); }

  // ---------------------------------------------------------------- chrome
  function renderFlags() {
    $('#flag-list').innerHTML = Sim.FLAGS.map(f => `<div class="flag"><label class="switch"><input type="checkbox" data-flag="${f.key}" ${Sim.state.flags[f.key] ? 'checked' : ''}><span class="track"></span><span class="sr">${f.title}</span></label>` +
      `<div class="flag-text"><div class="flag-title">${esc(f.title)} <code>${f.key}</code></div><p>${esc(f.desc)}</p><p class="look"><b>Where to look:</b> ${esc(f.look)}</p></div></div>`).join('');
  }
  function updateChrome() {
    const on = Sim.FLAGS.filter(f => Sim.state.flags[f.key]);
    const badge = $('#fault-count');
    badge.textContent = on.length; badge.hidden = !on.length;
    $('#banner').hidden = !on.length;
    if (on.length) $('#banner-text').innerHTML = `${icon('warn')}<span><b>${on.length} fault${on.length > 1 ? 's' : ''} active:</b> ${on.map(f => `<code>${f.key}</code>`).join(' ')}</span>`;
    const c = Sim.state.counters;
    $('#side-stats').innerHTML = `<div><span>Spans</span><b>${fmt.num(c.spans)}</b></div><div><span>Log records</span><b>${fmt.num(c.logs)}</b></div><div><span>Metric points</span><b>${fmt.num(c.points)}</b></div><div><span>Traces in memory</span><b>${fmt.num(Sim.state.traces.size)}</b></div>`;
  }
  function toggleDrawer(open) {
    const d = $('#drawer');
    d.hidden = !open; $('#scrim').hidden = !open;
    $('#btn-faults').setAttribute('aria-expanded', String(open));
    if (open) $('#drawer-close').focus();
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('otel-theme', t); } catch (e) { /* storage unavailable */ }
  }
  function effectiveTheme() {
    return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  // ---------------------------------------------------------------- routing
  let current = null;
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '') || 'overview';
    const [path, qs] = h.split('?');
    const parts = path.split('/');
    return { view: parts[0], arg: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(qs || '') };
  }
  function route() {
    const r = parseHash();
    const name = VIEWS[r.view] ? r.view : 'overview';
    if (current && current.destroy) current.destroy();
    Charts.hideTip();
    const main = $('#view');
    main.innerHTML = '';
    window.scrollTo(0, 0);
    current = VIEWS[name](main, r) || {};
    const nav = name === 'trace' ? 'traces' : name;
    $$('.nav a').forEach(a => { const on = a.dataset.view === nav; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = `${({ overview: 'Overview', traces: 'Traces', trace: 'Trace', metrics: 'Metrics', logs: 'Logs', concepts: 'Concepts' })[name]} · OTel Observatory`;
    if (current.update) current.update(true);
    main.focus({ preventScroll: true });
  }

  function init() {
    try { const t = localStorage.getItem('otel-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
    // Presets for presenting: index.html?faults=paymentFailure,cartFailure&theme=light&load=peak
    const qs = new URLSearchParams(location.search);
    (qs.get('faults') || '').split(',').filter(k => k in Sim.state.flags).forEach(k => Sim.setFlag(k, true));
    if (qs.get('theme') === 'light' || qs.get('theme') === 'dark') document.documentElement.dataset.theme = qs.get('theme');
    if (Sim.LOAD_LEVELS[qs.get('load')]) { Sim.setLoad(qs.get('load')); $('#load').value = qs.get('load'); }
    renderFlags();
    $('#flag-list').addEventListener('change', e => {
      const i = e.target.closest('[data-flag]'); if (!i) return;
      Sim.setFlag(i.dataset.flag, i.checked); updateChrome();
    });
    $('#flag-reset').addEventListener('click', () => { Sim.FLAGS.forEach(f => Sim.setFlag(f.key, false)); renderFlags(); updateChrome(); });
    $('#btn-faults').addEventListener('click', () => toggleDrawer($('#drawer').hidden));
    $('#drawer-close').addEventListener('click', () => toggleDrawer(false));
    $('#scrim').addEventListener('click', () => toggleDrawer(false));
    $('#btn-theme').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
    $('#load').addEventListener('change', e => Sim.setLoad(e.target.value));
    $('#btn-pause').addEventListener('click', () => {
      ui.paused = !ui.paused;
      const b = $('#btn-pause');
      b.setAttribute('aria-pressed', String(ui.paused));
      b.querySelector('.lbl').textContent = ui.paused ? 'Paused' : 'Live';
      b.title = ui.paused ? 'Resume live updates' : 'Pause view updates (telemetry keeps flowing)';
      if (!ui.paused && current && current.update) current.update(true);
    });
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    $('#modal-copy').addEventListener('click', async () => {
      const b = $('#modal-copy');
      try { await navigator.clipboard.writeText($('#modal')._raw); b.textContent = 'Copied'; }
      catch (e) { const sel = getSelection(), rg = document.createRange(); rg.selectNodeContents($('#modal-body pre')); sel.removeAllRanges(); sel.addRange(rg); b.textContent = 'Selected – press Ctrl+C'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1800);
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) closeModal(); else if (!$('#drawer').hidden) toggleDrawer(false);
    });
    document.addEventListener('click', e => {
      if (e.target.closest('[data-open-faults]')) { e.preventDefault(); toggleDrawer(true); return; }
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const el = document.getElementById(tg.dataset.toggle);
        const table = el.dataset.mode !== 'table';
        el.dataset.mode = table ? 'table' : 'chart';
        tg.setAttribute('aria-pressed', String(table));
        tg.textContent = table ? 'Chart' : 'Table';
        if (current && current.update) current.update(true);
        return;
      }
      const jt = e.target.closest('[data-json-trace]');
      if (jt) { const tr = Sim.getTrace(jt.dataset.jsonTrace); if (tr) openModal('OTLP/JSON · trace', `${tr.spans.length} spans grouped by resource and instrumentation scope, as an SDK would send them to /v1/traces`, Sim.otlpTrace(tr)); return; }
      const jl = e.target.closest('[data-json-log]');
      if (jl) { const lg = Sim.logs().find(l => l.id === +jl.dataset.jsonLog); if (lg) openModal('OTLP/JSON · log record', 'As sent to /v1/logs', Sim.otlpLog(lg)); return; }
      const href = e.target.closest('[data-href]');
      if (href && !e.target.closest('a,button')) location.hash = href.dataset.href;
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const href = e.target.closest && e.target.closest('[data-href]');
      if (href && e.target === href) location.hash = href.dataset.href;
    });

    let rz = 0;
    new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (current && current.update) current.update(true); }, 120); }).observe($('#view'));
    window.addEventListener('hashchange', route);

    const bar = $('#boot-bar');
    Sim.warmup(900, p => { bar.style.width = (p * 100).toFixed(0) + '%'; }, () => {
      Sim.start();
      $('#boot').hidden = true;
      route();
      updateChrome();
      Sim.onSecond(() => { updateChrome(); if (!ui.paused && current && current.update) current.update(false); });
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
