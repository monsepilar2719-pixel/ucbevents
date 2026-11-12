// =====================================================================
// RUTEO: grafo + Dijkstra + tiempo estimado con subida + modo accesible.
// Funciones puras (sin DOM), para poder probarlas con Node.
// =====================================================================
(function (global) {
  const VEL_PLANO = 1.2;          // m/s caminando en plano dentro del campus
  const VEL_SILLA = 1.0;          // m/s en modo accesible (silla de ruedas / muletas)
  const PENDIENTE_MAX_ACCESIBLE = 0.10; // >10 % no se considera apto sin ayuda
  const ESC_SUBIR_S_POR_M = 6;    // ~18 s por piso de 3 m al subir
  const ESC_BAJAR_S_POR_M = 3;
  const ASC_ESPERA_S = 40;        // espera promedio del ascensor
  const ASC_S_POR_M = 2;

  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Velocidad según pendiente (función de Tobler normalizada)
  function velocidadTobler(pendiente, vPlano) {
    return vPlano * Math.exp(-3.5 * Math.abs(pendiente + 0.05)) / Math.exp(-0.175);
  }

  function tiempoArista(ar, desde, hasta, modo) {
    const dh = (hasta.altura_m || 0) - (desde.altura_m || 0);
    const m = ar.metros;
    switch (ar.tipo) {
      case "escalera":
        return m / VEL_PLANO + (dh > 0 ? dh * ESC_SUBIR_S_POR_M : -dh * ESC_BAJAR_S_POR_M);
      case "ascensor":
        return ASC_ESPERA_S + Math.abs(dh) * ASC_S_POR_M;
      default: {
        const pend = m > 0 ? dh / m : 0;
        return m / velocidadTobler(pend, modo === "accesible" ? VEL_SILLA : VEL_PLANO);
      }
    }
  }

  // Distancia que se minimiza (decisión del equipo: ruta más corta en metros).
  // Ascensor: cuenta solo la altura que recorre.
  function distanciaArista(ar, desde, hasta) {
    if (ar.tipo === "ascensor") return Math.abs((hasta.altura_m || 0) - (desde.altura_m || 0));
    return ar.metros;
  }

  function esAccesible(ar, desde, hasta) {
    if (ar.tipo === "escalera") return false;
    if (ar.accesible === false) return false;
    if (ar.tipo === "ascensor") return true;
    const pend = ar.metros > 0 ? Math.abs((hasta.altura_m || 0) - (desde.altura_m || 0)) / ar.metros : 0;
    return pend <= PENDIENTE_MAX_ACCESIBLE;
  }

  function construirGrafo(datos) {
    const nodos = {}, ady = {};
    datos.nodos.forEach(n => { nodos[n.id] = n; ady[n.id] = []; });
    datos.aristas.forEach((ar, i) => {
      if (!nodos[ar.a] || !nodos[ar.b]) { console.warn("Arista con nodo inexistente:", ar); return; }
      const metros = ar.metros != null ? ar.metros : Math.round(haversine(nodos[ar.a], nodos[ar.b]));
      const arista = Object.assign({}, ar, { metros, idx: i });
      ady[ar.a].push({ hacia: ar.b, arista });
      ady[ar.b].push({ hacia: ar.a, arista });
    });
    return { nodos, ady };
  }

  // Dijkstra completo desde un origen.
  // opciones.cerradas: Set de índices de aristas fuera de servicio.
  function dijkstra(G, desdeId, modo, opciones) {
    const cerradas = (opciones && opciones.cerradas) || new Set();
    const dist = {}, prev = {}, visit = {};
    Object.keys(G.nodos).forEach(id => { dist[id] = Infinity; });
    dist[desdeId] = 0;
    while (true) {
      let u = null, best = Infinity;
      for (const id in dist) if (!visit[id] && dist[id] < best) { best = dist[id]; u = id; }
      if (u === null) break;
      visit[u] = true;
      for (const { hacia, arista } of G.ady[u]) {
        if (cerradas.has(arista.idx)) continue;
        const a = G.nodos[u], b = G.nodos[hacia];
        if (modo === "accesible" && !esAccesible(arista, a, b)) continue;
        let costo = distanciaArista(arista, a, b);
        if (modo === "techo" && !arista.techado) costo *= 2; // bajo techo: lo descubierto "pesa" el doble
        if (dist[u] + costo < dist[hacia]) {
          dist[hacia] = dist[u] + costo;
          prev[hacia] = { desde: u, arista };
        }
      }
    }
    return { dist, prev };
  }

  function armarResultado(G, desdeId, hastaId, prev, modo) {
    const tramos = [];
    let cur = hastaId;
    while (cur !== desdeId) {
      const pr = prev[cur];
      tramos.unshift({ desde: G.nodos[pr.desde], hasta: G.nodos[cur], arista: pr.arista });
      cur = pr.desde;
    }
    let metros = 0, segundos = 0, subida = 0, bajada = 0;
    tramos.forEach(t => {
      t.segundos = tiempoArista(t.arista, t.desde, t.hasta, modo);
      segundos += t.segundos;
      if (t.arista.tipo !== "ascensor") {
        metros += t.arista.metros;
        const dh = (t.hasta.altura_m || 0) - (t.desde.altura_m || 0);
        if (dh > 0) subida += dh; else bajada -= dh;
      }
    });
    return {
      ok: true, modo,
      destino: G.nodos[hastaId],
      nodos: [G.nodos[desdeId]].concat(tramos.map(t => t.hasta)),
      tramos,
      metros: Math.round(metros),
      segundos: Math.round(segundos),
      minutos: Math.max(1, Math.round(segundos / 60)),
      subida_m: Math.round(subida),
      bajada_m: Math.round(bajada),
      usaEscaleras: tramos.some(t => t.arista.tipo === "escalera"),
      usaAscensor: tramos.some(t => t.arista.tipo === "ascensor"),
      pasos: armarPasos(tramos),
    };
  }

  // modo: "corta" | "accesible" | "techo"
  function ruta(datos, desdeId, hastaId, modo, opciones) {
    modo = modo || "corta";
    const G = construirGrafo(datos);
    if (!G.nodos[desdeId] || !G.nodos[hastaId]) return { ok: false, motivo: "Punto de origen o destino desconocido." };
    if (desdeId === hastaId) return { ok: false, mismoLugar: true, motivo: "Ya estás en " + G.nodos[hastaId].nombre + "." };
    const { dist, prev } = dijkstra(G, desdeId, modo, opciones);
    if (dist[hastaId] === Infinity) {
      return {
        ok: false,
        motivo: modo === "accesible"
          ? "No hay una ruta sin gradas disponible hasta " + G.nodos[hastaId].nombre + "."
          : "No hay camino disponible entre esos puntos.",
      };
    }
    return armarResultado(G, desdeId, hastaId, prev, modo);
  }

  // Ruta al nodo más cercano (en tiempo) que cumpla un filtro. Ej.: baño más cercano.
  function rutaAlMasCercano(datos, desdeId, filtro, modo, opciones) {
    modo = modo || "corta";
    const G = construirGrafo(datos);
    if (!G.nodos[desdeId]) return { ok: false, motivo: "Punto de origen desconocido." };
    const { dist, prev } = dijkstra(G, desdeId, modo, opciones);
    let mejor = null;
    datos.nodos.filter(filtro).forEach(n => {
      if (dist[n.id] < Infinity && (!mejor || dist[n.id] < dist[mejor.id])) mejor = n;
    });
    if (!mejor) return { ok: false, motivo: "No se encontró ninguno alcanzable con este tipo de ruta." };
    if (mejor.id === desdeId) return { ok: false, mismoLugar: true, motivo: "Estás justo en " + mejor.nombre + "." };
    return armarResultado(G, desdeId, mejor.id, prev, modo);
  }

  // Pasos en texto (une gradas consecutivas: "Sube 5 pisos")
  function armarPasos(tramos) {
    const pasos = [];
    for (let i = 0; i < tramos.length; i++) {
      const t = tramos[i], ar = t.arista;
      if (ar.tipo === "escalera" && t.hasta.bloque && t.hasta.bloque === t.desde.bloque) {
        let j = i;
        while (j + 1 < tramos.length && tramos[j + 1].arista.tipo === "escalera" &&
               tramos[j + 1].hasta.bloque === t.desde.bloque) j++;
        const fin = tramos[j].hasta, pisos = fin.piso - t.desde.piso;
        pasos.push({ icono: "🪜", texto: (pisos > 0 ? "Sube " : "Baja ") + Math.abs(pisos) +
          (Math.abs(pisos) === 1 ? " piso" : " pisos") + " por las gradas hasta " + fin.nombre });
        i = j;
        continue;
      }
      const destino = t.hasta.nombre, nota = ar.nota ? " (" + ar.nota + ")" : "";
      const dh = (t.hasta.altura_m || 0) - (t.desde.altura_m || 0);
      if (ar.tipo === "ascensor") pasos.push({ icono: "🛗", texto: "Toma el ascensor al piso " + t.hasta.piso + " · " + destino });
      else if (ar.tipo === "escalera") pasos.push({ icono: "🪜", texto: (dh >= 0 ? "Sube" : "Baja") + " las gradas hasta " + destino + nota });
      else if (ar.tipo === "rampa") pasos.push({ icono: "♿", texto: "Toma la rampa " + ar.metros + " m hasta " + destino + nota });
      else pasos.push({ icono: "🚶", texto: "Camina " + ar.metros + " m hasta " + destino + (dh > 2 ? " (en subida)" : "") + nota });
    }
    return pasos;
  }

  function nodoMasCercano(datos, lat, lng) {
    let mejor = null, dmin = Infinity;
    datos.nodos.filter(n => n.piso === 0).forEach(n => {
      const d = haversine({ lat, lng }, n);
      if (d < dmin) { dmin = d; mejor = n; }
    });
    return { nodo: mejor, distancia: dmin };
  }

  const API = { ruta, rutaAlMasCercano, construirGrafo, nodoMasCercano, haversine, esAccesible, tiempoArista, distanciaArista };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.Ruteo = API;
})(typeof window !== "undefined" ? window : globalThis);
