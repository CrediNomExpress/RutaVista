/* =========================================
   RUTAVISITA - Lógica pura (sin DOM)
   Se puede probar en Node: node tests.js
========================================= */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RutaLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STATUSES = ["Pendiente", "Visitado", "No localizado", "Seguimiento", "Reprogramado"];
  const WINDOWS = ["Cualquier hora", "Mañana", "Tarde"];
  const PRIORITIES = ["Alta", "Normal", "Baja"];

  /* ---------- Fechas (siempre YYYY-MM-DD en hora local) ---------- */

  function dateToStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function todayStr() {
    return dateToStr(new Date());
  }

  function strToDate(str) {
    const [y, m, d] = String(str).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function addDays(str, days) {
    const date = strToDate(str);
    date.setDate(date.getDate() + days);
    return dateToStr(date);
  }

  /** Lunes de la semana a la que pertenece la fecha. */
  function weekStart(str) {
    const date = strToDate(str);
    const diff = (date.getDay() + 6) % 7; // lunes = 0
    date.setDate(date.getDate() - diff);
    return dateToStr(date);
  }

  function formatDate(str) {
    if (!str) return "";
    const p = String(str).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : str;
  }

  /* ---------- Normalización (migra datos de la v1 sin perder nada) ---------- */

  function newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(16).slice(2);
  }

  function normalizeVisit(v) {
    const visit = Object.assign({}, v);
    visit.id = visit.id || newId();
    visit.person = String(visit.person || "").trim();
    visit.address = String(visit.address || "").trim();
    visit.phone = String(visit.phone || "").trim();
    visit.notes = String(visit.notes || "").trim();
    visit.zone = String(visit.zone || "").trim();
    visit.status = STATUSES.includes(visit.status) ? visit.status : "Pendiente";
    visit.window = WINDOWS.includes(visit.window) ? visit.window : "Cualquier hora";
    visit.priority = PRIORITIES.includes(visit.priority) ? visit.priority : "Normal";
    visit.plannedDate = /^\d{4}-\d{2}-\d{2}$/.test(visit.plannedDate || "") ? visit.plannedDate : "";
    visit.order = Number.isFinite(visit.order) ? visit.order : 0;
    visit.lat = Number.isFinite(visit.lat) ? visit.lat : null;
    visit.lng = Number.isFinite(visit.lng) ? visit.lng : null;
    visit.createdDate = visit.createdDate || todayStr();
    visit.lastVisit = visit.lastVisit || "";
    visit.history = Array.isArray(visit.history) ? visit.history : [];
    visit.updatedAt = Number.isFinite(visit.updatedAt) ? visit.updatedAt : 0;
    return visit;
  }

  /* ---------- Coordenadas ---------- */

  function validCoords(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  /**
   * Acepta "19.4326, -99.1332" o un enlace de Google Maps
   * (@lat,lng  |  !3dlat!4dlng  |  q=lat,lng  |  ll=lat,lng).
   */
  function parseCoords(text) {
    if (!text) return null;
    const s = String(text).trim();
    const patterns = [
      /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
      /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
      /[?&](?:q|ll|query|destination)=(-?\d{1,3}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
      /^(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)$/
    ];
    for (const re of patterns) {
      const m = s.match(re);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (validCoords(lat, lng)) return { lat, lng };
      }
    }
    return null;
  }

  function haversine(a, b) {
    const R = 6371;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const hasCoords = (v) => validCoords(v.lat, v.lng);

  /* ---------- Orden de la ruta ---------- */

  const windowRank = (w) => ({ "Mañana": 0, "Cualquier hora": 1, "Tarde": 2 }[w] ?? 1);
  const priorityRank = (p) => ({ Alta: 0, Normal: 1, Baja: 2 }[p] ?? 1);

  function pathLength(points, start) {
    let total = 0;
    let prev = start || null;
    for (const p of points) {
      if (prev) total += haversine(prev, p);
      prev = p;
    }
    return total;
  }

  /** Vecino más cercano + mejora 2-opt (rutas abiertas, pocas paradas). */
  function nearestNeighbor(stops, start) {
    const left = stops.slice();
    const result = [];
    let current = start || null;

    if (!current) {
      current = left.shift();
      result.push(current);
    }

    while (left.length) {
      let best = 0;
      let bestDist = Infinity;
      left.forEach((s, i) => {
        const d = haversine(current, s);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      current = left.splice(best, 1)[0];
      result.push(current);
    }

    // 2-opt: invierte tramos mientras acorte el recorrido
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < result.length - 1; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const candidate = result.slice(0, i)
            .concat(result.slice(i, j + 1).reverse())
            .concat(result.slice(j + 1));
          if (pathLength(candidate, start) + 1e-9 < pathLength(result, start)) {
            result.splice(0, result.length, ...candidate);
            improved = true;
          }
        }
      }
    }
    return result;
  }

  /**
   * Ordena paradas: primero por horario (Mañana → Cualquiera → Tarde),
   * luego por prioridad (Alta primero) y, dentro de cada bloque,
   * por cercanía si hay coordenadas o agrupando por zona si no.
   * Devuelve { ordered, usedCoords, withoutCoords }.
   */
  function orderRoute(stops, start) {
    const groups = new Map();
    stops.forEach((s) => {
      const key = windowRank(s.window) * 10 + priorityRank(s.priority);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });

    const ordered = [];
    let cursor = start && validCoords(start.lat, start.lng) ? start : null;
    let usedCoords = 0;

    [...groups.keys()].sort((a, b) => a - b).forEach((key) => {
      const group = groups.get(key);
      const withC = group.filter(hasCoords);
      const withoutC = group.filter((s) => !hasCoords(s));

      withoutC.sort((a, b) =>
        a.zone.localeCompare(b.zone, "es") ||
        a.address.localeCompare(b.address, "es"));

      let part = [];
      if (withC.length > 1 || (withC.length === 1 && cursor)) {
        part = nearestNeighbor(withC, cursor);
        usedCoords += withC.length;
      } else {
        part = withC;
      }
      if (part.length) cursor = part[part.length - 1];

      ordered.push(...part, ...withoutC);
    });

    return {
      ordered,
      usedCoords,
      withoutCoords: stops.length - stops.filter(hasCoords).length
    };
  }

  /** Distancia en línea recta de la ruta (km), solo si hay coordenadas. */
  function routeDistanceKm(stops, start) {
    const pts = stops.filter(hasCoords);
    if (pts.length < 2 && !(pts.length === 1 && start)) return 0;
    return pathLength(pts, start);
  }

  /* ---------- Enlaces ---------- */

  function destinationOf(v) {
    return hasCoords(v) ? `${v.lat},${v.lng}` : v.address;
  }

  function mapsSearchUrl(v) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(destinationOf(v));
  }

  /** Indicaciones hacia una parada. Sin origen = ubicación actual. */
  function mapsDirectionsUrl(v, mode, origin) {
    let url = "https://www.google.com/maps/dir/?api=1&destination=" +
      encodeURIComponent(destinationOf(v)) +
      "&travelmode=" + encodeURIComponent(mode || "transit");
    if (origin) url += "&origin=" + encodeURIComponent(destinationOf(origin));
    return url;
  }

  /**
   * Ruta con varias paradas (auto o a pie). Google Maps admite un número
   * limitado de puntos intermedios, así que se divide en tramos.
   */
  function mapsMultiStopUrls(stops, mode, chunk) {
    const size = chunk || 8;
    const urls = [];
    for (let i = 0; i < stops.length; i += size) {
      const part = stops.slice(i, i + size);
      const dest = part[part.length - 1];
      const way = part.slice(0, -1).map(destinationOf).join("|");
      let url = "https://www.google.com/maps/dir/?api=1&destination=" +
        encodeURIComponent(destinationOf(dest)) +
        "&travelmode=" + encodeURIComponent(mode);
      if (way) url += "&waypoints=" + encodeURIComponent(way);
      if (i > 0) url += "&origin=" + encodeURIComponent(destinationOf(stops[i - 1]));
      urls.push({ url, from: i + 1, to: i + part.length });
    }
    return urls;
  }

  function phoneDigits(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  function telHref(phone) {
    const d = phoneDigits(phone);
    return d.length >= 7 ? "tel:" + d : "";
  }

  /** WhatsApp para números de México (10 dígitos, con o sin 52). */
  function whatsappHref(phone) {
    let d = phoneDigits(phone);
    if (d.length === 10) d = "52" + d;
    if (d.length === 13 && d.startsWith("521")) d = "52" + d.slice(3);
    return d.length === 12 && d.startsWith("52") ? "https://wa.me/" + d : "";
  }

  /* ---------- Gastos ---------- */

  function sumRange(expenses, from, to) {
    let total = 0;
    Object.keys(expenses || {}).forEach((date) => {
      if (date >= from && date <= to) total += Number(expenses[date]) || 0;
    });
    return Math.round(total * 100) / 100;
  }

  function monthRange(str) {
    const [y, m] = str.split("-");
    const last = new Date(Number(y), Number(m), 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, "0")}` };
  }

  function countVisitedInRange(visits, from, to) {
    let count = 0;
    visits.forEach((v) => {
      v.history.forEach((h) => {
        if (h.status === "Visitado" && h.date >= from && h.date <= to) count++;
      });
    });
    return count;
  }

  function dayStats(visits, date) {
    let visited = 0;
    let notFound = 0;
    visits.forEach((v) => {
      v.history.forEach((h) => {
        if (h.date !== date) return;
        if (h.status === "Visitado") visited++;
        if (h.status === "No localizado") notFound++;
      });
    });
    const attempts = visited + notFound;
    return {
      visited,
      notFound,
      effectiveness: attempts ? Math.round((visited / attempts) * 100) : null
    };
  }

  /* ---------- CSV / respaldo ---------- */

  function csvCell(value) {
    let s = value === null || value === undefined ? "" : String(value);
    // Evita que Excel interprete texto como fórmula (los números no se tocan)
    if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows, columns) {
    const head = columns.map((c) => csvCell(c.label)).join(",");
    const body = rows.map((r) => columns.map((c) => csvCell(c.get(r))).join(","));
    return "﻿" + [head].concat(body).join("\r\n");
  }

  /** Une dos listas por id; gana el registro con updatedAt más reciente. */
  function mergeVisits(current, incoming) {
    const map = new Map(current.map((v) => [v.id, v]));
    let added = 0;
    let updated = 0;
    incoming.forEach((raw) => {
      const v = normalizeVisit(raw);
      const existing = map.get(v.id);
      if (!existing) {
        map.set(v.id, v);
        added++;
      } else if (v.updatedAt > existing.updatedAt) {
        map.set(v.id, v);
        updated++;
      }
    });
    return { visits: [...map.values()], added, updated };
  }

  function mergeExpenses(current, incoming, replace) {
    const out = replace ? {} : Object.assign({}, current);
    Object.keys(incoming || {}).forEach((date) => {
      const n = Number(incoming[date]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(n) && n >= 0) {
        out[date] = replace ? n : Math.max(Number(out[date]) || 0, n);
      }
    });
    return out;
  }

  return {
    STATUSES, WINDOWS, PRIORITIES,
    dateToStr, todayStr, addDays, weekStart, formatDate, strToDate,
    normalizeVisit, newId,
    parseCoords, validCoords, haversine, hasCoords,
    orderRoute, routeDistanceKm, nearestNeighbor,
    mapsSearchUrl, mapsDirectionsUrl, mapsMultiStopUrls,
    telHref, whatsappHref, phoneDigits,
    sumRange, monthRange, countVisitedInRange, dayStats,
    toCSV, csvCell, mergeVisits, mergeExpenses
  };
});
