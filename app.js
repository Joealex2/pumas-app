// Configuración de Firebase para Club Los Pumas
const firebaseConfig = {
  apiKey: "AIzaSyCDJ23eL-v3XsbAKDhhvIAzTveUv4CEWds",
  authDomain: "club-los-pumas.firebaseapp.com",
  projectId: "club-los-pumas",
  storageBucket: "club-los-pumas.firebasestorage.app",
  messagingSenderId: "1027558241857",
  appId: "1:1027558241857:web:dcdff44d69211ba38c0",
  measurementId: "G-R8TFYZTDJJ"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Funciones utilitarias
const $ = (id) => document.getElementById(id);
const defaultTariffs = { normal: 25, late: 30, matricula: 15, implements: 0, uniform: 0, other: 0 };

let data = {
  students: [],
  obligations: [],
  abonos: [],
  tariffs: { ...defaultTariffs },
  nextStudent: 1,
  nextReceipt: 1,
  nextObligation: 1
};

// Cargar datos desde Cloud Firestore
async function loadData() {
  try {
    const docRef = db.collection("pumas_db").doc("configuracion_general");
    const doc = await docRef.get();
    
    if (doc.exists) {
      data = doc.data();
      if (!data.obligations) data.obligations = [];
      if (!data.abonos) data.abonos = [];
      if (!data.tariffs) data.tariffs = { ...defaultTariffs };
      // Migración: los alumnos sin "mes de inicio" arrancan limpios desde el mes actual
      let migrated = false;
      (data.students || []).forEach(s => { if (!s.since) { s.since = currentMonthKey(); migrated = true; } });
      if (migrated) { try { await docRef.set(data); } catch (e) { console.warn("No se pudo guardar la migración:", e); } }
    } else {
      await db.collection("pumas_db").doc("configuracion_general").set(data);
    }
  } catch (e) {
    console.error("Error al cargar de Firestore:", e);
    notice("Error de conexión con la nube.", true);
  }
  renderAll();
}

// Guardar datos automáticamente en Firestore cada vez que ocurra un cambio
async function saveData() {
  try {
    await db.collection("pumas_db").doc("configuracion_general").set(data);
    renderAll();
  } catch (e) {
    console.error("Error al guardar en Firestore:", e);
    notice("No se pudo guardar en la nube.", true);
  }
}

function money(n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// La mensualidad no tiene recargo si se paga hasta el día 15
function isPastDue(dateStr) {
  const d = dateStr || today();
  const day = Number(String(d).slice(8, 10));
  return day > 15;
}

// Nombre del mes a partir de una clave "YYYY-MM"
function monthLabel(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString("es-EC", { month: "long" });
  return name.charAt(0).toUpperCase() + name.slice(1) + " " + y;
}

// ¿El alumno ya cubrió (totalmente) la mensualidad del mes indicado?
function hasPaidMonthly(studentId, monthKey) {
  const s = data.students.find(x => x.id === studentId);
  const since = (s && s.since) || currentMonthKey();
  if (monthKey < since) return true; // aún no estaba inscrito ese mes
  return monthOutstanding(studentId, monthKey, false) <= 0;
}

// --- MENSUALIDADES / DEUDA ---
function currentMonthKey() { return today().slice(0, 7); }

function isMensualidad(a) { return /mensualidad/i.test(a.concept || ""); }

// Mes que cubre un abono de mensualidad (campo nuevo o compatibilidad con la fecha)
function abonoCoveredMonth(a) {
  if (a && a.coveredMonth) return a.coveredMonth;
  return String((a && a.recordDate) || "").slice(0, 7);
}

function monthAdd(key, n) {
  const [y, m] = String(key).split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Lista de meses "YYYY-MM" desde `fromKey` hasta `toKey` inclusive
function monthsRange(fromKey, toKey) {
  const out = [];
  let cur = fromKey, guard = 0;
  while (cur <= toKey && guard < 600) { out.push(cur); cur = monthAdd(cur, 1); guard++; }
  return out;
}

// ¿El mes está vencido? (meses pasados = sí; mes actual = después del día 15)
function monthIsLate(key) {
  const cm = currentMonthKey();
  if (key < cm) return true;
  if (key === cm) return isPastDue(today());
  return false;
}

function monthAmount(key) {
  return Number(monthIsLate(key) ? data.tariffs.late : data.tariffs.normal) || 0;
}

// Monto fijado para un mes cuando ya se registró un cobro (el mayor total de sus comprobantes).
// Devuelve null si el mes aún no tiene ningún cobro registrado.
function monthBaseTarget(studentId, monthKey) {
  const obls = (data.obligations || []).filter(o =>
    o.studentId === studentId && isMensualidad(o) && o.coveredMonth === monthKey);
  if (!obls.length) return null;
  return obls.reduce((mx, o) => Math.max(mx, Number(o.total) || 0), 0);
}

// Monto objetivo de un mes: el cobro ya fijado, o la tarifa (con recargo si vencido).
// Si el alumno ya cubrió la tarifa normal, no se le aplica recargo retroactivo.
function monthTargetFor(studentId, monthKey, waive = false) {
  const fixed = monthBaseTarget(studentId, monthKey);
  if (fixed != null) return fixed;
  const normal = Number(data.tariffs.normal) || 0;
  if (monthPaidFor(studentId, monthKey) >= normal) return normal;
  return (monthIsLate(monthKey) && !waive)
    ? (Number(data.tariffs.late) || 0)
    : normal;
}

// Total abonado por el alumno a un mes concreto (permite pagos parciales)
function monthPaidFor(studentId, monthKey) {
  return (data.abonos || [])
    .filter(a => a.studentId === studentId && isMensualidad(a) && abonoCoveredMonth(a) === monthKey)
    .reduce((s, a) => s + (Number(a.amount) || 0), 0);
}

// Saldo pendiente de un mes (0 = saldado). `waive` quita el recargo si el mes aún no tiene cobro fijado.
function monthOutstanding(studentId, monthKey, waive = false) {
  const target = monthTargetFor(studentId, monthKey, waive);
  const paid = monthPaidFor(studentId, monthKey);
  return Math.max(0, target - paid);
}

// Meses que el alumno aún debe (saldo restante por mes)
function pendingMonthsFor(student) {
  if (!student) return [];
  const since = student.since || currentMonthKey();
  const cm = currentMonthKey();
  const out = [];
  monthsRange(since, cm).forEach(k => {
    const amount = monthOutstanding(student.id, k, false);
    if (amount <= 0) return; // mes saldado
    const fixed = monthBaseTarget(student.id, k) != null;
    out.push({ month: k, label: monthLabel(k), amount, paid: monthPaidFor(student.id, k), late: !fixed && monthIsLate(k) });
  });
  return out;
}

// Deuda total del alumno = mensualidades pendientes + saldos de obligaciones NO mensuales
function studentDebt(student) {
  const months = pendingMonthsFor(student);
  const monthlyTotal = months.reduce((s, m) => s + m.amount, 0);
  // Las obligaciones de "Mensualidad" ya se contabilizan por mes; no deben sumarse otra vez.
  const otherBalance = (data.obligations || [])
    .filter(o => o.studentId === student.id && !/mensualidad/i.test(o.concept || ""))
    .reduce((s, o) => s + (Number(o.balance) || 0), 0);
  return { months, monthlyTotal, otherBalance, total: monthlyTotal + otherBalance, count: months.length };
}

function notice(msg, error = false) {
  const n = $("notice");
  if (!n) return;
  n.textContent = msg;
  n.classList.remove("hidden", "error");
  if (error) n.classList.add("error");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => n.classList.add("hidden"), 4000);
}

// Ventana de advertencia reutilizable. Devuelve una promesa con true/false.
function confirmDialog({ title = "Confirmar", message = "", confirmText = "Aceptar", danger = true, icon = "⚠️" } = {}) {
  return new Promise(resolve => {
    const modal = $("confirmModal");
    if (!modal) { resolve(window.confirm(message)); return; }

    const ok = $("confirmOk");
    const cancel = $("confirmCancel");
    if ($("confirmTitle")) $("confirmTitle").textContent = title;
    if ($("confirmMessage")) $("confirmMessage").textContent = message;
    if ($("confirmIcon")) $("confirmIcon").textContent = icon;
    if (ok) { ok.textContent = confirmText; ok.className = danger ? "danger" : "primary"; }
    modal.classList.remove("hidden");
    setTimeout(() => cancel && cancel.focus(), 0);

    const cleanup = (val) => {
      modal.classList.add("hidden");
      ok?.removeEventListener("click", onOk);
      cancel?.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onOverlay);
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === modal) cleanup(false); };
    const onKey = (e) => { if (e.key === "Escape") cleanup(false); };

    ok?.addEventListener("click", onOk);
    cancel?.addEventListener("click", onCancel);
    modal.addEventListener("click", onOverlay);
    document.addEventListener("keydown", onKey);
  });
}

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const v = $("view-" + name);
  if (v) v.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(b => {
    if (b.dataset.view) b.classList.toggle("active", b.dataset.view === name);
  });
  if (name === "payment") resetPaymentFormToNew();
  if (name === "history") renderHistory();
  if (name === "tariffs") fillTariffs();
}

