/*
 * diagrams.js — explanatory SVG diagrams for the Concepts page. Two of them
 * are filled with identifiers from live simulated telemetry.
 */
(function (global) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function box(x, y, w, h, title, sub, cls) {
    return `<g class="d-node ${cls || ''}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>` +
      `<text class="d-title" x="${x + 12}" y="${y + (sub ? 22 : h / 2 + 5)}">${esc(title)}</text>` +
      (sub ? `<text class="d-sub" x="${x + 12}" y="${y + 40}">${esc(sub)}</text>` : '') + '</g>';
  }
  function chip(x, y, w, label, cls) {
    return `<g class="d-chip ${cls || ''}"><rect x="${x}" y="${y}" width="${w}" height="28" rx="6"/><text x="${x + w / 2}" y="${y + 18}" text-anchor="middle">${esc(label)}</text></g>`;
  }
  const arrow = (d, cls) => `<path class="d-edge ${cls || ''}" d="${d}" marker-end="url(#d-arrow)"/>`;
  function flow(path, cls, n, dur) {
    let s = '';
    for (let i = 0; i < n; i++) s += `<circle class="flow ${cls}" r="4.5"><animateMotion dur="${dur}s" begin="${(-i * dur / n).toFixed(2)}s" repeatCount="indefinite" path="${path}"/></circle>`;
    return s;
  }
  const defs = `<defs><marker id="d-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="d-arrowhead"/></marker></defs>`;

  // ---------------------------------------------------------------- collector pipeline
  function pipeline() {
    let s = `<svg class="diagram" viewBox="0 0 1000 500" role="img" aria-label="Telemetry flows from SDKs through the Collector to backends">${defs}`;
    // animated signals go first so boxes sit on top of them
    s += `<g class="flows">` +
      flow('M210,92L284,115L420,115L570,115L600,95L724,95L790,95', 'flow-1', 3, 2.8) +
      flow('M210,222L284,255L420,255L570,255L724,255L790,255', 'flow-2', 3, 2.8) +
      flow('M210,352L284,385L420,385L570,385L724,385L790,385', 'flow-3', 3, 2.8) +
      flow('M570,120L600,136L662,150L662,198L404,198L404,255L570,255L724,255L790,255', 'flow-2', 2, 3.6) + '</g>';
    // services
    s += `<text class="d-col" x="20" y="34">Instrumented services</text>`;
    [['frontend', 'TypeScript · auto + manual', 50], ['cart', 'C# · .NET 9', 180], ['checkout', 'Go', 310]].forEach(([n, l, y]) => {
      s += `<g class="d-node"><rect x="20" y="${y}" width="190" height="84" rx="8"/><text class="d-title" x="32" y="${y + 24}">${n}</text><text class="d-sub" x="32" y="${y + 42}">${l}</text>` +
        `<text class="d-mono" x="32" y="${y + 66}">API → SDK → OTLP exporter</text></g>`;
    });
    s += `<text class="d-sub" x="20" y="424">+ payment, product-catalog,</text><text class="d-sub" x="20" y="442">recommendation, shipping, fraud-detection</text>`;

    // collector
    s += `<g class="d-group"><rect x="262" y="20" width="482" height="440" rx="12"/></g>`;
    s += `<text class="d-col" x="282" y="48">OpenTelemetry Collector</text><text class="d-sub" x="282" y="64">otelcol-contrib · gateway</text>`;
    s += `<g class="d-node"><rect x="282" y="78" width="104" height="360" rx="8"/><text class="d-title" x="294" y="102">otlp</text><text class="d-sub" x="294" y="120">receiver</text><text class="d-mono" x="294" y="412">:4317 gRPC</text><text class="d-mono" x="294" y="428">:4318 HTTP</text></g>`;
    const rows = [['traces', 90, 'memory_limiter', 'batch'], ['metrics', 230, 'memory_limiter', 'batch'], ['logs', 360, 'memory_limiter', 'resource · batch']];
    rows.forEach(([name, y, proc, proc2], i) => {
      s += `<text class="d-pipe d-pipe-${i + 1}" x="420" y="${y - 8}">${name} pipeline</text>`;
      s += `<g class="d-node"><rect x="420" y="${y}" width="150" height="${proc2 ? 58 : 50}" rx="8"/><text class="d-sub" x="432" y="${y + 20}">processors</text><text class="d-mono" x="432" y="${y + 38}">${proc}</text>` +
        (proc2 ? `<text class="d-mono" x="432" y="${y + 52}">${proc2}</text>` : '') + '</g>';
      s += arrow(`M386,${y + 25}H418`);
    });
    s += chip(600, 80, 124, 'otlp → jaeger');
    s += chip(600, 122, 124, 'spanmetrics', 'd-connector');
    s += chip(600, 241, 124, 'prometheus');
    s += chip(600, 371, 124, 'opensearch');
    s += arrow('M570,110L598,95') + arrow('M570,120L598,135') + arrow('M570,255H598') + arrow('M570,385H598');
    s += `<path class="d-edge d-connector-edge" d="M662,150V198H404V246H418" marker-end="url(#d-arrow)"/>`;
    s += `<text class="d-note" x="652" y="191" text-anchor="end">spanmetrics connector → metrics pipeline</text>`;

    // backends
    s += `<text class="d-col" x="790" y="48">Backends</text>`;
    s += box(790, 66, 190, 58, 'Jaeger', 'trace storage & search');
    s += box(790, 226, 190, 58, 'Prometheus', 'metrics TSDB, exemplars');
    s += box(790, 356, 190, 58, 'OpenSearch', 'log index');
    s += box(790, 430, 190, 50, 'Grafana · one UI', null, 'd-soft');
    s += arrow('M724,94L788,95') + arrow('M724,255H788') + arrow('M724,385H788');

    // OTLP from services
    s += arrow('M210,92L280,120') + arrow('M210,222L280,255') + arrow('M210,352L280,385');
    s += `<text class="d-note" x="222" y="200">OTLP</text>`;

    return s + '</svg>';
  }

  // ---------------------------------------------------------------- context propagation
  function tp(traceId, spanId, short) {
    const t = short ? `${traceId.slice(0, 6)}…${traceId.slice(-4)}` : traceId;
    return `<tspan class="tp-v">00</tspan>-<tspan class="tp-t">${t}</tspan>-<tspan class="tp-p">${spanId}</tspan>-<tspan class="tp-f">01</tspan>`;
  }
  function propagation(tr) {
    if (!tr) return '<p class="muted">Waiting for a checkout trace…</p>';
    const by = (pred) => tr.spans.find(pred);
    const feClient = by(s => s.service === 'frontend' && s.kind === 'CLIENT' && s.peer === 'checkout');
    const getCart = by(s => s.service === 'checkout' && s.kind === 'CLIENT' && s.peer === 'cart');
    const charge = by(s => s.service === 'checkout' && s.kind === 'CLIENT' && s.peer === 'payment');
    const prod = by(s => s.kind === 'PRODUCER');
    const lanes = ['load-generator', 'frontend', 'checkout', 'cart', 'payment', 'kafka', 'fraud-detection'];
    const X = i => 80 + i * 140;
    const msgs = [{ a: 0, b: 1, op: 'POST /api/checkout', note: 'no traceparent → frontend starts a new trace' }];
    if (feClient) msgs.push({ a: 1, b: 2, op: 'PlaceOrder · gRPC metadata', span: feClient });
    if (getCart) msgs.push({ a: 2, b: 3, op: 'GetCart', span: getCart });
    if (charge) msgs.push({ a: 2, b: 4, op: 'Charge', span: charge, err: charge.status.code === 'ERROR' });
    if (prod) {
      msgs.push({ a: 2, b: 5, op: 'send orders · Kafka record header', span: prod });
      msgs.push({ a: 5, b: 6, op: 'process orders (consumer extracts header)', span: prod });
    }
    msgs.push({ a: 1, b: 0, op: `${tr.root.attributes['http.response.status_code']} response`, reply: true, err: tr.error });
    const H = 96 + msgs.length * 64;
    let s = `<svg class="diagram" viewBox="0 0 1000 ${H}" role="img" aria-label="W3C trace context propagation across services">${defs}`;
    lanes.forEach((l, i) => {
      const sv = global.Sim && global.Sim.svc(l);
      s += `<line class="d-life" x1="${X(i)}" x2="${X(i)}" y1="54" y2="${H - 8}"/>`;
      s += `<g class="d-node ${sv ? '' : 'd-soft'}"><rect x="${X(i) - 66}" y="16" width="132" height="38" rx="8"/>` +
        (sv ? `<circle cx="${X(i) - 52}" cy="35" r="4.5" style="fill:var(--s${sv.slot})"/>` : '') +
        `<text class="d-title d-small" x="${X(i) + (sv ? 6 : 0)}" y="39.5" text-anchor="middle">${l}</text></g>`;
    });
    msgs.forEach((m, k) => {
      const y = 100 + k * 64, x1 = X(m.a), x2 = X(m.b), dir = x2 > x1 ? 1 : -1;
      const mid = (x1 + x2) / 2;
      s += `<path class="d-edge ${m.reply ? 'd-reply' : ''} ${m.err ? 'd-err' : ''}" d="M${x1 + dir * 4},${y}H${x2 - dir * 6}" marker-end="url(#d-arrow)"/>`;
      s += `<text class="d-msg" x="${mid}" y="${y - 9}" text-anchor="middle">${esc(m.op)}${m.err ? ' ✕' : ''}</text>`;
      if (m.span) s += `<text class="d-tp" x="${mid}" y="${y + 18}" text-anchor="middle">traceparent: ${tp(tr.traceId, m.span.spanId, true)}</text>`;
      else if (m.note) s += `<text class="d-note" x="${mid}" y="${y + 18}" text-anchor="middle">${esc(m.note)}</text>`;
    });
    return s + '</svg>';
  }

  // ---------------------------------------------------------------- signal correlation
  function correlation(ex) {
    let s = `<svg class="diagram" viewBox="0 0 1000 330" role="img" aria-label="Metrics, traces and logs share trace context and resource attributes">${defs}`;
    const card = (x, title, lines, href, cls) => {
      let c = `<a href="${href || '#/concepts'}"><g class="d-node d-card ${cls}"><rect x="${x}" y="24" width="280" height="168" rx="10"/>` +
        `<rect class="d-band" x="${x}" y="24" width="6" height="168" rx="3"/>` +
        `<text class="d-title" x="${x + 22}" y="52">${esc(title)}</text>`;
      lines.forEach((l, i) => { c += `<text class="${l[0]}" x="${x + 22}" y="${80 + i * 22}">${esc(l[1])}</text>`; });
      return c + '</g></a>';
    };
    const tid = ex && ex.trace ? ex.trace.traceId : '4bf92f3577b34da6a3ce929d0e0e4736';
    const svc = ex && ex.service ? ex.service : 'checkout';
    s += card(20, 'Metric · exemplar', [
      ['d-mono', 'traces.span.metrics.duration'],
      ['d-sub', `service.name = ${svc}`],
      ['d-sub', `slowest in window: ${ex ? global.Charts.fmt.ms(ex.v) : '–'}`],
      ['d-mono', `exemplar trace_id ${tid.slice(0, 12)}…`],
    ], ex && ex.trace ? `#/metrics?service=${svc}` : null, 'd-card-2');
    s += card(360, 'Trace', [
      ['d-mono', trunc(ex && ex.trace ? ex.trace.name : 'POST /api/checkout', 30)],
      ['d-sub', ex && ex.trace ? `${ex.trace.spans.length} spans · ${ex.trace.services.length} services` : ''],
      ['d-sub', ex && ex.trace ? `duration ${global.Charts.fmt.ms(ex.trace.duration)}` : ''],
      ['d-mono', `trace_id ${tid.slice(0, 16)}…`],
    ], ex && ex.trace ? `#/trace/${tid}` : null, 'd-card-1');
    s += card(700, 'Log record', [
      ['d-mono', ex && ex.log ? `${ex.log.sev} · ${ex.log.service}` : 'INFO · checkout'],
      ['d-sub', trunc(ex && ex.log ? ex.log.body : 'order placed', 36)],
      ['d-mono', `trace_id ${tid.slice(0, 12)}…`],
      ['d-mono', `span_id  ${ex && ex.log ? ex.log.spanId : '00f067aa0ba902b7'}`],
    ], ex && ex.trace ? `#/logs?trace=${tid}` : null, 'd-card-3');
    s += arrow('M300,108H356') + arrow('M700,108H644');
    s += `<text class="d-note" x="328" y="98" text-anchor="middle">exemplar</text><text class="d-note" x="672" y="98" text-anchor="middle">trace_id</text>`;
    s += `<g class="d-node d-soft"><rect x="20" y="240" width="960" height="64" rx="10"/>` +
      `<text class="d-title" x="40" y="266">Resource (shared by every signal from a process)</text>` +
      `<text class="d-mono" x="40" y="288">service.name=${esc(svc)} · service.version=2.1.3 · k8s.pod.name=${esc(global.Sim ? global.Sim.state.pods[svc] : '')} · deployment.environment.name=techorama-2026</text></g>`;
    [160, 500, 840].forEach(x => { s += `<line class="d-life" x1="${x}" x2="${x}" y1="192" y2="240"/>`; });
    return s + '</svg>';
  }

  const COLLECTOR_YAML = `receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 80
  batch: {}
  resource:
    attributes:
      - key: deployment.environment.name
        value: techorama-2026
        action: upsert

connectors:
  spanmetrics:
    histogram:
      explicit:
        buckets: [1ms, 2ms, 3ms, 5ms, 7.5ms, 10ms, 15ms, 20ms, 30ms, 50ms, 75ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s]
    exemplars:
      enabled: true

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls: { insecure: true }
  prometheus:
    endpoint: 0.0.0.0:9464
    enable_open_metrics: true   # needed to expose exemplars
  opensearch:
    http: { endpoint: http://opensearch:9200 }
    logs_index: otel

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/jaeger, spanmetrics]
    metrics:
      receivers: [otlp, spanmetrics]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [opensearch]`;

  const SDK_SNIPPET = `// Program.cs — the cart service (.NET)
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("cart"))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddGrpcClientInstrumentation()
        .AddRedisInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter())
    .WithLogging(l => l.AddOtlpExporter());

// OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`;

  global.Diagrams = { pipeline, propagation, correlation, COLLECTOR_YAML, SDK_SNIPPET };
})(window);
