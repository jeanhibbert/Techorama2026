# OTel Observatory

A fully self-contained OpenTelemetry demo. It is a static website with no build step, no server, no CDN and no external requests. It simulates a slimmed-down OpenTelemetry Astronomy Shop in the browser and shows its **traces, metrics and logs**, plus **diagrams** that explain how the pieces fit together.

## Run it

Open `index.html` in a browser. It works straight from `file://`.

To serve it over HTTP instead (for example to share it on a network):

```sh
npx serve .            # or: python -m http.server
```

## What's inside

| View | What it shows |
|---|---|
| **Overview** | KPI tiles, a live service map built from CLIENT→SERVER span pairs (with requests in flight), pipeline throughput, recent errors, slowest traces |
| **Traces** | Duration scatter plot, a filterable trace list, and a waterfall per trace with span attributes, events, resource, correlated logs and an OTLP/JSON export |
| **Metrics** | RED metrics per service from a `spanmetrics`-style aggregation: rate, errors, p50/p95/p99 from histogram buckets, clickable exemplars, latency heatmap, CPU and memory |
| **Logs** | Severity-stacked volume chart, filterable log stream with trace/span correlation and an OTLP/JSON view |
| **Concepts** | Collector pipeline diagram (animated), W3C `traceparent` propagation built from a live trace, a signal-correlation diagram, a Collector YAML file and a .NET SDK snippet |

Eight services in six languages (frontend, checkout, cart, payment, product-catalog, recommendation, shipping, fraud-detection) plus Postgres, Valkey and Kafka. Spans use OpenTelemetry semantic-convention attributes.

## Fault injection

**Inject faults** toggles flags modelled on the real demo's `flagd` flags: `paymentFailure`, `productCatalogFailure`, `cartFailure`, `recommendationCacheFailure` (memory leak → OOMKill), `kafkaQueueProblems` and `loadGeneratorFloodHomepage`. The warm-up also replays a past payment incident and a traffic spike, so the charts have a story from the first second.

## Presenter shortcuts

- `index.html?faults=paymentFailure,cartFailure` starts with those faults on
- `?theme=light` or `?theme=dark` forces a theme; `?load=peak` sets the traffic level
- `#/trace/latest` opens the newest checkout trace
- `#/metrics?service=recommendation` opens a service's metrics directly

## Files

```
index.html          shell: top bar, navigation, fault drawer, modal
css/styles.css      light and dark themes, layout
js/telemetry.js     the simulator: services, spans, logs, metrics, OTLP/JSON encoding
js/charts.js        dependency-free SVG charts with tooltips and table views
js/diagrams.js      concept diagrams and config snippets
js/app.js           routing and views
```