// Inicio automático cargando desde la nube
window.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  showView("dashboard");
  if ($("recordDate")) $("recordDate").value = today();
});

// Al volver a la app (o cambiar el día/mes) refrescar el panel del mes actual
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") renderDashboard();
});

document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showView(b.dataset.go)));

// --- GESTIÓN DE ALUMNOS ---
let editingStudentId = null;

function resetStudentForm() {
  $("studentForm")?.reset();
  if ($("studentId")) $("studentId").value = `LP-${String(data.nextStudent || 1).padStart(4, "0")}`;
  if ($("studentFormTitle")) $("studentFormTitle").textContent = "Registro de alumnos";
  if ($("studentSubmitBtn")) $("studentSubmitBtn").textContent = "Guardar alumno";
  $("studentCancelEditBtn")?.classList.add("hidden");
  if ($("studentCedula")) $("studentCedula").disabled = false;
  editingStudentId = null;
}

$("studentCancelEditBtn")?.addEventListener("click", resetStudentForm);
$("studentCedula")?.addEventListener("input", e => e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10));

$("studentForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const cedula = $("studentCedula")?.value.trim();
  if (!/^\d{10}$/.test(cedula)) { notice("La cédula debe tener 10 dígitos.", true); return; }

  if (editingStudentId) {
    const sIndex = data.students.findIndex(s => s.id === editingStudentId);
    if (sIndex > -1) {
      if (data.students.some(s => s.cedula === cedula && s.id !== editingStudentId)) {
        notice("Cédula duplicada.", true); return;
      }
      data.students[sIndex].cedula = cedula;
      data.students[sIndex].names = $("studentNames")?.value.trim();
      data.students[sIndex].last = $("studentLast")?.value.trim();
      data.students[sIndex].group = $("studentGroup")?.value;
      data.students[sIndex].status = $("studentStatus")?.value;
      saveData();
      notice("Alumno actualizado.");
      resetStudentForm();
    }
  } else {
    if (data.students.some(s => s.cedula === cedula)) { notice("Cédula duplicada.", true); return; }
    const s = {
      id: `LP-${String(data.nextStudent++).padStart(4, "0")}`,
      cedula,
      names: $("studentNames")?.value.trim(),
      last: $("studentLast")?.value.trim(),
      group: $("studentGroup")?.value,
      status: $("studentStatus")?.value,
      since: currentMonthKey()
    };
    data.students.push(s);
    saveData();
    notice("Alumno guardado.");
    resetStudentForm();
  }
});

$("studentSearch")?.addEventListener("input", renderStudents);
$("studentFilterStatus")?.addEventListener("change", renderStudents);

window.editStudent = function (id) {
  const s = data.students.find(x => x.id === id);
  if (!s) return;
  editingStudentId = s.id;
  if ($("studentId")) $("studentId").value = s.id;
  if ($("studentCedula")) $("studentCedula").value = s.cedula;
  if ($("studentNames")) $("studentNames").value = s.names;
  if ($("studentLast")) $("studentLast").value = s.last;
  if ($("studentGroup")) $("studentGroup").value = s.group;
  if ($("studentStatus")) $("studentStatus").value = s.status || "Activo";

  if ($("studentFormTitle")) $("studentFormTitle").textContent = `Editando a: ${s.names} ${s.last}`;
  if ($("studentSubmitBtn")) $("studentSubmitBtn").textContent = "Actualizar";
  $("studentCancelEditBtn")?.classList.remove("hidden");
  window.scrollTo({ top: $("view-students")?.offsetTop || 0, behavior: "smooth" });
};

window.deleteStudent = async function (id) {
  const s = data.students.find(x => x.id === id);
  if (!s) return;

  const recs = (data.abonos || []).filter(a => a.studentId === id).length;
  const obs = (data.obligations || []).filter(o => o.studentId === id).length;
  const extra = (recs || obs)
    ? ` También se eliminarán ${recs} recibo(s) y ${obs} obligación(es) asociados a este alumno.`
    : "";

  const ok = await confirmDialog({
    title: "Eliminar alumno",
    message: `¿Estás seguro de eliminar a ${s.names} ${s.last} (${s.id})? Esta acción no se puede deshacer.${extra}`,
    confirmText: "Sí, eliminar",
    danger: true
  });
  if (!ok) return;

  data.students = data.students.filter(x => x.id !== id);
  data.abonos = (data.abonos || []).filter(a => a.studentId !== id);
  data.obligations = (data.obligations || []).filter(o => o.studentId !== id);
  if (editingStudentId === id) resetStudentForm();

  await saveData();
  renderStudents();
  renderHistory();
  notice("Alumno eliminado correctamente.");
};

