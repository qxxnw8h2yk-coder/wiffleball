// ============================================================
// ESTADO GLOBAL
// ============================================================
let jugadorSeleccionado = null;
let jugadorNombre       = null;
let modoEdicion         = false;

// editandoIdx: índice del partido que se está editando (-1 = nuevo partido)
let editandoIdx = -1;

let partidos = JSON.parse(localStorage.getItem("partidos")) || [];
let players  = JSON.parse(localStorage.getItem("players"))  || {};
// pitchers[nombre] = { totalH, totalHR, totalBB, totalK, totalO, totalER, juegos:[] }
let pitchers = JSON.parse(localStorage.getItem("pitchers")) || {};

// Reglas de juego: máximo 5 entradas regulares + 2 extras = 7 entradas = 21 outs
const MAX_OUTS  = 21;  // outs totales por partido
const BASE_INN  = 5;   // innings base para ERA

// ============================================================
// UTILIDADES
// ============================================================
function toast(msg, ms = 2400) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), ms);
}

function guardarStorage() {
  localStorage.setItem("partidos", JSON.stringify(partidos));
  localStorage.setItem("players",  JSON.stringify(players));
  localStorage.setItem("pitchers", JSON.stringify(pitchers));
}

// ============================================================
// ESTADO DEL PARTIDO EN CURSO — persiste entre recargas
// ============================================================
function guardarEstadoPartido() {
  // Serializar filas de bateadores (nombre + stats)
  function leerFilas(tablaId) {
    return [...document.querySelectorAll(`${tablaId} tbody tr`)].map(tr => ({
      nombre: tr.children[0].textContent,
      stats:  [...tr.querySelectorAll(".stat")].map(td => parseInt(td.textContent) || 0)
    }));
  }

  // Serializar pitcher containers (manual, por si no hay tracking automático)
  function leerPitContainers(equipo) {
    const containerId = equipo === "visitante" ? "pitchersVsVisitanteContainer" : "pitchersVsLocalContainer";
    return [...document.querySelectorAll(`#${containerId} .pitcher-fila`)].map(fila => ({
      nombre: fila.querySelector(".pitcher-select")?.value || "",
      outs:   parseInt(fila.querySelector(".pitcher-outs-input")?.value) || 0
    })).filter(p => p.nombre);
  }

  const estado = {
    local:      document.getElementById("local")?.value     || "",
    visitante:  document.getElementById("visitante")?.value || "",
    fecha:      document.getElementById("fecha")?.value     || "",
    marcador, carrerasGrid, lineupPos,
    bases: {
      1: bases[1] ? { nombre: bases[1].nombre } : null,
      2: bases[2] ? { nombre: bases[2].nombre } : null,
      3: bases[3] ? { nombre: bases[3].nombre } : null,
    },
    pitcherActivo,
    outsPitcher,
    filasVisitante: leerFilas("#tablaVisitante"),
    filasLocal:     leerFilas("#tablaLocal"),
    pitContainerVisitante: leerPitContainers("visitante"),
    pitContainerLocal:     leerPitContainers("local"),
    jugadorActual: jugadorNombre || null,
    tablaActual:   tablaActiva  || null,
    juegoIniciado: document.getElementById("btnIniciarJuego")?.style.display === "none",
  };

  localStorage.setItem("estadoPartido", JSON.stringify(estado));
}

