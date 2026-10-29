/*
 * telemetry.js — an in-browser OpenTelemetry simulator.
 *
 * Models a slimmed-down OpenTelemetry Astronomy Shop: eight instrumented
 * services plus Postgres, Valkey and Kafka. Every simulated request becomes a
 * trace (spans with semantic-convention attributes), emits correlated log
 * records, and feeds span-derived RED metrics the way the Collector's
 * spanmetrics connector would. Runtime gauges (CPU, memory) are sampled per
 * second. Feature flags inject the same failure scenarios as the real demo.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- catalog
  const SERVICES = [
    { name: 'frontend', lang: 'nodejs', label: 'TypeScript · Next.js', version: '2.1.3', slot: 1, scope: '@opentelemetry/instrumentation-http' },
    { name: 'checkout', lang: 'go', label: 'Go', version: '2.1.3', slot: 2, scope: 'go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc' },
    { name: 'cart', lang: 'dotnet', label: 'C# · .NET 9', version: '2.1.3', slot: 3, scope: 'OpenTelemetry.Instrumentation.AspNetCore' },
    { name: 'payment', lang: 'nodejs', label: 'JavaScript · Node.js', version: '2.1.3', slot: 4, scope: '@opentelemetry/instrumentation-grpc' },
    { name: 'product-catalog', lang: 'go', label: 'Go', version: '2.1.3', slot: 5, scope: 'go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc' },
    { name: 'recommendation', lang: 'python', label: 'Python', version: '2.1.3', slot: 6, scope: 'opentelemetry.instrumentation.grpc' },
    { name: 'shipping', lang: 'rust', label: 'Rust', version: '2.1.3', slot: 7, scope: 'opentelemetry-otlp' },
    { name: 'fraud-detection', lang: 'java', label: 'Kotlin · JVM', version: '2.1.3', slot: 8, scope: 'io.opentelemetry.kafka-clients-2.6' },
  ];
  const SVC = Object.fromEntries(SERVICES.map(s => [s.name, s]));
  const INFRA = [
    { name: 'postgres', label: 'PostgreSQL', kind: 'database' },
    { name: 'valkey', label: 'Valkey', kind: 'cache' },
    { name: 'kafka', label: 'Kafka', kind: 'queue' },
  ];
  const SDK_VERSION = { nodejs: '2.2.0', go: '1.38.0', dotnet: '1.13.1', python: '1.37.0', rust: '0.31.0', java: '1.55.0' };
  const RPC = {
    checkout: 'oteldemo.CheckoutService', cart: 'oteldemo.CartService', payment: 'oteldemo.PaymentService',
    'product-catalog': 'oteldemo.ProductCatalogService', recommendation: 'oteldemo.RecommendationService',
    shipping: 'oteldemo.ShippingService',
  };
  const PORTS = { checkout: 5050, cart: 7070, payment: 50051, 'product-catalog': 3550, recommendation: 9001, shipping: 50050 };
  const PRODUCTS = [
    ['OLJCESPC7Z', 'National Park Foundation Explorascope', 101.96],
    ['66VCHSJNUP', 'Starsense Explorer Refractor Telescope', 349.95],
    ['1YMWWN1N4O', 'Eclipsmart Travel Refractor Telescope', 129.95],
    ['L9ECAV7KIM', 'Lens Cleaning Kit', 21.95],
    ['2ZYFJ3GM2N', 'Roof Binoculars', 209.95],
    ['0PUK6V6EV0', 'Solar System Color Imager', 175.0],
    ['LS4PSXUNUM', 'Red Flashlight', 57.8],
    ['9SIQT8TOJO', 'Optical Tube Assembly', 3599.0],
    ['6E92ZMYYFZ', 'Solar Filter', 69.95],
    ['HQTGWGPNH4', 'The Comet Book', 0.99],
  ];
  const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.4 Safari/605.1.15',
    'python-requests/2.32.3 (locust load-generator)',
  ];
  // Explicit histogram bucket bounds in ms (an implied +Inf bucket follows).
  const BOUNDS = [1, 2, 3, 5, 7.5, 10, 15, 20, 30, 50, 75, 100, 250, 500, 1000, 2500, 5000];
  const NB = BOUNDS.length + 1;
  const SEV = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 };

  const FLAGS = [
    { key: 'paymentFailure', service: 'payment', title: 'Payment failures',
      desc: 'payment Charge fails for about half of all orders with "Invalid token".',
      look: 'Red edges checkout → payment, ERROR logs from payment, error-rate spike on checkout and frontend.' },
    { key: 'productCatalogFailure', service: 'product-catalog', title: 'Product catalog failure',
      desc: 'GetProduct fails for product OLJCESPC7Z (the Explorascope).',
      look: 'Filter traces on product-catalog + errors and inspect app.product.id on the failing span.' },
    { key: 'cartFailure', service: 'cart', title: 'Cart storage outage',
      desc: 'cart loses its Valkey connection for ~35% of operations.',
      look: 'Valkey CLIENT spans carry exception events; cart ERROR logs; the cart → valkey edge turns red.' },
    { key: 'recommendationCacheFailure', service: 'recommendation', title: 'Recommendation memory leak',
      desc: 'A leaky cache grows memory and slows ListRecommendations until the pod is OOMKilled.',
      look: 'Memory and p95 on recommendation, slow exemplars, then an OOMKilled log and a new k8s.pod.name.' },
    { key: 'kafkaQueueProblems', service: 'fraud-detection', title: 'Kafka consumer lag',
      desc: 'fraud-detection falls seconds behind on the orders topic.',
      look: 'A wide gap between the PRODUCER and CONSUMER spans in checkout traces; WARN lag logs.' },
    { key: 'loadGeneratorFloodHomepage', service: 'frontend', title: 'Homepage flood',
      desc: 'The load generator floods GET / with ~20 extra requests per second.',
      look: 'Request rate on frontend, product-catalog and recommendation; CPU climbs.' },
  ];
  const LOAD_LEVELS = { low: 5, normal: 12, peak: 28 };

  // ---------------------------------------------------------------- random
  const rnd = Math.random;
  function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function logn(median, sigma) { return median * Math.exp(sigma * gauss()); }
  function hex(n) { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[(rnd() * 16) | 0]; return s; }
  function uuid() { return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[(rnd() * 4) | 0]}${hex(3)}-${hex(12)}`; }
  function pick(a) { return a[(rnd() * a.length) | 0]; }
  function poisson(l) { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; }
  function ip() { return `10.244.${(rnd() * 4) | 0}.${2 + ((rnd() * 250) | 0)}`; }
  // The Explorascope is a little more popular than the rest, as in the real demo.
  function pickProduct() { return rnd() < 0.18 ? PRODUCTS[0] : pick(PRODUCTS); }
  function sampleIds(n) { const a = PRODUCTS.map(p => p[0]).sort(() => rnd() - 0.5); return a.slice(0, n); }

  // ---------------------------------------------------------------- state
  const STEP = 200;          // simulation step in ms
  const RET = 900;           // seconds of metric retention (15 min)
  const KEEP_RECENT = 2000;  // most recent traces kept in memory
  const KEEP_EX = 1200;      // exemplar traces kept longer
  const KEEP_ERR = 600;      // error traces kept longer
  const LOG_CAP = 6000;

  const S = {
    flags: Object.fromEntries(FLAGS.map(f => [f.key, false])),
    prevFlags: {},
    load: 'normal',
    clock: 0, lastSec: 0, prefillEnd: 0, live: false,
    traces: new Map(), recent: [], keptEx: [], keptErr: [],
    logs: [], logSeq: 0,
    pending: [], particles: [],
    counters: { spans: 0, logs: 0, points: 0, traces: 0 },
    svc: {}, edges: {}, rt: {}, ex: {}, logVol: new Array(RET), sig: new Array(RET),
    ctx: { recLeak: 0, offset: 48210, orders: 1200, fdHeap: 0, restarts: 0 },
    pods: {}, res: {},
    listeners: [], lastNotify: 0,
  };
  SERVICES.forEach(s => { S.svc[s.name] = new Array(RET); S.rt[s.name] = new Array(RET); S.ex[s.name] = new Map(); newPod(s.name); });

  function newPod(name) {
    S.pods[name] = `${name}-${hex(9)}-${hex(5)}`;
    const sv = SVC[name];
    S.res[name] = {
      'service.name': name,
      'service.namespace': 'opentelemetry-demo',
      'service.version': sv.version,
      'service.instance.id': uuid(),
      'deployment.environment.name': 'techorama-2026',
      'telemetry.sdk.name': 'opentelemetry',
      'telemetry.sdk.language': sv.lang,
      'telemetry.sdk.version': SDK_VERSION[sv.lang],
      'k8s.namespace.name': 'otel-demo',
      'k8s.pod.name': S.pods[name],
      'k8s.node.name': 'aks-nodepool1-' + (10000000 + ((rnd() * 89999999) | 0)) + '-vmss00000' + ((rnd() * 3) | 0),
      'host.arch': 'amd64',
      'os.type': 'linux',
    };
  }

  function slot(arr, sec, make) {
    const i = ((sec % RET) + RET) % RET;
    let s = arr[i];
    if (!s || s.s !== sec) { if (!make) return null; s = arr[i] = make(sec); }
    return s;
  }
  const mkSvc = s => ({ s, calls: 0, errors: 0, sum: 0, hist: new Array(NB).fill(0) });
  const mkEdge = s => ({ s, calls: 0, errors: 0, sum: 0 });
  const mkRt = s => ({ s, cpu: 0, mem: 0 });
  const mkLv = s => ({ s, DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 });
  const mkSig = s => ({ s, spans: 0, logs: 0, points: 0 });
  function bucketOf(d) { for (let i = 0; i < BOUNDS.length; i++) if (d <= BOUNDS[i]) return i; return BOUNDS.length; }

  // ---------------------------------------------------------------- span building
  function newTrace() { return { traceId: hex(32), spans: [], logs: [] }; }

  function addSpan(tr, svc, name, kind, parent, start, attrs) {
    const s = {
      traceId: tr.traceId, spanId: hex(16), parentSpanId: parent ? parent.spanId : '',
      name, kind, service: svc, start, end: start,
      attributes: attrs || {}, events: [], links: [],
      status: { code: 'UNSET', message: '' },
      resource: S.res[svc], peer: null, from: null,
    };
    tr.spans.push(s);
    return s;
  }

  function makeLog(service, time, sev, body, attrs, traceId, spanId) {
    return {
      id: ++S.logSeq, time, sev, sevNum: SEV[sev], service, body,
      attributes: attrs || {}, traceId: traceId || '', spanId: spanId || '',
      resource: S.res[service],
    };
  }
  function addLog(tr, span, time, sev, body, attrs) {
    tr.logs.push(makeLog(span.service, time, sev, body, attrs, tr.traceId, span.spanId));
  }

  const STACKS = {
    nodejs: (t, m) => `${t}: ${m}\n    at Object.charge (/usr/src/app/charge.js:37:13)\n    at chargeServiceHandler (/usr/src/app/index.js:21:28)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)`,
    go: (t, m) => `${m}\n\tmain.(*productCatalog).GetProduct\n\t\t/usr/src/app/main.go:290\n\tgoogle.golang.org/grpc.(*Server).processUnaryRPC\n\t\t/go/pkg/mod/google.golang.org/grpc@v1.75.0/server.go:1431`,
    dotnet: (t, m) => `${t}: ${m}\n   at cart.cartstore.ValkeyCartStore.EnsureRedisConnected() in /src/cartstore/ValkeyCartStore.cs:line 96\n   at cart.cartstore.ValkeyCartStore.GetCartAsync(String userId) in /src/cartstore/ValkeyCartStore.cs:line 182`,
    python: (t, m) => `Traceback (most recent call last):\n  File "/app/recommendation_server.py", line 77, in ListRecommendations\n${t}: ${m}`,
    rust: (t, m) => `${t}: ${m}\n   at shipping::quote::calculate_quote (src/quote.rs:41)`,
    java: (t, m) => `${t}: ${m}\n\tat frauddetection.MainKt.main(main.kt:58)`,
  };
  function fail(span, type, msg, time) {
    span.status = { code: 'ERROR', message: msg };
    span.events.push({
      name: 'exception', time,
      attributes: { 'exception.type': type, 'exception.message': msg, 'exception.stacktrace': STACKS[SVC[span.service].lang](type, msg) },
    });
  }

  function internal(tr, parent, t, name, dur, attrs) {
    const s = addSpan(tr, parent.service, name, 'INTERNAL', parent, t, attrs);
    s.end = t + dur;
    return s;
  }

  // gRPC call: CLIENT span in the caller, SERVER span in the callee.
  function rpc(tr, parent, t, to, method, body) {
    const full = `${RPC[to]}/${method}`;
    const c = addSpan(tr, parent.service, full, 'CLIENT', parent, t, {
      'rpc.system': 'grpc', 'rpc.service': RPC[to], 'rpc.method': method,
      'server.address': to, 'server.port': PORTS[to], 'network.protocol.version': '2',
    });
    c.peer = to;
    const st = t + logn(0.35, 0.5);
    const s = addSpan(tr, to, full, 'SERVER', c, st, {
      'rpc.system': 'grpc', 'rpc.service': RPC[to], 'rpc.method': method,
      'server.port': PORTS[to], 'network.peer.address': ip(),
    });
    const r = body(s, st + logn(0.08, 0.5)) || {};
    s.end = r.end + logn(0.1, 0.5);
    const code = r.error ? (r.grpc || 13) : 0;
    s.attributes['rpc.grpc.status_code'] = code;
    c.attributes['rpc.grpc.status_code'] = code;
    if (r.error) {
      if (s.status.code !== 'ERROR') s.status = { code: 'ERROR', message: r.error };
      c.status = { code: 'ERROR', message: `${GRPC_CODES[code]}: ${r.error}` };
    }
    c.end = s.end + logn(0.3, 0.5);
    return { end: c.end, error: r.error, grpc: code };
  }
  const GRPC_CODES = { 0: 'OK', 9: 'FAILED_PRECONDITION', 13: 'INTERNAL', 14: 'UNAVAILABLE' };

  function db(tr, parent, t, system, op, table, query, dur) {
    const redis = system === 'redis';
    const s = addSpan(tr, parent.service, redis ? op : `${op} ${table}`, 'CLIENT', parent, t, {
      'db.system.name': system, 'db.operation.name': op,
      'server.address': redis ? 'valkey-cart' : 'postgres', 'server.port': redis ? 6379 : 5432,
    });
    if (redis) s.attributes['db.query.text'] = query;
    else Object.assign(s.attributes, { 'db.namespace': 'otel', 'db.collection.name': table, 'db.query.text': query });
    s.peer = redis ? 'valkey' : 'postgres';
    s.end = t + dur;
    return s;
  }

  // HTTP SERVER root span in the frontend.
  function httpRoot(tr, t, method, route, path, body) {
    const s = addSpan(tr, 'frontend', `${method} ${route}`, 'SERVER', null, t, {
      'http.request.method': method, 'http.route': route, 'url.path': path, 'url.scheme': 'http',
      'server.address': 'frontend-proxy', 'server.port': 8080,
      'user_agent.original': pick(USER_AGENTS), 'client.address': ip(),
      'app.session.id': uuid(),
    });
    s.from = 'load-generator';
    const r = body(s, t + logn(0.5, 0.5)) || {};
    s.end = r.end + logn(0.6, 0.5);
    const code = r.error ? 500 : 200;
    s.attributes['http.response.status_code'] = code;
    if (r.error) { s.status = { code: 'ERROR', message: '' }; s.attributes['error.type'] = '500'; }
    addLog(tr, s, s.end, r.error ? 'ERROR' : 'INFO',
      `${method} ${path} ${code} - ${(s.end - s.start).toFixed(0)} ms`,
      { 'http.request.method': method, 'http.route': route, 'http.response.status_code': code });
    return s;
  }

  // ---------------------------------------------------------------- service behaviour
  function listProducts(tr, parent, t) {
    return rpc(tr, parent, t, 'product-catalog', 'ListProducts', (s, t) => {
      const d = db(tr, s, t, 'postgresql', 'SELECT', 'products',
        'SELECT id, name, description, picture, price_currency_code, price_units, price_nanos, categories FROM catalog.products', logn(2.2, 0.45));
      s.attributes['app.products.count'] = PRODUCTS.length;
      return { end: d.end + logn(0.15, 0.4) };
    });
  }

  function getProduct(tr, parent, t, product, F) {
    const [id, name] = product;
    return rpc(tr, parent, t, 'product-catalog', 'GetProduct', (s, t) => {
      s.attributes['app.product.id'] = id;
      if (F.productCatalogFailure && id === 'OLJCESPC7Z') {
        const e = t + logn(0.4, 0.4);
        const msg = 'Error: Product Catalog Fail Feature Flag Enabled';
        fail(s, 'ProductCatalogError', msg, e);
        addLog(tr, s, e, 'ERROR', `${msg} (app.product.id=${id})`, { 'app.product.id': id, 'feature_flag.key': 'productCatalogFailure' });
        return { end: e, error: msg, grpc: 13 };
      }
      const d = db(tr, s, t, 'postgresql', 'SELECT', 'products',
        'SELECT id, name, description, picture, price_currency_code, price_units, price_nanos, categories FROM catalog.products WHERE id = $1', logn(1.1, 0.5));
      s.attributes['app.product.name'] = name;
      if (rnd() < 0.2) addLog(tr, s, d.end, 'INFO', `Product Found: ${id}`, { 'app.product.id': id, 'app.product.name': name });
      return { end: d.end + 0.1 };
    });
  }

  function recommendations(tr, parent, t, F) {
    const ids = sampleIds(1 + ((rnd() * 2) | 0));
    return rpc(tr, parent, t, 'recommendation', 'ListRecommendations', (s, t) => {
      const lp = listProducts(tr, s, t);
      if (lp.error) return lp;
      const slow = 1 + S.ctx.recLeak / 20;
      const miss = !!F.recommendationCacheFailure && rnd() < 0.6;
      const g = internal(tr, s, lp.end + 0.05, 'get_product_list', logn(2.5, 0.4) * slow, {
        'app.products.count': PRODUCTS.length,
        'app.recommendation.cache_enabled': !!F.recommendationCacheFailure,
        'app.cache_hit': !miss,
      });
      const rec = sampleIds(5);
      s.attributes['app.products_recommended.count'] = rec.length;
      if (rnd() < 0.18) addLog(tr, s, g.end, 'INFO', `Receive ListRecommendations for product ids:[${ids.map(i => `'${i}'`).join(', ')}]`, { 'app.products_recommended.count': rec.length });
      if (miss && rnd() < 0.2) addLog(tr, g, g.end, 'WARN', `Cache miss: product list rebuilt, cache now holds ${Math.round(4000 + S.ctx.recLeak * 120)} entries`, { 'app.cache_hit': false });
      return { end: g.end + 0.1 };
    });
  }

  function valkey(tr, parent, t, cmd, key, F) {
    const s = db(tr, parent, t, 'redis', cmd, null, `${cmd} ${key}`, logn(0.45, 0.5));
    if (F.cartFailure && rnd() < 0.35) {
      s.end = s.start + logn(1.2, 0.3);
      fail(s, 'StackExchange.Redis.RedisConnectionException', `No connection is active/available to service this operation: ${cmd} ${key}`, s.end);
      return { end: s.end, error: "Can't access cart storage. System.ApplicationException: Wasn't able to connect to redis" };
    }
    return { end: s.end };
  }

  function cartCall(tr, parent, t, method, user, cmds, F, extra) {
    return rpc(tr, parent, t, 'cart', method, (s, t) => {
      s.attributes['app.user.id'] = user;
      Object.assign(s.attributes, extra || {});
      let c = t;
      for (const cmd of cmds) {
        const r = valkey(tr, s, c, cmd, `cart:${user.slice(0, 8)}`, F);
        c = r.end + logn(0.08, 0.4);
        if (r.error) {
          fail(s, 'System.ApplicationException', r.error, c);
          addLog(tr, s, c, 'ERROR', r.error, { 'app.user.id': user, 'rpc.method': method });
          return { end: c, error: r.error, grpc: 9 };
        }
      }
      if (rnd() < 0.15) addLog(tr, s, c, 'DEBUG', `${method}Async called with userId=${user}`, { 'app.user.id': user });
      return { end: c };
    });
  }

  function shipQuote(tr, parent, t, n) {
    return rpc(tr, parent, t, 'shipping', 'GetQuote', (s, t) => {
      const q = internal(tr, s, t, 'calculate-quote', logn(0.9, 0.4), { 'app.shipping.items.count': n });
      const cost = +(8.99 + n * 1.25 + rnd() * 3).toFixed(2);
      s.attributes['app.shipping.cost.total'] = cost;
      q.attributes['app.shipping.cost.total'] = cost;
      if (rnd() < 0.3) addLog(tr, s, q.end, 'INFO', `Received quote: ${cost}`, { 'app.shipping.cost.total': cost });
      return { end: q.end + 0.05 };
    });
  }

  function shipOrder(tr, parent, t) {
    return rpc(tr, parent, t, 'shipping', 'ShipOrder', (s, t) => {
      const id = uuid();
      const q = internal(tr, s, t, 'create-shipping-tracking-id', logn(0.4, 0.4), {});
      s.attributes['app.shipping.tracking.id'] = id;
      if (rnd() < 0.3) addLog(tr, s, q.end, 'INFO', `Tracking ID Created: ${id}`, { 'app.shipping.tracking.id': id });
      return { end: q.end + 0.05 };
    });
  }

  function charge(tr, parent, t, amount, currency, F) {
    return rpc(tr, parent, t, 'payment', 'Charge', (ps, t) => {
      const card = pick(['visa', 'mastercard', 'amex']);
      const loyalty = pick(['gold', 'silver', 'platinum', 'bronze']);
      Object.assign(ps.attributes, { 'app.payment.card_type': card, 'app.payment.card_valid': true, 'app.loyalty.level': loyalty });
      if (rnd() < 0.25) addLog(tr, ps, t, 'INFO', 'Charge request received.', { 'app.payment.amount': amount });
      const ch = internal(tr, ps, t + 0.1, 'charge', logn(3, 0.5), { 'app.payment.amount': amount, 'app.payment.currency': currency });
      if (F.paymentFailure && rnd() < 0.5) {
        const msg = 'Payment request failed. Invalid token. app.loyalty.level=gold';
        fail(ch, 'Error', msg, ch.end);
        fail(ps, 'Error', msg, ch.end + 0.05);
        addLog(tr, ps, ch.end + 0.05, 'ERROR', msg, { 'app.payment.card_type': card, 'app.loyalty.level': 'gold', 'feature_flag.key': 'paymentFailure' });
        return { end: ch.end + 0.1, error: msg, grpc: 13 };
      }
      const txn = uuid();
      ps.attributes['app.payment.transaction.id'] = txn;
      addLog(tr, ps, ch.end + 0.05, 'INFO', 'Transaction complete.', { 'app.payment.transaction.id': txn, 'app.payment.card_type': card, 'app.payment.amount': amount });
      return { end: ch.end + 0.1 };
    });
  }

  // ---------------------------------------------------------------- user journeys
  function tHome(tr, t, F) {
    httpRoot(tr, t, 'GET', '/', '/', (s, t) => {
      const a = listProducts(tr, s, t);
      const b = recommendations(tr, s, t + logn(0.3, 0.5), F);
      return { end: Math.max(a.end, b.end), error: a.error || b.error };
    });
  }

  function tProduct(tr, t, F) {
    const p = pickProduct();
    httpRoot(tr, t, 'GET', '/api/products/{productId}', `/api/products/${p[0]}`, (s, t) => {
      s.attributes['app.product.id'] = p[0];
      const a = getProduct(tr, s, t, p, F);
      const b = recommendations(tr, s, t + logn(0.3, 0.5), F);
      return { end: Math.max(a.end, b.end), error: a.error || b.error };
    });
  }

  function tAddToCart(tr, t, F) {
    const p = pickProduct(), user = uuid(), qty = 1 + ((rnd() * 3) | 0);
    httpRoot(tr, t, 'POST', '/api/cart', '/api/cart', (s, t) => {
      const a = getProduct(tr, s, t, p, F);
      if (a.error) return a;
      return cartCall(tr, s, a.end + 0.2, 'AddItem', user, ['HGET', 'HSET', 'EXPIRE'], F,
        { 'app.product.id': p[0], 'app.product.quantity': qty });
    });
  }

  function tViewCart(tr, t, F) {
    const user = uuid();
    httpRoot(tr, t, 'GET', '/api/cart', '/api/cart', (s, t) => {
      const a = cartCall(tr, s, t, 'GetCart', user, ['HGETALL'], F);
      if (a.error) return a;
      return recommendations(tr, s, a.end + 0.2, F);
    });
  }

  function tCheckout(tr, t, F) {
    const user = uuid(), currency = pick(['USD', 'EUR', 'EUR', 'CAD', 'GBP']);
    httpRoot(tr, t, 'POST', '/api/checkout', '/api/checkout', (s, t) => {
      return rpc(tr, s, t, 'checkout', 'PlaceOrder', (co, t) => {
        const orderId = uuid();
        Object.assign(co.attributes, { 'app.user.id': user, 'app.user.currency': currency });
        const prep = internal(tr, co, t, 'prepareOrderItemsAndShippingQuoteFromCart', 0, {});
        let pt = t + 0.05;
        const g = cartCall(tr, prep, pt, 'GetCart', user, ['HGETALL'], F);
        if (g.error) { prep.end = g.end; return { end: g.end + 0.1, error: `cart failure: failed to get user cart during checkout: ${g.error}`, grpc: 13 }; }
        pt = g.end + 0.1;
        const n = 1 + ((rnd() * 3) | 0);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const p = pickProduct();
          const r = getProduct(tr, prep, pt, p, F);
          pt = r.end + 0.05;
          if (r.error) { prep.end = pt; prep.status = { code: 'ERROR', message: r.error }; return { end: pt + 0.1, error: `failed to prepare order: ${r.error}`, grpc: 13 }; }
          total += p[2];
        }
        const q = shipQuote(tr, prep, pt, n);
        prep.end = q.end + 0.05;
        prep.attributes['app.order.items.count'] = n;
        total = +total.toFixed(2);
        Object.assign(co.attributes, { 'app.order.amount': total, 'app.order.items.count': n });
        let cur = prep.end + 0.1;

        const pay = charge(tr, co, cur, total, currency, F);
        if (pay.error) {
          const msg = `failed to charge card: could not charge the card: rpc error: code = Internal desc = ${pay.error}`;
          addLog(tr, co, pay.end + 0.05, 'ERROR', msg, { 'app.order.id': orderId, 'app.user.id': user });
          return { end: pay.end + 0.1, error: msg, grpc: 13 };
        }
        cur = pay.end + 0.1;
        const ship = shipOrder(tr, co, cur);
        cur = ship.end + 0.1;
        const em = cartCall(tr, co, cur, 'EmptyCart', user, ['DEL'], F);
        if (em.error) return { end: em.end + 0.1, error: `failed to empty user cart during checkout: ${em.error}`, grpc: 13 };
        cur = em.end + 0.1;

        // Async hand-off: PRODUCER span here, CONSUMER span in fraud-detection.
        const pr = addSpan(tr, 'checkout', 'send orders', 'PRODUCER', co, cur, {
          'messaging.system': 'kafka', 'messaging.destination.name': 'orders',
          'messaging.operation.type': 'send', 'messaging.operation.name': 'send',
          'messaging.kafka.message.key': orderId, 'server.address': 'kafka', 'server.port': 9092,
        });
        pr.peer = 'kafka';
        pr.end = cur + logn(0.8, 0.5);
        const lag = F.kafkaQueueProblems ? logn(2600, 0.35) : logn(25, 0.6);
        const offset = S.ctx.offset++;
        const cs = addSpan(tr, 'fraud-detection', 'process orders', 'CONSUMER', pr, pr.end + lag, {
          'messaging.system': 'kafka', 'messaging.destination.name': 'orders',
          'messaging.operation.type': 'process', 'messaging.operation.name': 'process',
          'messaging.consumer.group.name': 'fraud-detection',
          'messaging.destination.partition.id': String((rnd() * 3) | 0),
          'messaging.kafka.offset': offset, 'messaging.kafka.message.key': orderId,
        });
        cs.from = 'kafka';
        cs.end = cs.start + logn(F.kafkaQueueProblems ? 35 : 4, 0.5);
        addLog(tr, cs, cs.end, 'INFO', `Consumed record with orderId: ${orderId}, and updated total count to: ${++S.ctx.orders}`, { 'app.order.id': orderId, 'messaging.kafka.offset': offset });
        if (F.kafkaQueueProblems && rnd() < 0.3) addLog(tr, cs, cs.start, 'WARN', `Record for orderId ${orderId} consumed ${(lag / 1000).toFixed(1)} s after it was produced`, { 'app.order.id': orderId, 'messaging.kafka.offset': offset });

        co.attributes['app.order.id'] = orderId;
        addLog(tr, co, pr.end + 0.05, 'INFO', `order placed app.order.id=${orderId}`, { 'app.order.id': orderId, 'app.order.amount': total, 'app.user.currency': currency });
        return { end: pr.end + 0.1 };
      });
    });
  }

  const JOURNEYS = [[tHome, 0.3], [tProduct, 0.3], [tAddToCart, 0.14], [tViewCart, 0.14], [tCheckout, 0.12]];
  function pickJourney() { let r = rnd(); for (const [fn, w] of JOURNEYS) { if ((r -= w) < 0) return fn; } return tHome; }

  function generate(fn, t0, F) {
    const tr = newTrace();
    fn(tr, t0, F);
    const root = tr.spans[0];
    tr.root = root;
    tr.name = root.name;
    tr.start = root.start;
    tr.end = tr.spans.reduce((m, s) => Math.max(m, s.end), 0);
    tr.duration = root.end - root.start;
    tr.errorCount = tr.spans.filter(s => s.status.code === 'ERROR').length;
    tr.error = tr.errorCount > 0;
    tr.services = [...new Set(tr.spans.map(s => s.service))];
    return tr;
  }

  // ---------------------------------------------------------------- storage & aggregation
  function release(tr) { if (--tr._r <= 0) S.traces.delete(tr.traceId); }
  function keep(tr, list, cap) {
    if (tr._k) return;
    tr._k = true; tr._r++;
    list.push(tr);
    if (list.length > cap) release(list.shift());
  }
  function storeTrace(tr) {
    tr._r = 1;
    S.traces.set(tr.traceId, tr);
    S.recent.push(tr);
    S.counters.traces++;
    if (S.recent.length > KEEP_RECENT) release(S.recent.shift());
  }

  function pushLog(lg) {
    S.logs.push(lg);
    if (S.logs.length > LOG_CAP) S.logs.splice(0, 500);
    const sec = Math.floor(lg.time / 1000);
    slot(S.logVol, sec, mkLv)[lg.sev]++;
    slot(S.sig, sec, mkSig).logs++;
    S.counters.logs++;
  }

  function record(tr) {
    for (const sp of tr.spans) {
      const sec = Math.floor(sp.end / 1000);
      const err = sp.status.code === 'ERROR';
      const dur = sp.end - sp.start;
      S.counters.spans++;
      slot(S.sig, sec, mkSig).spans++;
      if (sp.kind === 'SERVER' || sp.kind === 'CONSUMER') {
        const m = slot(S.svc[sp.service], sec, mkSvc);
        m.calls++; if (err) m.errors++; m.sum += dur; m.hist[bucketOf(dur)]++;
        const k = Math.floor(sec / 10), exm = S.ex[sp.service], cur = exm.get(k);
        if (!cur || dur > cur.v) exm.set(k, { t: sp.end, v: dur, traceId: tr.traceId, spanId: sp.spanId, err });
      }
      const from = sp.from || (sp.peer ? sp.service : null);
      const to = sp.peer || (sp.from ? sp.service : null);
      if (from && to) {
        const key = from + '>' + to;
        const e = S.edges[key] || (S.edges[key] = new Array(RET));
        const es = slot(e, sec, mkEdge);
        es.calls++; if (err) es.errors++; es.sum += dur;
      }
    }
    for (const lg of tr.logs) pushLog(lg);
    if (tr.error) keep(tr, S.keptErr, KEEP_ERR);
  }

  function addParticles(tr) {
    for (const sp of tr.spans) {
      const from = sp.from || (sp.peer ? sp.service : null);
      const to = sp.peer || (sp.from ? sp.service : null);
      if (from && to) S.particles.push({ from, to, at: sp.start, err: sp.status.code === 'ERROR', svc: sp.service });
    }
    if (S.particles.length > 900) S.particles.splice(0, S.particles.length - 700);
  }

  const RT = {
    frontend: { cpu: 6, k: 0.9, mem: 210, jit: 1.2 },
    checkout: { cpu: 2, k: 1.1, mem: 38, jit: 0.5 },
    cart: { cpu: 3, k: 0.8, mem: 145, jit: 0.7 },
    payment: { cpu: 2, k: 1.4, mem: 92, jit: 0.5 },
    'product-catalog': { cpu: 2, k: 0.35, mem: 28, jit: 0.5 },
    recommendation: { cpu: 4, k: 0.9, mem: 165, jit: 1 },
    shipping: { cpu: 1, k: 0.6, mem: 12, jit: 0.3 },
    'fraud-detection': { cpu: 5, k: 3.5, mem: 280, jit: 1 },
  };
  const MEM_LIMIT = 512;

  function sysLog(service, time, sev, body, attrs) { pushLog(makeLog(service, time, sev, body, attrs)); }

  function secondTick(sec, F) {
    const t = sec * 1000 + 999;
    for (const sv of SERVICES) {
      const m = slot(S.svc[sv.name], sec - 1, null);
      const rps = m ? m.calls : 0;
      const b = RT[sv.name];
      let cpu = b.cpu + rps * b.k + gauss() * b.jit;
      let mem = b.mem + gauss() * 1.2;
      if (sv.name === 'recommendation') {
        if (F.recommendationCacheFailure) S.ctx.recLeak += 1.6 + rps * 0.12;
        else S.ctx.recLeak = Math.max(0, S.ctx.recLeak * 0.985 - 0.2);
        mem += S.ctx.recLeak;
        cpu += S.ctx.recLeak * 0.05;
        if (mem > MEM_LIMIT) {
          sysLog('recommendation', t, 'ERROR', `Container recommendation in pod ${S.pods.recommendation} was OOMKilled (memory limit ${MEM_LIMIT}Mi); restarting`, { 'k8s.container.restart_count': ++S.ctx.restarts, 'process.memory.usage': Math.round(mem) });
          S.ctx.recLeak = 0;
          newPod('recommendation');
          mem = b.mem;
          sysLog('recommendation', t + 1, 'INFO', `Recommendation service started on port ${PORTS.recommendation}`, {});
        } else if (mem > 380 && sec % 5 === 0) {
          sysLog('recommendation', t, 'WARN', `Memory usage high: ${Math.round(mem)} MiB of ${MEM_LIMIT} MiB limit`, { 'process.memory.usage': Math.round(mem) });
        }
      }
      if (sv.name === 'fraud-detection') {
        S.ctx.fdHeap += 0.9 + rps * 0.2;
        if (S.ctx.fdHeap > 70) {
          if (rnd() < 0.5) sysLog('fraud-detection', t, 'DEBUG', `G1 Young Generation GC freed ${Math.round(S.ctx.fdHeap)} MB in ${(4 + rnd() * 8).toFixed(1)} ms`, { 'jvm.gc.name': 'G1 Young Generation' });
          S.ctx.fdHeap = 0;
        }
        mem += S.ctx.fdHeap;
        if (F.kafkaQueueProblems) cpu += 18;
      }
      const r = slot(S.rt[sv.name], sec, mkRt);
      r.cpu = Math.max(0.2, Math.min(100, cpu));
      r.mem = Math.max(4, mem);

      if (rnd() < 1 / 40) sysLog(sv.name, t, 'DEBUG', `Health check OK (${(rnd() * 2 + 0.2).toFixed(1)} ms)`, { 'http.route': '/healthz' });
    }
    if (rnd() < 1 / 45) sysLog('product-catalog', t, 'INFO', `Loaded ${PRODUCTS.length} products from catalog database`, { 'app.products.count': PRODUCTS.length });
    if (rnd() < 1 / 15) sysLog('fraud-detection', t, 'DEBUG', `Committed offset ${S.ctx.offset} for partition orders-${(rnd() * 3) | 0}`, { 'messaging.kafka.offset': S.ctx.offset });
    if (F.kafkaQueueProblems && sec % 3 === 0) sysLog('fraud-detection', t, 'WARN', `Consumer group fraud-detection is lagging on topic orders (lag ≈ ${30 + ((rnd() * 40) | 0)} records)`, { 'messaging.consumer.group.name': 'fraud-detection' });

    // Metric data points exported this second: calls + histogram per active service, 2 runtime gauges each.
    let pts = SERVICES.length * 2;
    for (const sv of SERVICES) if (slot(S.svc[sv.name], sec, null)) pts += 2;
    S.counters.points += pts;
    slot(S.sig, sec, mkSig).points = pts;

    // Promote each finished 10 s exemplar window's slowest trace to the long-lived set.
    if (sec % 10 === 5) {
      const k = (sec - 25) / 10;
      for (const sv of SERVICES) {
        const exm = S.ex[sv.name];
        const e = exm.get(k);
        if (e) { const tr = S.traces.get(e.traceId); if (tr) keep(tr, S.keptEx, KEEP_EX); }
        for (const key of exm.keys()) if (key < k - 95) exm.delete(key);
      }
    }
  }

  function flagChanged(f, on, t) {
    sysLog(f.service, t, on ? 'WARN' : 'INFO', `Feature flag "${f.key}" evaluated to ${on ? 'on' : 'off'} (flagd)`,
      { 'feature_flag.key': f.key, 'feature_flag.provider.name': 'flagd', 'feature_flag.result.variant': on ? 'on' : 'off' });
  }

  function tps(t) {
    const base = LOAD_LEVELS[S.load] || 12;
    return base * (1 + 0.22 * Math.sin(2 * Math.PI * t / 180000) + 0.08 * Math.sin(2 * Math.PI * t / 41000));
  }

  // Historical incidents baked into the warm-up so the charts tell a story from the first second.
  function prefillFlags(t) {
    const ago = (S.prefillEnd - t) / 1000;
    return {
      paymentFailure: ago < 500 && ago > 410,
      loadGeneratorFloodHomepage: ago < 230 && ago > 185,
    };
  }

  function stepOnce(t, live) {
    const F = live ? S.flags : prefillFlags(t);
    for (const f of FLAGS) if (!!F[f.key] !== !!S.prevFlags[f.key]) flagChanged(f, !!F[f.key], t);
    S.prevFlags = Object.assign({}, F);

    const n = poisson(tps(t) * STEP / 1000);
    const nf = F.loadGeneratorFloodHomepage ? poisson(20 * STEP / 1000) : 0;
    for (let i = 0; i < n + nf; i++) {
      const tr = generate(i < n ? pickJourney() : tHome, t + rnd() * STEP, F);
      S.pending.push(tr);
      if (live) addParticles(tr);
    }
    if (S.pending.length) {
      const still = [];
      for (const tr of S.pending) { if (tr.end <= t) { storeTrace(tr); record(tr); } else still.push(tr); }
      S.pending = still;
    }
    const sec = Math.floor(t / 1000);
    while (S.lastSec < sec) { S.lastSec++; secondTick(S.lastSec, F); }
  }

  function advance(to, live) {
    // Cap catch-up work (e.g. after the tab was in the background).
    if (to - S.clock > 120000) S.clock = to - 120000;
    while (S.clock + STEP <= to) { S.clock += STEP; stepOnce(S.clock, live); }
  }

  // ---------------------------------------------------------------- queries
  function lastSec() { return Math.floor(S.clock / 1000) - 1; }
  function steps(windowSec, step) {
    const end = lastSec(), n = Math.max(1, Math.floor(windowSec / step)), out = [];
    for (let i = n - 1; i >= 0; i--) { const b = end - i * step; out.push([b - step + 1, b]); }
    return out;
  }
  function quantile(hist, q) {
    let total = 0; for (const c of hist) total += c;
    if (!total) return null;
    const rank = q * total; let cum = 0;
    for (let i = 0; i < hist.length; i++) {
      const c = hist[i];
      if (c && cum + c >= rank) {
        if (i >= BOUNDS.length) return BOUNDS[BOUNDS.length - 1];
        const lo = i === 0 ? 0 : BOUNDS[i - 1], hi = BOUNDS[i];
        return lo + (hi - lo) * ((rank - cum) / c);
      }
      cum += c;
    }
    return BOUNDS[BOUNDS.length - 1];
  }
  function aggSvc(name, a, b) {
    const arr = S.svc[name], hist = new Array(NB).fill(0);
    let calls = 0, errors = 0, sum = 0;
    for (let s = a; s <= b; s++) {
      const m = slot(arr, s, null); if (!m) continue;
      calls += m.calls; errors += m.errors; sum += m.sum;
      for (let i = 0; i < NB; i++) hist[i] += m.hist[i];
    }
    return { calls, errors, sum, hist };
  }

  function serviceSeries(name, windowSec, step) {
    const st = steps(windowSec, step);
    const r = { times: [], rate: [], errRate: [], errPct: [], p50: [], p95: [], p99: [], heat: [], exemplars: [] };
    for (const [a, b] of st) {
      const g = aggSvc(name, a, b);
      r.times.push((b + 1) * 1000);
      r.rate.push(g.calls / step);
      r.errRate.push(g.errors / step);
      r.errPct.push(g.calls ? g.errors / g.calls * 100 : null);
      r.p50.push(quantile(g.hist, 0.5));
      r.p95.push(quantile(g.hist, 0.95));
      r.p99.push(quantile(g.hist, 0.99));
      r.heat.push(g.hist);
    }
    const from = st[0][0] * 1000, to = (st[st.length - 1][1] + 1) * 1000;
    for (const e of S.ex[name].values()) if (e.t >= from && e.t <= to && S.traces.has(e.traceId)) r.exemplars.push(e);
    return r;
  }

  function serviceStats(name, windowSec) {
    const end = lastSec(), g = aggSvc(name, end - windowSec + 1, end);
    return {
      calls: g.calls, rps: g.calls / windowSec,
      errPct: g.calls ? g.errors / g.calls * 100 : 0,
      avg: g.calls ? g.sum / g.calls : null,
      p50: quantile(g.hist, 0.5), p95: quantile(g.hist, 0.95), p99: quantile(g.hist, 0.99),
    };
  }

  function edgeStats(windowSec) {
    const end = lastSec(), out = {};
    for (const key in S.edges) {
      let calls = 0, errors = 0, sum = 0;
      for (let s = end - windowSec + 1; s <= end; s++) { const e = slot(S.edges[key], s, null); if (e) { calls += e.calls; errors += e.errors; sum += e.sum; } }
      out[key] = { calls, rps: calls / windowSec, errPct: calls ? errors / calls * 100 : 0, avg: calls ? sum / calls : null };
    }
    return out;
  }

  function runtimeSeries(name, windowSec, step) {
    const r = { times: [], cpu: [], mem: [] };
    for (const [a, b] of steps(windowSec, step)) {
      let c = 0, m = 0, n = 0;
      for (let s = a; s <= b; s++) { const x = slot(S.rt[name], s, null); if (x) { c += x.cpu; m += x.mem; n++; } }
      r.times.push((b + 1) * 1000); r.cpu.push(n ? c / n : null); r.mem.push(n ? m / n : null);
    }
    return r;
  }

  function logVolume(windowSec, step) {
    const r = { times: [], DEBUG: [], INFO: [], WARN: [], ERROR: [] };
    for (const [a, b] of steps(windowSec, step)) {
      const acc = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 };
      for (let s = a; s <= b; s++) { const x = slot(S.logVol, s, null); if (x) for (const k in acc) acc[k] += x[k]; }
      r.times.push((b + 1) * 1000); for (const k in acc) r[k].push(acc[k]);
    }
    return r;
  }

  function signalRates(windowSec) {
    const end = lastSec(); let spans = 0, logs = 0, points = 0;
    for (let s = end - windowSec + 1; s <= end; s++) { const x = slot(S.sig, s, null); if (x) { spans += x.spans; logs += x.logs; points += x.points; } }
    return { spans: spans / windowSec, logs: logs / windowSec, points: points / windowSec };
  }

  function signalSeries(windowSec, step) {
    const r = { times: [], spans: [], logs: [], points: [] };
    for (const [a, b] of steps(windowSec, step)) {
      let sp = 0, lg = 0, pt = 0;
      for (let s = a; s <= b; s++) { const x = slot(S.sig, s, null); if (x) { sp += x.spans; lg += x.logs; pt += x.points; } }
      r.times.push((b + 1) * 1000); r.spans.push(sp / step); r.logs.push(lg / step); r.points.push(pt / step);
    }
    return r;
  }

  function allTraces() { return Array.from(S.traces.values()); }

  // ---------------------------------------------------------------- OTLP/JSON encoding
  const KIND_NUM = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 };
  const STATUS_NUM = { UNSET: 0, OK: 1, ERROR: 2 };
  function anyValue(v) {
    if (typeof v === 'boolean') return { boolValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
    return { stringValue: String(v) };
  }
  function kv(obj) { return Object.entries(obj).map(([key, v]) => ({ key, value: anyValue(v) })); }
  function nanos(ms) {
    const whole = Math.floor(ms);
    return String(whole) + String(Math.min(999999, Math.round((ms - whole) * 1e6))).padStart(6, '0');
  }
  function otlpSpan(sp) {
    const o = {
      traceId: sp.traceId, spanId: sp.spanId, parentSpanId: sp.parentSpanId, flags: 257,
      name: sp.name, kind: KIND_NUM[sp.kind],
      startTimeUnixNano: nanos(sp.start), endTimeUnixNano: nanos(sp.end),
      attributes: kv(sp.attributes),
      status: sp.status.code === 'UNSET' ? {} : { code: STATUS_NUM[sp.status.code], message: sp.status.message || undefined },
    };
    if (sp.events.length) o.events = sp.events.map(e => ({ timeUnixNano: nanos(e.time), name: e.name, attributes: kv(e.attributes) }));
    if (!o.parentSpanId) delete o.parentSpanId;
    return o;
  }
  function otlpTrace(tr) {
    const groups = new Map();
    for (const sp of tr.spans) { if (!groups.has(sp.resource)) groups.set(sp.resource, []); groups.get(sp.resource).push(sp); }
    return {
      resourceSpans: [...groups].map(([res, spans]) => ({
        resource: { attributes: kv(res) },
        scopeSpans: [{ scope: { name: SVC[res['service.name']].scope }, spans: spans.map(otlpSpan) }],
      })),
    };
  }
  function otlpLog(lg) {
    const rec = {
      timeUnixNano: nanos(lg.time), observedTimeUnixNano: nanos(lg.time + 0.4),
      severityNumber: lg.sevNum, severityText: lg.sev,
      body: { stringValue: lg.body }, attributes: kv(lg.attributes),
    };
    if (lg.traceId) { rec.traceId = lg.traceId; rec.spanId = lg.spanId; rec.flags = 1; }
    return { resourceLogs: [{ resource: { attributes: kv(lg.resource) }, scopeLogs: [{ scope: { name: SVC[lg.service].scope }, logRecords: [rec] }] }] };
  }

  // ---------------------------------------------------------------- lifecycle
  function notify() { S.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

  function warmup(seconds, onProgress, done) {
    const end = Date.now();
    S.prefillEnd = end;
    S.clock = Math.floor((end - seconds * 1000) / STEP) * STEP;
    S.lastSec = Math.floor(S.clock / 1000);
    const start = S.clock;
    (function chunk() {
      advance(Math.min(S.clock + 20000, Date.now()), false);
      onProgress(Math.min(1, (S.clock - start) / (Date.now() - start)));
      if (Date.now() - S.clock > STEP * 2) setTimeout(chunk, 0); else done();
    })();
  }

  function start() {
    S.live = true;
    setInterval(() => {
      advance(Date.now(), true);
      const sec = Math.floor(Date.now() / 1000);
      if (sec !== S.lastNotify) { S.lastNotify = sec; notify(); }
    }, STEP);
  }

  global.Sim = {
    SERVICES, INFRA, FLAGS, BOUNDS, PRODUCTS, MEM_LIMIT, LOAD_LEVELS,
    svc: name => SVC[name] || null,
    state: S,
    warmup, start,
    onSecond(fn) { S.listeners.push(fn); },
    setFlag(key, on) { S.flags[key] = !!on; },
    setLoad(level) { S.load = level; },
    getTrace: id => S.traces.get(id) || null,
    allTraces, serviceSeries, serviceStats, edgeStats, runtimeSeries, logVolume, signalRates, signalSeries,
    logs: () => S.logs,
    logsForTrace: id => S.logs.filter(l => l.traceId === id).sort((a, b) => a.time - b.time),
    otlpTrace, otlpLog, nanos,
    now: () => S.clock,
  };
})(window);