function renderStudents() {
  if (!$("studentsList")) return;
  const q = ($("studentSearch")?.value || "").toLowerCase();
  const filterStatus = $("studentFilterStatus")?.value || "all";

  const arr = data.students.filter(s => {
    const status = s.status || "Activo";
    const matchSearch = [s.cedula, s.names, s.last].join(" ").toLowerCase().includes(q);
    const matchStatus = filterStatus === "all" || status === filterStatus;
    return matchSearch && matchStatus;
  });

  if (!arr.length) { $("studentsList").innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:var(--muted);">No hay alumnos registrados.</div>'; return; }

  $("studentsList").innerHTML = `<table style="min-width: 720px;"><thead><tr><th>Alumno</th><th>Cédula / ID</th><th>Grupo</th><th>Estado</th><th>Deuda</th><th>Acciones</th></tr></thead><tbody>${arr.map(s => {
    const status = s.status || "Activo";
    const statusBadge = status === "Activo" ? `<span class="badge" style="background:#e6f7ed;color:#177344">Activo</span>` : `<span class="badge" style="background:#fde7e9;color:#a41327">Inactivo</span>`;
    const cobrarBtn = status === "Activo" ? `<button class="mini-btn red" style="padding:6px 12px; font-weight:600;" data-pay-for="${s.id}">Cobrar</button> ` : "";
    const debt = studentDebt(s).total;
    const debtCell = debt > 0 ? `<span style="color:var(--red); font-weight:700;">${money(debt)}</span>` : `<span class="muted">—</span>`;
    return `<tr>
        <td><b>${esc(s.names)} ${esc(s.last)}</b></td>
        <td>${esc(s.cedula)}<span class="subline">${esc(s.id)}</span></td>
        <td>${esc(s.group)}</td>
        <td>${statusBadge}</td>
        <td>${debtCell}</td>
        <td>
            <div style="display:flex; gap:6px; flex-wrap:nowrap;">
                ${cobrarBtn}<button class="mini-btn" style="padding:6px 12px;" onclick="editStudent('${s.id}')">Editar</button>
                <button class="mini-btn danger" style="padding:6px 12px;" onclick="deleteStudent('${s.id}')">Eliminar</button>
            </div>
        </td>
     </tr>`;
  }).join("")}</tbody></table>`;

  document.querySelectorAll("[data-pay-for]").forEach(b => b.addEventListener("click", () => { showView("payment"); selectStudentForPayment(b.dataset.payFor); }));
}

// --- CARGA MASIVA DE ALUMNOS (CSV) ---
$("btnDownloadTemplate")?.addEventListener("click", () => {
  const csvHeader = "cedula,nombres,apellidos,grupo,estado\n";
  const csvExample = "1727363986,Joe Alexander,Gavilanez Paucar,Jóvenes,Activo\n1712345678,Matias Josue,Gavilanez Paucar,Niños,Activo";
  const blob = new Blob([csvHeader + csvExample], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Plantilla_Alumnos_LosPumas.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

$("btnImportStudentsCSV")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (evt) {
    const text = evt.target.result;
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");

    if (lines.length < 2) { notice("El archivo está vacío.", true); return; }

    let importCount = 0;
    let duplicateCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const separator = lines[i].includes(";") ? ";" : ",";
      const cols = lines[i].split(separator).map(c => c.trim().replace(/^["']|["']$/g, ""));

      if (cols.length < 3) continue;

      const cedula = cols[0].replace(/\D/g, "").slice(0, 10);
      const names = cols[1];
      const last = cols[2];
      const group = cols[3] || "Niños";
      const status = cols[4] || "Activo";

      if (!cedula || !names || !last) continue;

      if (data.students.some(s => s.cedula === cedula)) {
        duplicateCount++;
        continue;
      }

      const newStudent = {
        id: `LP-${String(data.nextStudent++).padStart(4, "0")}`,
        cedula: cedula,
        names: names,
        last: last,
        group: (group.toLowerCase().includes("jov") || group.toLowerCase().includes("juv")) ? "Jóvenes" : "Niños",
        status: status.toLowerCase().includes("inac") ? "Inactivo" : "Activo"
      };

      data.students.push(newStudent);
      importCount++;
    }

    saveData();
    renderAll();
    e.target.value = "";

    if (importCount > 0) {
      notice(`¡Carga exitosa! Se importaron ${importCount} deportistas.`);
    } else {
      notice("No se importaron alumnos. Verifica que no existan duplicados.", true);
    }
  };
  reader.readAsText(file, "UTF-8");
});

// --- COBROS Y PAGOS DIRECTOS ---
$("payStudentSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim(); const res = $("payStudentResults");
  if (q.length < 2) { res?.classList.add("hidden"); return; }
  const arr = data.students.filter(s => (s.status || "Activo") !== "Inactivo" && [s.cedula, s.names, s.last].join(" ").toLowerCase().includes(q));
  if (res) {
    res.innerHTML = arr.length ? arr.map(s => {
      const debt = studentDebt(s).total;
      const debtTag = debt > 0 ? ` <span style="color:var(--red); font-weight:700;">· debe ${money(debt)}</span>` : ` <span style="color:#177344; font-weight:600;">· al día</span>`;
      return `<div class="search-item" data-id="${s.id}"><b>${esc(s.names)} ${esc(s.last)}</b> - ${esc(s.cedula)}${debtTag}</div>`;
    }).join("") : '<div class="search-item muted">Sin resultados.</div>';
    res.querySelectorAll(".search-item[data-id]").forEach(el => el.addEventListener("click", () => selectStudentForPayment(el.dataset.id)));
    res.classList.remove("hidden");
  }
});

$("payStudentClear")?.addEventListener("click", () => {
  if ($("payStudentId")) $("payStudentId").value = "";
  if ($("payStudentSearch")) $("payStudentSearch").value = "";
  $("payStudentSearch")?.classList.remove("hidden");
  $("payStudentSelected")?.classList.add("hidden");
  resetPaymentFormToNew();
});

function selectStudentForPayment(studentId) {
  const s = data.students.find(x => x.id === studentId); if (!s) return;
  if ((s.status || "Activo") === "Inactivo") { notice("Este alumno está inactivo. Actívalo para poder registrar un pago.", true); return; }
  if ($("payStudentId")) $("payStudentId").value = s.id;
  $("payStudentSearch")?.classList.add("hidden"); $("payStudentResults")?.classList.add("hidden");
  $("payStudentSelected")?.classList.remove("hidden");
  if ($("payStudentName")) $("payStudentName").textContent = `${s.names} ${s.last}`;
  resetPaymentFormToNew();
}

function resetPaymentFormToNew() {
  if ($("payConcept")) updateSuggestedAmount();
}

function tariffFor(concept, type) {
  if (concept === "Mensualidad") return type === "late" ? data.tariffs.late : data.tariffs.normal;
  if (concept === "Mensualidad + Matrícula") return data.tariffs.normal + data.tariffs.matricula;
  if (concept === "Implementos deportivos") return data.tariffs.implements;
  if (concept === "Uniformes") return data.tariffs.uniform;
  return data.tariffs.other;
}

function recomputeAmount() {
  const concept = $("payConcept")?.value;
  const suggested = Number(tariffFor(concept, "normal")).toFixed(2);
  if ($("payAmount")) $("payAmount").value = suggested;
  if ($("payAbono")) $("payAbono").value = suggested;
  updateBalance();
}

// Mensualidades: se cobra por mes; el recargo se aplica automáticamente a cada mes vencido
function selectedStudent() {
  const id = $("payStudentId")?.value;
  return id ? data.students.find(s => s.id === id) : null;
}

function renderPendingMonths() {
  const wrap = $("pendingMonthsWrap");
  const list = $("pendingMonthsList");
  const info = $("debtSummary");
  if (!wrap || !list) return;
  const s = selectedStudent();
  const isMonthly = /mensualidad/i.test($("payConcept")?.value || "");

  if (!s) {
    wrap.classList.add("hidden"); list.innerHTML = ""; if (info) info.innerHTML = "";
    $("lateFeeRow")?.classList.add("hidden");
    if ($("payAmount")) $("payAmount").readOnly = false;
    if ($("payAbono")) $("payAbono").readOnly = false;
    return;
  }
  wrap.classList.remove("hidden");

  const debt = studentDebt(s);
  if (info) {
    info.innerHTML = debt.total > 0
      ? `Deuda estimada: <b style="color:var(--red)">${money(debt.total)}</b> · ${debt.count} mes(es) pendiente(s)`
      : `<span class="muted">Sin deuda pendiente 🎉</span>`;
  }

  // Recargo: se puede aplicar o quitar cuando ya pasó el día 15 (según la fecha del recibo)
  const refDate = $("recordDate")?.value || today();
  const refMonth = String(refDate).slice(0, 7);
  const lateRow = $("lateFeeRow");
  const refMonthPendingLate = isMonthly && isPastDue(refDate) && debt.months.some(m => m.month === refMonth);
  if (lateRow) {
    const wasHidden = lateRow.classList.contains("hidden");
    lateRow.classList.toggle("hidden", !refMonthPendingLate);
    if (refMonthPendingLate && wasHidden && $("lateFeeToggle")) $("lateFeeToggle").checked = true;
    const diff = (Number(data.tariffs.late) || 0) - (Number(data.tariffs.normal) || 0);
    if ($("lateFeeLabel")) $("lateFeeLabel").textContent = `Aplicar recargo por atraso (+${money(diff)})`;
  }

  if (!debt.months.length) {
    list.innerHTML = `<div class="muted" style="font-size:13px;">No hay mensualidades pendientes.</div>`;
  } else {
    const cm = currentMonthKey();
    list.innerHTML = debt.months.map(m => {
      const ch = monthChargeForForm(m.month);
      return `
      <label class="month-item${ch.late ? " late" : ""}">
        <input type="checkbox" class="month-check" value="${m.month}" data-amount="${ch.amount}" ${m.month === cm ? "checked" : ""}>
        <span class="month-name">${esc(m.label)}</span>
        <span class="month-amt">${money(ch.amount)}${ch.late ? " · recargo" : ""}</span>
      </label>`;
    }).join("");
    list.querySelectorAll(".month-check").forEach(cb => cb.addEventListener("change", recomputeMonthlyAmount));
  }

  // "Valor total a cobrar" y "Monto que paga hoy" son editables (permite cobros personalizados y pagos parciales)
  if ($("payAmount")) $("payAmount").readOnly = false;
  if ($("payAbono")) $("payAbono").readOnly = false;
}

// Saldo pendiente de un mes en el formulario: permite quitar el recargo del mes del recibo
function monthChargeForForm(monthKey) {
  const refDate = $("recordDate")?.value || today();
  const refMonth = String(refDate).slice(0, 7);
  const waive = $("lateFeeToggle") && !$("lateFeeToggle").checked;
  const s = selectedStudent();
  if (!s) return { amount: 0, late: false };
  const fixedTarget = monthBaseTarget(s.id, monthKey);
  let late;
  if (monthKey < refMonth) late = true;
  else if (monthKey === refMonth) late = isPastDue(refDate) && !waive;
  else late = false;
  const target = fixedTarget != null ? fixedTarget : (Number(late ? data.tariffs.late : data.tariffs.normal) || 0);
  const amount = Math.max(0, target - monthPaidFor(s.id, monthKey));
  return { amount, late: late && fixedTarget == null };
}

function recomputeMonthlyAmount() {
  const concept = $("payConcept")?.value || "";
  const checks = [...document.querySelectorAll("#pendingMonthsList .month-check:checked")];
  let total = checks.reduce((s, c) => s + (Number(c.dataset.amount) || 0), 0);
  if (/matr[ií]cula/i.test(concept)) total += Number(data.tariffs.matricula) || 0;
  if ($("payAmount")) $("payAmount").value = total.toFixed(2);
  if ($("payAbono")) $("payAbono").value = total.toFixed(2);
  updateBalance();
}

function updateSuggestedAmount() {
  const isMonthly = /mensualidad/i.test($("payConcept")?.value || "");
  renderPendingMonths();
  if (isMonthly) recomputeMonthlyAmount(); else recomputeAmount();
}

$("payConcept")?.addEventListener("change", updateSuggestedAmount);
$("recordDate")?.addEventListener("change", updateSuggestedAmount);
$("lateFeeToggle")?.addEventListener("change", () => {
  document.querySelectorAll("#pendingMonthsList .month-check").forEach(cb => {
    const ch = monthChargeForForm(cb.value);
    cb.dataset.amount = ch.amount;
    const item = cb.closest(".month-item");
    if (item) {
      item.classList.toggle("late", ch.late);
      const amtEl = item.querySelector(".month-amt");
      if (amtEl) amtEl.textContent = money(ch.amount) + (ch.late ? " · recargo" : "");
    }
  });
  recomputeMonthlyAmount();
});
$("payAbono")?.addEventListener("input", updateBalance);
$("payAmount")?.addEventListener("input", updateBalance);

function updateBalance() {
  const total = Number($("payAmount")?.value) || 0;
  const abono = Number($("payAbono")?.value) || 0;
  if ($("payBalance")) $("payBalance").textContent = money(Math.max(0, total - abono));
}

$("paymentForm")?.addEventListener("reset", () => setTimeout(() => {
  if ($("recordDate")) $("recordDate").value = today();
  if ($("payStudentId")) $("payStudentId").value = "";
  if ($("payStudentSearch")) $("payStudentSearch").value = "";
  $("payStudentSearch")?.classList.remove("hidden");
  $("payStudentSelected")?.classList.add("hidden");
  $("payStudentResults")?.classList.add("hidden");
  resetPaymentFormToNew();
}, 0));

$("paymentForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const studentId = $("payStudentId")?.value;
  if (!studentId) { notice("Selecciona un alumno.", true); return; }
  const s = data.students.find(x => x.id === studentId);
  if (!s) { notice("Alumno no encontrado.", true); return; }

  const concept = $("payConcept")?.value || "";
  const cleanDate = ($("recordDate")?.value || today()).trim();
  const notes = $("payNotes")?.value.trim() || "";
  const isMonthly = /mensualidad/i.test(concept);
  const created = [];

  if (isMonthly) {
    const checks = [...document.querySelectorAll("#pendingMonthsList .month-check:checked")]
      .map(c => ({ month: c.value, outstanding: Number(c.dataset.amount) || 0 }))
      .sort((a, b) => a.month.localeCompare(b.month));

    if (!checks.length) { notice("Selecciona al menos un mes a cancelar.", true); return; }

    const matricula = /matr[ií]cula/i.test(concept) ? (Number(data.tariffs.matricula) || 0) : 0;

    // "Valor total a cobrar" (editable): se reparte entre los meses del más antiguo al más reciente.
    let chargeLeft = Number($("payAmount")?.value);
    if (!Number.isFinite(chargeLeft) || chargeLeft < 0) { notice("Monto a cobrar inválido.", true); return; }
    checks.forEach((sel, i) => {
      const isLast = i === checks.length - 1;
      const charge = isLast ? chargeLeft : Math.min(sel.outstanding, chargeLeft);
      sel.charge = Math.max(0, charge);
      chargeLeft -= sel.charge;
    });

    const grandTotal = checks.reduce((s, c) => s + c.charge, 0) + matricula;

    // "Monto que paga hoy": se reparte entre los meses (del más antiguo al más reciente) para pagos parciales
    let remaining = Number($("payAbono")?.value);
    if (!Number.isFinite(remaining) || remaining < 0) { notice("Monto inválido.", true); return; }
    remaining = Math.min(remaining, grandTotal);

    checks.forEach(sel => {
      if (remaining <= 0 || sel.charge <= 0) return;
      const pay = Math.min(remaining, sel.charge);
      remaining -= pay;
      const obId = `OB-${String(data.nextObligation++).padStart(5, "0")}`;
      data.obligations.push({ id: obId, studentId: s.id, concept, monthlyType: monthChargeForForm(sel.month).late ? "late" : "normal", total: sel.charge, balance: sel.charge - pay, created: cleanDate, coveredMonth: sel.month });
      const p = { receipt: `LP-${String(data.nextReceipt++).padStart(6, "0")}`, obligationId: obId, studentId: s.id, studentName: `${s.names} ${s.last}`, cedula: s.cedula, concept, coveredMonth: sel.month, recordDate: cleanDate, amount: pay, notes };
      data.abonos.push(p); created.push(p);
    });

    if (matricula > 0 && remaining > 0) {
      const pay = Math.min(remaining, matricula);
      remaining -= pay;
      const obId = `OB-${String(data.nextObligation++).padStart(5, "0")}`;
      data.obligations.push({ id: obId, studentId: s.id, concept: "Matrícula", monthlyType: "normal", total: matricula, balance: matricula - pay, created: cleanDate });
      const p = { receipt: `LP-${String(data.nextReceipt++).padStart(6, "0")}`, obligationId: obId, studentId: s.id, studentName: `${s.names} ${s.last}`, cedula: s.cedula, concept: "Matrícula", recordDate: cleanDate, amount: pay, notes };
      data.abonos.push(p); created.push(p);
    }

    if (!created.length) { notice("El monto a cobrar debe ser mayor a 0.", true); return; }
  } else {
    const total = Number($("payAmount")?.value), abono = Number($("payAbono")?.value);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(abono) || abono < 0) { notice("Valores inválidos.", true); return; }
    const obId = `OB-${String(data.nextObligation++).padStart(5, "0")}`;
    data.obligations.push({ id: obId, studentId: s.id, concept, monthlyType: "normal", total, balance: Math.max(0, total - abono), created: cleanDate });
    const p = { receipt: `LP-${String(data.nextReceipt++).padStart(6, "0")}`, obligationId: obId, studentId: s.id, studentName: `${s.names} ${s.last}`, cedula: s.cedula, concept, recordDate: cleanDate, amount: abono, notes };
    data.abonos.push(p); created.push(p);
  }

  await saveData();
  e.target.reset();
  $("payStudentClear")?.click();
  renderReceipt(getJoinedReceipt(created[0]));
  notice(created.length === 1
    ? "Recibo registrado correctamente en la nube."
    : `${created.length} recibos registrados (${created[0].receipt} a ${created[created.length - 1].receipt}).`);
});

function getJoinedReceipt(abono) {
  const ob = data.obligations.find(o => o.id === abono.obligationId) || {};
  return { ...abono, total: ob.total || 0, balance: ob.balance || 0, monthlyType: ob.monthlyType || 'normal' };
}

// Generar mensaje detallado para WhatsApp
function getReceiptMessage(p) {
  return `*CLUB LOS PUMAS* \n_Comprobante de Movimiento_\n\n*Recibo:* ${p.receipt}\n*Alumno:* ${p.studentName}\n*Concepto:* ${p.concept}${p.coveredMonth ? `\n*Cubre:* ${monthLabel(p.coveredMonth)}` : ""}\n*Fecha:* ${p.recordDate}\n\n*Total a pagar:* ${money(p.total)}\n*Abono:*  ${money(p.amount)}\n*Saldo pendiente:*  ${money(p.balance)}${p.notes ? `\n*Nota:* ${p.notes}` : ''}`;
}

// --- RECIBO Y PDF ---
function renderReceipt(p) {
  const box = $("receiptResult");
  if (!box) return;
  box.classList.remove("hidden");

  box.innerHTML = `
    <div class="section-head">
        <div><h3>Recibo emitido</h3><p class="muted">Documento ${esc(p.receipt)}</p></div>
        <span class="badge ${p.balance > 0 ? "partial" : ""}">${p.balance === 0 ? "Pagado" : "Abono registrado"}</span>
    </div>
    
    <div class="receipt-paper" id="receiptPaper" style="padding:0; overflow:hidden; border:1px solid #ddd; border-radius:8px; background:#fff;">
        <div style="background-color: #211e1e; color: #fff; padding: 20px; display: flex; align-items: center; gap: 15px;">
            <img
    class="receipt-logo"
    src="./img/Pum.png?v=2"
    alt="Sello Club Los Pumas"
    style="width: 70px; height: 70px; border-radius: 50%; object-fit: contain; background: #fff; padding: 2px;"
>
            <div>
                <h2 style="margin: 0 0 5px 0; font-size: 16.5px; line-height: 1.1; font-family: Arial, sans-serif;">Club Deportivo Formativo Especializado<br>Los Pumas</h2>
                <p style="margin: 0; font-size: 10px; color: #d4d4d4; line-height: 1.4;">SANTA ISABEL, CALLE<br>QUEVEDO Y PICHINCHA<br>CEL: 0984302599</p>
            </div>
        </div>
        
        <div style="padding: 25px;">
            <h1 style="margin: 0 0 25px 0; font-size: 26px; font-weight: 900; letter-spacing: 0.5px; color: #000;">RECIBO</h1>
            
            <div style="font-size: 14px; margin-bottom: 25px; color: #000;">
                <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                    <b style="flex: 0 0 85px; text-align: right;">Recibo N° :</b>
                    <span style="flex: 1; border-bottom: 1px solid #777; padding-bottom: 2px;">${esc(p.receipt)}</span>
                </div>
                <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                    <b style="flex: 0 0 85px; text-align: right;">Recibo a: :</b>
                    <span style="flex: 1; border-bottom: 1px solid #777; padding-bottom: 2px;">${esc(p.studentName)}</span>
                </div>
                <div style="display: flex; gap: 12px;">
                    <b style="flex: 0 0 85px; text-align: right;">Fecha :</b>
                    <span style="flex: 1; border-bottom: 1px solid #777; padding-bottom: 2px;">${esc(p.recordDate)}</span>
                </div>
                ${p.coveredMonth ? `<div style="display: flex; gap: 12px; margin-top: 12px;">
                    <b style="flex: 0 0 85px; text-align: right;">Cubre :</b>
                    <span style="flex: 1; border-bottom: 1px solid #777; padding-bottom: 2px; text-transform: capitalize;">${esc(monthLabel(p.coveredMonth))}</span>
                </div>` : ""}
            </div>
            
            <div style="margin-bottom: 40px;">
                <div style="background-color: #26292b; color: #fff; display: inline-block; padding: 6px 14px; font-weight: bold; font-size: 13px;">Descripción:</div>
                <div style="padding: 10px 0; border-bottom: 1px solid #777; font-size: 14px; min-height: 30px; color: #000;">
                    ${esc(p.concept)} - Deuda total: ${money(p.total)}
                    ${p.notes ? `<br><span style="font-size: 12px; color: #555;">(Nota: ${esc(p.notes)})</span>` : ""}
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; flex-wrap:wrap; gap:20px;">
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="background-color: #b5b5b5; padding: 6px 10px; font-weight: bold; color: #000;">SALDO:</div>
                        <div style="border-bottom: 1px solid #777; width: 85px; text-align: center; color: var(--red); font-weight: bold;">${money(p.balance)}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; align-self: flex-start;">
                        <div style="background-color: #b5b5b5; padding: 6px 10px; font-weight: bold; color: #000;">Pago Total:</div>
                        <div style="border-bottom: 1px solid #777; width: 85px; text-align: center; font-weight: bold; color: #000;">${money(p.amount)}</div>
                    </div>
                </div>
                
                <div style="text-align: center; width: 150px; margin-left:auto;">
                    <div style="font-family: 'Georgia', serif; font-style: italic; font-size: 24px; color: #333; margin-bottom: 5px;">G Gavilanez</div>
                    <div style="border-top: 1px solid #000; padding-top: 5px; font-size: 11px; font-weight: bold; line-height: 1.2; color: #000;">Lic. Galo Gavilanez<br>Director y Maestro</div>
                </div>
            </div>
        </div>
        <div style="background-color: #26292b; height: 25px; width: 100%;"></div>
    </div>
    
    <div class="receipt-actions" style="margin-top: 20px;">
        <button class="primary" id="shareReceiptImage">🖼️ Compartir comprobante</button>
        <button class="secondary" id="downloadReceiptPdf">📄 Descargar PDF</button>
        <button class="danger" id="deleteReceiptFromResult">🗑️ Eliminar comprobante</button>
    </div>`;

  $("shareReceiptImage")?.addEventListener("click", () => shareReceiptImage(p));
  $("downloadReceiptPdf")?.addEventListener("click", () => downloadPdf(p));
  $("deleteReceiptFromResult")?.addEventListener("click", async () => {
    await deleteReceipt(p.receipt);
    if (!data.abonos.some(a => a.receipt === p.receipt)) {
      box.classList.add("hidden");
      box.innerHTML = "";
    }
  });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- CARGA DEL SELLO DEL CLUB ---
// El PNG original medía 7123x7123px (más de 50 millones de píxeles), lo que
// supera el límite de canvas de Android y dejaba el sello en blanco en el PDF.
// Ahora se usa una versión de 512x512 (ver ?v=2 para forzar la actualización en
// teléfonos que aún tengan la imagen grande en caché).
const LOGO_SRC = "./img/Pum.png?v=2";
let logoPromise = null;

function loadLogoImage() {
  if (logoPromise) return logoPromise;
  logoPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let result = img;
      try {
        const max = 512;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl && dataUrl.length > 100) result = dataUrl;
      } catch (e) {
        result = img; // Respaldo: usar la imagen original si el canvas falla
      }
      resolve(result);
    };
    img.onerror = () => {
      logoPromise = null; // Permite reintentar en la próxima llamada
      // Respaldo: usar la imagen que ya se ve en el recibo en pantalla
      const domImg = document.querySelector("#receiptPaper .receipt-logo");
      if (domImg && domImg.complete && domImg.naturalWidth > 0) {
        resolve(domImg);
      } else {
        console.warn("No se pudo cargar el sello del Club Los Pumas.");
        resolve(null);
      }
    };
    img.src = LOGO_SRC;
  });
  return logoPromise;
}