function restaurarEstadoPartido() {
  const raw = localStorage.getItem("estadoPartido");
  if (!raw) return;

  let estado;
  try { estado = JSON.parse(raw); } catch { return; }
  if (!estado || !estado.juegoIniciado) return; // no había partido en curso

  // Rellenar campos de texto
  if (document.getElementById("local"))     document.getElementById("local").value     = estado.local     || "";
  if (document.getElementById("visitante")) document.getElementById("visitante").value = estado.visitante || "";
  if (document.getElementById("fecha"))     document.getElementById("fecha").value     = estado.fecha     || "";

  // Restaurar marcador y grids
  if (estado.marcador)     Object.assign(marcador, estado.marcador);
  if (estado.carrerasGrid) Object.assign(carrerasGrid, estado.carrerasGrid);
  if (estado.lineupPos)    Object.assign(lineupPos, estado.lineupPos);
  if (estado.pitcherActivo) Object.assign(pitcherActivo, estado.pitcherActivo);
  if (estado.outsPitcher)   Object.assign(outsPitcher, estado.outsPitcher);

  // Restaurar bateadores
  function restaurarFilas(tablaId, filas) {
    const tbody = document.querySelector(`${tablaId} tbody`);
    if (!tbody || !filas) return;
    tbody.innerHTML = "";
    filas.forEach(({ nombre, stats }) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${nombre}</td>` +
        stats.map(v => `<td class="stat">${v}</td>`).join("") +
        `<td class="stat-av td-ave">.000</td>` +
        `<td class="stat-av td-ops">.000</td>` +
        `<td class="td-acciones"><button class="btn-sustituir" title="Sustituir" onclick="abrirModalSustituir(this)">⇄</button><button onclick="this.closest('tr').remove()">✕</button></td>`;
      tbody.appendChild(tr);
    });
  }

  restaurarFilas("#tablaVisitante", estado.filasVisitante);
  restaurarFilas("#tablaLocal",     estado.filasLocal);

  // Restaurar bases con referencias a filas reales
  [1, 2, 3].forEach(n => {
    const b = estado.bases?.[n];
    if (!b) { bases[n] = null; return; }
    // Buscar la fila del corredor en las tablas restauradas
    const fila = [...document.querySelectorAll("#tablaVisitante tbody tr, #tablaLocal tbody tr")]
      .find(tr => tr.children[0].textContent === b.nombre);
    bases[n] = fila ? { nombre: b.nombre, fila } : null;
  });

  // Restaurar pitcher containers manuales
  function restaurarPitContainers(equipo, pitchers) {
    const containerId = equipo === "visitante" ? "pitchersVsVisitanteContainer" : "pitchersVsLocalContainer";
    const container = document.getElementById(containerId);
    if (!container || !pitchers) return;
    container.innerHTML = "";
    pitchers.forEach(({ nombre, outs }) => {
      agregarFilaPitcherConValor(equipo, nombre, outs);
    });
  }
  restaurarPitContainers("visitante", estado.pitContainerVisitante);
  restaurarPitContainers("local",     estado.pitContainerLocal);

  // Restaurar bateador seleccionado
  if (estado.jugadorActual && estado.tablaActual) {
    const fila = [...document.querySelectorAll(`${estado.tablaActual} tbody tr`)]
      .find(tr => tr.children[0].textContent === estado.jugadorActual);
    if (fila) seleccionarFila(fila, estado.tablaActual);
  }

  // Mostrar/ocultar botones
  document.getElementById("btnIniciarJuego").style.display = "none";
  document.getElementById("btnGuardar").style.display = "block";

  // Actualizar UI
  cargarSelects();
  actualizarMarcadorUI();
  actualizarBasesUI();
  actualizarPitcherActivoUI();

  toast("🔄 Partido restaurado", 3000);
}

function limpiarEstadoPartido() {
  localStorage.removeItem("estadoPartido");
}

function ipDisplay(outs) {
  return `${Math.floor(outs/3)}.${outs%3}`;
}

// ============================================================
// NAVEGACIÓN PRINCIPAL
// ============================================================
function mostrarVista(vista, btn) {
  ["vistaJuego","vistaStats","vistaRespaldo"]
    .forEach(id => document.getElementById(id).style.display = "none");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const mapa = { juego:"vistaJuego", stats:"vistaStats", respaldo:"vistaRespaldo" };
  document.getElementById(mapa[vista]).style.display = "block";
  if (vista === "stats") cargarStats();
  if (vista === "juego") cargarSelects();
}

function mostrarTabStats(tab, btn) {
  ["tabBateo","tabPitcheoStats","tabPartidos","tabJugadores"]
    .forEach(id => document.getElementById(id).style.display = "none");
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const mapa = { bateo:"tabBateo", pitcheo:"tabPitcheoStats", partidos:"tabPartidos", jugadores:"tabJugadores" };
  document.getElementById(mapa[tab]).style.display = "block";
  if (tab === "jugadores") cargarEditorJugadores();
}

// ============================================================
// SELECCIÓN DE BATEADOR (tap en fila)
// ============================================================
document.addEventListener("click", (e) => {
  const fila = e.target.closest("tr");
  if (!fila || fila.parentElement.tagName !== "TBODY") return;
  // Detectar de qué tabla viene
  const enVisitante = fila.closest("#tablaVisitante");
  const enLocal     = fila.closest("#tablaLocal");
  if (!enVisitante && !enLocal) return; // ignorar clicks en tablas de stats
  const tablaId = enVisitante ? "#tablaVisitante" : "#tablaLocal";
  seleccionarFila(fila, tablaId);
});

// ============================================================
// PITCHERS DINÁMICOS
// ============================================================
function agregarFilaPitcher(equipo) {
  const containerId = equipo === "visitante"
    ? "pitchersVsVisitanteContainer"
    : "pitchersVsLocalContainer";
  const container = document.getElementById(containerId);

  const fila = document.createElement("div");
  fila.className = "pitcher-fila";

  // Select de jugadores
  const sel = document.createElement("select");
  sel.className = "pitcher-select";
  sel.innerHTML = `<option value="">Pitcher...</option>`;
  Object.keys(players).sort().forEach(n => {
    sel.innerHTML += `<option value="${n}">${n}</option>`;
  });

  // Input de outs
  const outLabel = document.createElement("span");
  outLabel.className = "pit-label";
  outLabel.textContent = "Outs:";

  const outInput = document.createElement("input");
  outInput.type = "number";
  outInput.min  = "0";
  outInput.max  = String(MAX_OUTS);
  outInput.value = "0";
  outInput.className = "pitcher-outs-input";
  outInput.placeholder = "0";

  // Botón eliminar fila
  const btnDel = document.createElement("button");
  btnDel.className = "btn-del-pitcher";
  btnDel.textContent = "✕";
  btnDel.onclick = () => fila.remove();

  fila.appendChild(sel);
  fila.appendChild(outLabel);
  fila.appendChild(outInput);
  fila.appendChild(btnDel);
  container.appendChild(fila);
}

function leerPitchersContainer(equipo) {
  // Devuelve array de { nombre, outs }
  const containerId = equipo === "visitante"
    ? "pitchersVsVisitanteContainer"
    : "pitchersVsLocalContainer";
  const filas = document.querySelectorAll(`#${containerId} .pitcher-fila`);
  const result = [];
  filas.forEach(fila => {
    const nombre = fila.querySelector(".pitcher-select").value;
    const outs   = parseInt(fila.querySelector(".pitcher-outs-input").value) || 0;
    if (nombre) result.push({ nombre, outs });
  });
  return result;
}

// ============================================================
// JUGADORES EN PARTIDO
// ============================================================
function agregarJugadorDesdeLista(equipo) {
  const select = document.getElementById(
    equipo === "local" ? "selectLocal" : "selectVisitante"
  );
  const nombre = select.value;
  if (!nombre) return;

  const tbody = document.querySelector(
    equipo === "local" ? "#tablaLocal tbody" : "#tablaVisitante tbody"
  );
  if ([...tbody.querySelectorAll("tr")].some(tr => tr.children[0].textContent === nombre))
    return toast("⚠️ Jugador ya está en este juego");

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${nombre}</td>
    ${Array(9).fill('<td class="stat">0</td>').join("")}
    <td class="stat-av td-ave">.000</td>
    <td class="stat-av td-ops">.000</td>
    <td class="td-acciones">
      <button class="btn-sustituir" title="Sustituir" onclick="abrirModalSustituir(this)">⇄</button>
      <button onclick="this.closest('tr').remove()">✕</button>
    </td>
  `;
  tbody.appendChild(tr);
  select.value = "";
}

// ============================================================
// ORDEN AL BATE
// ============================================================
// Selecciona el siguiente bateador en la tabla activa (visitante o local)
// La tabla activa es la del jugador actualmente seleccionado
let tablaActiva = null; // "#tablaVisitante" o "#tablaLocal"

function seleccionarFila(fila, tablaId) {
  document.querySelectorAll("tbody tr").forEach(r => r.classList.remove("activo"));
  fila.classList.add("activo");
  jugadorNombre       = fila.children[0].textContent;
  jugadorSeleccionado = fila;
  tablaActiva         = tablaId;
  actualizarStatsEnVivo();
  fila.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function actualizarStatsEnVivo() {
  const jA = document.getElementById("jugadorActivo");
  if (!jugadorSeleccionado) {
    jA.textContent = "👆 Ningún jugador seleccionado";
    jA.classList.remove("activo-global");
    refreshStatsTablas();
    return;
  }

  const celdas = jugadorSeleccionado.querySelectorAll(".stat");
  const s = [...celdas].map(td => parseInt(td.textContent) || 0);
  const H  = s[0]+s[1]+s[2]+s[3];
  const AB = H + s[5] + s[6];
  const BB = s[4];
  const TB = s[0] + 2*s[1] + 3*s[2] + 4*s[3];
  const AVE = AB ? (H/AB).toFixed(3) : ".000";
  const OBP = (AB+BB) ? ((H+BB)/(AB+BB)).toFixed(3) : ".000";
  const SLG = AB ? (TB/AB).toFixed(3) : ".000";
  const OPS = (AB+BB) ? ((H+BB)/(AB+BB) + TB/AB).toFixed(3) : ".000";

  jA.innerHTML = `
    <span class="ev-nombre">🏏 ${jugadorNombre}</span>
    <span class="ev-stat">AVE <strong>${AVE}</strong></span>
    <span class="ev-stat">OBP <strong>${OBP}</strong></span>
    <span class="ev-stat">SLG <strong>${SLG}</strong></span>
    <span class="ev-stat">OPS <strong>${OPS}</strong></span>
    <span class="ev-stat">CA <strong>${s[7]}</strong></span>
    <span class="ev-stat">CI <strong>${s[8]}</strong></span>
  `;
  jA.classList.add("activo-global");
  refreshStatsTablas();
}

// Recalcula AVE y OPS en cada fila de las tablas del partido
function refreshStatsTablas() {
  ["#tablaVisitante","#tablaLocal"].forEach(tablaId => {
    document.querySelectorAll(`${tablaId} tbody tr`).forEach(tr => {
      const celdas = tr.querySelectorAll(".stat");
      if (!celdas.length) return;
      const s = [...celdas].map(td => parseInt(td.textContent) || 0);
      const H  = s[0]+s[1]+s[2]+s[3];
      const AB = H + s[5] + s[6];
      const BB = s[4];
      const TB = s[0] + 2*s[1] + 3*s[2] + 4*s[3];
      const AVE = AB ? (H/AB).toFixed(3) : ".000";
      const OPS = (AB+BB) ? ((H+BB)/(AB+BB) + TB/AB).toFixed(3) : ".000";
      const tdAve = tr.querySelector(".td-ave");
      const tdOps = tr.querySelector(".td-ops");
      if (tdAve) tdAve.textContent = AVE;
      if (tdOps) tdOps.textContent = OPS;
    });
  });
}

// Posición del lineup por equipo — índice del SIGUIENTE bateador tras el último out
let lineupPos = { visitante: 0, local: 0 };

function siguienteBateador() {
  const tablaId = marcador.turno === "visitante" ? "#tablaVisitante" : "#tablaLocal";
  const filas = [...document.querySelectorAll(`${tablaId} tbody tr`)];
  if (!filas.length) return;

  if (!jugadorSeleccionado || tablaActiva !== tablaId) {
    // Retomar desde la posición guardada del equipo
    const pos = lineupPos[marcador.turno] % filas.length;
    seleccionarFila(filas[pos], tablaId);
    return;
  }

  const idx  = filas.indexOf(jugadorSeleccionado);
  const next = (idx + 1) % filas.length;
  lineupPos[marcador.turno] = next; // guardar posición
  seleccionarFila(filas[next], tablaId);
}

// ============================================================
// INICIO DE JUEGO
// ============================================================
function iniciarJuego() {
  const filasVisit = [...document.querySelectorAll("#tablaVisitante tbody tr")];
  const filasLocal = [...document.querySelectorAll("#tablaLocal tbody tr")];

  if (!filasVisit.length) return toast("⚠️ Agrega jugadores al equipo visitante primero");
  if (!filasLocal.length) return toast("⚠️ Agrega jugadores al equipo local primero");

  // Validar pitchers designados
  if (!pitcherActivo.local?.nombre)
    return toast("⚠️ Designa el pitcher del equipo LOCAL (lanza vs Visitante)");
  if (!pitcherActivo.visitante?.nombre)
    return toast("⚠️ Designa el pitcher del equipo VISITANTE (lanza vs Local)");

  lineupPos = { visitante: 0, local: 0 };
  marcador = { inning: 1, outs: 0, turno: "visitante", ultimoOut: null };
  actualizarMarcadorUI();
  actualizarBasesUI();

  seleccionarFila(filasVisit[0], "#tablaVisitante");
  document.getElementById("btnIniciarJuego").style.display = "none";
  document.getElementById("btnGuardar").style.display = "block";
  toast(`⚾ ¡Juego iniciado! Al bate: ${filasVisit[0].children[0].textContent}`, 3000);
}

// ============================================================
// MARCADOR
// ============================================================
// carrerasGrid[equipo][inning] = número de CA anotadas en esa entrada
// equipo: "visitante" | "local"   inning: 1-7
let marcador = {
  inning: 1,
  outs: 0,
  turno: "visitante"
};

let carrerasGrid = {
  visitante: { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 },
  local:     { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 }
};

function actualizarMarcadorUI() {
  document.getElementById("inningActual").textContent = marcador.inning;

  // Outs dots
  for (let i = 0; i < 3; i++) {
    const dot = document.getElementById("out" + i);
    if (dot) dot.classList.toggle("out-activo", i < marcador.outs);
  }

  // Turno btn
  const btn = document.getElementById("turnoBtn");
  if (btn) {
    btn.textContent = marcador.turno === "visitante" ? "🛫 VIS" : "🏠 LOC";
    btn.className   = "turno-btn " + (marcador.turno === "visitante" ? "turno-vis" : "turno-loc");
  }

  // Resaltar entrada activa
  for (let i = 1; i <= 7; i++) {
    const th = document.getElementById("sbh" + i);
    if (th) th.classList.toggle("sb-inn-activa", i === marcador.inning);
  }

  // Nombres dinámicos
  const nomV = (document.getElementById("visitante")?.value || "VISITANTE").toUpperCase().substring(0, 10);
  const nomL = (document.getElementById("local")?.value    || "LOCAL").toUpperCase().substring(0, 10);
  const sbNV = document.getElementById("sbNomVisitante");
  const sbNL = document.getElementById("sbNomLocal");
  if (sbNV) sbNV.textContent = nomV;
  if (sbNL) sbNL.textContent = nomL;

  // Pitcher activo
  actualizarPitcherActivoUI();
  let totalV = 0, totalL = 0;
  for (let i = 1; i <= 7; i++) {
    const cv = carrerasGrid.visitante[i];
    const cl = carrerasGrid.local[i];
    const celdaV = document.getElementById("v" + i);
    const celdaL = document.getElementById("l" + i);
    if (celdaV) {
      celdaV.textContent = cv > 0 ? cv : "·";
      celdaV.classList.toggle("sb-cell-activa", i === marcador.inning && marcador.turno === "visitante");
      celdaV.classList.toggle("sb-tiene-carreras", cv > 0);
    }
    if (celdaL) {
      celdaL.textContent = cl > 0 ? cl : "·";
      celdaL.classList.toggle("sb-cell-activa", i === marcador.inning && marcador.turno === "local");
      celdaL.classList.toggle("sb-tiene-carreras", cl > 0);
    }
    totalV += cv;
    totalL += cl;
  }

  const tcV = document.getElementById("totalCVisitante");
  const tcL = document.getElementById("totalCLocal");
  if (tcV) { tcV.textContent = totalV; tcV.classList.toggle("sb-ganador", totalV > totalL); }
  if (tcL) { tcL.textContent = totalL; tcL.classList.toggle("sb-ganador", totalL > totalV); }

  // Hits automáticos desde tablas
  actualizarHits();
}

function cambiarInning(delta) {
  marcador.inning = Math.min(7, Math.max(1, marcador.inning + delta));
  actualizarMarcadorUI();
}

function cambiarOuts(delta) {
  marcador.outs = Math.min(3, Math.max(0, marcador.outs + delta));
  if (delta > 0) sumarOutsPitcherActivo(delta);
  actualizarMarcadorUI();

  if (marcador.outs === 3) {
    const equipoSale = marcador.turno;
    const tablaIdSale = equipoSale === "visitante" ? "#tablaVisitante" : "#tablaLocal";
    const filasSale = [...document.querySelectorAll(`${tablaIdSale} tbody tr`)];
    if (filasSale.length && jugadorSeleccionado) {
      const idxActual = filasSale.indexOf(jugadorSeleccionado);
      if (idxActual >= 0) lineupPos[equipoSale] = (idxActual + 1) % filasSale.length;
    }

    // Guardar el jugador que hizo el último out (para regla chiller)
    marcador.ultimoOut = { nombre: jugadorNombre, tablaId: tablaActiva };

    setTimeout(() => {
      marcador.outs = 0;
      bases = { 1: null, 2: null, 3: null };

      const eraTurnoLocal = marcador.turno === "local";

      if (!eraTurnoLocal) {
        // Terminó la media entrada del visitante → turno del local
        marcador.turno = "local";
      } else {
        // Terminó la entrada completa → verificar reglas de término
        const accion = verificarTerminoEntrada();
        if (accion === "fin") return; // partido terminado
        if (accion === "derby") return; // derby de HR iniciado
        if (accion === "chiller") {
          // Iniciar inning extra con regla chiller
          marcador.inning = Math.min(7, marcador.inning + 1);
          marcador.turno  = "visitante";
          activarReglaChiller();
          actualizarMarcadorUI();
          actualizarBasesUI();
          cambiarEquipoBateador(marcador.turno);
          return;
        }
        marcador.inning = Math.min(7, marcador.inning + 1);
        marcador.turno  = "visitante";
      }

      actualizarMarcadorUI();
      actualizarBasesUI();
      cambiarEquipoBateador(marcador.turno);
    }, 800);
  }
}

// ============================================================
// REGLAS DE TÉRMINO DEL PARTIDO
// ============================================================
// Fase: "normal" | "extra" | "derby"
let fasePartido = "normal";
let derbyState  = null; // estado del derby de HR

function totalesCarreras() {
  const cV = Object.values(carrerasGrid.visitante).reduce((s,v) => s+v, 0);
  const cL = Object.values(carrerasGrid.local).reduce((s,v) => s+v, 0);
  return { cV, cL };
}

function verificarTerminoEntrada() {
  const { cV, cL } = totalesCarreras();
  const inn = marcador.inning;

  if (inn === 5 && fasePartido === "normal") {
    if (cV !== cL) {
      // Hay ganador al 5° inning → terminar
      mostrarGanador(cV > cL ? "VISITANTE" : "LOCAL", cV, cL, "5° inning");
      return "fin";
    } else {
      // Empate → 2 innings extras con regla chiller
      fasePartido = "extra";
      toast("⚾ Empate al 5° inning — 2 innings extras con regla chiller", 4000);
      return "chiller";
    }
  }

  if (inn === 7 && fasePartido === "extra") {
    if (cV !== cL) {
      mostrarGanador(cV > cL ? "VISITANTE" : "LOCAL", cV, cL, "innings extras");
      return "fin";
    } else {
      // Sigue empatado → derby de HR
      fasePartido = "derby";
      setTimeout(() => iniciarDerby(), 600);
      return "derby";
    }
  }

  return "continuar";
}

function mostrarGanador(equipo, cV, cL, momento) {
  const modal = document.getElementById("modalFinPartido");
  document.getElementById("finGanador").textContent  = `🏆 ${equipo}`;
  document.getElementById("finMarcador").textContent = `${cV} — ${cL}`;
  document.getElementById("finMomento").textContent  = `Partido terminado en el ${momento}`;
  if (modal) modal.style.display = "flex";
}

function cerrarFinPartido(guardar) {
  document.getElementById("modalFinPartido").style.display = "none";
  if (guardar) {
    guardarPartido(); // guarda stats y hace reset completo automáticamente
  } else {
    limpiarEstadoPartido();
    resetJuego();
    cargarSelects();
    toast("🗑 Partido descartado — listo para nuevo partido");
  }
}

// ============================================================
// REGLA CHILLER — último out pasa a 2B al inicio del inning
// ============================================================
function activarReglaChiller() {
  if (!marcador.ultimoOut?.nombre) return;
  const { nombre, tablaId } = marcador.ultimoOut;
  const fila = [...document.querySelectorAll(`${tablaId} tbody tr`)]
    .find(tr => tr.children[0].textContent === nombre);
  if (!fila) return;

  // Poner al jugador en 2B
  bases[2] = { nombre, fila };
  actualizarBasesUI();
  toast(`⚾ Regla chiller: ${nombre} inicia en 2B`, 3500);
}

// ============================================================
// DERBY DE HOME RUNS
// 3 bateadores por equipo, 3 swings c/u → más HR total gana
// ============================================================
function iniciarDerby() {
  derbyState = {
    ronda:        1,
    turno:        "visitante",  // visitante batea primero
    bateadorIdx:  0,            // 0,1,2 (3 bateadores)
    swingsRestantes: 3,
    hrVisitante:  0,
    hrLocal:      0,
    rondaHRVisit: 0,
    rondaHRLocal: 0,
    bateadoresVisit: [],        // se llenarán al abrir
    bateadoresLocal: [],
  };

  // Cargar nombres de bateadores desde las tablas
  derbyState.bateadoresVisit = [...document.querySelectorAll("#tablaVisitante tbody tr")]
    .slice(0, 3).map(tr => tr.children[0].textContent);
  derbyState.bateadoresLocal = [...document.querySelectorAll("#tablaLocal tbody tr")]
    .slice(0, 3).map(tr => tr.children[0].textContent);

  document.getElementById("modalDerby").style.display = "flex";
  actualizarDerbyUI();
}

function bateadorActualDerby() {
  const lista = derbyState.turno === "visitante"
    ? derbyState.bateadoresVisit
    : derbyState.bateadoresLocal;
  return lista[derbyState.bateadorIdx] || `Bateador ${derbyState.bateadorIdx + 1}`;
}

function actualizarDerbyUI() {
  if (!derbyState) return;
  const totalBateadores = 3;
  const bateadorNum = derbyState.bateadorIdx + 1;
  const equipoLabel = derbyState.turno === "visitante" ? "🛫 VISITANTE" : "🏠 LOCAL";
  const nombre = bateadorActualDerby();

  document.getElementById("derbyRonda").textContent    = `Ronda ${derbyState.ronda}`;
  document.getElementById("derbyTurno").textContent    = `${equipoLabel} — Bateador ${bateadorNum}/${totalBateadores}`;
  document.getElementById("derbyBateador").textContent = nombre;
  document.getElementById("derbySwings").textContent   = `Swings restantes: ${derbyState.swingsRestantes}`;
  document.getElementById("derbyHRVis").textContent    = derbyState.rondaHRVisit;
  document.getElementById("derbyHRLoc").textContent    = derbyState.rondaHRLocal;
  document.getElementById("derbyTotalVis").textContent = derbyState.hrVisitante;
  document.getElementById("derbyTotalLoc").textContent = derbyState.hrLocal;
}

function derbyHR() {
  if (!derbyState) return;
  if (derbyState.turno === "visitante") {
    derbyState.rondaHRVisit++;
    derbyState.hrVisitante++;
  } else {
    derbyState.rondaHRLocal++;
    derbyState.hrLocal++;
  }
  derbyState.swingsRestantes--;
  if (derbyState.swingsRestantes <= 0) derbySiguienteBateador();
  else actualizarDerbyUI();
}

function derbyOut() {
  if (!derbyState) return;
  derbyState.swingsRestantes--;
  if (derbyState.swingsRestantes <= 0) derbySiguienteBateador();
  else actualizarDerbyUI();
}

function derbySiguienteBateador() {
  derbyState.bateadorIdx++;
  derbyState.swingsRestantes = 3;

  if (derbyState.bateadorIdx < 3) {
    // Siguiente bateador del mismo equipo
    actualizarDerbyUI();
    return;
  }

  // Terminó el equipo → cambiar turno o cerrar ronda
  derbyState.bateadorIdx = 0;

  if (derbyState.turno === "visitante") {
    derbyState.turno = "local";
    actualizarDerbyUI();
    toast("⚾ Turno del LOCAL en el derby", 2500);
  } else {
    // Terminó la ronda completa
    if (derbyState.rondaHRVisit !== derbyState.rondaHRLocal) {
      const ganador = derbyState.rondaHRVisit > derbyState.rondaHRLocal ? "VISITANTE" : "LOCAL";
      document.getElementById("modalDerby").style.display = "none";
      const { cV, cL } = totalesCarreras();
      mostrarGanador(ganador, cV, cL, `Derby de HR (Ronda ${derbyState.ronda})`);
      derbyState  = null;
      fasePartido = "normal";
    } else {
      // Nueva ronda
      derbyState.ronda++;
      derbyState.turno = "visitante";
      derbyState.rondaHRVisit = 0;
      derbyState.rondaHRLocal = 0;
      actualizarDerbyUI();
      toast(`⚾ Empate — Ronda ${derbyState.ronda} del derby`, 2500);
    }
  }
}

// Cambia al equipo correcto y selecciona el bateador según posición guardada del lineup
function cambiarEquipoBateador(turno) {
  const tablaId = turno === "visitante" ? "#tablaVisitante" : "#tablaLocal";
  const filas = [...document.querySelectorAll(`${tablaId} tbody tr`)];
  if (!filas.length) {
    jugadorSeleccionado = null;
    jugadorNombre = null;
    tablaActiva = null;
    const jA = document.getElementById("jugadorActivo");
    jA.textContent = `⚾ Turno: ${turno === "visitante" ? "VISITANTE" : "LOCAL"} — sin jugadores`;
    jA.classList.add("activo-global");
    return;
  }

  // Continuar desde la posición guardada del lineup de este equipo
  const pos  = (lineupPos[turno] || 0) % filas.length;
  const fila = filas[pos];
  seleccionarFila(fila, tablaId);

  const nombre = fila.children[0].textContent;
  const msg = turno === "local"
    ? `⚾ 3 outs — Turno LOCAL · Al bate: ${nombre}`
    : `⚾ 3 outs — Entrada ${marcador.inning} · Al bate: ${nombre}`;
  toast(msg, 3000);
}

// ============================================================
// PITCHER ACTIVO — cada equipo tiene el suyo independiente
// pitcherActivo[equipo] = { nombre } | null
// outsPitcher[equipo][nombre] = outs acumulados en este partido
// Los outs se acumulan al pitcher del equipo CONTRARIO al que batea
// (el pitcher del local enfrenta al visitante y viceversa)
// ============================================================
let pitcherActivo = { visitante: null, local: null };
let outsPitcher   = { visitante: {}, local: {} };
let _equipoSelectorPitcher = null; // equipo cuyo pitcher se está cambiando

function equipoPitcherActivo() {
  // Devuelve el equipo del pitcher que AHORA lanza (opuesto al que batea)
  return marcador.turno === "visitante" ? "local" : "visitante";
}

function actualizarPitcherActivoUI() {
  const elL = document.getElementById("pitcherNombreLocal");
  const elV = document.getElementById("pitcherNombreVisitante");
  if (elL) elL.textContent = pitcherActivo.local?.nombre    || "—";
  if (elV) elV.textContent = pitcherActivo.visitante?.nombre || "—";
}

function abrirSelectorPitcherActivo() {
  // Abrir selector para el pitcher que está lanzando AHORA
  _equipoSelectorPitcher = equipoPitcherActivo();
  const turno = _equipoSelectorPitcher === "local" ? "LOCAL (lanza vs VIS)" : "VISITANTE (lanza vs LOC)";
  document.getElementById("modalPitcherEquipo").textContent = turno;
  _renderListaPitcher();
  document.getElementById("modalPitcherActivo").style.display = "flex";
}

function abrirSelectorPitcherEquipo(equipo) {
  _equipoSelectorPitcher = equipo;
  const turno = equipo === "local" ? "LOCAL (lanza vs VIS)" : "VISITANTE (lanza vs LOC)";
  document.getElementById("modalPitcherEquipo").textContent = turno;
  _renderListaPitcher();
  document.getElementById("modalPitcherActivo").style.display = "flex";
}

function _renderListaPitcher() {
  const lista = document.getElementById("modalPitcherLista");
  lista.innerHTML = "";

  // vs VIS → pitcher del LOCAL | vs LOC → pitcher del VISITANTE
  const tablaId = _equipoSelectorPitcher === "local"
    ? "#tablaLocal tbody tr"
    : "#tablaVisitante tbody tr";

  const filas = [...document.querySelectorAll(tablaId)];

  if (!filas.length) {
    const equipo = _equipoSelectorPitcher === "local" ? "local" : "visitante";
    lista.innerHTML = `<p style='color:#aaa;font-size:13px;padding:8px'>Agrega jugadores al equipo ${equipo} primero</p>`;
    return;
  }

  filas.forEach(fila => {
    const nombre = fila.children[0].textContent;
    const btn = document.createElement("button");
    btn.className = "modal-jugador-btn";
    const outs = outsPitcher[_equipoSelectorPitcher]?.[nombre] || 0;
    btn.textContent = nombre + (outs > 0 ? ` · ${ipDisplay(outs)} IP` : "");
    if (pitcherActivo[_equipoSelectorPitcher]?.nombre === nombre) btn.classList.add("modal-jugador-btn-activo");
    btn.onclick = () => {
      pitcherActivo[_equipoSelectorPitcher] = { nombre };
      actualizarPitcherActivoUI();
      document.getElementById("modalPitcherActivo").style.display = "none";
      toast(`🥎 Pitcher ${_equipoSelectorPitcher === "local" ? "LOCAL" : "VIS"}: ${nombre}`);
      guardarEstadoPartido();
    };
    lista.appendChild(btn);
  });
}

function cerrarSelectorPitcherActivo() {
  document.getElementById("modalPitcherActivo").style.display = "none";
}

// Suma outs al pitcher del equipo contrario al que batea
function sumarOutsPitcherActivo(cantidad) {
  const equipo = equipoPitcherActivo();
  const pitcher = pitcherActivo[equipo];
  if (!pitcher) return;
  if (!outsPitcher[equipo][pitcher.nombre]) outsPitcher[equipo][pitcher.nombre] = 0;
  outsPitcher[equipo][pitcher.nombre] += cantidad;
}

function toggleTurno() {
  marcador.turno = marcador.turno === "visitante" ? "local" : "visitante";
  bases = { 1: null, 2: null, 3: null };
  actualizarBasesUI();
  actualizarMarcadorUI();
}

// ============================================================
// BASES — asignación manual con selector
// bases[n] = null | { nombre, fila }
// ============================================================
let bases = { 1: null, 2: null, 3: null };
let _baseSeleccionando = null;

function abrirSelectorBase(n) {
  _baseSeleccionando = n;
  document.getElementById("modalBaseNum").textContent = n + "B";

  const tablaId = marcador.turno === "visitante" ? "#tablaVisitante" : "#tablaLocal";
  const filas   = [...document.querySelectorAll(`${tablaId} tbody tr`)];
  const lista   = document.getElementById("modalBaseLista");
  lista.innerHTML = "";

  if (!filas.length) {
    lista.innerHTML = "<p style='color:#aaa;font-size:13px;padding:8px'>Sin jugadores en el equipo</p>";
  } else {
    filas.forEach(fila => {
      const nombre  = fila.children[0].textContent;
      const btn     = document.createElement("button");
      btn.className = "modal-jugador-btn";
      const yaEnBase = [1,2,3].find(b => b !== n && bases[b]?.nombre === nombre);
      btn.textContent = nombre + (yaEnBase ? ` · en ${yaEnBase}B` : "");
      if (bases[n]?.nombre === nombre) btn.classList.add("modal-jugador-btn-activo");
      btn.onclick = () => { bases[n] = { nombre, fila }; actualizarBasesUI(); document.getElementById("modalBase").style.display = "none"; };
      lista.appendChild(btn);
    });
  }
  document.getElementById("modalBase").style.display = "flex";
}

function limpiarBase() {
  if (_baseSeleccionando !== null) { bases[_baseSeleccionando] = null; actualizarBasesUI(); }
  document.getElementById("modalBase").style.display = "none";
  _baseSeleccionando = null;
}

function cerrarSelectorBase() {
  document.getElementById("modalBase").style.display = "none";
  _baseSeleccionando = null;
}

function actualizarBasesUI() {
  [1, 2, 3].forEach(n => {
    const el    = document.getElementById("base" + n);
    const label = document.getElementById("baseLabel" + n);
    if (!el) return;
    const jugador = bases[n];
    el.classList.toggle("base-ocupada", jugador !== null);
    if (label) label.textContent = jugador ? jugador.nombre.split(" ")[0] : "";
  });
}

// Calcula quién anota según la jugada y mueve corredores
// Devuelve lista de { nombre, fila } que anotaron
function procesarJugada(bateadorNombre, bateadorFila, tipo) {
  const anotaron = [];
  const b1 = bases[1], b2 = bases[2], b3 = bases[3];

  if (tipo === 3) {
    // HR: todos anotan incluyendo bateador
    if (b3) anotaron.push(b3);
    if (b2) anotaron.push(b2);
    if (b1) anotaron.push(b1);
    anotaron.push({ nombre: bateadorNombre, fila: bateadorFila });
    bases = { 1: null, 2: null, 3: null };
  } else if (tipo === 2) {
    // 3B: 3B y 2B anotan, 1B→3B, bateador→3B si no hay nadie
    if (b3) anotaron.push(b3);
    if (b2) anotaron.push(b2);
    bases = { 1: null, 2: null, 3: b1 || { nombre: bateadorNombre, fila: bateadorFila } };
  } else if (tipo === 1) {
    // 2B: 3B anota, 1B→3B, bateador→2B
    if (b3) anotaron.push(b3);
    bases = { 1: null, 2: { nombre: bateadorNombre, fila: bateadorFila }, 3: b1 };
  } else if (tipo === 0) {
    // 1B: 3B anota, 2B→3B, 1B→2B, bateador→1B
    if (b3) anotaron.push(b3);
    bases = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b1, 3: b2 };
  } else if (tipo === 4) {
    // BB forzado
    if (b1 && b2 && b3) { anotaron.push(b3); bases = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b1, 3: b2 }; }
    else if (b1 && b2)  bases = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b1, 3: b2 };
    else if (b1)        bases = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b1, 3: b3 };
    else                bases = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b2, 3: b3 };
  }

  actualizarBasesUI();
  return anotaron;
}

// ============================================================
// MODAL RESULTADO JUGADA — editable
// ============================================================
const NOMBRES_JUGADA = ["1B","2B","3B","HR","BB","K","O"];

// Estado del modal
let _mj = {
  bateadorNombre: "",
  bateadorFila:   null,
  tipo:           -1,
  basesPropoestas: { 1: null, 2: null, 3: null }, // copia editable
  anotadores:     [],  // [{ nombre, fila }] — corredores que anotan
  ci:             0,
  outsExtra:      0,
  _selectorTarget: null, // "base1"|"base2"|"base3"|"anotador"
};

function abrirModalJugada(tipoJugada) {
  _mj.bateadorNombre  = jugadorNombre;
  _mj.bateadorFila    = jugadorSeleccionado;
  _mj.tipo            = tipoJugada;
  _mj.outsExtra       = 0;

  // Calcular bases propuestas y anotadores usando lógica automática
  const { basesNuevas, anotaron } = calcularJugada(jugadorNombre, jugadorSeleccionado, tipoJugada);
  _mj.basesPropoestas = basesNuevas;
  _mj.anotadores      = anotaron;

  // CI sugeridas:
  // HR → CI = todos los que anotan (corredores + el bateador mismo)
  // Otros → CI = solo corredores que anotaron (no el bateador)
  _mj.ci = tipoJugada === 3
    ? anotaron.length              // HR: todos los que anotan = CI del bateador
    : anotaron.filter(a => a.nombre !== jugadorNombre).length;

  renderModalJugada();
  document.getElementById("modalJugada").style.display = "flex";
}

function calcularJugada(bateadorNombre, bateadorFila, tipo) {
  const anotaron = [];
  const b1 = bases[1], b2 = bases[2], b3 = bases[3];
  let basesNuevas = { 1: null, 2: null, 3: null };

  if (tipo === 3) {
    if (b3) anotaron.push(b3);
    if (b2) anotaron.push(b2);
    if (b1) anotaron.push(b1);
    anotaron.push({ nombre: bateadorNombre, fila: bateadorFila });
  } else if (tipo === 2) {
    if (b3) anotaron.push(b3);
    if (b2) anotaron.push(b2);
    basesNuevas[3] = b1 || { nombre: bateadorNombre, fila: bateadorFila };
  } else if (tipo === 1) {
    if (b3) anotaron.push(b3);
    basesNuevas[2] = { nombre: bateadorNombre, fila: bateadorFila };
    basesNuevas[3] = b1;
  } else if (tipo === 0) {
    if (b3) anotaron.push(b3);
    basesNuevas[1] = { nombre: bateadorNombre, fila: bateadorFila };
    basesNuevas[2] = b1;
    basesNuevas[3] = b2;
  } else if (tipo === 4) {
    if (b1 && b2 && b3) { anotaron.push(b3); basesNuevas = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b1, 3: b2 }; }
    else if (b1 && b2)  basesNuevas = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b1, 3: b2 };
    else if (b1)        basesNuevas = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b1, 3: b3 };
    else                basesNuevas = { 1: { nombre: bateadorNombre, fila: bateadorFila }, 2: b2, 3: b3 };
  }
  return { basesNuevas, anotaron };
}

function renderModalJugada() {
  document.getElementById("mj-bateador").textContent = _mj.bateadorNombre;
  document.getElementById("mj-tipo").textContent     = NOMBRES_JUGADA[_mj.tipo] || "";
  document.getElementById("mj-outsExtra").textContent = _mj.outsExtra;
  document.getElementById("mj-ci").textContent        = _mj.ci;

  // Bases propuestas
  [1, 2, 3].forEach(n => {
    const el = document.getElementById("mj-base" + n + "-nombre");
    if (el) el.textContent = _mj.basesPropoestas[n]?.nombre || "—";
  });

  // Anotadores
  const div = document.getElementById("mj-anotadores");
  div.innerHTML = "";
  if (_mj.anotadores.length === 0) {
    div.innerHTML = "<p style='font-size:12px;color:#aaa;margin:4px 0'>Ninguno</p>";
  } else {
    _mj.anotadores.forEach((a, idx) => {
      const row = document.createElement("div");
      row.className = "mj-anotador-row";
      row.innerHTML = `<span class="mj-anotador-nombre">🏃 ${a.nombre}</span>
        <button class="mj-base-vaciar" onclick="quitarAnotador(${idx})">✕</button>`;
      div.appendChild(row);
    });
  }
}

function cambiarMJ(campo, delta) {
  if (campo === "outsExtra") _mj.outsExtra = Math.min(2, Math.max(0, _mj.outsExtra + delta));
  if (campo === "ci")        _mj.ci        = Math.max(0, _mj.ci + delta);
  renderModalJugada();
}

function vaciarBaseModal(n) {
  _mj.basesPropoestas[n] = null;
  renderModalJugada();
}

function quitarAnotador(idx) {
  _mj.anotadores.splice(idx, 1);
  renderModalJugada();
}

// Abrir selector para cambiar quién está en una base del modal
function abrirSelectorBaseModal(n) {
  _mj._selectorTarget = "base" + n;
  document.getElementById("mj-selector-titulo").textContent = "¿Quién está en " + n + "B?";
  abrirSelectorJugadorModal();
}

function abrirSelectorAnotador() {
  _mj._selectorTarget = "anotador";
  document.getElementById("mj-selector-titulo").textContent = "¿Quién anotó?";
  abrirSelectorJugadorModal();
}

function abrirSelectorJugadorModal() {
  const tablaId = marcador.turno === "visitante" ? "#tablaVisitante" : "#tablaLocal";
  const filas   = [...document.querySelectorAll(`${tablaId} tbody tr`)];
  const lista   = document.getElementById("mj-selector-lista");
  lista.innerHTML = "";
  filas.forEach(fila => {
    const nombre = fila.children[0].textContent;
    const btn    = document.createElement("button");
    btn.className = "modal-jugador-btn";
    btn.textContent = nombre;
    btn.onclick = () => { seleccionarJugadorModal(nombre, fila); };
    lista.appendChild(btn);
  });
  document.getElementById("modalSelectorJugador").style.display = "flex";
}

function seleccionarJugadorModal(nombre, fila) {
  document.getElementById("modalSelectorJugador").style.display = "none";
  const target = _mj._selectorTarget;
  if (target === "anotador") {
    if (!_mj.anotadores.find(a => a.nombre === nombre)) {
      _mj.anotadores.push({ nombre, fila });
    }
  } else if (target === "base1") _mj.basesPropoestas[1] = { nombre, fila };
  else if (target === "base2")   _mj.basesPropoestas[2] = { nombre, fila };
  else if (target === "base3")   _mj.basesPropoestas[3] = { nombre, fila };
  _mj._selectorTarget = null;
  renderModalJugada();
}

function cerrarSelectorJugador() {
  document.getElementById("modalSelectorJugador").style.display = "none";
  _mj._selectorTarget = null;
}

function confirmarJugada() {
  // 1. Aplicar bases propuestas (las que el usuario editó)
  bases = { ..._mj.basesPropoestas };
  actualizarBasesUI();

  // 2. Outs adicionales (doble play, corredor cogido)
  if (_mj.outsExtra > 0) {
    cambiarOuts(_mj.outsExtra);
  }

  // 3. CA individual por cada corredor que anotó
  _mj.anotadores.forEach(a => {
    const celdas = a.fila.querySelectorAll(".stat");
    if (celdas[7]) celdas[7].textContent = (parseInt(celdas[7].textContent) || 0) + 1;
    registrarCarreraEnMarcador(1);
  });

  // 4. CI al bateador
  if (_mj.ci > 0 && _mj.bateadorFila) {
    const celdas = _mj.bateadorFila.querySelectorAll(".stat");
    if (celdas[8]) celdas[8].textContent = (parseInt(celdas[8].textContent) || 0) + _mj.ci;
  }

  document.getElementById("modalJugada").style.display = "none";
  actualizarStatsEnVivo();
  setTimeout(siguienteBateador, 150);
  guardarEstadoPartido();
}

function registrarCarreraEnMarcador(delta) {
  const equipo = marcador.turno;
  const inn    = marcador.inning;
  carrerasGrid[equipo][inn] = Math.max(0, (carrerasGrid[equipo][inn] || 0) + delta);
  actualizarMarcadorUI();
}

function actualizarHits() {
  function sumarHits(tablaId) {
    let h = 0;
    document.querySelectorAll(`${tablaId} tbody tr`).forEach(tr => {
      const celdas = tr.querySelectorAll(".stat");
      for (let c = 0; c < 4; c++) h += parseInt(celdas[c]?.textContent) || 0;
    });
    return h;
  }
  const hV = document.getElementById("totalHVisitante");
  const hL = document.getElementById("totalHLocal");
  if (hV) hV.textContent = sumarHits("#tablaVisitante");
  if (hL) hL.textContent = sumarHits("#tablaLocal");
}

function actualizarTotales() { actualizarMarcadorUI(); }

function resetMarcador() {
  marcador = { inning: 1, outs: 0, turno: "visitante", ultimoOut: null };
  bases = { 1: null, 2: null, 3: null };
  lineupPos = { visitante: 0, local: 0 };
  pitcherActivo = { visitante: null, local: null };
  outsPitcher   = { visitante: {}, local: {} };
  fasePartido = "normal";
  derbyState  = null;
  actualizarBasesUI();
  carrerasGrid = {
    visitante: { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 },
    local:     { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 }
  };
  actualizarMarcadorUI();
}

// ============================================================
// ============================================================
// HISTORIAL PARA DESHACER
// ============================================================
let historialJugadas = [];

function registrar(i) {
  if (!jugadorSeleccionado) return toast("⚠️ Selecciona un bateador");
  const celdas = jugadorSeleccionado.querySelectorAll(".stat");
  if (!celdas[i]) return;
  const valorAnterior = parseInt(celdas[i].textContent) || 0;
  celdas[i].textContent = valorAnterior + 1;

  historialJugadas.push({ fila: jugadorSeleccionado, nombre: jugadorNombre, idx: i, valorAnterior, outsAntes: marcador.outs });
  if (historialJugadas.length > 20) historialJugadas.shift();

  if (i < 4) actualizarHits();

  if (i === 5) { // K — solo out, sin modal
    cambiarOuts(1);
    setTimeout(siguienteBateador, 250);
    setTimeout(guardarEstadoPartido, 900);
    actualizarStatsEnVivo();
    return;
  }

  if (i === 6) { // O — out + modal
    cambiarOuts(1);
    setTimeout(() => abrirModalJugada(i), 200);
    actualizarStatsEnVivo();
    return;
  }

  // 1B,2B,3B,HR,BB → modal
  setTimeout(() => abrirModalJugada(i), 200);
  actualizarStatsEnVivo();
}

function deshacerUltimaJugada() {
  if (!historialJugadas.length) return toast("⚠️ No hay jugadas para deshacer");
  const j = historialJugadas.pop();
  const celdas = j.fila.querySelectorAll(".stat");
  if (celdas[j.idx]) celdas[j.idx].textContent = j.valorAnterior;
  if (j.idx === 5 || j.idx === 6) cambiarOuts(-1);
  document.querySelectorAll("tbody tr").forEach(r => r.classList.remove("activo"));
  j.fila.classList.add("activo");
  jugadorSeleccionado = j.fila;
  jugadorNombre = j.nombre;
  actualizarHits();
  actualizarStatsEnVivo();
  guardarEstadoPartido();
  toast(`↩ Deshecho: ${j.nombre}`);
}

// ============================================================
// SUSTITUCIÓN DE JUGADOR
// ============================================================
let _sustituirFila = null;

function abrirModalSustituir(btn) {
  _sustituirFila = btn.closest("tr");
  const nombreSale = _sustituirFila.children[0].textContent;
  document.getElementById("sustituirSale").textContent = nombreSale;

  // Determinar en qué tabla está
  const enVisitante = _sustituirFila.closest("#tablaVisitante");
  const tablaId = enVisitante ? "#tablaVisitante" : "#tablaLocal";
  const selectId = enVisitante ? "selectVisitante" : "selectLocal";

  // Jugadores del mismo equipo ya en el partido (para excluir)
  const yaEnPartido = [...document.querySelectorAll(`${tablaId} tbody tr`)]
    .map(tr => tr.children[0].textContent);

  // Opciones: todos los jugadores del equipo en el select, que no estén ya en la tabla
  const select = document.getElementById(selectId);
  const opciones = [...select.options]
    .map(o => o.value)
    .filter(v => v && !yaEnPartido.includes(v));

  const lista = document.getElementById("sustituirLista");
  lista.innerHTML = "";

  if (!opciones.length) {
    lista.innerHTML = "<p style='color:#aaa;font-size:13px;padding:8px'>No hay jugadores disponibles para sustituir</p>";
  } else {
    opciones.forEach(nombre => {
      const btn = document.createElement("button");
      btn.className = "modal-jugador-btn";
      btn.textContent = nombre;
      btn.onclick = () => aplicarSustitucion(nombre);
      lista.appendChild(btn);
    });
  }

  document.getElementById("modalSustituir").style.display = "flex";
}

function aplicarSustitucion(nombreEntra) {
  if (!_sustituirFila) return;

  const nombreSale = _sustituirFila.children[0].textContent;

  // Guardar stats del jugador que sale (ya acumuladas en la celda)
  const stats = [..._sustituirFila.querySelectorAll(".stat")]
    .map(td => parseInt(td.textContent) || 0);

  // Cambiar nombre en la fila — conservar stats acumuladas
  _sustituirFila.children[0].textContent = nombreEntra;

  // Si el jugador que sale estaba seleccionado, actualizar referencia
  if (jugadorNombre === nombreSale) {
    jugadorNombre = nombreEntra;
    const jA = document.getElementById("jugadorActivo");
    jA.textContent = `🏏 Al bate: ${nombreEntra}`;
  }

  // Si estaba en una base, actualizar el nombre del corredor
  [1, 2, 3].forEach(n => {
    if (bases[n]?.nombre === nombreSale) {
      bases[n].nombre = nombreEntra;
      bases[n].fila   = _sustituirFila;
    }
  });
  actualizarBasesUI();

  document.getElementById("modalSustituir").style.display = "none";
  _sustituirFila = null;
  guardarEstadoPartido();
  toast(`✅ ${nombreSale} → ${nombreEntra}`);
}

function cerrarModalSustituir() {
  document.getElementById("modalSustituir").style.display = "none";
  _sustituirFila = null;
}

// ============================================================
// FIELDER'S CHOICE (FC)
// ============================================================
function registrarFC() {
  if (!jugadorSeleccionado) return toast("⚠️ Selecciona un bateador");
  if (modoEdicion) return toast("ℹ️ FC solo disponible en modo Sumar");

  // Necesita al menos un corredor en base para haber FC
  const corredores = [1,2,3].filter(n => bases[n] !== null).map(n => ({ base: n, ...bases[n] }));
  if (!corredores.length) return toast("⚠️ No hay corredores en base para FC");

  document.getElementById("fc-bateador").textContent = jugadorNombre;
  const lista = document.getElementById("fc-lista");
  lista.innerHTML = "";

  corredores.forEach(({ base, nombre, fila }) => {
    const btn = document.createElement("button");
    btn.className = "modal-jugador-btn";
    btn.textContent = `Out en ${base}B — ${nombre}`;
    btn.onclick = () => aplicarFC(base, nombre, fila);
    lista.appendChild(btn);
  });

  document.getElementById("modalFC").style.display = "flex";
}

function aplicarFC(baseOut, nombreOut, filaOut) {
  document.getElementById("modalFC").style.display = "none";

  // Registrar O al bateador actual (llegó a 1B pero se le cuenta el FC como out al equipo)
  // En béisbol FC no es hit — no suma al AVE como hit, cuenta como AB
  // Aquí lo registramos como O en la tabla del bateador para el conteo correcto
  const celdasBat = jugadorSeleccionado.querySelectorAll(".stat");
  if (celdasBat[6]) celdasBat[6].textContent = (parseInt(celdasBat[6].textContent) || 0) + 1;

  // Sumar out al marcador
  cambiarOuts(1);

  // Mover bateador a 1B y quitar al corredor que fue puesto out
  const bateadorRef = { nombre: jugadorNombre, fila: jugadorSeleccionado };
  bases[baseOut] = null; // corredor out — eliminado de base

  // Reubicar bateador en 1B (si estaba libre, si no desplaza)
  // Avance conservador: solo el bateador llega a 1B, los demás corredores no avanzan
  if (!bases[1]) {
    bases[1] = bateadorRef;
  } else {
    // 1B ocupada — el bateador se queda pero el corredor original avanzó
    bases[1] = bateadorRef;
  }

  actualizarBasesUI();
  setTimeout(siguienteBateador, 300);
}

function cerrarFC() {
  document.getElementById("modalFC").style.display = "none";
}

// ============================================================
// EDITAR JUGADORES
// ============================================================
function cargarEditorJugadores() {
  const div = document.getElementById("listaJugadoresEdit");
  div.innerHTML = "";
  const nombres = Object.keys(players).sort();

  if (!nombres.length) {
    div.innerHTML = "<p class='empty-msg'>Sin jugadores</p>"; return;
  }

  nombres.forEach(nombre => {
    const card = document.createElement("div");
    card.className = "edit-jugador-card";
    card.innerHTML = `
      <input class="edit-jugador-input" value="${nombre}" id="edit-${CSS.escape(nombre)}" autocomplete="off">
      <button class="edit-jugador-btn" onclick="guardarNombreJugador('${nombre}')">✓</button>
      <button class="edit-jugador-del" onclick="eliminarJugadorGlobal('${nombre}')" title="Eliminar jugador">🗑</button>
    `;
    div.appendChild(card);
  });
}

function guardarNombreJugador(nombreAnterior) {
  const input = document.getElementById("edit-" + CSS.escape(nombreAnterior));
  if (!input) return;
  const nuevoNombre = input.value.trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (!nuevoNombre || nuevoNombre === nombreAnterior) return;
  if (players[nuevoNombre]) return toast(`⚠️ "${nuevoNombre}" ya existe`);

  // Validar apellido
  if (nuevoNombre.trim().split(/\s+/).length < 2) return toast("⚠️ Debe tener nombre Y apellido");

  // Renombrar en players
  players[nuevoNombre] = players[nombreAnterior];
  delete players[nombreAnterior];

  // Renombrar en pitchers
  if (pitchers[nombreAnterior]) {
    pitchers[nuevoNombre] = pitchers[nombreAnterior];
    delete pitchers[nombreAnterior];
  }

  // Renombrar en partidos
  partidos.forEach(p => {
    [p.jugadores, p.jugVisitante, p.jugLocal].forEach(lista =>
      lista?.forEach(j => { if (j.nombre === nombreAnterior) j.nombre = nuevoNombre; })
    );
    [...(p.pitVsVisit||[]), ...(p.pitVsLocal||[])].forEach(x => {
      if (x.nombre === nombreAnterior) x.nombre = nuevoNombre;
    });
  });

  guardarStorage();
  cargarSelects();           // actualiza desplegables
  cargarEditorJugadores();   // actualiza lista editor
  cargarStats();             // actualiza tablas de stats
  toast(`✅ "${nombreAnterior}" → "${nuevoNombre}"`);
}

// ============================================================
// LEER FILAS DE BATEADORES
// ============================================================
function leerBateadores(tablaId) {
  return [...document.querySelectorAll(`${tablaId} tbody tr`)].map(tr => ({
    nombre: tr.children[0].textContent,
    stats:  [...tr.querySelectorAll(".stat")].map(td => parseInt(td.textContent) || 0)
  }));
}

// ============================================================
// ACUMULAR STATS DE BATEO COMO PITCHEO
// Recibe array de bateadores y distribuye proporcionalmente entre pitchers según outs
// ============================================================
function distribuirStatsPitcheo(bateadores, pitchersArr, fecha, partidoStr) {
  if (!pitchersArr.length) return;

  // Stats colectivas del equipo bateador
  const totalO  = bateadores.reduce((s,j) => s + j.stats[6], 0);
  const totalH  = bateadores.reduce((s,j) => s + j.stats[0]+j.stats[1]+j.stats[2]+j.stats[3], 0);
  const totalHR = bateadores.reduce((s,j) => s + j.stats[3], 0);
  const totalBB = bateadores.reduce((s,j) => s + j.stats[4], 0);
  const totalK  = bateadores.reduce((s,j) => s + j.stats[5], 0);
  const totalER = bateadores.reduce((s,j) => s + j.stats[7], 0);

  // Si solo hay un pitcher, le asignamos todo
  if (pitchersArr.length === 1) {
    const p = pitchersArr[0];
    _sumarPitcher(p.nombre, {
      H: totalH, HR: totalHR, BB: totalBB, K: totalK,
      O: p.outs || totalO,   // usar outs declarados o el total
      ER: totalER
    }, fecha, partidoStr);
    return;
  }

  // Con múltiples pitchers, distribuir proporcionalmente a sus outs declarados
  const sumaOuts = pitchersArr.reduce((s,p) => s + p.outs, 0) || 1;

  pitchersArr.forEach(p => {
    const ratio = sumaOuts ? p.outs / sumaOuts : 1 / pitchersArr.length;
    _sumarPitcher(p.nombre, {
      H:  Math.round(totalH  * ratio),
      HR: Math.round(totalHR * ratio),
      BB: Math.round(totalBB * ratio),
      K:  Math.round(totalK  * ratio),
      O:  p.outs,
      ER: Math.round(totalER * ratio)
    }, fecha, partidoStr);
  });
}

function _sumarPitcher(nombre, s, fecha, partidoStr) {
  if (!pitchers[nombre]) pitchers[nombre] = {
    totalH:0, totalHR:0, totalBB:0, totalK:0, totalO:0, totalER:0, juegos:[]
  };
  pitchers[nombre].totalH  += s.H;
  pitchers[nombre].totalHR += s.HR;
  pitchers[nombre].totalBB += s.BB;
  pitchers[nombre].totalK  += s.K;
  pitchers[nombre].totalO  += s.O;
  pitchers[nombre].totalER += s.ER;
  pitchers[nombre].juegos.push({ fecha, partido: partidoStr, ...s });
}

// Inverso: restar stats de un partido previo
function restarStatsPitcherPartido(pitchersArr, fecha, partidoStr) {
  // Busca en pitchers[nombre].juegos el juego con esa fecha+partido y lo resta
  pitchersArr.forEach(({ nombre }) => {
    if (!pitchers[nombre]) return;
    const idx = pitchers[nombre].juegos.findIndex(
      j => j.fecha === fecha && j.partido === partidoStr
    );
    if (idx === -1) return;
    const j = pitchers[nombre].juegos[idx];
    pitchers[nombre].totalH  -= j.H;
    pitchers[nombre].totalHR -= j.HR;
    pitchers[nombre].totalBB -= j.BB;
    pitchers[nombre].totalK  -= j.K;
    pitchers[nombre].totalO  -= j.O;
    pitchers[nombre].totalER -= j.ER;
    pitchers[nombre].juegos.splice(idx, 1);
  });
}

function restarStatsJugadorPartido(jugadores, fecha) {
  jugadores.forEach(({ nombre, stats }) => {
    if (!players[nombre]) return;
    const idx = players[nombre].juegos.findIndex(j => j.fecha === fecha);
    if (idx === -1) return;
    // restar las stats de ese juego
    players[nombre].juegos[idx].stats.forEach((v, i) => {
      players[nombre].total[i] -= v;
    });
    players[nombre].juegos.splice(idx, 1);
  });
}

// ============================================================
// GUARDAR PARTIDO (nuevo o edición)
// ============================================================
function guardarPartido() {
  const fecha     = document.getElementById("fecha").value || "Sin fecha";
  const hora      = document.getElementById("hora")?.value || "";
  const fechaHora = hora ? `${fecha} ${hora}` : fecha;
  const localNom  = document.getElementById("local").value || "Local";
  const visitNom  = document.getElementById("visitante").value || "Visitante";
  const partidoStr = `${localNom} vs ${visitNom}`;

  const bateadoresVisit = leerBateadores("#tablaVisitante");
  const bateadoresLocal = leerBateadores("#tablaLocal");

  if (!bateadoresVisit.length && !bateadoresLocal.length)
    return toast("⚠️ No hay jugadores en el partido");

  // Construir pitVsVisit y pitVsLocal desde el tracking automático de outs
  // outsPitcher[equipo][nombre] = outs acumulados en el partido
  // El pitcher del equipo local enfrenta al visitante (pitVsVisit) y viceversa
  const pitVsVisit = Object.entries(outsPitcher.local).map(([nombre, outs]) => ({ nombre, outs }));
  const pitVsLocal = Object.entries(outsPitcher.visitante).map(([nombre, outs]) => ({ nombre, outs }));

  // Si no hubo tracking automático, intentar leer los contenedores manuales como fallback
  const pitVsVisitFinal = pitVsVisit.length ? pitVsVisit : leerPitchersContainer("visitante");
  const pitVsLocalFinal = pitVsLocal.length ? pitVsLocal : leerPitchersContainer("local");

  // Si estamos editando: revertir stats previas del partido
  if (editandoIdx >= 0) {
    const previo = partidos[editandoIdx];
    const prevPartidoStr = `${previo.local} vs ${previo.visitante}`;
    restarStatsJugadorPartido(previo.jugadores, previo.fecha);
    if (previo.pitVsVisit) restarStatsPitcherPartido(previo.pitVsVisit, previo.fecha, prevPartidoStr);
    if (previo.pitVsLocal) restarStatsPitcherPartido(previo.pitVsLocal, previo.fecha, prevPartidoStr);
  }

  // Acumular bateo
  const todosJugadores = [...bateadoresVisit, ...bateadoresLocal];
  todosJugadores.forEach(({ nombre, stats }) => {
    if (!players[nombre]) players[nombre] = { total: Array(9).fill(0), juegos: [] };
    players[nombre].juegos.push({ fecha, stats: [...stats] });
    stats.forEach((v, i) => players[nombre].total[i] += v);
  });

  // Acumular pitcheo
  distribuirStatsPitcheo(bateadoresVisit, pitVsVisitFinal, fecha, partidoStr);
  distribuirStatsPitcheo(bateadoresLocal, pitVsLocalFinal, fecha, partidoStr);

  // Construir objeto partido
  const partido = {
    fecha: fechaHora, local: localNom, visitante: visitNom,
    jugadores: todosJugadores,
    jugVisitante: bateadoresVisit,
    jugLocal: bateadoresLocal,
    pitVsVisit: pitVsVisitFinal, pitVsLocal: pitVsLocalFinal
  };

  if (editandoIdx >= 0) {
    partidos[editandoIdx] = partido;
    toast("✅ Partido actualizado");
  } else {
    partidos.push(partido);
    toast("✅ Partido guardado");
  }

  guardarStorage();
  limpiarEstadoPartido(); // ya no hay partido en curso
  resetJuego();
  cargarSelects();
}

// ============================================================
// EDITAR PARTIDO ANTERIOR
// ============================================================
function editarPartido(idx) {
  const p = partidos[idx];
  editandoIdx = idx;

  // Ir a vista juego
  mostrarVista("juego", document.getElementById("navJuego"));

  // Banner
  document.getElementById("editandoBanner").style.display = "flex";
  document.getElementById("editandoLabel").textContent =
    `${p.local} vs ${p.visitante} · ${p.fecha}`;
  document.getElementById("btnGuardar").textContent = "💾 Actualizar Partido";
  document.getElementById("btnGuardar").style.display = "block";
  document.getElementById("btnIniciarJuego").style.display = "none";

  // Rellenar campos
  document.getElementById("local").value     = p.local;
  document.getElementById("visitante").value = p.visitante;
  document.getElementById("fecha").value     = p.fecha;

  // Limpiar tablas
  document.querySelector("#tablaVisitante tbody").innerHTML = "";
  document.querySelector("#tablaLocal tbody").innerHTML = "";
  document.getElementById("pitchersVsVisitanteContainer").innerHTML = "";
  document.getElementById("pitchersVsLocalContainer").innerHTML = "";

  // Cargar bateadores visitante
  (p.jugVisitante || []).forEach(({ nombre, stats }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${nombre}</td>` +
      stats.map(v => `<td class="stat">${v}</td>`).join("") +
      `<td class="stat-av td-ave">.000</td>` +
      `<td class="stat-av td-ops">.000</td>` +
      `<td class="td-acciones"><button class="btn-sustituir" title="Sustituir" onclick="abrirModalSustituir(this)">⇄</button><button onclick="this.closest('tr').remove()">✕</button></td>`;
    document.querySelector("#tablaVisitante tbody").appendChild(tr);
  });

  // Cargar bateadores local
  (p.jugLocal || []).forEach(({ nombre, stats }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${nombre}</td>` +
      stats.map(v => `<td class="stat">${v}</td>`).join("") +
      `<td class="stat-av td-ave">.000</td>` +
      `<td class="stat-av td-ops">.000</td>` +
      `<td class="td-acciones"><button class="btn-sustituir" title="Sustituir" onclick="abrirModalSustituir(this)">⇄</button><button onclick="this.closest('tr').remove()">✕</button></td>`;
    document.querySelector("#tablaLocal tbody").appendChild(tr);
  });

  // Cargar pitchers
  (p.pitVsVisit || []).forEach(({ nombre, outs }) => {
    agregarFilaPitcherConValor("visitante", nombre, outs);
  });
  (p.pitVsLocal || []).forEach(({ nombre, outs }) => {
    agregarFilaPitcherConValor("local", nombre, outs);
  });

  cargarSelects();
  window.scrollTo(0, 0);
}

function agregarFilaPitcherConValor(equipo, nombre, outs) {
  const containerId = equipo === "visitante"
    ? "pitchersVsVisitanteContainer"
    : "pitchersVsLocalContainer";
  const container = document.getElementById(containerId);

  const fila = document.createElement("div");
  fila.className = "pitcher-fila";

  const sel = document.createElement("select");
  sel.className = "pitcher-select";
  sel.innerHTML = `<option value="">Pitcher...</option>`;
  Object.keys(players).sort().forEach(n => {
    sel.innerHTML += `<option value="${n}" ${n===nombre?"selected":""}>${n}</option>`;
  });

  const outLabel = document.createElement("span");
  outLabel.className = "pit-label";
  outLabel.textContent = "Outs:";

  const outInput = document.createElement("input");
  outInput.type = "number";
  outInput.min = "0"; outInput.max = String(MAX_OUTS);
  outInput.value = outs;
  outInput.className = "pitcher-outs-input";

  const btnDel = document.createElement("button");
  btnDel.className = "btn-del-pitcher";
  btnDel.textContent = "✕";
  btnDel.onclick = () => fila.remove();

  fila.appendChild(sel);
  fila.appendChild(outLabel);
  fila.appendChild(outInput);
  fila.appendChild(btnDel);
  container.appendChild(fila);
}

function cancelarEdicion() {
  editandoIdx = -1;
  resetJuego();
  document.getElementById("editandoBanner").style.display = "none";
  document.getElementById("btnGuardar").textContent = "💾 Guardar Partido";
  document.getElementById("btnGuardar").style.display = "none";
  document.getElementById("btnIniciarJuego").style.display = "block";
}

// ============================================================
// RESET JUEGO
// ============================================================
function resetJuego() {
  document.querySelector("#tablaVisitante tbody").innerHTML = "";
  document.querySelector("#tablaLocal tbody").innerHTML = "";

  // Limpiar containers de pitcher si existen (compatibilidad)
  const pVV = document.getElementById("pitchersVsVisitanteContainer");
  const pVL = document.getElementById("pitchersVsLocalContainer");
  if (pVV) pVV.innerHTML = "";
  if (pVL) pVL.innerHTML = "";

  jugadorSeleccionado = null;
  jugadorNombre = null;
  tablaActiva = null;
  historialJugadas = [];
  resetMarcador();
  fasePartido = "normal";
  derbyState  = null;

  const jA = document.getElementById("jugadorActivo");
  jA.textContent = "👆 Ningún jugador seleccionado";
  jA.classList.remove("activo-global");
  document.getElementById("local").value = "";
  document.getElementById("visitante").value = "";
  document.getElementById("fecha").value = "";
  const horaEl = document.getElementById("hora");
  if (horaEl) horaEl.value = "";
  document.getElementById("editandoBanner").style.display = "none";
  document.getElementById("btnGuardar").textContent = "💾 Guardar Partido";
  document.getElementById("btnGuardar").style.display = "none";
  document.getElementById("btnIniciarJuego").style.display = "block";
  editandoIdx = -1;
}

// ============================================================
// SELECTS DINÁMICOS
// ============================================================
function cargarSelects() {
  // Normalizar cualquier nombre en minúsculas/tildes que pudiera existir en storage
  const _norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  let necesitaGuardar = false;
  Object.keys(players).forEach(n => {
    const norm = _norm(n);
    if (norm !== n) {
      if (players[norm]) {
        players[norm].total = players[norm].total.map((v,i) => v + (players[n].total[i]||0));
        players[norm].juegos = [...(players[norm].juegos||[]), ...(players[n].juegos||[])];
      } else {
        players[norm] = players[n];
      }
      delete players[n];
      necesitaGuardar = true;
    }
  });
  if (necesitaGuardar) guardarStorage();

  const nombres = Object.keys(players).sort();
  ["selectLocal","selectVisitante"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const ph = id === "selectLocal" ? "+ Agregar jugador local" : "+ Agregar jugador visitante";
    sel.innerHTML = `<option value="">${ph}</option>`;
    nombres.forEach(n => sel.innerHTML += `<option value="${n}">${n}</option>`);
  });
  // Actualizar selects de pitcher dinámicos existentes
  document.querySelectorAll(".pitcher-select").forEach(sel => {
    const val = sel.value;
    sel.innerHTML = `<option value="">Pitcher...</option>`;
    nombres.forEach(n => sel.innerHTML += `<option value="${n}" ${n===val?"selected":""}>${n}</option>`);
  });
}

// ============================================================
// CREAR JUGADOR GLOBAL
// ============================================================
function crearJugadorGlobal() {
  const inputN = document.getElementById("nuevoNombre");
  const inputA = document.getElementById("nuevoApellido");
  if (!inputN || !inputA) return; // solo disponible en tab Jugadores

  const normalize = s => s.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const nombre   = normalize(inputN.value);
  const apellido = normalize(inputA.value);

  if (!nombre)   return toast("⚠️ Debes ingresar el nombre");
  if (!apellido) return toast("⚠️ El apellido es obligatorio");

  const nombreCompleto = `${nombre} ${apellido}`;

  // Verificar duplicado exacto
  if (players[nombreCompleto]) {
    return toast(`⚠️ "${nombreCompleto}" ya existe`);
  }

  // Verificar duplicado parcial (mismo nombre o mismo apellido+nombre invertido)
  const duplicado = Object.keys(players).find(p =>
    p.toUpperCase() === nombreCompleto
  );
  if (duplicado) return toast(`⚠️ "${duplicado}" ya existe`);

  players[nombreCompleto] = { total: Array(9).fill(0), juegos: [] };
  guardarStorage();
  inputN.value = "";
  inputA.value = "";
  cargarSelects();
  cargarEditorJugadores();
  toast(`✅ "${nombreCompleto}" creado`);
}

// ============================================================
// ESTADÍSTICAS AVANZADAS BATEO
// ============================================================
function calcularAvanzadas(s) {
  const H  = s[0]+s[1]+s[2]+s[3];
  const BB = s[4], K = s[5], O = s[6];
  const AB = H+K+O;
  const TB = s[0]+2*s[1]+3*s[2]+4*s[3];
  const AVE = AB ? H/AB : 0;
  const OBP = (AB+BB) ? (H+BB)/(AB+BB) : 0;
  const SLG = AB ? TB/AB : 0;
  const OPS = OBP+SLG;
  return {
    VB:AB, H, BB, K, HR:s[3], CA:s[7], CI:s[8],
    "1B":s[0], "2B":s[1], "3B":s[2],
    AVE: AVE.toFixed(3), OBP: OBP.toFixed(3),
    SLG: SLG.toFixed(3), OPS: OPS.toFixed(3)
  };
}

function calcularERA(totalO, totalER) {
  if (!totalO) return "---";
  return ((totalER / (totalO / 3)) * BASE_INN).toFixed(2);
}

// ============================================================
// CARGAR STATS — TABLAS
// ============================================================
function cargarStats() {
  cargarStatsBateo();
  cargarStatsPitcheo();
  cargarStatsPartidos();
}

function cargarStatsBateo() {
  const div = document.getElementById("historial");
  div.innerHTML = "";
  const nombres = Object.keys(players).sort();
  if (!nombres.length) {
    div.innerHTML = "<p class='empty-msg'>Sin jugadores aún</p>"; return;
  }

  // Tabla comparativa
  const wrapper = document.createElement("div");
  wrapper.className = "stats-table-wrapper";
  wrapper.innerHTML = `
    <table class="stats-tabla">
      <thead>
        <tr>
          <th>Jugador</th>
          <th>VB</th><th>H</th><th>1B</th><th>2B</th><th>3B</th><th>HR</th>
          <th>BB</th><th>K</th><th>CA</th><th>CI</th>
          <th>AVE</th><th>OBP</th><th>SLG</th><th>OPS</th>
        </tr>
      </thead>
      <tbody id="tbody-bateo"></tbody>
    </table>
  `;
  div.appendChild(wrapper);

  const tbody = wrapper.querySelector("#tbody-bateo");

  // Ordenar por OPS desc
  const filas = nombres.map(nombre => {
    const av = calcularAvanzadas(players[nombre].total);
    return { nombre, av };
  }).sort((a,b) => parseFloat(b.av.OPS) - parseFloat(a.av.OPS));

  filas.forEach(({ nombre, av }, rank) => {
    const tr = document.createElement("tr");
    tr.className = rank === 0 ? "rank-gold" : rank === 1 ? "rank-silver" : rank === 2 ? "rank-bronze" : "";
    tr.innerHTML = `
      <td class="col-nombre-stats">${nombre}
        <button class="btn-eliminar-stat" onclick="eliminarJugadorGlobal('${nombre}')">✕</button>
      </td>
      <td>${av.VB}</td><td>${av.H}</td><td>${av["1B"]}</td><td>${av["2B"]}</td>
      <td>${av["3B"]}</td><td>${av.HR}</td><td>${av.BB}</td><td>${av.K}</td>
      <td>${av.CA}</td><td>${av.CI}</td>
      <td class="stat-dest">${av.AVE}</td>
      <td class="stat-dest">${av.OBP}</td>
      <td class="stat-dest">${av.SLG}</td>
      <td class="stat-dest-hi">${av.OPS}</td>
    `;
    tbody.appendChild(tr);
  });
}

function cargarStatsPitcheo() {
  const div = document.getElementById("historialPitcheo");
  div.innerHTML = "";
  const nombres = Object.keys(pitchers).sort();
  if (!nombres.length) {
    div.innerHTML = "<p class='empty-msg'>Aún no hay pitcheos.<br>Designa pitchers al guardar un partido.</p>";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "stats-table-wrapper";
  wrapper.innerHTML = `
    <table class="stats-tabla">
      <thead>
        <tr>
          <th>Pitcher</th>
          <th>IP</th><th>H</th><th>HR</th><th>BB</th><th>K</th><th>ER</th>
          <th>ERA</th><th>WHIP</th><th>K/5</th><th>BB/5</th><th>H/5</th><th>HR/5</th><th>K/BB</th>
        </tr>
      </thead>
      <tbody id="tbody-pitcheo"></tbody>
    </table>
  `;
  div.appendChild(wrapper);

  const MIN_OUTS = 15; // 5 innings × 3 outs

  const tbody = wrapper.querySelector("#tbody-pitcheo");

  function calcStats(p) {
    const ip5 = p.totalO ? p.totalO / 3 : 0; // IP reales
    const BASE = 5; // base de la liga
    const era  = calcularERA(p.totalO, p.totalER);
    const ip   = ipDisplay(p.totalO);
    const whip = ip5 ? ((p.totalBB + p.totalH) / ip5).toFixed(2) : "---";
    const k9   = ip5 ? ((p.totalK  / ip5) * BASE).toFixed(1) : "---";
    const bb9  = ip5 ? ((p.totalBB / ip5) * BASE).toFixed(1) : "---";
    const h9   = ip5 ? ((p.totalH  / ip5) * BASE).toFixed(1) : "---";
    const hr9  = ip5 ? ((p.totalHR / ip5) * BASE).toFixed(2) : "---";
    const kbb  = p.totalBB ? (p.totalK / p.totalBB).toFixed(2) : "---";
    return { era, ip, whip, k9, bb9, h9, hr9, kbb };
  }

  const todos = nombres.map(nombre => {
    const p    = pitchers[nombre];
    const s    = calcStats(p);
    return { nombre, p, ...s, cumple: p.totalO >= MIN_OUTS };
  });

  const filas     = todos.filter(f => f.cumple).sort((a,b) => {
    if (a.era==="---") return 1;
    if (b.era==="---") return -1;
    return parseFloat(a.era) - parseFloat(b.era);
  });
  const excluidos = todos.filter(f => !f.cumple);

  if (!filas.length) {
    div.innerHTML = "<p class='empty-msg'>Ningún pitcher ha lanzado mínimo 5 innings aún.</p>";
    return;
  }

  filas.forEach(({ nombre, p, era, ip, whip, k9, bb9, h9, hr9, kbb }, rank) => {
    const eraNum  = parseFloat(era);
    const whipNum = parseFloat(whip);
    const eraClass  = isNaN(eraNum)  ? "" : eraNum  <= 3.5 ? "era-good" : eraNum  >= 6   ? "era-bad" : "";
    const whipClass = isNaN(whipNum) ? "" : whipNum <= 1.2 ? "era-good" : whipNum >= 1.8 ? "era-bad" : "";
    const tr = document.createElement("tr");
    tr.className = rank === 0 ? "rank-gold" : rank === 1 ? "rank-silver" : rank === 2 ? "rank-bronze" : "";
    tr.innerHTML = `
      <td class="col-nombre-stats">🥎 ${nombre}</td>
      <td>${ip}</td>
      <td>${p.totalH}</td><td>${p.totalHR}</td><td>${p.totalBB}</td>
      <td>${p.totalK}</td><td>${p.totalER}</td>
      <td class="stat-dest-hi ${eraClass}">${era}</td>
      <td class="stat-dest ${whipClass}">${whip}</td>
      <td class="stat-dest">${k9}</td>
      <td>${bb9}</td>
      <td>${h9}</td>
      <td>${hr9}</td>
      <td class="stat-dest">${kbb}</td>
    `;
    tbody.appendChild(tr);
  });

  // Nota de excluidos
  if (excluidos.length) {
    const nota = document.createElement("p");
    nota.className = "empty-msg";
    nota.style.cssText = "font-size:11px;padding:10px 14px;text-align:left";
    nota.innerHTML = `<em>Excluidos por menos de 5 IP: ${excluidos.map(e => `${e.nombre} (${e.ip} IP)`).join(", ")}</em>`;
    wrapper.appendChild(nota);
  }
}

function cargarStatsPartidos() {
  const div = document.getElementById("listaPartidos");
  div.innerHTML = "";
  if (!partidos.length) {
    div.innerHTML = "<p class='empty-msg'>Sin partidos guardados aún</p>"; return;
  }

  [...partidos].reverse().forEach((p, revIdx) => {
    const realIdx = partidos.length - 1 - revIdx;
    const pitInfo = [
      ...(p.pitVsVisit||[]).map(x=>`🥎 vs ${p.visitante}: ${x.nombre} (${ipDisplay(x.outs)} IP)`),
      ...(p.pitVsLocal||[]).map(x=>`🥎 vs ${p.local}: ${x.nombre} (${ipDisplay(x.outs)} IP)`)
    ].join(" · ");

    const card = document.createElement("div");
    card.className = "partido-card";
    card.innerHTML = `
      <div class="partido-titulo">⚾ ${p.local} vs ${p.visitante}</div>
      <div class="partido-fecha">📅 ${p.fecha} · ${p.jugadores?.length||0} jugadores</div>
      ${pitInfo ? `<div class="partido-pit">${pitInfo}</div>` : ""}
      <div class="partido-acciones">
        <button class="btn-editar-partido" onclick="editarPartido(${realIdx})">✏️ Editar</button>
        <button class="btn-eliminar-partido" onclick="eliminarPartido(${realIdx})">🗑 Eliminar</button>
      </div>
    `;
    div.appendChild(card);
  });
}

function eliminarPartido(idx) {
  const p = partidos[idx];
  if (!confirm(`¿Eliminar el partido "${p.local} vs ${p.visitante}" del ${p.fecha}?\nEstas acción revertirá todas las estadísticas de ese partido.`)) return;

  const partidoStr = `${p.local} vs ${p.visitante}`;

  // Revertir stats de bateo
  restarStatsJugadorPartido(p.jugadores || [], p.fecha);

  // Revertir stats de pitcheo
  if (p.pitVsVisit) restarStatsPitcherPartido(p.pitVsVisit, p.fecha, partidoStr);
  if (p.pitVsLocal) restarStatsPitcherPartido(p.pitVsLocal, p.fecha, partidoStr);

  // Eliminar el partido
  partidos.splice(idx, 1);
  guardarStorage();
  cargarStatsPartidos();
  cargarStatsBateo();
  cargarStatsPitcheo();
  toast(`🗑 Partido eliminado y estadísticas revertidas`);
}

// ============================================================
// ELIMINAR JUGADOR GLOBAL
// ============================================================
function eliminarJugadorGlobal(nombre) {
  if (!confirm(`¿Eliminar a "${nombre}" y todos sus datos?`)) return;
  delete players[nombre];
  delete pitchers[nombre];
  guardarStorage();
  cargarSelects();
  // Refrescar tanto stats como editor
  cargarStatsBateo();
  cargarStatsPitcheo();
  const tabJug = document.getElementById("tabJugadores");
  if (tabJug && tabJug.style.display !== "none") cargarEditorJugadores();
  toast(`🗑 ${nombre} eliminado`);
}

// ============================================================
// EXPORTAR / IMPORTAR
// ============================================================
// ============================================================
// DESCARGAR PDF DE ESTADÍSTICAS
// ============================================================
function descargarPDF(tipo) {
  const win = window.open("", "_blank");
  const nombres = tipo === "bateo" ? Object.keys(players).sort() : Object.keys(pitchers).sort();
  if (!nombres.length) { toast("⚠️ Sin datos para exportar"); return; }

  let filas = "";
  let headers = "";

  if (tipo === "bateo") {
    headers = `<tr><th>Jugador</th><th>VB</th><th>H</th><th>1B</th><th>2B</th><th>3B</th><th>HR</th><th>BB</th><th>K</th><th>CA</th><th>CI</th><th>AVE</th><th>OBP</th><th>SLG</th><th>OPS</th></tr>`;
    const datos = nombres.map(n => {
      const av = calcularAvanzadas(players[n].total);
      return { nombre: n, av, ops: parseFloat(av.OPS) };
    }).sort((a,b) => b.ops - a.ops);
    filas = datos.map(({ nombre, av }) =>
      `<tr><td>${nombre}</td><td>${av.VB}</td><td>${av.H}</td><td>${av["1B"]}</td><td>${av["2B"]}</td><td>${av["3B"]}</td><td>${av.HR}</td><td>${av.BB}</td><td>${av.K}</td><td>${av.CA}</td><td>${av.CI}</td><td>${av.AVE}</td><td>${av.OBP}</td><td>${av.SLG}</td><td class="hi">${av.OPS}</td></tr>`
    ).join("");
  } else {
    const MIN_OUTS_PDF = 15;
    headers = `<tr><th>Pitcher</th><th>IP</th><th>H</th><th>HR</th><th>BB</th><th>K</th><th>ER</th><th>ERA</th><th>WHIP</th><th>K/5</th><th>BB/5</th><th>K/BB</th></tr>`;
    const datos = nombres.map(n => {
      const p   = pitchers[n];
      const ip9 = p.totalO ? p.totalO/3 : 0;
      const BASE = 5;
      const era  = calcularERA(p.totalO, p.totalER);
      const ip   = ipDisplay(p.totalO);
      const whip = ip9 ? ((p.totalBB+p.totalH)/ip9).toFixed(2) : "---";
      const k9   = ip9 ? ((p.totalK/ip9)*BASE).toFixed(1) : "---";
      const bb9  = ip9 ? ((p.totalBB/ip9)*BASE).toFixed(1) : "---";
      const kbb  = p.totalBB ? (p.totalK/p.totalBB).toFixed(2) : "---";
      return { nombre: n, p, era, ip, whip, k9, bb9, kbb, eraNum: parseFloat(era) || 999 };
    }).filter(d => pitchers[d.nombre].totalO >= MIN_OUTS_PDF)
      .sort((a,b) => a.eraNum - b.eraNum);
    filas = datos.map(({ nombre, p, era, ip, whip, k9, bb9, kbb }) =>
      `<tr><td>${nombre}</td><td>${ip}</td><td>${p.totalH}</td><td>${p.totalHR}</td><td>${p.totalBB}</td><td>${p.totalK}</td><td>${p.totalER}</td><td class="hi">${era}</td><td>${whip}</td><td>${k9}</td><td>${bb9}</td><td>${kbb}</td></tr>`
    ).join("");
  }

  const titulo = tipo === "bateo" ? "Estadísticas de Bateo" : "Estadísticas de Pitcheo";
  const fecha = new Date().toLocaleDateString("es-CL");

  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Liga Cubana de Wiffleball · ${titulo}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #222; margin: 20px; }
      h1 { font-size: 16px; color: #0B3A6E; margin: 0 0 2px; }
      h2 { font-size: 12px; color: #7a7570; font-weight: normal; margin: 0 0 14px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #0B3A6E; color: white; padding: 6px 4px; text-align: center; font-size: 10px; }
      td { padding: 5px 4px; text-align: center; border-bottom: 1px solid #ddd; }
      td:first-child { text-align: left; font-weight: bold; }
      tr:nth-child(even) td { background: #f5f0e8; }
      .hi { color: #0B3A6E; font-weight: bold; }
      .footer { margin-top: 14px; font-size: 10px; color: #aaa; text-align: right; }
    </style></head><body>
    <h1>Liga Cubana de Wiffleball Chile · Since 2026</h1>
    <h2>${titulo} · ${fecha}</h2>
    <table><thead>${headers}</thead><tbody>${filas}</tbody></table>
    <div class="footer">Generado el ${fecha}</div>
    <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

function exportarJSON() {
  const data = { version:4, exportado:new Date().toISOString(), players, partidos, pitchers };
  const blob = new Blob([JSON.stringify(data,null,2)], { type:"application/json" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wiffleball-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast("📤 Respaldo exportado");
}

function importarJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.players && !data.partidos) throw new Error();
      if (!confirm("⚠️ Esto reemplazará todos los datos actuales. ¿Continuar?")) {
        event.target.value=""; return;
      }
      players  = data.players  || {};
      partidos = data.partidos || [];
      pitchers = data.pitchers || {};
      guardarStorage(); cargarSelects();
      document.getElementById("importStatus").textContent =
        `✅ ${Object.keys(players).length} jugadores, ${partidos.length} partidos importados`;
      toast("✅ Datos importados");
    } catch {
      document.getElementById("importStatus").textContent = "❌ Archivo inválido";
      toast("❌ Error al importar");
    }
    event.target.value="";
  };
  reader.readAsText(file);
}

function resetearTodo() {
  if (!confirm("⚠️ ¿Borrar TODOS los datos? Esta acción no se puede deshacer.")) return;
  players={}; partidos=[]; pitchers={};
  guardarStorage(); cargarSelects();
  toast("🗑 Datos borrados");
}

// ============================================================
// INIT
// ============================================================

// Jugadores iniciales — solo se agregan si la base está vacía
const JUGADORES_INICIALES = [
  "ANTHONY","DANIEL","EDEL ESTRADA","EMERIO","FERNANDO",
  "FIDEL ERNESTO","FRANCISCO PALAY","GONZALO","GUSTAVO JR.","GUSTAVO URIBE",
  "JULIO CALERO","JUSTIN","LUIS","MARIO LAO","MARLON BASANTA",
  "MIGUEL RODRIGUEZ","MIGUELITO","PEPITO PEREZ","PEPO PEREZ","REY",
  "RICARDO LEON","ROMIL BENITO","RUDY MARTIN","WILFREDO CALZADILLA","YANNI"
];

if (Object.keys(players).length === 0) {
  JUGADORES_INICIALES.forEach(nombre => {
    players[nombre] = { total: Array(9).fill(0), juegos: [] };
  });
  guardarStorage();
}

cargarSelects();
actualizarMarcadorUI();
actualizarBasesUI();
document.getElementById("visitante").addEventListener("input", actualizarMarcadorUI);

// Enter en campos de nuevo jugador
["nuevoNombre","nuevoApellido"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("keydown", e => { if (e.key === "Enter") crearJugadorGlobal(); });
});

// Restaurar partido en curso si había uno al recargar
restaurarEstadoPartido();
