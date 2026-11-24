// Pruebas de la lógica: node tests.js
const assert = require("assert");
const L = require("./logic.js");

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const v = (o) => L.normalizeVisit(Object.assign({ person: "X", address: "Calle 1" }, o));

test("migra datos v1 sin perder campos", () => {
  const old = { id: "a", person: "Ana", address: "Calle 5", status: "Visitado", createdDate: "2026-01-02", lastVisit: "hoy" };
  const n = L.normalizeVisit(old);
  assert.strictEqual(n.person, "Ana");
  assert.strictEqual(n.status, "Visitado");
  assert.strictEqual(n.priority, "Normal");
  assert.strictEqual(n.window, "Cualquier hora");
  assert.deepStrictEqual(n.history, []);
  assert.strictEqual(n.lat, null);
});

test("estado inválido vuelve a Pendiente", () => {
  assert.strictEqual(v({ status: "???" }).status, "Pendiente");
});

test("parseCoords: texto, enlaces y rechazo", () => {
  assert.deepStrictEqual(L.parseCoords("19.4326, -99.1332"), { lat: 19.4326, lng: -99.1332 });
  assert.deepStrictEqual(L.parseCoords("https://www.google.com/maps/place/X/@19.4326,-99.1332,17z"), { lat: 19.4326, lng: -99.1332 });
  assert.deepStrictEqual(L.parseCoords("https://www.google.com/maps?q=19.5,-99.2"), { lat: 19.5, lng: -99.2 });
  assert.deepStrictEqual(L.parseCoords("https://www.google.com/maps/place/X/data=!3d19.1!4d-99.9"), { lat: 19.1, lng: -99.9 });
  assert.strictEqual(L.parseCoords("hola"), null);
  assert.strictEqual(L.parseCoords("95.0, -99.1"), null); // latitud fuera de rango
  assert.strictEqual(L.parseCoords("https://maps.app.goo.gl/abc"), null);
});

test("orderRoute: horario y prioridad mandan", () => {
  const stops = [
    v({ id: "t", window: "Tarde" }),
    v({ id: "m", window: "Mañana" }),
    v({ id: "any", window: "Cualquier hora" }),
    v({ id: "mAlta", window: "Mañana", priority: "Alta" })
  ];
  const ids = L.orderRoute(stops).ordered.map((s) => s.id);
  assert.deepStrictEqual(ids, ["mAlta", "m", "any", "t"]);
});

test("orderRoute: sin coordenadas agrupa por zona", () => {
  const stops = [
    v({ id: "1", zone: "Norte" }), v({ id: "2", zone: "Centro" }),
    v({ id: "3", zone: "Norte" }), v({ id: "4", zone: "Centro" })
  ];
  const zones = L.orderRoute(stops).ordered.map((s) => s.zone);
  assert.deepStrictEqual(zones, ["Centro", "Centro", "Norte", "Norte"]);
});

test("orderRoute: por cercanía acorta el recorrido", () => {
  // puntos sobre una línea, desordenados a propósito
  const mk = (id, lng) => v({ id, lat: 19.4, lng });
  const stops = [mk("c", -99.10), mk("a", -99.30), mk("d", -99.05), mk("b", -99.20)];
  const start = { lat: 19.4, lng: -99.31 };
  const res = L.orderRoute(stops, start);
  assert.deepStrictEqual(res.ordered.map((s) => s.id), ["a", "b", "c", "d"]);
  assert.ok(L.routeDistanceKm(res.ordered, start) <= L.routeDistanceKm(stops, start));
  assert.strictEqual(res.usedCoords, 4);
  assert.strictEqual(res.withoutCoords, 0);
});

test("orderRoute: mezcla con y sin coordenadas no pierde paradas", () => {
  const stops = [v({ id: "1", lat: 19.4, lng: -99.1 }), v({ id: "2" }), v({ id: "3", lat: 19.41, lng: -99.11 })];
  const res = L.orderRoute(stops);
  assert.strictEqual(res.ordered.length, 3);
  assert.strictEqual(res.withoutCoords, 1);
});

test("orderRoute: una sola parada y lista vacía", () => {
  assert.strictEqual(L.orderRoute([]).ordered.length, 0);
  assert.strictEqual(L.orderRoute([v({ id: "z", lat: 19, lng: -99 })]).ordered.length, 1);
});