// Precargar el sello para que el botón Compartir no pierda la interacción del usuario
window.addEventListener("load", () => { loadLogoImage().catch(() => {}); });

function buildPdfDoc(p, logo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ format: 'a5' });

  // Franja superior oscura (igual que el recibo en pantalla)
  doc.setFillColor(33, 30, 30);
  doc.rect(0, 0, 148, 44, 'F');

  if (logo) {
    try {
      doc.addImage(logo, "PNG", 12, 6, 28, 28);
    } catch (e) {
      console.warn("No se pudo incrustar el sello:", e);
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Club Deportivo Formativo Especializado", 46, 16);
  doc.text("Los Pumas", 46, 23);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("SANTA ISABEL, CALLE QUEVEDO Y PICHINCHA", 46, 31);
  doc.text("CEL: 0984302599", 46, 36);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("RECIBO", 15, 58);

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Recibo Nº :", 15, 75); doc.text(String(p.receipt), 42, 75);
  doc.text("Recibo a: :", 15, 83); doc.text(String(p.studentName), 42, 83);
  doc.text("Fecha :", 15, 91); doc.text(String(p.recordDate), 42, 91);

  doc.setDrawColor(120, 120, 120);
  doc.line(40, 76, 133, 76); doc.line(40, 84, 133, 84); doc.line(40, 92, 133, 92);

  doc.setFillColor(38, 41, 43); doc.rect(15, 105, 30, 8, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("Descripción:", 18, 110.5);

  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
  const descText = `${p.concept} - Deuda Total: ${money(p.total)}`;
  doc.text(descText, 15, 122);
  if (p.notes) {
    doc.setFontSize(9); doc.setTextColor(80, 80, 80);
    doc.text("(Nota: " + p.notes + ")", 15, 128);
  }

  doc.setDrawColor(120, 120, 120);
  doc.line(15, 132, 133, 132);

  doc.setFillColor(181, 181, 181); doc.rect(15, 145, 22, 8, 'F');
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
  doc.text("SALDO:", 17, 150.5);
  doc.setTextColor(199, 25, 45); doc.text(money(p.balance), 40, 150.5);
  doc.line(39, 152, 65, 152);

  doc.setTextColor(0, 0, 0); doc.rect(70, 155, 26, 8, 'F');
  doc.text("Pago Total:", 72, 160.5); doc.text(money(p.amount), 98, 160.5);
  doc.line(98, 162, 125, 162);

  doc.setFont("times", "italic"); doc.setFontSize(22);
  doc.text("G Gavilanez", 105, 182, { align: "center" });
  doc.setDrawColor(0, 0, 0); doc.line(80, 185, 130, 185);

  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("Lic. Galo Gavilanez", 105, 190, { align: "center" });
  doc.text("Director y Maestro", 105, 195, { align: "center" });

  doc.setFillColor(38, 41, 43); doc.rect(0, 202, 148, 8, 'F');
  return doc;
}

async function downloadPdf(p) {
  if (!window.jspdf) { notice("Requiere internet para el PDF.", true); return; }
  let logo = null;
  try { logo = await loadLogoImage(); } catch (e) { console.warn(e); }
  const doc = buildPdfDoc(p, logo);
  doc.save(`Recibo_${p.receipt}.pdf`);
}

// Invoca el menú nativo de compartir del celular con el PDF adjunto
async function shareReceiptPdf(p) {
  if (!window.jspdf) { notice("Requiere internet para el PDF.", true); return; }
  let logo = null;
  try { logo = await loadLogoImage(); } catch (e) { console.warn(e); }
  const doc = buildPdfDoc(p, logo);
  await executeNativeShare(doc, p);
}

async function executeNativeShare(doc, p) {
  const fileName = `Recibo_${p.receipt}.pdf`;
  const title = `Recibo ${p.receipt} - Club Los Pumas`;

  let file;
  try {
    file = new File([doc.output('blob')], fileName, { type: 'application/pdf' });
  } catch (e) {
    doc.save(fileName);
    notice("📥 PDF descargado en tu dispositivo.");
    return;
  }

  // Compartir el PDF CON un mensaje predefinido (WhatsApp lo usa como pie de mensaje)
  const withMessage = { files: [file], text: getReceiptMessage(p), title };
  const fileOnly = { files: [file], title };

  if (navigator.share && navigator.canShare) {
    try {
      if (navigator.canShare(withMessage)) {
        await navigator.share(withMessage);
        return;
      }
      // Si el navegador no admite texto junto al archivo, comparte solo el PDF
      if (navigator.canShare(fileOnly)) {
        await navigator.share(fileOnly);
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return; // Si cancelas el menú a propósito, no hace nada
      }
      console.log("Error al invocar el compartidor nativo:", err);
    }
  }

  // Si el navegador del celular no soporta compartir archivos, se descarga como respaldo
  doc.save(fileName);
  notice("📥 PDF descargado en tu dispositivo.");
}

// Abre WhatsApp con el mensaje del comprobante (útil cuando el equipo no adjunta texto al PDF)
function shareReceiptWhatsAppText(p) {
  const url = "https://wa.me/?text=" + encodeURIComponent(getReceiptMessage(p));
  window.open(url, "_blank");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Devuelve una imagen "dibujable" (Image) a partir del sello cargado
async function resolveLogoImage() {
  let logo = null;
  try { logo = await loadLogoImage(); } catch (e) { console.warn(e); }
  if (!logo) return null;
  if (typeof logo === "string") {
    return await new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = logo;
    });
  }
  return logo; // ya es un <img>
}

// Dibuja el recibo directamente en un canvas (100% fiable en celulares,
// sin depender de html2canvas). Replica el diseño del PDF (A5, 148x210 mm).
function drawReceiptCanvas(p, logoImg) {
  const scale = 6; // píxeles por milímetro
  const W = Math.round(148 * scale), H = Math.round(210 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const X = (mm) => mm * scale;
  const Y = (mm) => mm * scale;
  const fs = (pt) => pt * 0.3528 * scale;
  const SANS = "Arial, Helvetica, sans-serif";

  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Franja superior oscura
  ctx.fillStyle = "#211e1e"; ctx.fillRect(0, 0, X(148), Y(44));
  if (logoImg) { try { ctx.drawImage(logoImg, X(12), Y(6), X(28), Y(28)); } catch (e) { console.warn(e); } }

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${fs(14)}px ${SANS}`;
  ctx.fillText("Club Deportivo Formativo Especializado", X(46), Y(16));
  ctx.fillText("Los Pumas", X(46), Y(23));
  ctx.font = `${fs(9)}px ${SANS}`;
  ctx.fillText("SANTA ISABEL, CALLE QUEVEDO Y PICHINCHA", X(46), Y(31));
  ctx.fillText("CEL: 0984302599", X(46), Y(36));

  // Título
  ctx.fillStyle = "#000000";
  ctx.font = `bold ${fs(22)}px ${SANS}`;
  ctx.fillText("RECIBO", X(15), Y(58));

  // Datos
  ctx.font = `${fs(12)}px ${SANS}`;
  ctx.strokeStyle = "rgb(120,120,120)"; ctx.lineWidth = Math.max(1, scale * 0.18);
  const dataRows = [["Recibo N° :", String(p.receipt), 75], ["Recibo a: :", String(p.studentName), 83], ["Fecha :", String(p.recordDate), 91]];
  if (p.coveredMonth) dataRows.push(["Cubre :", monthLabel(p.coveredMonth), 99]);
  dataRows
    .forEach(([label, val, y]) => {
      ctx.fillStyle = "#000000";
      ctx.fillText(label, X(15), Y(y));
      ctx.fillText(val, X(42), Y(y));
      ctx.beginPath(); ctx.moveTo(X(40), Y(y + 1)); ctx.lineTo(X(133), Y(y + 1)); ctx.stroke();
    });

  // Descripción
  ctx.fillStyle = "#26292b"; ctx.fillRect(X(15), Y(105), X(30), Y(8));
  ctx.fillStyle = "#ffffff"; ctx.font = `bold ${fs(11)}px ${SANS}`;
  ctx.fillText("Descripción:", X(18), Y(110.5));
  ctx.fillStyle = "#000000"; ctx.font = `${fs(12)}px ${SANS}`;
  ctx.fillText(`${p.concept} - Deuda total: ${money(p.total)}`, X(15), Y(122));
  if (p.notes) {
    ctx.fillStyle = "rgb(80,80,80)"; ctx.font = `${fs(9)}px ${SANS}`;
    ctx.fillText("(Nota: " + p.notes + ")", X(15), Y(128));
  }
  ctx.strokeStyle = "rgb(120,120,120)";
  ctx.beginPath(); ctx.moveTo(X(15), Y(132)); ctx.lineTo(X(133), Y(132)); ctx.stroke();

  // Saldo
  ctx.fillStyle = "#b5b5b5"; ctx.fillRect(X(15), Y(145), X(22), Y(8));
  ctx.fillStyle = "#000000"; ctx.font = `bold ${fs(11)}px ${SANS}`;
  ctx.fillText("SALDO:", X(17), Y(150.5));
  ctx.fillStyle = "rgb(199,25,45)"; ctx.fillText(money(p.balance), X(40), Y(150.5));
  ctx.strokeStyle = "rgb(120,120,120)";
  ctx.beginPath(); ctx.moveTo(X(39), Y(152)); ctx.lineTo(X(65), Y(152)); ctx.stroke();

  // Pago total
  ctx.fillStyle = "#b5b5b5"; ctx.fillRect(X(70), Y(155), X(26), Y(8));
  ctx.fillStyle = "#000000"; ctx.font = `bold ${fs(11)}px ${SANS}`;
  ctx.fillText("Pago Total:", X(72), Y(160.5));
  ctx.fillText(money(p.amount), X(98), Y(160.5));
  ctx.strokeStyle = "rgb(120,120,120)";
  ctx.beginPath(); ctx.moveTo(X(98), Y(162)); ctx.lineTo(X(125), Y(162)); ctx.stroke();

  // Firma
  ctx.textAlign = "center"; ctx.fillStyle = "#000000";
  ctx.font = `italic ${fs(22)}px Georgia, "Times New Roman", serif`;
  ctx.fillText("G Gavilanez", X(105), Y(182));
  ctx.strokeStyle = "#000000"; ctx.lineWidth = Math.max(1, scale * 0.18);
  ctx.beginPath(); ctx.moveTo(X(80), Y(185)); ctx.lineTo(X(130), Y(185)); ctx.stroke();
  ctx.font = `bold ${fs(10)}px ${SANS}`;
  ctx.fillText("Lic. Galo Gavilanez", X(105), Y(190));
  ctx.fillText("Director y Maestro", X(105), Y(195));
  ctx.textAlign = "left";

  // Franja inferior
  ctx.fillStyle = "#26292b"; ctx.fillRect(0, Y(202), X(148), Y(8));
  return canvas;
}

// Comparte el recibo como IMAGEN (PNG) junto al mensaje. A diferencia del PDF,
// WhatsApp sí incluye el texto como pie de foto en las imágenes.
async function shareReceiptImage(p) {
  notice("Generando imagen del recibo...");

  let logo = null;
  try { logo = await resolveLogoImage(); } catch (e) { console.warn(e); }

  let blob;
  try {
    const canvas = drawReceiptCanvas(p, logo);
    blob = await new Promise(res => canvas.toBlob(res, "image/png"));
  } catch (e) {
    console.error("Error al generar la imagen:", e);
    notice("No se pudo generar la imagen: " + (e && e.message ? e.message : "error desconocido"), true);
    return;
  }
  if (!blob) { notice("No se pudo generar la imagen.", true); return; }

  const fileName = `Recibo_${p.receipt}.png`;
  const title = `Recibo ${p.receipt} - Club Los Pumas`;
  const message = getReceiptMessage(p);

  let file;
  try {
    file = new File([blob], fileName, { type: "image/png" });
  } catch (e) {
    downloadBlob(blob, fileName);
    notice("📥 Imagen descargada en tu dispositivo.");
    return;
  }

  const withMessage = { files: [file], text: message, title };
  const fileOnly = { files: [file], title };

  if (navigator.share && navigator.canShare) {
    try {
      if (navigator.canShare(withMessage)) { await navigator.share(withMessage); return; }
      if (navigator.canShare(fileOnly)) { await navigator.share(fileOnly); return; }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.log("Error al compartir la imagen:", err);
    }
  }

  downloadBlob(blob, fileName);
  notice("📥 Imagen descargada en tu dispositivo.");
}

// --- HISTORIAL CON BUSCADOR DE ALUMNO Y CONTEO TOTAL ---
let historySelectedStudentId = "all";

$("historyStudentSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim(); 
  const res = $("historyStudentResults");
  if (q.length < 2) { 
    res?.classList.add("hidden"); 
    if (q === "") {
      historySelectedStudentId = "all";
      $("historyStudentFilter").value = "all";
      renderHistory();
    }
    return; 
  }
  const arr = data.students.filter(s => [s.cedula, s.names, s.last].join(" ").toLowerCase().includes(q));
  if (res) {
    res.innerHTML = arr.length ? arr.map(s => `<div class="search-item" data-id="${s.id}"><b>${esc(s.names)} ${esc(s.last)}</b> - ${esc(s.cedula)}</div>`).join("") : '<div class="search-item muted">Sin resultados.</div>';
    res.querySelectorAll(".search-item[data-id]").forEach(el => el.addEventListener("click", () => selectStudentForHistory(el.dataset.id)));
    res.classList.remove("hidden");
  }
});

function selectStudentForHistory(studentId) {
  const s = data.students.find(x => x.id === studentId); if (!s) return;
  historySelectedStudentId = s.id;
  $("historyStudentFilter").value = s.id;
  if ($("historyStudentSearch")) $("historyStudentSearch").value = `${s.names} ${s.last} (${s.cedula})`;
  $("historyStudentResults")?.classList.add("hidden");
  $("historyStudentSelected")?.classList.remove("hidden");
  if ($("historyStudentName")) $("historyStudentName").textContent = `${s.names} ${s.last}`;
  renderHistory();
}

$("historyStudentClear")?.addEventListener("click", () => {
  historySelectedStudentId = "all";
  $("historyStudentFilter").value = "all";
  if ($("historyStudentSearch")) $("historyStudentSearch").value = "";
  $("historyStudentSearch")?.classList.remove("hidden");
  $("historyStudentSelected")?.classList.add("hidden");
  renderHistory();
});

["historyMonth", "historyConcept", "historyStatus"].forEach(id => {
  $(id)?.addEventListener("change", renderHistory);
});

function renderHistory() {
  if (!$("historyList")) return;
  const month = $("historyMonth")?.value;
  const concept = $("historyConcept")?.value;
  const status = $("historyStatus")?.value;
  const studentFilter = historySelectedStudentId;

  let arr = data.abonos.map(ab => getJoinedReceipt(ab)).filter(p => {
    if (month && !(p.recordDate || "").startsWith(month)) return false;
    if (concept && concept !== "all" && p.concept !== concept) return false;
    if (status === "paid" && p.balance > 0) return false;
    if (status === "partial" && !(p.amount > 0 && p.balance > 0)) return false;
    if (status === "pending" && p.balance <= 0) return false;
    if (studentFilter !== "all" && p.studentId !== studentFilter) return false;
    return true;
  }).sort((a, b) => (b.recordDate || "").localeCompare(a.recordDate || ""));

  if ($("historyCount")) $("historyCount").textContent = arr.length;
  if ($("historyRevenue")) $("historyRevenue").textContent = money(arr.reduce((s, p) => s + p.amount, 0));

  const uniqueObs = new Set(); let totalBalance = 0;
  arr.forEach(p => { if (!uniqueObs.has(p.obligationId)) { uniqueObs.add(p.obligationId); totalBalance += p.balance; } });
  if ($("historyBalance")) $("historyBalance").textContent = money(totalBalance);

  if (!arr.length) { $("historyList").innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:var(--muted);">No hay recibos registrados con los filtros seleccionados.</div>'; return; }

  $("historyList").innerHTML = `<table style="min-width: 750px;"><thead><tr><th>Fecha</th><th>Recibo</th><th>Alumno</th><th>Concepto</th><th>Abono</th><th>Saldo</th><th>Acciones</th></tr></thead><tbody>${arr.map(p => `<tr>
    <td>${esc(p.recordDate)}</td>
    <td>${esc(p.receipt)}</td>
    <td><b>${esc(p.studentName)}</b></td>
    <td>${esc(p.concept)}</td>
    <td>${money(p.amount)}</td>
    <td>${money(p.balance)}</td>
    <td>
      <div style="display:flex; gap:6px;">
        <button class="mini-btn red" data-receipt="${p.receipt}">Ver comprobante</button>
        <button class="mini-btn danger" onclick="deleteReceipt('${p.receipt}')">Eliminar</button>
      </div>
    </td>
  </tr>`).join("")}</tbody></table>`;

  document.querySelectorAll("[data-receipt]").forEach(b => b.addEventListener("click", () => { const p = arr.find(x => x.receipt === b.dataset.receipt); if (p) renderReceipt(p); showView("payment"); }));
}

window.deleteReceipt = async function(receiptNum) {
  const ok = await confirmDialog({
    title: "Eliminar comprobante",
    message: `¿Estás seguro de eliminar el comprobante ${receiptNum}? Esta acción devolverá el monto abonado a la deuda pendiente.`,
    confirmText: "Sí, eliminar",
    danger: true
  });
  if (!ok) return;

  const abonoIdx = data.abonos.findIndex(a => a.receipt === receiptNum);
  if (abonoIdx === -1) return;

  const abono = data.abonos[abonoIdx];
  const obligation = data.obligations.find(o => o.id === abono.obligationId);

  if (obligation) {
    obligation.balance = Number((obligation.balance + abono.amount).toFixed(2));
  }

  data.abonos.splice(abonoIdx, 1);
  saveData();
  renderHistory();
  notice("Comprobante eliminado y saldo restituido correctamente.");
};

// --- TARIFAS ---
function fillTariffs() {
  if ($("tariffNormal")) $("tariffNormal").value = data.tariffs.normal;
  if ($("tariffLate")) $("tariffLate").value = data.tariffs.late;
  if ($("tariffMatricula")) $("tariffMatricula").value = data.tariffs.matricula;
  if ($("tariffImplements")) $("tariffImplements").value = data.tariffs.implements;
  if ($("tariffUniform")) $("tariffUniform").value = data.tariffs.uniform;
  if ($("tariffOther")) $("tariffOther").value = data.tariffs.other;
}

$("tariffForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const vals = { normal: $("tariffNormal")?.value, late: $("tariffLate")?.value, matricula: $("tariffMatricula")?.value, implements: $("tariffImplements")?.value, uniform: $("tariffUniform")?.value, other: $("tariffOther")?.value };
  for (const [k, v] of Object.entries(vals)) { data.tariffs[k] = Number(v); }
  saveData(); notice("Tarifas guardadas.");
});

$("resetTariffs")?.addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Restablecer tarifas",
    message: "¿Restablecer las tarifas por defecto? Se perderán los valores actuales.",
    confirmText: "Sí, restablecer",
    danger: true
  });
  if (ok) { data.tariffs = { ...defaultTariffs }; saveData(); fillTariffs(); notice("Tarifas restablecidas."); }
});

// --- COPIAS DE SEGURIDAD ---
$("btnExportData")?.addEventListener("click", () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `Respaldo_ClubLosPumas_${today()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  notice("Copia de seguridad descargada.");
});

$("btnImportData")?.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (event) {
    try {
      const importedData = JSON.parse(event.target.result);
      if (importedData.students && importedData.obligations && importedData.abonos) {
        const ok = await confirmDialog({
          title: "Restaurar respaldo",
          message: "¿Restaurar respaldo? Se sobreescribirán los registros actuales. Esta acción no se puede deshacer.",
          confirmText: "Sí, restaurar",
          danger: true
        });
        if (ok) {
          data = importedData;
          saveData();
          notice("Datos restaurados.");
          setTimeout(() => location.reload(), 1000);
        }
      } else {
        notice("El archivo no tiene el formato válido.", true);
      }
    } catch (err) {
      notice("Error al leer el archivo.", true);
    }
  };
  reader.readAsText(file);
});

