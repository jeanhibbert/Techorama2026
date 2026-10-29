/*
 * charts.js — tiny dependency-free SVG charts: line, stacked columns,
 * heatmap, horizontal bars, scatter and sparkline. Every chart is re-rendered
 * from data on each update; hover state survives re-renders.
 */
(function (global) {
  'use strict';

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- formatting
  const fmt = {
    ms(v, tick) {
      if (v == null || isNaN(v)) return '–';
      if (tick) return v >= 1000 ? `${+(v / 1000).toFixed(1)}s` : `${+v.toFixed(1)}ms`;
      if (v >= 10000) return `${(v / 1000).toFixed(1)} s`;
      if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
      if (v >= 100 || (v >= 10 && Number.isInteger(v))) return `${Math.round(v)} ms`;
      if (v >= 10) return `${v.toFixed(1)} ms`;
      return `${v.toFixed(2)} ms`;
    },
    rate(v, tick) {
      if (v == null || isNaN(v)) return '–';
      if (tick) return fmt.num(v);
      return (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + '/s';
    },
    pct(v, tick) {
      if (v == null || isNaN(v)) return '–';
      if (tick) return `${+v.toFixed(1)}%`;
      if (v === 0) return '0%';
      if (v < 0.1) return '<0.1%';
      return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
    },
    num(v) {
      if (v == null || isNaN(v)) return '–';
      const a = Math.abs(v);
      if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
      if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
      return a < 10 && v % 1 ? `${+v.toFixed(1)}` : String(Math.round(v));
    },
    mib(v, tick) { return v == null ? '–' : tick ? `${Math.round(v)}` : `${Math.round(v)} MiB`; },
    cpu(v, tick) { return v == null ? '–' : tick ? `${Math.round(v)}%` : `${v.toFixed(1)}%`; },
    count(v, tick) { return v == null ? '–' : tick ? fmt.num(v) : Math.round(v).toLocaleString(); },
    time(ms) { const d = new Date(ms); return d.toTimeString().slice(0, 8); },
    timeMs(ms) { const d = new Date(ms); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); },
  };

  function niceStep(raw) {
    const e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  function niceTicks(max, n) {
    if (!(max > 0)) max = 1;
    const step = niceStep(max / (n || 4));
    const top = Math.ceil(max / step - 1e-9) * step;
    const out = [];
    for (let v = 0; v <= top + step / 2; v += step) out.push(+v.toPrecision(10));
    return out;
  }

  // ---------------------------------------------------------------- tooltip
  function tipEl() { return document.getElementById('tooltip'); }
  function showTip(html, cx, cy) {
    const t = tipEl(); if (!t) return;
    t.innerHTML = html; t.hidden = false;
    const r = t.getBoundingClientRect(), pad = 14;
    let x = cx + pad, y = cy + pad;
    if (x + r.width > innerWidth - 8) x = cx - r.width - pad;
    if (y + r.height > innerHeight - 8) y = cy - r.height - pad;
    t.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }
  function hideTip() { const t = tipEl(); if (t) t.hidden = true; }
  const row = (color, name, val, shape) =>
    `<div class="tt-row"><span class="tt-k"><i class="${shape || 'sw'}" style="background:${color}"></i>${esc(name)}</span><b>${esc(val)}</b></div>`;

  // ---------------------------------------------------------------- shared frame
  function svgOpen(W, H, label) {
    return `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || 'chart')}">`;
  }
  function yAxis(ticks, Y, m, W, f) {
    let s = '';
    ticks.forEach((v, i) => {
      const y = Y(v).toFixed(1);
      s += `<line class="${i === 0 ? 'axis' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${+y + 4}" text-anchor="end">${esc(f(v))}</text>`;
    });
    return s;
  }
  function xAxis(t0, t1, X, H, m, pw) {
    const n = Math.max(2, Math.min(6, Math.floor(pw / 110)));
    let s = '';
    for (let i = 0; i <= n; i++) {
      const t = t0 + (t1 - t0) * i / n;
      const anchor = i === 0 ? 'start' : i === n ? 'end' : 'middle';
      s += `<text class="tick" x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${fmt.time(t)}</text>`;
    }
    return s;
  }
  function svgPoint(el, cx, cy) {
    const svg = el.querySelector('svg'); if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: (cx - r.left) * (svg.width.baseVal.value / r.width), y: (cy - r.top) * (svg.height.baseVal.value / r.height) };
  }
  function wire(el) {
    if (el._wired) return;
    el._wired = true;
    el.addEventListener('mousemove', e => { el._hv = { x: e.clientX, y: e.clientY }; hover(el); });
    el.addEventListener('mouseleave', () => { el._hv = null; clear(el); hideTip(); });
    el.addEventListener('click', () => { const c = el._c; if (c && c.active && c.onPick) c.onPick(c.active); });
  }
  function clear(el) { const g = el.querySelector('.hov'); if (g) g.innerHTML = ''; el.style.cursor = ''; if (el._c) el._c.active = null; }
  function hover(el) {
    const c = el._c; if (!c || !el._hv) return;
    const p = svgPoint(el, el._hv.x, el._hv.y); if (!p) return;
    const g = el.querySelector('.hov');
    const res = c.hover(p, g);
    if (res) { el.style.cursor = c.active && c.onPick ? 'pointer' : ''; showTip(res, el._hv.x, el._hv.y); }
    else { clear(el); hideTip(); }
  }
  function finish(el, html, ctx) {
    el.innerHTML = html;
    el._c = ctx;
    if (el._hv) hover(el);
  }
  function empty(el, msg) { el.innerHTML = `<div class="chart-empty">${esc(msg || 'Waiting for data…')}</div>`; el._c = null; }

  // ---------------------------------------------------------------- line
  function line(el, cfg) {
    wire(el);
    const T = cfg.times || [], n = T.length;
    if (n < 2) return empty(el);
    const W = Math.max(260, Math.floor(el.clientWidth || 600)), H = cfg.height || 200;
    const series = cfg.series;
    const direct = series.length >= 2 && series.length <= 4 && cfg.directLabels !== false;
    const m = { l: cfg.left || 52, r: direct ? 48 : 16, t: 12, b: 26 };
    let max = 0;
    for (const s of series) for (const v of s.values) if (v != null && v > max) max = v;
    if (cfg.refLine) max = Math.max(max, cfg.refLine.value * 1.08);
    let exMax = 0; (cfg.exemplars || []).forEach(e => { if (e.v > exMax) exMax = e.v; });
    if (exMax) max = Math.max(max, Math.min(exMax, (max || 1) * 2.2));
    if (cfg.minMax) max = Math.max(max, cfg.minMax);
    const ticks = niceTicks(max, cfg.ticks || 4), yMax = ticks[ticks.length - 1];
    const t0 = T[0], t1 = T[n - 1];
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = t => m.l + (t - t0) / Math.max(1, t1 - t0) * pw;
    const Y = v => m.t + ph - Math.min(v, yMax) / yMax * ph;
    const f = cfg.format || fmt.num;

    let s = svgOpen(W, H, cfg.label) + yAxis(ticks, Y, m, W, v => f(v, true)) + xAxis(t0, t1, X, H, m, pw);
    if (cfg.refLine) {
      const y = Y(cfg.refLine.value).toFixed(1);
      s += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="ref-label" x="${W - m.r - 4}" y="${y - 6}" text-anchor="end">${esc(cfg.refLine.label)}</text>`;
    }
    const ends = [];
    series.forEach((sr, si) => {
      let d = '', pen = false, last = -1, first = -1;
      sr.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        if (first < 0) first = i;
        d += (pen ? 'L' : 'M') + X(T[i]).toFixed(1) + ',' + Y(v).toFixed(1);
        pen = true; last = i;
      });
      if (!d) return;
      if (cfg.area && si === 0 && sr.values.every(v => v != null)) {
        s += `<path class="area" d="${d}L${X(T[last]).toFixed(1)},${Y(0)}L${X(T[first]).toFixed(1)},${Y(0)}Z" style="fill:${sr.color}"/>`;
      }
      s += `<path class="ln" d="${d}" style="stroke:${sr.color}"/>`;
      const ex = X(T[last]), ey = Y(sr.values[last]);
      s += `<circle class="end-dot" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" style="fill:${sr.color}"/>`;
      ends.push({ y: ey, name: sr.short || sr.name, x: ex });
    });
    if (direct && ends.length) {
      // Only label line ends that don't collide; the legend carries the rest.
      ends.sort((a, b) => a.y - b.y);
      ends.forEach((e, i) => {
        const clash = (i > 0 && e.y - ends[i - 1].y < 13) || (i < ends.length - 1 && ends[i + 1].y - e.y < 13);
        if (!clash) s += `<text class="end-label" x="${(e.x + 8).toFixed(1)}" y="${(e.y + 4).toFixed(1)}">${esc(e.name)}</text>`;
      });
    }
    const exs = [];
    (cfg.exemplars || []).forEach(e => {
      const x = X(e.t); if (x < m.l || x > W - m.r) return;
      const over = e.v > yMax, y = over ? m.t + 5 : Y(e.v);
      exs.push({ x, y, e });
      s += `<path class="ex${e.err ? ' ex-err' : ''}" d="M${x.toFixed(1)},${(y - 5).toFixed(1)}l5,5l-5,5l-5,-5z"/>`;
    });
    s += `<g class="hov"></g></svg>`;

    finish(el, s, {
      onPick: cfg.onExemplar ? a => a.e && cfg.onExemplar(a.e) : null,
      hover(p, g) {
        this.active = null;
        if (p.x < m.l - 6 || p.x > W - m.r + 6) return null;
        let best = null, bd = 10;
        for (const x of exs) { const d = Math.hypot(x.x - p.x, x.y - p.y); if (d < bd) { bd = d; best = x; } }
        if (best) {
          this.active = best;
          g.innerHTML = `<circle class="ex-ring" cx="${best.x}" cy="${best.y}" r="9"/>`;
          const e = best.e;
          return `<div class="tt-h">Exemplar · ${fmt.timeMs(e.t)}</div>${row('transparent', 'duration', fmt.ms(e.v), 'dia')}` +
            `<div class="tt-row"><span class="tt-k">trace_id</span><code>${e.traceId.slice(0, 16)}…</code></div><div class="tt-foot">${e.err ? 'Error span · ' : ''}Click to open the trace</div>`;
        }
        let i = 0, bdx = Infinity;
        for (let k = 0; k < n; k++) { const d = Math.abs(X(T[k]) - p.x); if (d < bdx) { bdx = d; i = k; } }
        const x = X(T[i]).toFixed(1);
        let h = `<line class="xhair" x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}"/>`;
        let tt = `<div class="tt-h">${fmt.time(T[i])}</div>`;
        series.forEach(sr => {
          const v = sr.values[i];
          if (v != null) h += `<circle class="hov-dot" cx="${x}" cy="${Y(v).toFixed(1)}" r="4.5" style="fill:${sr.color}"/>`;
          tt += row(sr.color, sr.name, f(v));
        });
        g.innerHTML = h;
        return tt;
      },
    });
  }

  // ---------------------------------------------------------------- stacked columns
  function stack(el, cfg) {
    wire(el);
    const T = cfg.times || [], n = T.length;
    if (n < 2) return empty(el);
    const W = Math.max(260, Math.floor(el.clientWidth || 600)), H = cfg.height || 160;
    const m = { l: 44, r: 12, t: 10, b: 26 };
    const totals = T.map((_, i) => cfg.series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const ticks = niceTicks(Math.max(1, ...totals), 3), yMax = ticks[ticks.length - 1];
    const pw = W - m.l - m.r, ph = H - m.t - m.b, slotW = pw / n;
    const cw = Math.max(2, Math.min(24, slotW * 0.72));
    const Y = v => m.t + ph - v / yMax * ph;
    const cx = i => m.l + slotW * (i + 0.5);
    const f = cfg.format || fmt.count;
    const X = t => m.l + (t - T[0]) / (T[n - 1] - T[0]) * (pw - slotW) + slotW / 2;
    let s = svgOpen(W, H, cfg.label) + yAxis(ticks, Y, m, W, v => f(v, true)) + xAxis(T[0], T[n - 1], X, H, m, pw);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const vis = cfg.series.filter(sr => sr.values[i] > 0);
      vis.forEach((sr, k) => {
        const v = sr.values[i];
        const y1 = Y(acc), y0 = Y(acc + v);
        const gap = acc > 0 ? 2 : 0;
        const h = Math.max(0.5, y1 - y0 - gap);
        const x = cx(i) - cw / 2;
        if (k === vis.length - 1) {
          const r = Math.min(4 - (cw < 8 ? 2 : 0), h, cw / 2);
          s += `<path d="M${x},${y0 + h}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + cw - r}Q${x + cw},${y0} ${x + cw},${y0 + r}V${y0 + h}Z" style="fill:${sr.color}"/>`;
        } else {
          s += `<rect x="${x}" y="${y0}" width="${cw}" height="${h}" style="fill:${sr.color}"/>`;
        }
        acc += v;
      });
    }
    s += `<g class="hov"></g></svg>`;
    finish(el, s, {
      onPick: null,
      hover(p, g) {
        if (p.x < m.l || p.x > W - m.r) return null;
        const i = Math.max(0, Math.min(n - 1, Math.floor((p.x - m.l) / slotW)));
        g.innerHTML = `<rect class="hov-band" x="${m.l + slotW * i}" y="${m.t}" width="${slotW}" height="${ph}"/>`;
        let tt = `<div class="tt-h">${fmt.time(T[i] - (cfg.step || 0) * 1000)}–${fmt.time(T[i])}</div>`;
        cfg.series.slice().reverse().forEach(sr => { tt += row(sr.color, sr.name, f(sr.values[i])); });
        return tt + `<div class="tt-row tt-total"><span class="tt-k">Total</span><b>${f(totals[i])}</b></div>`;
      },
    });
  }

  // ---------------------------------------------------------------- heatmap
  function heatmap(el, cfg) {
    wire(el);
    const T = cfg.times || [], n = T.length;
    if (n < 2) return empty(el);
    const rows = cfg.rowLabels.length;
    const W = Math.max(260, Math.floor(el.clientWidth || 600)), H = cfg.height || 220;
    const m = { l: 58, r: 12, t: 8, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, cw = pw / n, ch = ph / rows;
    let max = 0; cfg.matrix.forEach(col => col.forEach(v => { if (v > max) max = v; }));
    const steps = 7, lmax = Math.log1p(max || 1);
    const level = v => Math.min(steps, 1 + Math.floor(Math.log1p(v) / lmax * (steps - 0.001)));
    let s = svgOpen(W, H, cfg.label);
    for (let r = 0; r < rows; r++) {
      if (r % 2 === 0 || rows <= 8) {
        const y = m.t + ph - (r + 0.5) * ch;
        s += `<text class="tick" x="${m.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(cfg.rowLabels[r])}</text>`;
      }
    }
    const gap = cw > 6 ? 1 : 0.5;
    for (let i = 0; i < n; i++) {
      for (let r = 0; r < rows; r++) {
        const v = cfg.matrix[i][r]; if (!v) continue;
        const x = m.l + i * cw, y = m.t + ph - (r + 1) * ch;
        s += `<rect x="${(x + gap).toFixed(1)}" y="${(y + gap).toFixed(1)}" width="${Math.max(0.5, cw - gap * 2).toFixed(1)}" height="${(ch - gap * 2).toFixed(1)}" rx="1.5" style="fill:var(--seq-${level(v)})"/>`;
      }
    }
    s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
    const X = t => m.l + (t - T[0]) / (T[n - 1] - T[0]) * (pw - cw) + cw / 2;
    s += xAxis(T[0], T[n - 1], X, H, m, pw);
    s += `<g class="hov"></g></svg>`;
    finish(el, s, {
      onPick: null,
      hover(p, g) {
        if (p.x < m.l || p.x > W - m.r || p.y < m.t || p.y > m.t + ph) return null;
        const i = Math.min(n - 1, Math.floor((p.x - m.l) / cw));
        const r = Math.min(rows - 1, Math.floor((m.t + ph - p.y) / ch));
        const x = m.l + i * cw, y = m.t + ph - (r + 1) * ch;
        g.innerHTML = `<rect class="hov-cell" x="${x}" y="${y}" width="${cw}" height="${ch}"/>`;
        const v = cfg.matrix[i][r] || 0;
        return `<div class="tt-h">${fmt.time(T[i] - (cfg.step || 0) * 1000)}–${fmt.time(T[i])}</div>` +
          `<div class="tt-row"><span class="tt-k">Latency bucket</span><b>${esc(cfg.rowNames[r])}</b></div>` +
          `<div class="tt-row"><span class="tt-k">Requests</span><b>${v.toLocaleString()}</b></div>`;
      },
    });
  }

  // ---------------------------------------------------------------- horizontal bars
  function hbar(el, cfg) {
    wire(el);
    const items = cfg.items;
    if (!items.length) return empty(el);
    const W = Math.max(260, Math.floor(el.clientWidth || 400));
    const rowH = 30, m = { l: 132, r: 72, t: 4, b: 4 };
    const H = m.t + m.b + rowH * items.length;
    const max = Math.max(...items.map(i => i.value || 0), 1e-9);
    const pw = W - m.l - m.r, bh = 16;
    const f = cfg.format || fmt.num;
    let s = svgOpen(W, H, cfg.label);
    s += `<line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>`;
    items.forEach((it, k) => {
      const y = m.t + k * rowH + (rowH - bh) / 2;
      const w = Math.max(it.value ? 2 : 0, (it.value || 0) / max * pw);
      const r = Math.min(4, w / 2, bh / 2);
      const dim = cfg.selected && cfg.selected !== it.id;
      s += `<text class="bar-label${dim ? ' dim' : ''}" x="${m.l - 10}" y="${y + bh / 2 + 4}" text-anchor="end">${esc(it.label)}</text>`;
      if (w > 0) s += `<path d="M${m.l},${y}H${m.l + w - r}Q${m.l + w},${y} ${m.l + w},${y + r}V${y + bh - r}Q${m.l + w},${y + bh} ${m.l + w - r},${y + bh}H${m.l}Z" style="fill:${dim ? 'var(--bar-dim)' : (it.color || 'var(--s1)')}"/>`;
      s += `<text class="bar-value" x="${m.l + w + 8}" y="${y + bh / 2 + 4}">${esc(f(it.value))}</text>`;
    });
    s += `<g class="hov"></g></svg>`;
    finish(el, s, {
      onPick: cfg.onClick ? a => cfg.onClick(a) : null,
      hover(p, g) {
        const k = Math.floor((p.y - m.t) / rowH);
        if (k < 0 || k >= items.length) { this.active = null; return null; }
        const it = items[k];
        this.active = it;
        g.innerHTML = `<rect class="hov-band" x="0" y="${m.t + k * rowH}" width="${W}" height="${rowH}"/>`;
        let tt = `<div class="tt-h">${esc(it.label)}</div>${row(it.color || 'var(--s1)', cfg.valueName || 'value', f(it.value))}`;
        (it.extra || []).forEach(([k2, v]) => { tt += `<div class="tt-row"><span class="tt-k">${esc(k2)}</span><b>${esc(v)}</b></div>`; });
        if (cfg.onClick) tt += `<div class="tt-foot">Click to select</div>`;
        return tt;
      },
    });
  }

  // ---------------------------------------------------------------- scatter (log y)
  function scatter(el, cfg) {
    wire(el);
    const pts = cfg.points;
    const W = Math.max(260, Math.floor(el.clientWidth || 600)), H = cfg.height || 220;
    if (!pts.length) return empty(el, 'No traces match the current filters.');
    const m = { l: 52, r: 16, t: 12, b: 26 };
    let lo = Infinity, hi = 0;
    pts.forEach(p => { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
    const e0 = Math.floor(Math.log10(Math.max(0.1, lo))), e1 = Math.max(e0 + 1, Math.ceil(Math.log10(Math.max(hi, 1))));
    const t1 = cfg.t1 || Math.max(...pts.map(p => p.t)), t0 = cfg.t0 || Math.min(...pts.map(p => p.t));
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = t => m.l + (t - t0) / Math.max(1, t1 - t0) * pw;
    const Y = v => m.t + ph - (Math.log10(Math.max(v, Math.pow(10, e0))) - e0) / (e1 - e0) * ph;
    let s = svgOpen(W, H, cfg.label);
    for (let e = e0; e <= e1; e++) {
      const v = Math.pow(10, e), y = Y(v).toFixed(1);
      s += `<line class="${e === e0 ? 'axis' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${+y + 4}" text-anchor="end">${fmt.ms(v, true)}</text>`;
    }
    s += xAxis(t0, t1, X, H, m, pw);
    const P = pts.map(p => ({ x: X(p.t), y: Y(p.v), p }));
    let ok = '', bad = '';
    for (const q of P) {
      if (q.p.err) bad += `<path class="sc-err" d="M${q.x.toFixed(1)},${(q.y - 5).toFixed(1)}l5,5l-5,5l-5,-5z"/>`;
      else ok += `<circle class="sc-ok" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="4"/>`;
    }
    s += `<g>${ok}</g><g>${bad}</g><g class="hov"></g></svg>`;
    finish(el, s, {
      onPick: cfg.onClick ? a => cfg.onClick(a.p) : null,
      hover(p, g) {
        let best = null, bd = 12;
        for (const q of P) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
        this.active = best;
        if (!best) { g.innerHTML = ''; return null; }
        g.innerHTML = `<circle class="ex-ring" cx="${best.x}" cy="${best.y}" r="8"/>`;
        return cfg.tip(best.p);
      },
    });
  }

  // ---------------------------------------------------------------- sparkline
  function spark(values, opts) {
    const W = (opts && opts.w) || 120, H = (opts && opts.h) || 32;
    const v = values.map(x => x == null ? 0 : x);
    if (v.length < 2) return '';
    const max = Math.max(...v, 1e-9), min = Math.min(...v, 0);
    const X = i => 2 + i / (v.length - 1) * (W - 8), Y = x => H - 4 - (x - min) / (max - min || 1) * (H - 8);
    const d = v.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(x).toFixed(1)).join('');
    const last = v.length - 1;
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/><circle cx="${X(last).toFixed(1)}" cy="${Y(v[last]).toFixed(1)}" r="3.5"/></svg>`;
  }

  // ---------------------------------------------------------------- table view
  function table(kind, cfg) {
    if (kind === 'hbar') {
      return `<table class="data"><thead><tr><th>${esc(cfg.labelName || 'Item')}</th><th class="num">${esc(cfg.valueName || 'Value')}</th></tr></thead><tbody>` +
        cfg.items.map(i => `<tr><td>${esc(i.label)}</td><td class="num">${esc((cfg.format || fmt.num)(i.value))}</td></tr>`).join('') + '</tbody></table>';
    }
    if (kind === 'heatmap') {
      const tot = cfg.rowNames.map((_, r) => cfg.matrix.reduce((a, col) => a + (col[r] || 0), 0));
      return `<table class="data"><thead><tr><th>Latency bucket</th><th class="num">Requests in window</th></tr></thead><tbody>` +
        cfg.rowNames.map((nm, r) => `<tr><td>${esc(nm)}</td><td class="num">${tot[r].toLocaleString()}</td></tr>`).join('') + '</tbody></table>';
    }
    const f = cfg.format || fmt.num;
    const rows = [];
    for (let i = cfg.times.length - 1; i >= Math.max(0, cfg.times.length - 20); i--) {
      rows.push(`<tr><td>${fmt.time(cfg.times[i])}</td>${cfg.series.map(s => `<td class="num">${esc(f(s.values[i]))}</td>`).join('')}</tr>`);
    }
    return `<table class="data"><thead><tr><th>Time</th>${cfg.series.map(s => `<th class="num">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  global.Charts = { line, stack, heatmap, hbar, scatter, spark, table, fmt, esc, showTip, hideTip };
})(window);
