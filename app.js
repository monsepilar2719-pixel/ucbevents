// =====================================================================
// APP: mapa, rutas, eventos, horario, avisos, roles y administración.
// Todo se guarda en el navegador (localStorage): es un prototipo sin servidor.
// =====================================================================
(function () {
  const D = window.DATOS;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nodoPorId = id => D.nodos.find(n => n.id === id);
  const ORG_DEMO = "Mecacentro UCB";            // identidad del organizador de la demo
  const AFORO_VENCE_MS = 2 * 3600e3;            // el aforo vence a las 2 h sin actualizar
  const ESPERA_AVISO_MS = 60e3;                 // anti-spam por evento (producción: 30 min)
  const MARGEN_CLASE_S = 180;                   // llegar 3 min antes a clase

  // ---------------- Almacenamiento ----------------
  const leer = (k, def) => { try { const v = JSON.parse(localStorage.getItem("ucb_" + k)); return v == null ? def : v; } catch (e) { return def; } };
  const guardar = (k, v) => { try { localStorage.setItem("ucb_" + k, JSON.stringify(v)); } catch (e) {} };

  const ROLES = {
    visitante:   { nombre: "Visitante",     cuenta: false },
    estudiante:  { nombre: "Estudiante",    cuenta: true },
    organizador: { nombre: "Organizador",   cuenta: true },
    admin:       { nombre: "Administrador", cuenta: true },
  };
  let rol = leer("rol", "visitante");
  const tieneCuenta = () => ROLES[rol].cuenta;
  const puedeGestionar = ev => rol === "admin" || (rol === "organizador" && ev.organizador === ORG_DEMO);

  // Aristas cerradas por el administrador (por grupo: "Ascensor Bloque D", etc.)
  const grupoArista = ar => ar.nombre || (nodoPorId(ar.a).nombre + " ↔ " + nodoPorId(ar.b).nombre + " (" + ar.tipo + ")");
  function cerradas() {
    const g = new Set(leer("cerrados", []));
    return new Set(D.aristas.map((ar, i) => g.has(grupoArista(ar)) ? i : -1).filter(i => i >= 0));
  }
  const opcionesRuta = () => ({ cerradas: cerradas() });

  // ---------------- Eventos ----------------
  function todosLosEventos() {
    const aforos = leer("aforos", {});
    return D.eventos.map(e => Object.assign({ estado: "aprobado" }, e)).concat(leer("eventos_extra", []))
      .map(ev => {
        // Si el evento registra asistencia y tiene capacidad, el aforo se calcula solo
        if (confAsistencia(ev.id).activa && ev.capacidad) {
          const n = asistentes(ev.id).length;
          return Object.assign({}, ev, { aforo_pct: Math.min(100, Math.round(n / ev.capacidad * 100)), aforo_t: Date.now(), aforo_auto: true });
        }
        const a = aforos[ev.id];
        if (!a) return Object.assign({}, ev, { aforo_t: ev.aforo_pct != null ? Date.now() : null });
        if (Date.now() - a.t < AFORO_VENCE_MS) return Object.assign({}, ev, { aforo_pct: a.pct, aforo_t: a.t });
        return Object.assign({}, ev, { aforo_pct: null, aforo_t: null });
      })
      .sort((x, y) => x.inicio.localeCompare(y.inicio));
  }
  // ---------------- Asistencia por QR ----------------
  // Cada evento puede activar el registro de asistencia. El QR que muestra el
  // organizador cambia cada 30 s (código de 4 dígitos derivado de un secreto),
  // así una foto del QR enviada por WhatsApp deja de servir al minuto.
  const VENTANA_QR_MS = 30e3;
  const confAsistencia = id => leer("conf_asistencia", {})[id] || { activa: false };
  function activarAsistencia(id, activa) {
    const c = leer("conf_asistencia", {});
    c[id] = { activa, secreto: (c[id] && c[id].secreto) || Math.random().toString(36).slice(2) + Date.now().toString(36) };
    guardar("conf_asistencia", c);
  }
  function codigoQR(secreto, ventana) {
    let h = 2166136261; const s = secreto + ":" + ventana;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return String((h >>> 0) % 10000).padStart(4, "0");
  }
  const ventanaActual = () => Math.floor(Date.now() / VENTANA_QR_MS);
  function codigoValido(id, codigo) {
    const c = confAsistencia(id);
    if (!c.activa || !c.secreto) return false;
    const v = ventanaActual();
    return [v, v - 1, v - 2].some(w => codigoQR(c.secreto, w) === String(codigo).trim()); // tolera ~1 min
  }
  const asistentes = id => leer("asistencias", {})[id] || [];
  function guardarAsistentes(id, lista) { const a = leer("asistencias", {}); a[id] = lista; guardar("asistencias", a); }
  const clavePersona = p => (p.codigo || p.nombre || "").toString().trim().toLowerCase();
  function yaAsistio(id) { const yo = perfil(); return !!yo && asistentes(id).some(x => clavePersona(x) === clavePersona(yo)); }

  // Perfil del usuario con cuenta (en producción viene del login institucional)
  const perfil = () => leer("perfil", null);

  function nivelAforo(pct) {
    if (pct == null) return { clase: "sd", texto: "Aforo sin dato" };
    if (pct >= 100) return { clase: "lleno", texto: "Lleno" };
    if (pct >= 80) return { clase: "alto", texto: pct + " % · casi lleno" };
    if (pct >= 50) return { clase: "medio", texto: pct + " % · se está llenando" };
    return { clase: "bajo", texto: pct + " % · hay lugar" };
  }

  // ---------------- Mapa ----------------
  const centro = D.nodos.reduce((acc, n) => [acc[0] + n.lat / D.nodos.length, acc[1] + n.lng / D.nodos.length], [0, 0]);
  const mapa = L.map("mapa", { zoomControl: false }).setView(centro, 18);
  L.control.zoom({ position: "bottomright" }).addTo(mapa);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20, maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);

  const ESTILO = {
    camino:   { color: "#8e8e8e", weight: 4 },
    rampa:    { color: "#2e9e57", weight: 5 },
    escalera: { color: "#d9442b", weight: 4, dashArray: "4 6" },
    ascensor: { color: "#8b4fd6", weight: 5 },
  };
  let capaCaminos = L.layerGroup().addTo(mapa);
  function dibujarCaminos() {
    capaCaminos.clearLayers();
    const c = cerradas();
    D.aristas.forEach((ar, i) => {
      const a = nodoPorId(ar.a), b = nodoPorId(ar.b);
      if (!a || !b || (a.lat === b.lat && a.lng === b.lng && ar.tipo !== "ascensor")) return;
      const cerrado = c.has(i);
      const estilo = cerrado ? { color: "#000", weight: 3, dashArray: "2 8", opacity: .6 } : (ESTILO[ar.tipo] || ESTILO.camino);
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], estilo)
        .bindTooltip((cerrado ? "⛔ CERRADO · " : "") + ar.tipo + (ar.metros ? " · " + ar.metros + " m" : "") + (ar.nota ? " · " + ar.nota : ""))
        .addTo(capaCaminos);
    });
  }
  const ICONO_NODO = { bano: "🚻", entrada: "🚪", sala: "★", aula: "▣" };
  D.nodos.forEach(n => {
    const html = n.tipo === "bano"
      ? '<div class="pin pin-bano">🚻</div>'
      : '<div class="pin pin-' + n.tipo + '"></div>';
    const icono = L.divIcon({ className: "", html, iconSize: n.tipo === "bano" ? [24, 24] : [14, 14], iconAnchor: n.tipo === "bano" ? [12, 12] : [7, 7] });
    L.marker([n.lat, n.lng], { icon: icono, zIndexOffset: n.piso * 10 }).addTo(mapa).bindPopup(
      "<b>" + esc(n.nombre) + "</b><br>" + (n.piso ? "Piso " + n.piso : "Planta baja") +
      (n.tipo === "bano" ? (n.accesible ? " · ♿ accesible" : " · no accesible") : "") +
      '<div class="pop-acc"><button data-desde="' + n.id + '">Salgo de aquí</button><button data-hasta="' + n.id + '">Ir aquí</button></div>'
    );
  });
  mapa.on("popupopen", e => {
    e.popup.getElement().querySelectorAll("button").forEach(btn => btn.onclick = () => {
      if (btn.dataset.desde) $("#sel-desde").value = btn.dataset.desde;
      if (btn.dataset.hasta) $("#sel-hasta").value = btn.dataset.hasta;
      mapa.closePopup();
      if ($("#sel-desde").value !== $("#sel-hasta").value) calcular();
    });
  });

  // ---------------- Pestañas ----------------
  function irA(tab) {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("activa", b.dataset.tab === tab));
    document.querySelectorAll(".vista").forEach(v => v.classList.toggle("oculto", v.id !== "vista-" + tab));
    if (tab === "avisos") { guardar("avisos_leidos", leer("avisos", []).length); pintarBadge(); }
  }
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => irA(b.dataset.tab));

  // ---------------- Selectores ----------------
  const ordenNodos = D.nodos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  function opcionesNodos(sel, filtro) {
    sel.innerHTML = ordenNodos.filter(filtro || (() => true))
      .map(n => '<option value="' + n.id + '">' + (n.tipo === "bano" ? "🚻 " : "") + esc(n.nombre) + "</option>").join("");
  }
  opcionesNodos($("#sel-desde"));
  opcionesNodos($("#sel-hasta"));
  opcionesNodos($("#ev-lugar"), n => n.tipo !== "bano");
  opcionesNodos($("#cl-aula"), n => n.tipo !== "bano");

  const modoActual = () => document.querySelector('input[name="modo"]:checked').value;
  const setModo = m => { const r = document.querySelector('input[name="modo"][value="' + m + '"]'); if (r) r.checked = true; };
  const modoPreferido = () => leer("siempre_accesible", false) ? "accesible" : "corta";

  // ---------------- Rutas ----------------
  let capaRuta = null;
  const fmtMin = s => Math.max(1, Math.round(s / 60)) + " min";

  function dibujarRuta(r) {
    if (capaRuta) { mapa.removeLayer(capaRuta); capaRuta = null; }
    if (!r || !r.ok) return;
    const coords = r.nodos.map(n => [n.lat, n.lng]);
    capaRuta = L.layerGroup([
      L.polyline(coords, { color: "#fff", weight: 11, opacity: .95 }),
      L.polyline(coords, { color: "#2f7bf6", weight: 6 }),
      L.circleMarker(coords[0], { radius: 8, color: "#fff", weight: 3, fillColor: "#2f7bf6", fillOpacity: 1 }),
      L.circleMarker(coords[coords.length - 1], { radius: 9, color: "#fff", weight: 3, fillColor: "#e8890c", fillOpacity: 1 }),
    ]).addTo(mapa);
    mapa.fitBounds(L.latLngBounds(coords).pad(0.4));
  }

  function pintarResultado(r, modo, extraHtml) {
    const out = $("#resultado");
    out.classList.remove("oculto");
    dibujarRuta(r);
    if (!r.ok) {
      out.innerHTML = '<div class="aviso ' + (r.mismoLugar ? "info" : "error") + '"><b>' + (modo === "accesible" && !r.mismoLugar ? "♿ " : "") + esc(r.motivo) + "</b>" + (extraHtml || "") + "</div>";
      return;
    }
    const dest = r.destino;
    out.innerHTML =
      '<div class="resumen">' + r.metros + " m · " + r.minutos + " min</div>" +
      '<div class="sub">Hasta <b>' + esc(dest.nombre) + "</b> · subida +" + r.subida_m + " m" +
      (r.bajada_m ? " · bajada −" + r.bajada_m + " m" : "") + "</div>" + (extraHtml || "") +
      "<ol>" + r.pasos.map(p => "<li><span>" + p.icono + "</span><span>" + esc(p.texto) + "</span></li>").join("") +
      "<li><span>🏁</span><span>Llegaste a " + esc(dest.nombre) + "</span></li></ol>";
  }

  function calcular() {
    const desde = $("#sel-desde").value, hasta = $("#sel-hasta").value, modo = modoActual();
    actualizarURL();
    irA("ruta");
    const r = Ruteo.ruta(D, desde, hasta, modo, opcionesRuta());
    let extra = "";
    if (!r.ok && modo === "accesible" && !r.mismoLugar) {
      const alt = Ruteo.ruta(D, desde, hasta, "corta", opcionesRuta());
      extra = "<br>" + (alt.ok ? "El único acceso disponible tiene gradas (" + alt.metros + " m, " + alt.minutos + " min). " : "") +
        "Recomendamos contactar al organizador para trasladar la actividad o coordinar asistencia.";
    } else if (r.ok && modo !== "accesible" && r.usaEscaleras) {
      const acc = Ruteo.ruta(D, desde, hasta, "accesible", opcionesRuta());
      extra = acc.ok
        ? '<div class="aviso info">♿ Esta ruta tiene gradas. Ruta sin gradas: ' + acc.metros + " m · " + acc.minutos + " min" +
          (acc.metros > r.metros ? " (+" + (acc.metros - r.metros) + " m)" : "") +
          ' <button class="sec chico" id="btn-ver-acc" type="button">Ver</button></div>'
        : '<div class="aviso error">♿ Este destino no tiene ruta sin gradas disponible.</div>';
    } else if (r.ok && modo === "accesible") {
      extra = '<div class="aviso ok">♿ Ruta sin gradas' + (r.usaAscensor ? ", usa ascensor" : "") + ".</div>";
    }
    pintarResultado(r, modo, extra);
    const b = $("#btn-ver-acc");
    if (b) b.onclick = () => { setModo("accesible"); calcular(); };
  }

  function banoMasCercano() {
    const modo = modoActual();
    const acc = modo === "accesible";
    const r = Ruteo.rutaAlMasCercano(D, $("#sel-desde").value, n => n.tipo === "bano" && (!acc || n.accesible), modo, opcionesRuta());
    irA("ruta");
    if (r.ok) $("#sel-hasta").value = r.destino.id;
    pintarResultado(r, modo, r.ok ? '<div class="aviso info">🚻 Baño más cercano' + (acc ? " accesible" : "") + "</div>" : "");
  }

  // ---------------- Eventos (vista) ----------------
  const fmtFecha = iso => new Date(iso).toLocaleString("es-BO", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtHora = t => new Date(t).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });

  function linkCalendar(titulo, inicio, fin, lugarId, recur) {
    const f = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "T" +
      String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + "00";
    const lugar = nodoPorId(lugarId);
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(titulo) +
      "&dates=" + f(inicio) + "/" + f(fin) + "&ctz=America/La_Paz" +
      "&location=" + encodeURIComponent((lugar ? lugar.nombre : "") + ", UCB La Paz") +
      "&details=" + encodeURIComponent("Cómo llegar: " + urlRuta(null, lugarId)) +
      (recur ? "&recur=" + encodeURIComponent(recur) : "");
  }

  function pintarEventos() {
    const seguidos = leer("seguidos", []);
    const ahoraCerr = opcionesRuta();
    const visibles = todosLosEventos().filter(ev => ev.estado === "aprobado" || puedeGestionar(ev));
    $("#lista-eventos").innerHTML = visibles.map(ev => {
      const lugar = nodoPorId(ev.lugar);
      const accesible = Ruteo.ruta(D, "entrada-principal", ev.lugar, "accesible", ahoraCerr).ok || ev.lugar === "entrada-principal";
      const niv = nivelAforo(ev.aforo_pct);
      const sigue = seguidos.includes(ev.id);
      let html = '<li class="evento">' +
        '<div class="ev-nombre">' + esc(ev.nombre) + (ev.estado === "pendiente" ? ' <span class="badge pend">Pendiente de aprobación</span>' : "") + "</div>" +
        '<div class="ev-meta">' + fmtFecha(ev.inicio) + " · " + esc(lugar ? lugar.nombre : ev.lugar) + " · " + esc(ev.organizador) +
        (accesible ? "" : ' <span class="badge noacc">♿ sin acceso sin gradas</span>') + "</div>" +
        '<div class="aforo"><div class="barra"><i class="niv-' + niv.clase + '" style="width:' + (ev.aforo_pct || 0) + '%"></i></div>' +
        '<span class="niv-txt niv-' + niv.clase + '">' + niv.texto + (ev.aforo_auto ? " · según asistencia" : ev.aforo_t && ev.aforo_pct != null && leer("aforos", {})[ev.id] ? " · act. " + fmtHora(ev.aforo_t) : "") +
        (ev.capacidad ? " · capacidad " + ev.capacidad : "") + "</span></div>" +
        '<div class="ev-acciones"><button data-ir="' + ev.lugar + '" type="button">Cómo llegar</button>' +
        '<a target="_blank" rel="noopener" href="' + linkCalendar(ev.nombre, new Date(ev.inicio), new Date(ev.fin || ev.inicio), ev.lugar) + '">+ Calendar</a>' +
        (tieneCuenta() ? '<button class="sec" data-seguir="' + ev.id + '" type="button">' + (sigue ? "✓ Siguiendo" : "🔔 Seguir") + "</button>" : "") +
        '<button class="sec" data-qr="' + ev.id + '" type="button">QR</button>' +
        (confAsistencia(ev.id).activa && tieneCuenta() && ev.estado === "aprobado"
          ? (yaAsistio(ev.id) ? '<span class="badge ok">✅ Asistencia registrada</span>' : '<button class="sec" data-marcar="' + ev.id + '" type="button">✅ Registrar asistencia</button>')
          : "") + "</div>";

      if (puedeGestionar(ev)) {
        html += '<div class="gestion"><b>Gestionar (' + ROLES[rol].nombre.toLowerCase() + ")</b>" +
          (rol === "admin" && ev.estado === "pendiente" ? '<div class="fila"><button data-aprobar="' + ev.id + '" type="button">Aprobar</button><button class="sec" data-rechazar="' + ev.id + '" type="button">Rechazar</button></div>' : "") +
          htmlAsistencia(ev) +
          (ev.aforo_auto ? '<p class="ev-meta">El aforo se calcula solo con la asistencia registrada.</p>' :
          '<label>Aforo lleno: <b><span id="pct-' + ev.id + '">' + (ev.aforo_pct == null ? "—" : ev.aforo_pct) + "</span> %</b>" +
          '<input type="range" min="0" max="100" step="5" value="' + (ev.aforo_pct || 0) + '" data-pct="' + ev.id + '"></label>' +
          '<button class="sec" data-guardar-pct="' + ev.id + '" type="button">Actualizar aforo</button>') +
          '<label>Aviso a seguidores (máx. 120 caracteres)<textarea maxlength="120" id="msg-' + ev.id + '" rows="2" placeholder="Ej.: Quedan lugares, ¡vengan!"></textarea></label>' +
          '<div class="plantillas">' +
          ['Quedan lugares, ¡te esperamos!', 'Empezamos en 10 minutos', 'Cambio de sala: revisa la ruta'].map(t => '<button class="sec chico" data-plantilla="' + ev.id + '" data-texto="' + esc(t) + '" type="button">' + esc(t) + "</button>").join("") +
          '</div><button data-avisar="' + ev.id + '" type="button" ' + (ev.estado !== "aprobado" ? "disabled" : "") + '>📣 Enviar aviso</button></div>';
      }
      return html + "</li>";
    }).join("") || '<li class="vacio">No hay eventos.</li>';

    const L_ = $("#lista-eventos");
    L_.querySelectorAll("[data-ir]").forEach(b => b.onclick = () => {
      $("#sel-hasta").value = b.dataset.ir;
      if ($("#sel-desde").value === b.dataset.ir) $("#sel-desde").value = "entrada-principal";
      calcular();
    });
    L_.querySelectorAll("[data-seguir]").forEach(b => b.onclick = () => {
      const s = new Set(leer("seguidos", []));
      s.has(b.dataset.seguir) ? s.delete(b.dataset.seguir) : s.add(b.dataset.seguir);
      guardar("seguidos", [...s]);
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      pintarEventos();
    });
    L_.querySelectorAll("[data-qr]").forEach(b => b.onclick = () => mostrarQR(b.dataset.qr));
    L_.querySelectorAll("[data-det]").forEach(d => d.ontoggle = () => { d.open ? detallesAbiertos.add(d.dataset.det) : detallesAbiertos.delete(d.dataset.det); });
    L_.querySelectorAll("[data-marcar]").forEach(b => b.onclick = () => pedirCodigo(b.dataset.marcar));
    L_.querySelectorAll("[data-asis-activar]").forEach(c => c.onchange = () => { activarAsistencia(c.dataset.asisActivar, c.checked); pintarEventos(); });
    L_.querySelectorAll("[data-asis-qr]").forEach(b => b.onclick = () => mostrarQRAsistencia(b.dataset.asisQr));
    L_.querySelectorAll("[data-retirar]").forEach(b => b.onclick = () => {
      if (b.dataset.seguro !== "1") { b.dataset.seguro = "1"; b.textContent = "¿Seguro?"; return; }
      const [id, i] = b.dataset.retirar.split("|");
      const lista = asistentes(id), quitado = lista.splice(+i, 1)[0];
      guardarAsistentes(id, lista);
      toast("Se retiró a " + quitado.nombre + ".");
      pintarEventos();
    });
    L_.querySelectorAll("[data-asis-agregar]").forEach(b => b.onclick = () => {
      const id = b.dataset.asisAgregar, inp = $("#asis-nombre-" + id);
      const nombre = inp.value.trim();
      if (!nombre) { toast("Escribe el nombre del participante."); return; }
      const r = registrarAsistencia(id, { nombre, codigo: "" }, "manual");
      toast(r.msg); pintarEventos();
    });
    L_.querySelectorAll("[data-asis-csv]").forEach(b => b.onclick = () => exportarCSV(b.dataset.asisCsv));
    L_.querySelectorAll("[data-pct]").forEach(r => r.oninput = () => { $("#pct-" + r.dataset.pct).textContent = r.value; });
    L_.querySelectorAll("[data-guardar-pct]").forEach(b => b.onclick = () => {
      const id = b.dataset.guardarPct, pct = +L_.querySelector('[data-pct="' + id + '"]').value;
      const a = leer("aforos", {}); a[id] = { pct, t: Date.now() }; guardar("aforos", a);
      pintarEventos();
      if (pct < 50) toast("Aforo en " + pct + " %. ¿Quieres avisar a los seguidores que quedan lugares?");
    });
    L_.querySelectorAll("[data-plantilla]").forEach(b => b.onclick = () => { $("#msg-" + b.dataset.plantilla).value = b.dataset.texto; });
    L_.querySelectorAll("[data-avisar]").forEach(b => b.onclick = () => enviarAviso(b.dataset.avisar));
    L_.querySelectorAll("[data-aprobar]").forEach(b => b.onclick = () => cambiarEstado(b.dataset.aprobar, "aprobado"));
    L_.querySelectorAll("[data-rechazar]").forEach(b => b.onclick = () => cambiarEstado(b.dataset.rechazar, null));
  }

  function cambiarEstado(id, estado) {
    let extra = leer("eventos_extra", []);
    extra = estado ? extra.map(e => e.id === id ? Object.assign(e, { estado }) : e) : extra.filter(e => e.id !== id);
    guardar("eventos_extra", extra);
    toast(estado ? "Evento aprobado: ya es visible para todos." : "Evento rechazado.");
    pintarEventos(); pintarAdmin();
  }

  $("#btn-crear").onclick = () => {
    const nombre = $("#ev-nombre").value.trim(), inicio = $("#ev-inicio").value;
    if (!nombre || !inicio) { toast("Completa el nombre y la fecha."); return; }
    const fin = new Date(new Date(inicio).getTime() + 2 * 3600e3), pad = n => String(n).padStart(2, "0");
    const extra = leer("eventos_extra", []);
    extra.push({
      id: "ev" + Date.now(), nombre, inicio,
      fin: fin.getFullYear() + "-" + pad(fin.getMonth() + 1) + "-" + pad(fin.getDate()) + "T" + pad(fin.getHours()) + ":" + pad(fin.getMinutes()),
      lugar: $("#ev-lugar").value, capacidad: +$("#ev-capacidad").value || null, aforo_pct: null,
      organizador: ORG_DEMO, estado: rol === "admin" ? "aprobado" : "pendiente",
    });
    guardar("eventos_extra", extra);
    $("#ev-nombre").value = ""; $("#ev-capacidad").value = "";
    toast(rol === "admin" ? "Evento publicado." : "Evento enviado. Queda pendiente hasta que un administrador lo apruebe.");
    pintarEventos(); pintarAdmin();
  };

  // ---------------- Avisos (notificaciones) ----------------
  function enviarAviso(id) {
    const ev = todosLosEventos().find(e => e.id === id);
    const texto = ($("#msg-" + id).value || "").trim();
    if (!texto) { toast("Escribe el aviso o elige una plantilla."); return; }
    const ultimos = leer("ultimo_aviso", {});
    if (ultimos[id] && Date.now() - ultimos[id] < ESPERA_AVISO_MS) {
      toast("Anti-spam: espera " + Math.ceil((ESPERA_AVISO_MS - (Date.now() - ultimos[id])) / 1000) + " s para volver a avisar sobre este evento.");
      return;
    }
    ultimos[id] = Date.now(); guardar("ultimo_aviso", ultimos);
    const aviso = { t: Date.now(), evento: id, titulo: ev.nombre, texto, aforo: ev.aforo_pct };
    const avisos = leer("avisos", []); avisos.unshift(aviso); guardar("avisos", avisos.slice(0, 50));
    // Entrega: en el prototipo se entrega en este dispositivo si sigue el evento.
    if (leer("seguidos", []).includes(id)) notificar(ev.nombre, texto, id);
    toast("📣 Aviso enviado a los seguidores de " + ev.nombre + ".");
    $("#msg-" + id).value = "";
    pintarAvisos(); pintarBadge();
  }

  function notificar(titulo, cuerpo, idEv) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = { body: cuerpo, icon: "icono-192.png", badge: "icono-192.png", tag: idEv, data: { url: urlRuta(null, (todosLosEventos().find(e => e.id === idEv) || {}).lugar) } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => reg.showNotification(titulo, opts));
    } else {
      try { new Notification(titulo, opts); } catch (e) {}
    }
  }

  function pintarAvisos() {
    const seguidos = leer("seguidos", []);
    const avisos = leer("avisos", []).filter(a => seguidos.includes(a.evento));
    $("#lista-avisos").innerHTML = !tieneCuenta()
      ? '<li class="vacio">Entra con tu cuenta (Estudiante) para seguir eventos y recibir avisos.</li>'
      : avisos.map(a => {
          const ev = todosLosEventos().find(e => e.id === a.evento);
          return '<li><div class="ev-nombre">📣 ' + esc(a.titulo) + '</div><div>' + esc(a.texto) + '</div><div class="ev-meta">' + fmtHora(a.t) + "</div>" +
            (ev ? '<button class="chico" data-ir-av="' + ev.lugar + '" type="button">Cómo llegar</button>' : "") + "</li>";
        }).join("") || '<li class="vacio">Aún no hay avisos. Sigue un evento (🔔) para recibir los avisos de sus organizadores.</li>';
    $("#lista-avisos").querySelectorAll("[data-ir-av]").forEach(b => b.onclick = () => { $("#sel-hasta").value = b.dataset.irAv; calcular(); });
    const perm = "Notification" in window ? Notification.permission : "no";
    $("#btn-permiso").classList.toggle("oculto", perm !== "default" || !tieneCuenta());
  }
  function pintarBadge() {
    const seguidos = leer("seguidos", []);
    const n = leer("avisos", []).filter(a => seguidos.includes(a.evento)).length - leer("avisos_leidos", 0);
    $("#badge-avisos").textContent = n > 0 && tieneCuenta() ? n : "";
  }
  $("#btn-permiso").onclick = () => Notification.requestPermission().then(pintarAvisos);

  // ---------------- Mi horario ----------------
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const DIAS_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function pintarHorario() {
    const sinCuenta = !tieneCuenta();
    $("#horario-sin-cuenta").classList.toggle("oculto", !sinCuenta);
    $("#horario-contenido").classList.toggle("oculto", sinCuenta);
    if (sinCuenta) return;
    const clases = leer("clases", []);
    const ahora = new Date();

    // Próxima clase
    let prox = null;
    clases.filter(c => c.nodo).forEach(c => {
      const d = Horario.proximaOcurrencia(c, ahora);
      if (d && (!prox || d < prox.fecha)) prox = { clase: c, fecha: d };
    });
    if (prox) {
      const modo = modoPreferido();
      const r = Ruteo.ruta(D, $("#sel-desde").value, prox.clase.nodo, modo, opcionesRuta());
      const seg = r.ok ? r.segundos : 0;
      const salirEn = Math.round((prox.fecha - ahora) / 1000 - seg - MARGEN_CLASE_S);
      const cuando = prox.fecha.toDateString() === ahora.toDateString() ? "Hoy " : DIAS[prox.fecha.getDay()] + " ";
      const salirTxt = salirEn <= 0 ? "<b class='urgente'>¡Sal ya!</b>"
        : salirEn < 3 * 3600 ? "Sal en <b>" + fmtMin(salirEn) + "</b>"
        : "Sal a las <b>" + fmtHora(prox.fecha.getTime() - (seg + MARGEN_CLASE_S) * 1000) + "</b>";
      $("#proxima-clase").innerHTML = '<div class="prox">' +
        '<div class="ev-meta">Próxima clase</div><div class="ev-nombre">' + esc(prox.clase.materia) + "</div>" +
        "<div>" + cuando + prox.clase.inicio + " · " + esc(nodoPorId(prox.clase.nodo).nombre) + "</div>" +
        '<div class="salir">' + salirTxt + (r.ok ? " · " + r.minutos + " min de camino desde " + esc(nodoPorId($("#sel-desde").value).nombre) + (modo === "accesible" ? " (sin gradas)" : "") : "") + "</div>" +
        '<button data-ir-clase="' + prox.clase.nodo + '" type="button">Cómo llegar</button></div>';
    } else {
      $("#proxima-clase").innerHTML = '<div class="aviso info">Importa tu horario o agrega tus clases para ver cuándo salir.</div>';
    }

    // Lista
    $("#lista-clases").innerHTML = clases.map((c, i) => {
      const n = c.nodo && nodoPorId(c.nodo);
      const d = Horario.proximaOcurrencia(c, ahora) || new Date();
      const [h1, m1] = c.inicio.split(":").map(Number), [h2, m2] = c.fin.split(":").map(Number);
      const ini = new Date(d); ini.setHours(h1, m1); const fin = new Date(d); fin.setHours(h2, m2);
      const recur = "RRULE:FREQ=WEEKLY;BYDAY=" + c.dias.map(x => DIAS_RRULE[x]).join(",");
      return "<li><div class='ev-nombre'>" + esc(c.materia) + "</div>" +
        "<div class='ev-meta'>" + c.dias.map(x => DIAS[x]).join(", ") + " · " + c.inicio + "–" + c.fin + " · " +
        (n ? esc(n.nombre) : "<span class='badge noacc'>Aula no reconocida: " + esc(c.ubicacion || "sin ubicación") + "</span>") + "</div>" +
        (n ? "" : '<select data-asignar="' + i + '"><option value="">Asignar aula…</option>' + ordenNodos.filter(x => x.tipo !== "bano").map(x => '<option value="' + x.id + '">' + esc(x.nombre) + "</option>").join("") + "</select>") +
        '<div class="ev-acciones">' + (n ? '<button data-ir-clase="' + n.id + '" type="button">Cómo llegar</button>' +
        '<a target="_blank" rel="noopener" href="' + linkCalendar(c.materia, ini, fin, n.id, recur) + '">+ Calendar</a>' : "") +
        '<button class="sec" data-borrar="' + i + '" type="button">Quitar</button></div></li>';
    }).join("") || '<li class="vacio">Sin clases cargadas.</li>';

    document.querySelectorAll("[data-ir-clase]").forEach(b => b.onclick = () => {
      $("#sel-hasta").value = b.dataset.irClase; setModo(modoPreferido()); calcular();
    });
    $("#lista-clases").querySelectorAll("[data-borrar]").forEach(b => b.onclick = () => {
      const cl = leer("clases", []); cl.splice(+b.dataset.borrar, 1); guardar("clases", cl); pintarHorario();
    });
    $("#lista-clases").querySelectorAll("[data-asignar]").forEach(s => s.onchange = () => {
      const cl = leer("clases", []); cl[+s.dataset.asignar].nodo = s.value || null; guardar("clases", cl); pintarHorario();
    });
  }

  $("#archivo-ics").onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then(txt => {
      const nuevas = Horario.leerICS(txt).map(c => Object.assign(c, { nodo: (Horario.reconocerAula(D, c.ubicacion) || {}).id || null }));
      if (!nuevas.length) { toast("No se encontraron clases en el archivo."); return; }
      guardar("clases", leer("clases", []).concat(nuevas));
      const ok = nuevas.filter(c => c.nodo).length;
      toast(nuevas.length + " clases importadas · " + ok + " con aula reconocida.");
      e.target.value = "";
      pintarHorario();
    });
  };
  $("#btn-agregar-clase").onclick = () => {
    const materia = $("#cl-materia").value.trim();
    const dias = [...document.querySelectorAll(".cl-dia:checked")].map(x => +x.value);
    const inicio = $("#cl-inicio").value, fin = $("#cl-fin").value;
    if (!materia || !dias.length || !inicio || !fin) { toast("Completa materia, días y horario."); return; }
    const n = nodoPorId($("#cl-aula").value);
    const cl = leer("clases", []);
    cl.push({ materia, dias, inicio, fin, ubicacion: n.nombre, nodo: n.id });
    guardar("clases", cl);
    $("#cl-materia").value = "";
    document.querySelectorAll(".cl-dia").forEach(x => { x.checked = false; });
    pintarHorario();
  };
  $("#btn-borrar-horario").onclick = e => {
    const b = e.currentTarget;
    if (b.dataset.seguro !== "1") { b.dataset.seguro = "1"; b.textContent = "¿Seguro? Toca otra vez"; setTimeout(() => { b.dataset.seguro = ""; b.textContent = "Quitar todo el horario"; }, 4000); return; }
    b.dataset.seguro = ""; b.textContent = "Quitar todo el horario";
    guardar("clases", []); pintarHorario();
  };

  // ---------------- Administración ----------------
  function pintarAdmin() {
    $("#tab-admin").classList.toggle("oculto", rol !== "admin");
    if (rol !== "admin") return;
    const pend = leer("eventos_extra", []).filter(e => e.estado === "pendiente");
    $("#admin-pendientes").innerHTML = pend.length
      ? pend.map(e => '<li><b>' + esc(e.nombre) + "</b><div class='ev-meta'>" + fmtFecha(e.inicio) + " · " + esc(nodoPorId(e.lugar).nombre) + " · " + esc(e.organizador) + '</div><div class="fila"><button data-ap="' + e.id + '" type="button">Aprobar</button><button class="sec" data-re="' + e.id + '" type="button">Rechazar</button></div></li>').join("")
      : '<li class="vacio">No hay eventos pendientes.</li>';
    $("#admin-pendientes").querySelectorAll("[data-ap]").forEach(b => b.onclick = () => cambiarEstado(b.dataset.ap, "aprobado"));
    $("#admin-pendientes").querySelectorAll("[data-re]").forEach(b => b.onclick = () => cambiarEstado(b.dataset.re, null));

    const grupos = {};
    D.aristas.forEach(ar => { const g = grupoArista(ar); grupos[g] = grupos[g] || ar.tipo; });
    const orden = { ascensor: 0, rampa: 1, camino: 2, escalera: 3 };
    const cerr = new Set(leer("cerrados", []));
    $("#admin-caminos").innerHTML = Object.keys(grupos).sort((a, b) => orden[grupos[a]] - orden[grupos[b]] || a.localeCompare(b))
      .map(g => '<li><label class="check"><input type="checkbox" data-cerrar="' + esc(g) + '" ' + (cerr.has(g) ? "checked" : "") + "> ⛔ " +
        { ascensor: "🛗", rampa: "♿", camino: "🚶", escalera: "🪜" }[grupos[g]] + " " + esc(g) + "</label></li>").join("");
    $("#admin-caminos").querySelectorAll("[data-cerrar]").forEach(c => c.onchange = () => {
      const s = new Set(leer("cerrados", []));
      c.checked ? s.add(c.dataset.cerrar) : s.delete(c.dataset.cerrar);
      guardar("cerrados", [...s]);
      dibujarCaminos(); pintarEventos();
      toast(c.checked ? "Marcado fuera de servicio: las rutas ya lo evitan." : "Habilitado nuevamente.");
    });
  }

  // ---------------- Roles ----------------
  function aplicarRol() {
    $("#sel-rol").value = rol;
    document.body.dataset.rol = rol;
    $("#form-evento").classList.toggle("oculto", !(rol === "organizador" || rol === "admin"));
    pintarEventos(); pintarHorario(); pintarAvisos(); pintarBadge(); pintarAdmin(); pintarPerfil();
    if (rol !== "admin" && $("#vista-admin") && !$("#vista-admin").classList.contains("oculto")) irA("eventos");
  }
  $("#sel-rol").onchange = () => { rol = $("#sel-rol").value; guardar("rol", rol); aplicarRol(); toast("Entraste como " + ROLES[rol].nombre + "."); };

  // ---------------- Preferencias ----------------
  $("#chk-accesible").checked = leer("siempre_accesible", false);
  $("#chk-accesible").onchange = () => {
    guardar("siempre_accesible", $("#chk-accesible").checked);
    setModo(modoPreferido());
    if (!$("#resultado").classList.contains("oculto")) calcular();
    pintarHorario();
  };

  // ---------------- GPS ----------------
  $("#btn-gps").onclick = () => {
    if (!navigator.geolocation) { toast("Tu navegador no permite ubicación."); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const { nodo, distancia } = Ruteo.nodoMasCercano(D, pos.coords.latitude, pos.coords.longitude);
      if (distancia > 400) { toast("Parece que no estás en el campus (a " + Math.round(distancia) + " m). Elige tu punto en la lista."); return; }
      $("#sel-desde").value = nodo.id;
      toast("Estás cerca de: " + nodo.nombre);
      calcular();
    }, () => toast("No se pudo obtener tu ubicación. Elige tu punto en la lista o escanea un QR."), { enableHighAccuracy: true, timeout: 8000 });
  };

  // ---------------- Enlaces, QR y compartir ----------------
  function urlRuta(desde, hasta, modo) {
    const u = new URL(location.href.split("?")[0].split("#")[0]);
    if (desde) u.searchParams.set("desde", desde);
    if (hasta) u.searchParams.set("hasta", hasta);
    if (modo && modo !== "corta") u.searchParams.set("modo", modo);
    return u.toString();
  }
  function actualizarURL() { history.replaceState(null, "", urlRuta($("#sel-desde").value, $("#sel-hasta").value, modoActual())); }

  // QR dibujado en el propio navegador (librería local, funciona sin internet)
  function qrSVG(texto, tam) {
    const q = qrcode(0, "M"); q.addData(texto); q.make();
    return q.createSvgTag({ cellSize: Math.max(2, Math.floor(tam / (q.getModuleCount() + 8))), margin: 4, scalable: false })
      .replace("<svg ", '<svg class="qr" ');
  }

  // ---------- Asistencia: vista del organizador ----------
  const detallesAbiertos = new Set();
  function htmlAsistencia(ev) {
    const c = confAsistencia(ev.id), lista = asistentes(ev.id);
    let h = '<label class="check"><input type="checkbox" data-asis-activar="' + ev.id + '" ' + (c.activa ? "checked" : "") + "> Registrar asistencia con QR</label>";
    if (!c.activa) return h;
    h += '<button data-asis-qr="' + ev.id + '" type="button"' + (ev.estado !== "aprobado" ? " disabled" : "") + '>📷 Mostrar QR de asistencia</button>' +
      '<details class="asist" data-det="' + ev.id + '"' + (detallesAbiertos.has(ev.id) ? " open" : "") + '><summary><b>Asistentes: ' + lista.length + (ev.capacidad ? " / " + ev.capacidad : "") + "</b></summary>" +
      '<ul class="lista-asis">' + (lista.map((p, i) =>
        "<li><span>" + esc(p.nombre) + (p.codigo ? ' <small>· ' + esc(p.codigo) + "</small>" : "") +
        ' <small class="ev-meta">' + fmtHora(p.t) + " · " + (p.metodo === "qr" ? "QR" : "manual") + "</small></span>" +
        '<button class="sec chico" data-retirar="' + ev.id + "|" + i + '" type="button">Retirar</button></li>').join("") || '<li class="ev-meta">Nadie registrado todavía.</li>') +
      "</ul>" +
      '<div class="fila"><input id="asis-nombre-' + ev.id + '" placeholder="Agregar a mano (nombre)"><button class="sec chico" data-asis-agregar="' + ev.id + '" type="button">Agregar</button></div>' +
      '<button class="sec chico" data-asis-csv="' + ev.id + '" type="button">⬇ Descargar lista (CSV)</button></details>';
    return h;
  }

  function mostrarQRAsistencia(id) {
    const ev = todosLosEventos().find(e => e.id === id);
    const c = confAsistencia(id);
    const pintar = () => {
      const v = ventanaActual(), cod = codigoQR(c.secreto, v);
      const url = urlRuta(null, null).replace(/\?$/, "") + "?asistir=" + encodeURIComponent(id) + "&c=" + cod;
      const quedan = Math.ceil(((v + 1) * VENTANA_QR_MS - Date.now()) / 1000);
      $("#modal-cuerpo").innerHTML = "<h3>Asistencia · " + esc(ev.nombre) + "</h3>" + qrSVG(url, 260) +
        '<div class="codigo-grande">' + cod + "</div>" +
        '<p class="ev-meta">Escanea con la cámara del celular, o ingresa el código en la app (Eventos → Registrar asistencia).<br>El código cambia en ' + quedan + " s.</p>" +
        '<p><b>' + asistentes(id).length + "</b> asistentes registrados</p>";
    };
    pintar();
    $("#modal").classList.remove("oculto");
    clearInterval(timerModal);
    timerModal = setInterval(() => { pintar(); pintarEventos(); }, 1000);
  }

  function exportarCSV(id) {
    const ev = todosLosEventos().find(e => e.id === id);
    const filas = [["nombre", "codigo", "hora", "metodo"]].concat(asistentes(id).map(p => [p.nombre, p.codigo || "", new Date(p.t).toLocaleString("es-BO"), p.metodo]));
    const csv = "﻿" + filas.map(f => f.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "asistencia_" + ev.nombre.replace(/[^\w]+/g, "_") + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- Asistencia: vista del participante ----------
  function registrarAsistencia(id, persona, metodo) {
    const lista = asistentes(id);
    if (lista.some(x => clavePersona(x) === clavePersona(persona))) return { ok: false, msg: persona.nombre + " ya tenía la asistencia registrada." };
    const ev = todosLosEventos().find(e => e.id === id);
    if (ev && ev.capacidad && lista.length >= ev.capacidad) return { ok: false, msg: "El evento ya alcanzó su capacidad (" + ev.capacidad + ")." };
    lista.push({ nombre: persona.nombre, codigo: persona.codigo || "", t: Date.now(), metodo });
    guardarAsistentes(id, lista);
    return { ok: true, msg: "✅ Asistencia registrada: " + persona.nombre + " · " + (ev ? ev.nombre : "") };
  }

  // Pide nombre y código (una sola vez) y luego continúa
  function conPerfil(continuar) {
    if (perfil()) { continuar(perfil()); return; }
    $("#modal-cuerpo").innerHTML = "<h3>Tus datos</h3><p class='ev-meta'>Se usan para registrar tu asistencia. En la versión final se toman de tu cuenta institucional.</p>" +
      '<input id="pf-nombre" placeholder="Nombre completo" maxlength="60"><input id="pf-codigo" placeholder="Código de estudiante o CI" maxlength="20">' +
      '<button id="pf-ok" type="button">Continuar</button>';
    $("#modal").classList.remove("oculto");
    $("#pf-ok").onclick = () => {
      const nombre = $("#pf-nombre").value.trim(), codigo = $("#pf-codigo").value.trim();
      if (!nombre) { toast("Escribe tu nombre."); return; }
      guardar("perfil", { nombre, codigo });
      if (rol === "visitante") { rol = "estudiante"; guardar("rol", rol); aplicarRol(); }
      pintarPerfil();
      cerrarModal();
      continuar({ nombre, codigo });
    };
  }

  function marcarConCodigo(id, codigo) {
    const ev = todosLosEventos().find(e => e.id === id);
    if (!ev) { toast("Evento no encontrado."); return; }
    if (!codigoValido(id, codigo)) {
      $("#modal-cuerpo").innerHTML = '<div class="aviso error"><b>Código vencido o incorrecto.</b><br>Vuelve a escanear el QR que muestra el organizador (cambia cada 30 s).</div>';
      $("#modal").classList.remove("oculto");
      return;
    }
    conPerfil(p => {
      const r = registrarAsistencia(id, p, "qr");
      $("#modal-cuerpo").innerHTML = '<div class="aviso ' + (r.ok ? "ok" : "info") + '"><b>' + esc(r.msg) + "</b></div>" +
        '<p class="ev-meta">' + fmtFecha(ev.inicio) + " · " + esc(nodoPorId(ev.lugar).nombre) + "</p>";
      $("#modal").classList.remove("oculto");
      pintarEventos();
    });
  }

  function pedirCodigo(id) {
    const ev = todosLosEventos().find(e => e.id === id);
    $("#modal-cuerpo").innerHTML = "<h3>Registrar asistencia</h3><p class='ev-meta'>" + esc(ev.nombre) +
      "<br>Escanea el QR del organizador con la cámara, o escribe el código de 4 dígitos que aparece debajo.</p>" +
      '<input id="cod-asis" inputmode="numeric" maxlength="4" placeholder="0000" class="codigo-input"><button id="cod-ok" type="button">Registrar</button>';
    $("#modal").classList.remove("oculto");
    $("#cod-ok").onclick = () => { const c = $("#cod-asis").value; cerrarModal(); marcarConCodigo(id, c); };
  }

  function pintarPerfil() {
    const p = perfil();
    $("#perfil").innerHTML = tieneCuenta() && p ? "👤 " + esc(p.nombre) + ' · <a href="#" id="pf-cambiar">cambiar</a>' : "";
    const a = $("#pf-cambiar");
    if (a) a.onclick = e => { e.preventDefault(); guardar("perfil", null); conPerfil(() => toast("Datos actualizados.")); };
  }

  function mostrarQR(idEv) {
    const ev = todosLosEventos().find(e => e.id === idEv);
    const url = urlRuta(null, null).replace(/\?$/, "") + "?evento=" + encodeURIComponent(idEv);
    $("#modal-cuerpo").innerHTML = "<h3>" + esc(ev.nombre) + "</h3>" + qrSVG(url, 240) +
      "<p class='ev-meta'>Para el afiche: abre la ruta a " + esc(nodoPorId(ev.lugar).nombre) + "</p><input readonly value='" + esc(url) + "'>";
    $("#modal").classList.remove("oculto");
  }
  let timerModal = null;
  function cerrarModal() { $("#modal").classList.add("oculto"); clearInterval(timerModal); timerModal = null; }
  $("#modal-cerrar").onclick = cerrarModal;

  $("#btn-compartir").onclick = () => {
    const url = location.href;
    if (navigator.share) navigator.share({ title: "UCB Events", text: "Así llegas:", url }).catch(() => {});
    else window.open("https://wa.me/?text=" + encodeURIComponent("Así llegas: " + url), "_blank");
  };

  // ---------------- Toast ----------------
  let tToast;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("ver");
    clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove("ver"), 3500);
  }

  // ---------------- Instalar como app (PWA) ----------------
  let promptInstalar = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); promptInstalar = e; $("#btn-instalar").classList.remove("oculto"); });
  $("#btn-instalar").onclick = () => { if (promptInstalar) { promptInstalar.prompt(); promptInstalar = null; $("#btn-instalar").classList.add("oculto"); } };
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // ---------------- Eventos de la interfaz ----------------
  $("#btn-ruta").onclick = calcular;
  $("#btn-bano").onclick = banoMasCercano;
  $("#sel-desde").onchange = () => pintarHorario();
  document.querySelectorAll('input[name="modo"]').forEach(r => r.onchange = () => { if (!$("#resultado").classList.contains("oculto")) calcular(); });

  // ---------------- Arranque: ?desde=&hasta=&evento=&modo= ----------------
  dibujarCaminos();
  const q = new URLSearchParams(location.search);
  $("#sel-desde").value = nodoPorId(q.get("desde")) ? q.get("desde") : "entrada-principal";
  const evQ = q.get("evento") && todosLosEventos().find(e => e.id === q.get("evento"));
  const hasta = evQ ? evQ.lugar : q.get("hasta");
  $("#sel-hasta").value = nodoPorId(hasta) ? hasta : "coliseo";
  setModo(q.get("modo") || modoPreferido());
  aplicarRol();
  irA("ruta");
  if (hasta && nodoPorId(hasta)) calcular();
  if (q.get("asistir")) {
    const idA = q.get("asistir"), cod = q.get("c") || "";
    history.replaceState(null, "", location.pathname);
    irA("eventos");
    marcarConCodigo(idA, cod);
  }
  setInterval(pintarHorario, 60e3); // actualiza "sal en X min"
})();