function renderDashboard() {
  if ($("statStudents")) $("statStudents").textContent = data.students.filter(s => s.status !== "Inactivo").length;
  if ($("statPayments")) $("statPayments").textContent = data.abonos.length;
  if ($("statRevenue")) $("statRevenue").textContent = money(data.abonos.reduce((s, a) => s + a.amount, 0));

  // Mensualidades del mes seleccionado (por defecto, el mes en curso)
  const currentMonth = currentMonthKey();
  const monthKey = dashMonthKey || currentMonth;
  const active = data.students.filter(s => s.status !== "Inactivo");
  const enrolled = active.filter(s => (s.since || currentMonth) <= monthKey);
  const paid = enrolled.filter(s => hasPaidMonthly(s.id, monthKey));
  const debtors = enrolled.filter(s => !hasPaidMonthly(s.id, monthKey));
  const late = monthIsLate(monthKey);
  const rate = Number(late ? data.tariffs.late : data.tariffs.normal) || 0;
  const totalDebt = active.reduce((sum, s) => sum + studentDebt(s).total, 0);

  if ($("statPendingLabel")) $("statPendingLabel").textContent = "Deuda total por cobrar";
  if ($("statPending")) $("statPending").textContent = money(totalDebt);

  // Actividad reciente: últimos 5 recibos
  const recent = [...(data.abonos || [])]
    .sort((a, b) => (b.recordDate || "").localeCompare(a.recordDate || "") || String(b.receipt).localeCompare(String(a.receipt)))
    .slice(0, 5);
  const recentBox = $("dashRecent");
  if (recentBox) {
    recentBox.innerHTML = recent.length ? recent.map(a => {
      const p = getJoinedReceipt(a);
      return `<div class="activity-item">
        <div class="activity-main">
          <b>${esc(p.studentName)}</b>
          <span class="subline">${esc(p.concept)} · ${esc(p.recordDate)} · ${esc(p.receipt)}</span>
        </div>
        <div class="activity-amount">
          <span class="amt">${money(p.amount)}</span>
          <button class="mini-btn red" data-receipt="${esc(p.receipt)}">Ver</button>
        </div>
      </div>`;
    }).join("") : '<div class="empty-state">Aún no hay pagos registrados.</div>';
    recentBox.querySelectorAll("[data-receipt]").forEach(b => b.addEventListener("click", () => {
      const p = data.abonos.map(getJoinedReceipt).find(x => x.receipt === b.dataset.receipt);
      if (p) { renderReceipt(p); showView("payment"); }
    }));
  }

  // Panel de mensualidades del mes
  const monthlyBadge = $("dashMonthlyBadge");
  if (monthlyBadge) monthlyBadge.textContent = `${paid.length}/${enrolled.length} pagaron`;
  const monthlyTitle = $("dashMonthlyTitle");
  if (monthlyTitle) monthlyTitle.textContent = "Mensualidades";
  if ($("dashMonthLabel")) $("dashMonthLabel").textContent = monthLabel(monthKey);
  const monthlyProgress = $("dashMonthlyProgress");
  if (monthlyProgress) monthlyProgress.style.width = enrolled.length ? `${Math.round((paid.length / enrolled.length) * 100)}%` : "0%";
  const monthlyHint = $("dashMonthlyHint");
  if (monthlyHint) {
    if (monthKey === currentMonth) monthlyHint.textContent = late
      ? `Después del día 15 aplica recargo: ${money(rate)} por alumno.`
      : `Sin recargo hasta el 15. Tarifa normal: ${money(rate)}.`;
    else if (monthKey > currentMonth) monthlyHint.textContent = `Mes futuro · tarifa: ${money(rate)} por alumno.`;
    else monthlyHint.textContent = `Mes cerrado · recargo aplicado: ${money(rate)} por alumno.`;
  }

  const monthList = $("dashMonthlyList");
  if (monthList) {
    const q = ($("dashMonthlySearch")?.value || "").toLowerCase().trim();
    const shown = q ? debtors.filter(s => [s.cedula, s.names, s.last].join(" ").toLowerCase().includes(q)) : debtors;
    monthList.innerHTML = shown.length ? shown.map(s => {
      const d = studentDebt(s);
      const monthsTxt = d.count === 1 ? "1 mes" : `${d.count} meses`;
      return `<div class="debtor-item">
        <div>
          <b>${esc(s.names)} ${esc(s.last)}</b>
          <span class="subline">${esc(s.cedula)} · ${esc(s.group || "")} · debe ${monthsTxt}</span>
        </div>
        <div class="debtor-right">
          <span class="amt-red">${money(d.total)}</span>
          <button class="mini-btn red" data-pay-for="${s.id}">Cobrar</button>
        </div>
      </div>`;
    }).join("") : `<div class="empty-state">${q ? "Sin resultados para \"" + esc(q) + "\"." : (enrolled.length === 0 ? "Sin alumnos inscritos en este mes." : `¡Todos al día${monthKey === currentMonth ? " este mes" : " en " + monthLabel(monthKey)}! 🎉`)}</div>`;
    monthList.querySelectorAll("[data-pay-for]").forEach(b => b.addEventListener("click", () => { showView("payment"); selectStudentForPayment(b.dataset.payFor); }));
  }
}

