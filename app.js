/* =========================================
   RUTAVISITA - Aplicación principal (v2)
   Almacenamiento local privado
========================================= */

(() => {
  "use strict";

  const L = window.RutaLogic;

  const STORAGE_VISITS = "rutavisita_visits_v1";
  const STORAGE_EXPENSES = "rutavisita_expenses_v1";
  const STORAGE_SETTINGS = "rutavisita_settings_v1";
  const BACKUP_REMINDER_DAYS = 7;

  const $ = (id) => document.getElementById(id);

  /* ---------- Estado ---------- */

  let visits = loadData(STORAGE_VISITS, []).map(L.normalizeVisit);
  let expenses = loadData(STORAGE_EXPENSES, {});
  let settings = Object.assign(
    { travelMode: "transit", lastBackup: 0 },
    loadData(STORAGE_SETTINGS, {})
  );

  let routeDate = L.todayStr();
  let editingId = null;
  let dialogVisitId = null;

  /* ---------- Almacenamiento ---------- */

  function loadData(key, fallback) {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : fallback;
    } catch (error) {
      console.error("Error al leer almacenamiento:", error);
      return fallback;
    }
  }

  function saveData(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (error) {
      toast("No se pudo guardar. Revisa el espacio disponible.");
      console.error(error);
      return false;
    }
  }

  /** Ejecuta un cambio sobre visits y lo revierte si no se pudo guardar. */
  function commit(mutator) {
    const snapshot = JSON.stringify(visits);
    mutator();
    if (!saveData(STORAGE_VISITS, visits)) {
      visits = JSON.parse(snapshot);
      return false;
    }
    return true;
  }

  const saveSettings = () => saveData(STORAGE_SETTINGS, settings);

  /* ---------- Utilidades ---------- */

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[c]);
  }

  function statusClass(status) {
    return "status-" + status
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "-");
  }

  function formatMoney(amount) {
    return Number(amount || 0).toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN"
    });
  }

  function formatMoneyShort(amount) {
    return Number(amount || 0).toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0
    });
  }

  function formatDayLabel(dateStr) {
    return L.strToDate(dateStr).toLocaleDateString("es-MX", {
      weekday: "short", day: "2-digit", month: "short"
    });
  }

  function formatLongDay(dateStr) {
    return L.strToDate(dateStr).toLocaleDateString("es-MX", {
      weekday: "long", day: "numeric", month: "long"
    });
  }

  const touch = (v) => { v.updatedAt = Date.now(); };

  function nextOrder(date) {
    const orders = visits
      .filter((v) => v.plannedDate === date)
      .map((v) => v.order);
    return (orders.length ? Math.max(...orders) : 0) + 1;
  }

  const isClosed = (v) => v.status === "Visitado" || v.status === "No localizado";

  function addHistory(visit, status, note) {
    visit.history.push({
      date: L.todayStr(),
      ts: Date.now(),
      status,
      note: note || ""
    });
    visit.lastVisit = new Date().toLocaleString("es-MX");
  }

  /* ---------- Avisos (toast con deshacer) ---------- */

  let toastTimer = null;

  function toast(message, action) {
    const el = $("toast");
    el.innerHTML = "";

    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);

    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-btn";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        el.hidden = true;
        action.run();
      });
      el.appendChild(btn);
    }

    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3500);
  }

  /** Revierte un registro a como estaba antes de un cambio. */
  function undoVisit(snapshot) {
    const index = visits.findIndex((v) => v.id === snapshot.id);
    commit(() => {
      if (index >= 0) visits[index] = snapshot;
      else visits.unshift(snapshot);
    });
    renderAll();
  }

  /* ---------- Navegación ---------- */

  function showView(name) {
    document.querySelectorAll(".view").forEach((el) => {
      el.hidden = el.id !== "view-" + name;
    });
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === name);
    });
    window.scrollTo(0, 0);
  }

  document.querySelector(".tabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) showView(tab.dataset.view);
  });

  document.addEventListener("click", (event) => {
    const go = event.target.closest("[data-view-go]");
    if (go) showView(go.dataset.viewGo);
  });

  /* =========================================
     RUTA DEL DÍA
  ========================================= */

  function routeVisits() {
    return visits
      .filter((v) => v.plannedDate === routeDate)
      .sort((a, b) => a.order - b.order || a.createdDate.localeCompare(b.createdDate));
  }

  function chips(v) {
    const parts = [];
    if (v.zone) parts.push(`<span class="chip">${escapeHTML(v.zone)}</span>`);
    if (v.window !== "Cualquier hora") parts.push(`<span class="chip">${escapeHTML(v.window)}</span>`);
    if (v.priority === "Alta") parts.push('<span class="chip chip-high">Prioridad alta</span>');
    if (v.priority === "Baja") parts.push('<span class="chip chip-low">Prioridad baja</span>');
    if (L.hasCoords(v)) parts.push('<span class="chip chip-ok">Ubicación exacta</span>');
    return parts.length ? `<div class="chips">${parts.join("")}</div>` : "";
  }

  function contactLinks(v) {
    const tel = L.telHref(v.phone);
    const wa = L.whatsappHref(v.phone);
    let html = "";
    if (tel) html += `<a class="action-link" href="${escapeHTML(tel)}">Llamar</a>`;
    if (wa) html += `<a class="action-link" href="${escapeHTML(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`;
    return html;
  }

  function directionsLink(v, label) {
    const url = L.mapsDirectionsUrl(v, settings.travelMode);
    return `<a class="action-link primary" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${label || "Cómo llegar"}</a>`;
  }

  function stopCard(v, position, total) {
    const closed = isClosed(v);
    const index = position + 1;

    const moveButtons = closed ? "" : `
      <div class="move-buttons">
        <button type="button" class="icon-btn" data-action="up" data-id="${escapeHTML(v.id)}"
          aria-label="Subir parada" ${position === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="icon-btn" data-action="down" data-id="${escapeHTML(v.id)}"
          aria-label="Bajar parada" ${position === total - 1 ? "disabled" : ""}>▼</button>
      </div>`;

    const quick = closed ? `
      <div class="stop-actions">
        <span class="state-pill ${statusClass(v.status)}">${escapeHTML(v.status)}</span>
        <button type="button" class="small ghost" data-action="reopen" data-id="${escapeHTML(v.id)}">Reabrir</button>
      </div>` : `
      <div class="stop-actions">
        ${directionsLink(v)}
        ${contactLinks(v)}
      </div>
      <div class="quick-row">
        <button type="button" class="small ok" data-action="done" data-id="${escapeHTML(v.id)}">Visitado</button>
        <button type="button" class="small warn" data-action="notfound" data-id="${escapeHTML(v.id)}">No localizado</button>
        <button type="button" class="small ghost" data-action="reschedule" data-id="${escapeHTML(v.id)}">Reprogramar</button>
      </div>`;

    return `
      <article class="stop-card ${statusClass(v.status)} ${closed ? "is-closed" : ""}">
        <div class="stop-head">
          <span class="stop-number">${index}</span>
          <div class="stop-title">
            <h3>${escapeHTML(v.person)}</h3>
            <p class="address">${escapeHTML(v.address)}</p>
          </div>
          ${moveButtons}
        </div>
        ${chips(v)}
        ${v.notes ? `<p class="note">${escapeHTML(v.notes)}</p>` : ""}
        ${quick}
        <button type="button" class="link-btn" data-action="remove-route" data-id="${escapeHTML(v.id)}">Quitar de esta ruta</button>
      </article>`;
  }

  function renderRoute() {
    $("route-date").value = routeDate;
    $("travel-mode").value = settings.travelMode;

    const list = routeVisits();
    const open = list.filter((v) => !isClosed(v));
    const done = list.filter((v) => v.status === "Visitado");
    const stats = L.dayStats(visits, routeDate);

    $("stat-stops").textContent = list.length;
    $("stat-pending").textContent = open.length;
    $("stat-done").textContent = done.length;
    $("stat-eff").textContent = stats.effectiveness === null ? "–" : stats.effectiveness + "%";

    // Resumen de la ruta
    const zones = new Set(open.map((v) => v.zone).filter(Boolean));
    const km = L.routeDistanceKm(open);
    const meta = [formatLongDay(routeDate)];
    if (zones.size) meta.push(zones.size + (zones.size === 1 ? " zona" : " zonas"));
    if (km > 0) meta.push("≈ " + km.toFixed(1) + " km en línea recta");
    $("route-meta").textContent = meta.join(" · ");

    // Siguiente parada
    const next = open[0];
    $("next-stop-panel").hidden = !next;
    if (next) {
      $("next-stop").innerHTML = `
        <h3 class="next-name">${escapeHTML(next.person)}</h3>
        <p class="address">${escapeHTML(next.address)}</p>
        ${chips(next)}
        <div class="stop-actions">
          ${directionsLink(next, "Cómo llegar a esta parada")}
          ${contactLinks(next)}
        </div>
        <div class="quick-row">
          <button type="button" class="small ok" data-action="done" data-id="${escapeHTML(next.id)}">Visitado</button>
          <button type="button" class="small warn" data-action="notfound" data-id="${escapeHTML(next.id)}">No localizado</button>
          <button type="button" class="small ghost" data-action="reschedule" data-id="${escapeHTML(next.id)}">Reprogramar</button>
        </div>`;
    }

    // Enlaces de ruta completa
    const linksBox = $("full-route-links");
    linksBox.innerHTML = "";
    if (settings.travelMode !== "transit" && open.length >= 2) {
      const routes = L.mapsMultiStopUrls(open, settings.travelMode, 8);
      linksBox.innerHTML = routes.map((r) => `
        <a class="action-link" href="${escapeHTML(r.url)}" target="_blank" rel="noopener noreferrer">
          Abrir en Maps: paradas ${r.from}–${r.to}
        </a>`).join("");
    }

    // Consejos
    let hint = "";
    if (settings.travelMode === "transit") {
      hint = "En transporte público Google Maps no arma una ruta con varias paradas: usa «Cómo llegar» en cada parada, en el orden de la lista.";
    }
    const missing = open.filter((v) => !L.hasCoords(v)).length;
    if (open.length > 1 && missing > 0) {
      hint += (hint ? " " : "") +
        `A ${missing} ${missing === 1 ? "parada le falta" : "paradas les falta"} la ubicación exacta; sin ella el orden usa horario, prioridad y zona.`;
    }
    $("route-hint").textContent = hint;
    $("optimize-route").disabled = open.length < 2;

    // Lista
    $("route-list").innerHTML = list.length
      ? list.map((v, i) => stopCard(v, i, list.length)).join("")
      : '<p class="empty-message">No hay paradas para este día. Agrega domicilios desde abajo o desde «Domicilios».</p>';

    renderOverdue();
    renderUnscheduled();
  }

  function renderOverdue() {
    const today = L.todayStr();
    const overdue = visits
      .filter((v) => v.plannedDate && v.plannedDate < today && !isClosed(v))
      .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));

    $("overdue-panel").hidden = overdue.length === 0;
    $("overdue-list").innerHTML = overdue.map((v) => `
      <div class="mini-row">
        <div>
          <strong>${escapeHTML(v.person)}</strong>
          <span class="muted">${escapeHTML(v.zone || v.address)} · desde ${L.formatDate(v.plannedDate)}</span>
        </div>
        <button type="button" class="small" data-action="add-route" data-id="${escapeHTML(v.id)}">Mover</button>
      </div>`).join("");
    $("overdue-all").textContent = "Mover todas a la ruta del " + L.formatDate(routeDate);
  }

  function renderUnscheduled() {
    const pending = visits
      .filter((v) => v.status === "Pendiente" && !v.plannedDate)
      .sort((a, b) => a.zone.localeCompare(b.zone, "es") || a.person.localeCompare(b.person, "es"));

    $("unscheduled-panel").hidden = pending.length === 0;

    const shown = pending.slice(0, 10);
    $("unscheduled-hint").textContent = pending.length > shown.length
      ? `Hay ${pending.length}; se muestran 10 ordenados por zona. El resto está en «Domicilios».`
      : `${pending.length} por programar. Agrégalos a la ruta del ${L.formatDate(routeDate)}.`;

    $("unscheduled-list").innerHTML = shown.map((v) => `
      <div class="mini-row">
        <div>
          <strong>${escapeHTML(v.person)}</strong>
          <span class="muted">${escapeHTML(v.zone || v.address)}</span>
        </div>
        <button type="button" class="small" data-action="add-route" data-id="${escapeHTML(v.id)}">Agregar</button>
      </div>`).join("");
  }

  /* ----- Controles de fecha ----- */

  function setRouteDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return;
    routeDate = date;
    renderRoute();
    renderList();
  }

  $("route-date").addEventListener("change", (e) => setRouteDate(e.target.value));
  $("route-prev").addEventListener("click", () => setRouteDate(L.addDays(routeDate, -1)));
  $("route-next").addEventListener("click", () => setRouteDate(L.addDays(routeDate, 1)));
  $("route-today").addEventListener("click", () => setRouteDate(L.todayStr()));

  $("travel-mode").addEventListener("change", (e) => {
    settings.travelMode = e.target.value;
    saveSettings();
    renderRoute();
    renderList();
  });

  /* ----- Ordenar ruta ----- */

  function getPosition(timeout) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: timeout || 5000, maximumAge: 120000 }
      );
    });
  }

  $("optimize-route").addEventListener("click", async () => {
    const list = routeVisits();
    const open = list.filter((v) => !isClosed(v));
    const closed = list.filter(isClosed);
    if (open.length < 2) return;

    const anyCoords = open.some(L.hasCoords);
    const start = anyCoords ? await getPosition(5000) : null;
    const result = L.orderRoute(open, start);

    const previousOrder = JSON.stringify(visits);
    const ok = commit(() => {
      result.ordered.concat(closed).forEach((v, i) => {
        const target = visits.find((x) => x.id === v.id);
        target.order = i + 1;
        touch(target);
      });
    });
    if (!ok) return;

    renderAll();

    const km = L.routeDistanceKm(result.ordered, start);
    let msg = "Ruta ordenada.";
    if (result.usedCoords > 1) msg += ` ${result.usedCoords} paradas por cercanía`;
    if (km > 0) msg += ` (≈ ${km.toFixed(1)} km en línea recta)`;
    if (result.withoutCoords > 0) msg += `. ${result.withoutCoords} sin ubicación exacta quedaron por horario y zona`;
    toast(msg, {
      label: "Deshacer",
      run: () => {
        visits = JSON.parse(previousOrder);
        saveData(STORAGE_VISITS, visits);
        renderAll();
      }
    });
  });

  /* ----- Mover paradas ----- */

  function moveStop(id, direction) {
    const list = routeVisits();
    const index = list.findIndex((v) => v.id === id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= list.length) return;
    if (isClosed(list[swapWith])) return;

    commit(() => {
      const arranged = list.slice();
      [arranged[index], arranged[swapWith]] = [arranged[swapWith], arranged[index]];
      arranged.forEach((v, i) => {
        const target = visits.find((x) => x.id === v.id);
        target.order = i + 1;
        touch(target);
      });
    });
    renderRoute();
  }

  /* =========================================
     CAMBIO DE ESTADO
  ========================================= */

  function applyStatus(id, status, options) {
    const visit = visits.find((v) => v.id === id);
    if (!visit) return;
    const snapshot = JSON.parse(JSON.stringify(visit));
    const opts = options || {};

    const ok = commit(() => {
      const target = visits.find((v) => v.id === id);
      target.status = status;
      addHistory(target, status, opts.note);

      if (opts.date !== undefined && (status === "Reprogramado" || status === "Seguimiento" || status === "Pendiente")) {
        if (opts.date && opts.date !== target.plannedDate) {
          target.plannedDate = opts.date;
          target.order = nextOrder(opts.date);
        } else if (!opts.date && status === "Pendiente") {
          target.plannedDate = "";
        }
      }
      touch(target);
    });
    if (!ok) return;

    renderAll();
    toast(`${visit.person}: ${status}`, { label: "Deshacer", run: () => undoVisit(snapshot) });
  }

  function reopenVisit(id) {
    const visit = visits.find((v) => v.id === id);
    if (!visit) return;
    const snapshot = JSON.parse(JSON.stringify(visit));
    const ok = commit(() => {
      const target = visits.find((v) => v.id === id);
      target.status = "Pendiente";
      addHistory(target, "Pendiente", "Reabierta");
      touch(target);
    });
    if (ok) {
      renderAll();
      toast(`${visit.person}: reabierta`, { label: "Deshacer", run: () => undoVisit(snapshot) });
    }
  }

  /* ----- Diálogo ----- */

  const dialog = $("status-dialog");
  const dialogStatus = $("dialog-status");

  dialogStatus.innerHTML = L.STATUSES
    .map((s) => `<option value="${s}">${s}</option>`)
    .join("");

  function defaultDateFor(status) {
    if (status === "Reprogramado") return L.addDays(L.todayStr(), 1);
    if (status === "Seguimiento") return L.addDays(L.todayStr(), 7);
    return "";
  }

  function syncDialogFields() {
    const status = dialogStatus.value;
    const needsDate = status === "Reprogramado" || status === "Seguimiento" || status === "Pendiente";
    $("dialog-date-wrap").hidden = !needsDate;
    $("dialog-date-label").textContent =
      status === "Reprogramado" ? "Nueva fecha de visita" :
      status === "Seguimiento" ? "Fecha de seguimiento" :
      "Fecha programada (opcional)";
    if (needsDate && !$("dialog-date").value) {
      $("dialog-date").value = defaultDateFor(status);
    }
  }

  function openStatusDialog(id, preset) {
    const visit = visits.find((v) => v.id === id);
    if (!visit || typeof dialog.showModal !== "function") return;

    dialogVisitId = id;
    $("dialog-person").textContent = visit.person + " · " + visit.address;
    dialogStatus.value = preset || visit.status;
    // Reprogramar/Seguimiento proponen una fecha futura; Pendiente conserva la actual
    $("dialog-date").value = defaultDateFor(dialogStatus.value) ||
      (visit.plannedDate && !isClosed(visit) ? visit.plannedDate : "");
    $("dialog-note").value = "";
    syncDialogFields();
    dialog.showModal();
  }

  dialogStatus.addEventListener("change", () => {
    $("dialog-date").value = defaultDateFor(dialogStatus.value);
    syncDialogFields();
  });

  $("status-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const status = dialogStatus.value;
    const date = $("dialog-date-wrap").hidden ? undefined : $("dialog-date").value;

    if ((status === "Reprogramado" || status === "Seguimiento") && !date) {
      toast("Elige una fecha.");
      return;
    }

    const id = dialogVisitId;
    dialogVisitId = null;
    dialog.close();
    applyStatus(id, status, { date, note: $("dialog-note").value.trim() });
  });

  $("dialog-cancel").addEventListener("click", () => {
    dialogVisitId = null;
    dialog.close();
    renderList();
  });

  dialog.addEventListener("cancel", () => {
    dialogVisitId = null;
    renderList();
  });

  /* =========================================
     DOMICILIOS
  ========================================= */

  const form = $("visit-form");
  const visitsList = $("visits-list");

  function zonesList() {
    return [...new Set(visits.map((v) => v.zone).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"));
  }

  function renderZones() {
    const zones = zonesList();
    $("zone-options").innerHTML = zones.map((z) => `<option value="${escapeHTML(z)}">`).join("");

    const select = $("filter-zone");
    const current = select.value;
    select.innerHTML = '<option value="Todas">Todas</option>' +
      zones.map((z) => `<option value="${escapeHTML(z)}">${escapeHTML(z)}</option>`).join("");
    select.value = zones.includes(current) ? current : "Todas";
  }

  function matchesSearch(v, query) {
    if (!query) return true;
    const haystack = [v.person, v.address, v.zone, v.phone, v.notes]
      .join(" ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    return query.split(/\s+/).every((word) => haystack.includes(word));
  }

  function visitCard(v) {
    const options = L.STATUSES.map((s) =>
      `<option value="${s}" ${v.status === s ? "selected" : ""}>${s}</option>`).join("");

    const onRoute = v.plannedDate === routeDate;
    const dateInfo = v.plannedDate
      ? `Programada: ${L.formatDate(v.plannedDate)}`
      : (isClosed(v) ? "" : "Sin fecha programada");

    const visitedCount = v.history.filter((h) => h.status === "Visitado").length;

    const history = v.history.length ? `
      <details class="history">
        <summary>Historial (${v.history.length})</summary>
        <ul>
          ${v.history.slice().reverse().map((h) => `
            <li><strong>${L.formatDate(h.date)}</strong> · ${escapeHTML(h.status)}${h.note ? " — " + escapeHTML(h.note) : ""}</li>
          `).join("")}
        </ul>
      </details>` : "";

    return `
      <article class="visit-card ${statusClass(v.status)}">
        <h3>${escapeHTML(v.person)}</h3>
        ${chips(v)}

        <p><strong>Domicilio:</strong> ${escapeHTML(v.address)}</p>
        ${v.phone ? `<p><strong>Teléfono:</strong> ${escapeHTML(v.phone)}</p>` : ""}
        <p><strong>Estado:</strong> ${escapeHTML(v.status)}${dateInfo ? " · " + dateInfo : ""}</p>
        <p><strong>Registrado:</strong> ${L.formatDate(v.createdDate)}${visitedCount ? ` · ${visitedCount} ${visitedCount === 1 ? "visita realizada" : "visitas realizadas"}` : ""}</p>
        ${v.notes ? `<p><strong>Observaciones:</strong> ${escapeHTML(v.notes)}</p>` : ""}
        ${v.lastVisit ? `<p><strong>Último cambio:</strong> ${escapeHTML(v.lastVisit)}</p>` : ""}

        <label>Actualizar estado</label>
        <select class="change-status" data-id="${escapeHTML(v.id)}">${options}</select>

        <div class="stop-actions">
          ${directionsLink(v)}
          ${contactLinks(v)}
          <a class="action-link" href="${escapeHTML(L.mapsSearchUrl(v))}" target="_blank" rel="noopener noreferrer">Ver en mapa</a>
        </div>

        ${history}

        <div class="quick-row">
          ${onRoute
            ? '<span class="state-pill status-seguimiento">En la ruta de este día</span>'
            : `<button type="button" class="small" data-action="add-route" data-id="${escapeHTML(v.id)}">Agregar a la ruta del ${L.formatDate(routeDate)}</button>`}
          <button type="button" class="small ghost" data-action="edit" data-id="${escapeHTML(v.id)}">Editar</button>
        </div>

        <button type="button" class="delete-visit" data-action="delete" data-id="${escapeHTML(v.id)}">
          Eliminar domicilio
        </button>
      </article>`;
  }

  function renderList() {
    const status = $("filter-status").value;
    const zone = $("filter-zone").value;
    const query = $("search").value.trim().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "");

    const filtered = visits.filter((v) =>
      (status === "Todas" || v.status === status) &&
      (zone === "Todas" || v.zone === zone) &&
      matchesSearch(v, query)
    );

    $("list-count").textContent = visits.length
      ? `${filtered.length} de ${visits.length} domicilios`
      : "";

    if (!filtered.length) {
      visitsList.innerHTML = `<p class="empty-message">${
        visits.length ? "Ningún domicilio coincide con el filtro." : "Todavía no tienes domicilios registrados."
      }</p>`;
      return;
    }

    visitsList.innerHTML = filtered.map(visitCard).join("");
  }

  $("filter-status").addEventListener("change", renderList);
  $("filter-zone").addEventListener("change", renderList);
  $("search").addEventListener("input", renderList);

  /* ----- Formulario ----- */

  function coordsToText(v) {
    return L.hasCoords(v) ? `${v.lat.toFixed(6)}, ${v.lng.toFixed(6)}` : "";
  }

  function resetForm() {
    form.reset();
    editingId = null;
    $("visit-id").value = "";
    $("form-title").textContent = "Registrar domicilio";
    $("save-visit").textContent = "Guardar domicilio";
    $("cancel-edit").hidden = true;
    $("status").disabled = false;
    $("planned-date").value = routeDate;
    $("coords-hint").textContent = "Con la ubicación exacta la ruta se ordena por cercanía.";
  }

  function startEdit(id) {
    const v = visits.find((x) => x.id === id);
    if (!v) return;

    editingId = id;
    $("visit-id").value = id;
    $("person").value = v.person;
    $("address").value = v.address;
    $("zone").value = v.zone;
    $("phone").value = v.phone;
    $("planned-date").value = v.plannedDate;
    $("priority").value = v.priority;
    $("window").value = v.window;
    $("coords").value = coordsToText(v);
    $("status").value = v.status;
    $("status").disabled = true;
    $("notes").value = v.notes;

    $("form-title").textContent = "Editar domicilio";
    $("save-visit").textContent = "Guardar cambios";
    $("cancel-edit").hidden = false;
    $("coords-hint").textContent = "El estado se cambia desde la tarjeta del domicilio, para guardar el historial.";

    showView("domicilios");
    $("form-title").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("cancel-edit").addEventListener("click", resetForm);

  $("use-location").addEventListener("click", async () => {
    const btn = $("use-location");
    btn.disabled = true;
    btn.textContent = "Buscando ubicación…";
    const pos = await getPosition(12000);
    btn.disabled = false;
    btn.textContent = "Usar mi ubicación actual";

    if (!pos) {
      toast("No pude obtener tu ubicación. Revisa el permiso del navegador.");
      return;
    }
    $("coords").value = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;
    toast("Ubicación guardada en el formulario.");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const person = $("person").value.trim();
    const address = $("address").value.trim();
    const coordsText = $("coords").value.trim();

    if (!person || !address) {
      toast("Escribe el nombre y el domicilio.");
      return;
    }

    let coords = null;
    if (coordsText) {
      coords = L.parseCoords(coordsText);
      if (!coords) {
        toast(/goo\.gl|maps\.app/i.test(coordsText)
          ? "Los enlaces cortos de Maps no traen coordenadas. Abre el enlace y copia el largo, o usa tu ubicación."
          : "No pude leer la ubicación. Usa «19.4326, -99.1332» o un enlace largo de Google Maps.");
        return;
      }
    }

    const fields = {
      person,
      address,
      zone: $("zone").value.trim(),
      phone: $("phone").value.trim(),
      plannedDate: $("planned-date").value,
      priority: $("priority").value,
      window: $("window").value,
      notes: $("notes").value.trim(),
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null
    };

    if (editingId) {
      const ok = commit(() => {
        const target = visits.find((v) => v.id === editingId);
        const dateChanged = fields.plannedDate !== target.plannedDate;
        Object.assign(target, fields);
        if (dateChanged && fields.plannedDate) target.order = nextOrder(fields.plannedDate);
        touch(target);
      });
      if (!ok) return;
      resetForm();
      renderAll();
      toast("Cambios guardados.");
      return;
    }

    const visit = L.normalizeVisit(Object.assign({}, fields, {
      id: L.newId(),
      status: $("status").value,
      createdDate: L.todayStr(),
      order: fields.plannedDate ? nextOrder(fields.plannedDate) : 0,
      updatedAt: Date.now()
    }));

    if (visit.status !== "Pendiente") addHistory(visit, visit.status, "Registrada con este estado");

    const ok = commit(() => { visits.unshift(visit); });
    if (!ok) return;

    resetForm();
    $("filter-status").value = "Todas";
    $("filter-zone").value = "Todas";
    $("search").value = "";
    renderAll();
    toast("Domicilio guardado.", { label: "Deshacer", run: () => {
      commit(() => { visits = visits.filter((v) => v.id !== visit.id); });
      renderAll();
    }});
  });

  /* ----- Acciones de tarjetas (delegación) ----- */

  visitsList.addEventListener("change", (event) => {
    if (!event.target.classList.contains("change-status")) return;
    openStatusDialog(event.target.dataset.id, event.target.value);
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;

    const id = btn.dataset.id;
    const visit = visits.find((v) => v.id === id);
    if (!visit) return;

    switch (btn.dataset.action) {
      case "done":
        applyStatus(id, "Visitado");
        break;
      case "notfound":
        applyStatus(id, "No localizado");
        break;
      case "reschedule":
        openStatusDialog(id, "Reprogramado");
        break;
      case "reopen":
        reopenVisit(id);
        break;
      case "up":
        moveStop(id, -1);
        break;
      case "down":
        moveStop(id, 1);
        break;
      case "remove-route": {
        const snapshot = JSON.parse(JSON.stringify(visit));
        if (commit(() => {
          const t = visits.find((v) => v.id === id);
          t.plannedDate = "";
          t.order = 0;
          touch(t);
        })) {
          renderAll();
          toast(`${visit.person}: quitada de la ruta`, { label: "Deshacer", run: () => undoVisit(snapshot) });
        }
        break;
      }
      case "add-route": {
        const snapshot = JSON.parse(JSON.stringify(visit));
        if (commit(() => {
          const t = visits.find((v) => v.id === id);
          t.plannedDate = routeDate;
          t.order = nextOrder(routeDate);
          touch(t);
        })) {
          renderAll();
          toast(`${visit.person}: agregada a la ruta del ${L.formatDate(routeDate)}`, { label: "Deshacer", run: () => undoVisit(snapshot) });
        }
        break;
      }
      case "edit":
        startEdit(id);
        break;
      case "delete": {
        if (!confirm(`¿Eliminar el domicilio de ${visit.person}?`)) return;
        const snapshot = JSON.parse(JSON.stringify(visit));
        if (commit(() => { visits = visits.filter((v) => v.id !== id); })) {
          renderAll();
          toast("Domicilio eliminado.", { label: "Deshacer", run: () => undoVisit(snapshot) });
        }
        break;
      }
    }
  });

  $("overdue-all").addEventListener("click", () => {
    const today = L.todayStr();
    const ids = visits
      .filter((v) => v.plannedDate && v.plannedDate < today && !isClosed(v))
      .map((v) => v.id);
    if (!ids.length) return;

    const before = JSON.stringify(visits);
    const ok = commit(() => {
      ids.forEach((id) => {
        const t = visits.find((v) => v.id === id);
        t.plannedDate = routeDate;
        t.order = nextOrder(routeDate);
        touch(t);
      });
    });
    if (!ok) return;
    renderAll();
    toast(`${ids.length} visitas movidas a la ruta del ${L.formatDate(routeDate)}`, {
      label: "Deshacer",
      run: () => {
        visits = JSON.parse(before);
        saveData(STORAGE_VISITS, visits);
        renderAll();
      }
    });
  });

  /* =========================================
     GASTOS
  ========================================= */

  const expenseDate = $("expense-date");
  const expenseInput = $("transport-cost");

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function renderExpenses() {
    const date = expenseDate.value || L.todayStr();
    const amount = expenses[date] || 0;

    $("expense-summary").textContent =
      `Gasto registrado el ${L.formatDate(date)}: ${formatMoney(amount)}`;

    const today = L.todayStr();
    const monday = L.weekStart(today);
    const sunday = L.addDays(monday, 6);
    const week = L.sumRange(expenses, monday, sunday);
    const month = L.monthRange(today);
    const monthTotal = L.sumRange(expenses, month.from, month.to);
    const weekVisits = L.countVisitedInRange(visits, monday, sunday);

    $("exp-week").textContent = formatMoneyShort(week);
    $("exp-month").textContent = formatMoneyShort(monthTotal);
    $("exp-visits").textContent = weekVisits;
    $("exp-per-visit").textContent = weekVisits && week ? formatMoney(week / weekVisits) : "–";

    const rows = [];
    for (let i = 0; i < 14; i++) {
      const d = L.addDays(today, -i);
      const spent = Number(expenses[d]) || 0;
      const stats = L.dayStats(visits, d);
      if (spent || stats.visited) rows.push({ d, spent, visited: stats.visited });
    }

    $("expense-history").innerHTML = rows.length
      ? rows.map((r) => `
        <div class="mini-row">
          <div>
            <strong>${escapeHTML(formatDayLabel(r.d))}</strong>
            <span class="muted">${r.visited} ${r.visited === 1 ? "visita" : "visitas"}${r.visited && r.spent ? " · " + formatMoney(r.spent / r.visited) + " por visita" : ""}</span>
          </div>
          <strong>${formatMoney(r.spent)}</strong>
        </div>`).join("")
      : '<p class="empty-message">Aún no hay gastos en los últimos 14 días.</p>';
  }

  expenseDate.addEventListener("change", () => {
    expenseInput.value = "";
    renderExpenses();
  });

  function readAmount(allowZero) {
    const amount = Number(expenseInput.value);
    if (!expenseInput.value || !Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
      toast("Introduce un monto válido.");
      return null;
    }
    return amount;
  }

  function writeExpense(date, value, message) {
    const previous = Object.assign({}, expenses);
    expenses[date] = round2(value);
    if (!saveData(STORAGE_EXPENSES, expenses)) {
      expenses = previous;
      return;
    }
    expenseInput.value = "";
    renderExpenses();
    toast(message);
  }

  $("add-expense").addEventListener("click", () => {
    const amount = readAmount(false);
    if (amount === null) return;
    const date = expenseDate.value || L.todayStr();
    writeExpense(date, (Number(expenses[date]) || 0) + amount,
      `Sumado ${formatMoney(amount)}. Total del día: ${formatMoney((Number(expenses[date]) || 0) + amount)}`);
  });

  $("save-expense").addEventListener("click", () => {
    const amount = readAmount(true);
    if (amount === null) return;
    const date = expenseDate.value || L.todayStr();
    writeExpense(date, amount, "Total del día guardado.");
  });

  /* =========================================
     RESPALDO
  ========================================= */

  function renderBackup() {
    const last = settings.lastBackup;
    $("backup-status").textContent = last
      ? "Último respaldo: " + new Date(last).toLocaleString("es-MX")
      : "Todavía no has hecho ningún respaldo.";

    const stale = !last || Date.now() - last > BACKUP_REMINDER_DAYS * 86400000;
    const show = visits.length > 0 && stale;
    $("backup-banner").hidden = !show;
    if (show) {
      $("backup-banner-text").textContent = last
        ? `Hace más de ${BACKUP_REMINDER_DAYS} días que no haces respaldo.`
        : "Aún no tienes respaldo de tus domicilios.";
    }
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function backupPayload() {
    return JSON.stringify({
      app: "rutavisita",
      version: 2,
      exportedAt: new Date().toISOString(),
      visits,
      expenses,
      settings: { travelMode: settings.travelMode }
    }, null, 2);
  }

  function markBackup() {
    settings.lastBackup = Date.now();
    saveSettings();
    renderBackup();
  }

  const stamp = () => L.todayStr();

  $("export-json").addEventListener("click", () => {
    download(backupPayload(), `rutavisita-respaldo-${stamp()}.json`, "application/json");
    markBackup();
    toast("Respaldo descargado.");
  });

  $("share-json").addEventListener("click", async () => {
    const file = new File([backupPayload()], `rutavisita-respaldo-${stamp()}.json`, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Respaldo RutaVisita" });
        markBackup();
      } catch (error) {
        if (error && error.name !== "AbortError") toast("No se pudo compartir el archivo.");
      }
    } else {
      toast("Tu navegador no permite compartir archivos. Usa «Descargar respaldo».");
    }
  });

  $("export-visits-csv").addEventListener("click", () => {
    const csv = L.toCSV(visits, [
      { label: "Nombre", get: (v) => v.person },
      { label: "Domicilio", get: (v) => v.address },
      { label: "Zona", get: (v) => v.zone },
      { label: "Teléfono", get: (v) => L.phoneDigits(v.phone) },
      { label: "Estado", get: (v) => v.status },
      { label: "Fecha programada", get: (v) => v.plannedDate },
      { label: "Horario", get: (v) => v.window },
      { label: "Prioridad", get: (v) => v.priority },
      { label: "Latitud", get: (v) => v.lat },
      { label: "Longitud", get: (v) => v.lng },
      { label: "Visitas realizadas", get: (v) => v.history.filter((h) => h.status === "Visitado").length },
      { label: "Observaciones", get: (v) => v.notes },
      { label: "Registrado", get: (v) => v.createdDate },
      { label: "Último cambio", get: (v) => v.lastVisit }
    ]);
    download(csv, `rutavisita-domicilios-${stamp()}.csv`, "text/csv;charset=utf-8");
  });

  $("export-expenses-csv").addEventListener("click", () => {
    const dates = Object.keys(expenses).sort();
    const csv = L.toCSV(dates, [
      { label: "Fecha", get: (d) => d },
      { label: "Gasto de transporte (MXN)", get: (d) => Number(expenses[d]) || 0 },
      { label: "Visitas realizadas", get: (d) => L.dayStats(visits, d).visited }
    ]);
    download(csv, `rutavisita-gastos-${stamp()}.csv`, "text/csv;charset=utf-8");
  });

  $("import-file").addEventListener("change", async (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Archivo demasiado grande");

      const data = JSON.parse(await file.text());
      if (!data || data.app !== "rutavisita" || !Array.isArray(data.visits)) {
        throw new Error("Formato no reconocido");
      }

      const replace = $("import-mode").value === "replace";
      const message = replace
        ? `Se reemplazarán TODOS tus datos actuales por los del respaldo (${data.visits.length} domicilios). ¿Continuar?`
        : `Se combinarán ${data.visits.length} domicilios del respaldo con los tuyos. ¿Continuar?`;
      if (!confirm(message)) return;

      const before = { visits: JSON.stringify(visits), expenses: JSON.stringify(expenses) };
      let summary;

      if (replace) {
        visits = data.visits.map(L.normalizeVisit);
        expenses = L.mergeExpenses({}, data.expenses, true);
        summary = `${visits.length} domicilios restaurados.`;
      } else {
        const merged = L.mergeVisits(visits, data.visits);
        visits = merged.visits;
        expenses = L.mergeExpenses(expenses, data.expenses, false);
        summary = `${merged.added} nuevos, ${merged.updated} actualizados.`;
      }

      if (!saveData(STORAGE_VISITS, visits) || !saveData(STORAGE_EXPENSES, expenses)) {
        visits = JSON.parse(before.visits);
        expenses = JSON.parse(before.expenses);
        return;
      }

      renderAll();
      toast("Respaldo restaurado. " + summary);
    } catch (error) {
      console.error(error);
      toast("No se pudo leer el respaldo: " + error.message);
    } finally {
      input.value = "";
    }
  });

  /* =========================================
     INICIO
  ========================================= */

  function renderAll() {
    renderZones();
    renderRoute();
    renderList();
    renderExpenses();
    renderBackup();
  }

  expenseDate.value = L.todayStr();
  resetForm();
  renderAll();

  // Pide al navegador que no borre los datos si hay poco espacio
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
})();