test("enlaces de Maps", () => {
  const a = v({ address: "Av. Juárez 10, Centro" });
  const url = L.mapsDirectionsUrl(a, "transit");
  assert.ok(url.includes("destination=Av.%20Ju%C3%A1rez%2010%2C%20Centro"));
  assert.ok(url.includes("travelmode=transit"));
  const b = v({ lat: 19.4, lng: -99.1 });
  assert.ok(L.mapsDirectionsUrl(b, "walking").includes("destination=19.4%2C-99.1"));
  const stops = Array.from({ length: 10 }, (_, i) => v({ address: "Calle " + i }));
  const parts = L.mapsMultiStopUrls(stops, "driving", 8);
  assert.strictEqual(parts.length, 2);
  assert.deepStrictEqual([parts[0].from, parts[0].to, parts[1].from, parts[1].to], [1, 8, 9, 10]);
  assert.ok(parts[1].url.includes("origin=Calle%207"));
});

test("teléfono y WhatsApp (México)", () => {
  assert.strictEqual(L.whatsappHref("55 1234 5678"), "https://wa.me/525512345678");
  assert.strictEqual(L.whatsappHref("+52 1 55 1234 5678"), "https://wa.me/525512345678");
  assert.strictEqual(L.whatsappHref("123"), "");
  assert.strictEqual(L.telHref("55-1234-5678"), "tel:5512345678");
  assert.strictEqual(L.telHref(""), "");
});

test("fechas: semana (lunes) y mes", () => {
  assert.strictEqual(L.weekStart("2026-11-24"), "2026-11-23"); // martes -> lunes
  assert.strictEqual(L.weekStart("2026-11-29"), "2026-11-23"); // domingo
  assert.strictEqual(L.addDays("2026-11-30", 1), "2026-12-01");
  assert.deepStrictEqual(L.monthRange("2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
});

test("gastos: suma por rango", () => {
  const e = { "2026-11-23": 40, "2026-11-24": 35.5, "2026-11-30": 10 };
  assert.strictEqual(L.sumRange(e, "2026-11-23", "2026-11-29"), 75.5);
});

test("estadísticas del día y visitas contadas", () => {
  const a = v({ history: [{ date: "2026-11-24", status: "Visitado" }, { date: "2026-11-24", status: "No localizado" }] });
  const b = v({ history: [{ date: "2026-11-24", status: "Visitado" }, { date: "2026-11-20", status: "Visitado" }] });
  const s = L.dayStats([a, b], "2026-11-24");
  assert.deepStrictEqual([s.visited, s.notFound, s.effectiveness], [2, 1, 67]);
  assert.strictEqual(L.dayStats([a], "2026-01-01").effectiveness, null);
  assert.strictEqual(L.countVisitedInRange([a, b], "2026-11-23", "2026-11-29"), 2);
});

test("CSV: escapa comas/comillas, neutraliza fórmulas y respeta números", () => {
  const csv = L.toCSV([{ n: 'Ana, "la" mejor', f: "=HYPERLINK(1)", lat: -99.1 }], [
    { label: "N", get: (r) => r.n }, { label: "F", get: (r) => r.f }, { label: "Lat", get: (r) => r.lat }
  ]);
  const lines = csv.replace("﻿", "").split("\r\n");
  assert.strictEqual(lines[0], "N,F,Lat");
  assert.strictEqual(lines[1], '"Ana, ""la"" mejor",\'=HYPERLINK(1),-99.1');
});

test("importar: combinar conserva lo más reciente y no duplica", () => {
  const cur = [v({ id: "1", person: "Viejo", updatedAt: 10 }), v({ id: "2", person: "Solo local", updatedAt: 5 })];
  const inc = [{ id: "1", person: "Nuevo", address: "C", updatedAt: 20 }, { id: "3", person: "Otro", address: "C", updatedAt: 1 }, { id: "2", person: "Más viejo", address: "C", updatedAt: 1 }];
  const r = L.mergeVisits(cur, inc);
  assert.strictEqual(r.visits.length, 3);
  assert.strictEqual(r.visits.find((x) => x.id === "1").person, "Nuevo");
  assert.strictEqual(r.visits.find((x) => x.id === "2").person, "Solo local");
  assert.deepStrictEqual([r.added, r.updated], [1, 1]);
});

test("importar gastos: descarta fechas y montos inválidos", () => {
  const out = L.mergeExpenses({ "2026-11-01": 10 }, { "2026-11-01": 5, "mal": 3, "2026-11-02": -4, "2026-11-03": 8 }, false);
  assert.deepStrictEqual(out, { "2026-11-01": 10, "2026-11-03": 8 });
});

console.log(`\n${passed} pruebas correctas`);