// Mes seleccionado en el panel de mensualidades (null = mes actual)
let dashMonthKey = null;
$("dashMonthlySearch")?.addEventListener("input", renderDashboard);
$("dashMonthToday")?.addEventListener("click", () => { dashMonthKey = null; renderDashboard(); });

// Deslizar (swipe) para cambiar de mes en el panel de mensualidades
function shiftDashMonth(dir) {
  dashMonthKey = monthAdd(dashMonthKey || currentMonthKey(), dir);
  renderDashboard();
  const panel = $("dashMonthlyPanel");
  if (panel) { panel.classList.remove("month-fade"); void panel.offsetWidth; panel.classList.add("month-fade"); }
}
(function initMonthSwipe() {
  const panel = $("dashMonthlyPanel");
  if (!panel) return;
  let startX = 0, startY = 0, tracking = false, swiping = false;
  panel.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true; swiping = false;
  }, { passive: true });
  panel.addEventListener("touchmove", e => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!swiping && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) swiping = true;
    if (swiping && e.cancelable) e.preventDefault();
  }, { passive: false });
  panel.addEventListener("touchend", e => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) shiftDashMonth(dx < 0 ? 1 : -1);
    swiping = false;
  }, { passive: true });
})();

function renderAll() {
  renderDashboard();
  renderStudents();
  renderHistory();
  if ($("studentId")) $("studentId").value = `LP-${String(data.nextStudent || 1).padStart(4, "0")}`;
  if ($("recordDate") && !$("recordDate").value) $("recordDate").value = today();
}