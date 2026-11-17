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

// Permite recobrar un mes ya cancelado después de aceptar la advertencia
let forcePaidMonthly = false;
let lateFeeManuallySet = false;

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
      (data.students || []).forEach(s => {
        if (!s.since) { s.since = currentMonthKey(); migrated = true; }
        if (!("monthlyPrice" in s)) { s.monthlyPrice = null; migrated = true; }
      });
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

function parsePrice(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Precio del alumno; vacío = tarifa global. El precio con atraso es siempre
// la mensualidad más el recargo global (atrasada - normal).
function lateSurcharge() {
  return Math.max(0, (Number(data.tariffs.late) || 0) - (Number(data.tariffs.normal) || 0));
}

function studentPrice(student, type) {
  const ownNormal = parsePrice(student && student.monthlyPrice);
  const normal = ownNormal != null ? ownNormal : (Number(data.tariffs.normal) || 0);
  if (type === "late") {
    return normal + lateSurcharge();
  }
  return normal;
}
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// La mensualidad no tiene recargo si se paga hasta el día 15.
// Si el 15 cae sábado o domingo, el plazo se extiende al lunes siguiente.
function monthlyDueDate(dateStr) {
  const d = dateStr || today();
  const [y, m] = String(d).slice(0, 7).split("-").map(Number);
  const due = new Date(y, m - 1, 15);
  const dow = due.getDay(); // 0 = domingo, 6 = sábado
  if (dow === 6) due.setDate(17);      // sábado 15 -> lunes 17
  else if (dow === 0) due.setDate(16); // domingo 15 -> lunes 16
  return due;
}

function isPastDue(dateStr) {
  const d = dateStr || today();
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day) > monthlyDueDate(d);
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

// ¿El mes está vencido? (meses pasados = sí; mes actual = después del plazo de pago)
function monthIsLate(key) {
  const cm = currentMonthKey();
  if (key < cm) return true;
  if (key === cm) return isPastDue(today());
  return false;
}

function monthAmount(key, student) {
  return studentPrice(student, monthIsLate(key) ? "late" : "normal");
}

// Monto base de un mes: el mayor cobro normal. Los cobros generados con recargo
// no cuentan como base para no duplicarlo al volver a calcular la deuda.
// Devuelve null si el mes aún no tiene ningún cobro registrado.
function monthBaseTarget(studentId, monthKey) {
  const obls = (data.obligations || []).filter(o =>
    o.studentId === studentId && isMensualidad(o) && o.coveredMonth === monthKey);
  if (!obls.length) return null;
  const normales = obls.filter(o => o.monthlyType !== "late");
  const base = (normales.length ? normales : obls)
    .reduce((mx, o) => Math.max(mx, Number(o.total) || 0), 0);
  return normales.length ? base : Math.max(0, base - lateSurcharge());
}

// Solo se recarga un cobro fijado que sigue pendiente; si el mes ya fue pagado
// íntegramente se conserva su precio y no se genera un recargo retroactivo.
function monthTargetWithLate(student, monthKey, fixed) {
  if (fixed == null || !student) return fixed;
  const obls = (data.obligations || []).filter(o =>
    o.studentId === student.id && isMensualidad(o) && o.coveredMonth === monthKey);
  if (!obls.some(o => (Number(o.balance) || 0) > 0)) return fixed;
  if (monthPaidFor(student.id, monthKey) >= fixed) return fixed;
  return fixed + lateSurcharge();
}

// Monto objetivo de un mes: el cobro ya fijado (con recargo si sigue pendiente), o la tarifa.
// Si el alumno ya cubrió la tarifa normal, no se le aplica recargo retroactivo.
function monthTargetFor(studentId, monthKey, waive = false) {
  const s = data.students.find(x => x.id === studentId);
  const fixed = monthBaseTarget(studentId, monthKey);
  const late = monthIsLateFor(s, monthKey) && !waive;
  if (fixed != null) return late ? monthTargetWithLate(s, monthKey, fixed) : fixed;
  const normal = studentPrice(s, "normal");
  if (monthPaidFor(studentId, monthKey) >= normal) return normal;
  return late ? studentPrice(s, "late") : normal;
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
    out.push({ month: k, label: monthLabel(k), amount, paid: monthPaidFor(student.id, k), late: !fixed && monthIsLateFor(student, k) });
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
function confirmDialog({ title = "Confirmar", message = "", confirmText = "Aceptar", cancelText = "Cancelar", danger = true, icon = "⚠️" } = {}) {
  return new Promise(resolve => {
    const modal = $("confirmModal");
    if (!modal) { resolve(window.confirm(message)); return; }

    const ok = $("confirmOk");
    const cancel = $("confirmCancel");
    if ($("confirmTitle")) $("confirmTitle").textContent = title;
    if ($("confirmMessage")) $("confirmMessage").textContent = message;
    if ($("confirmIcon")) $("confirmIcon").textContent = icon;
    if (ok) { ok.textContent = confirmText; ok.className = danger ? "danger" : "primary"; }
    if (cancel) cancel.textContent = cancelText;
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
}

window.addEventListener("DOMContentLoaded", async () => {
  if (recordDate) recordDate.value = today();
  await loadData();
  showView("dashboard");
});

// Al volver a la app (o cambiar el día/mes) refrescar el panel del mes actual
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") renderDashboard();
});

document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showView(b.dataset.go)));

// --- GESTIÓN DE ALUMNOS ---
let editingStudentId = null;

function isNewStudentForm() {
  return $("studentTypeNew")?.checked === true;
}

function updateStudentTypeUI() {
  const isNew = isNewStudentForm();
  if ($("studentStatusRow")) $("studentStatusRow").style.display = isNew ? "none" : "";
  if (isNew && $("studentStatus")) $("studentStatus").value = "Activo";
}

function resetStudentForm() {
  $("studentForm")?.reset();
  if ($("studentId")) $("studentId").value = `LP-${String(data.nextStudent || 1).padStart(4, "0")}`;
  if ($("studentFormTitle")) $("studentFormTitle").textContent = "Registro de alumnos";
  if ($("studentTypeNew")) $("studentTypeNew").checked = true;
  updateStudentTypeUI();
  if ($("studentSubmitBtn")) $("studentSubmitBtn").textContent = "Guardar alumno";
  $("studentCancelEditBtn")?.classList.add("hidden");
  if ($("studentCedula")) $("studentCedula").disabled = false;
  editingStudentId = null;
}

$("studentCancelEditBtn")?.addEventListener("click", resetStudentForm);
document.querySelectorAll('input[name="studentType"]').forEach(r => r.addEventListener("change", updateStudentTypeUI));
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
      const isNew = isNewStudentForm();
      data.students[sIndex].status = isNew ? "Activo" : $("studentStatus")?.value;
      data.students[sIndex].isNew = isNew;
      if (isNew && !data.students[sIndex].enrollmentExemptMonth) data.students[sIndex].enrollmentExemptMonth = currentMonthKey();
      data.students[sIndex].monthlyPrice = parsePrice($("studentMonthlyPrice")?.value);
      saveData();
      notice("Alumno actualizado.");
      resetStudentForm();
    }
  } else {
    if (data.students.some(s => s.cedula === cedula)) { notice("Cédula duplicada.", true); return; }
    const isNew = isNewStudentForm();
    const s = {
      id: `LP-${String(data.nextStudent++).padStart(4, "0")}`,
      cedula,
      names: $("studentNames")?.value.trim(),
      last: $("studentLast")?.value.trim(),
      group: $("studentGroup")?.value,
      status: isNew ? "Activo" : $("studentStatus")?.value,
      since: currentMonthKey(),
      isNew,
      ...(isNew ? { enrollmentExemptMonth: currentMonthKey() } : {}),
      monthlyPrice: parsePrice($("studentMonthlyPrice")?.value)
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
  if ($("studentTypeNew")) $("studentTypeNew").checked = s.isNew === true;
  if ($("studentTypeOld")) $("studentTypeOld").checked = s.isNew !== true;
  updateStudentTypeUI();
  if ($("studentMonthlyPrice")) $("studentMonthlyPrice").value = s.monthlyPrice ?? "";

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
    const newBadge = s.isNew ? ` <span class="badge" style="background:#e8f0ff;color:#1e40af">Nuevo</span>` : "";
    const cobrarBtn = status === "Activo" ? `<button class="mini-btn red" style="padding:6px 12px; font-weight:600;" data-pay-for="${s.id}">Cobrar</button> ` : "";
    const debt = studentDebt(s).total;
    const debtCell = debt > 0 ? `<span style="color:var(--red); font-weight:700;">${money(debt)}</span>` : `<span class="muted">—</span>`;
    return `<tr>
        <td><b>${esc(s.names)} ${esc(s.last)}</b>${newBadge}</td>
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
  const csvHeader = "cedula,nombres,apellidos,grupo,estado,precio_mensual,nuevo\n";
  const csvExample = "1727363986,Joe Alexander,Gavilanez Paucar,Jóvenes,Activo,35,si\n1712345678,Matias Josue,Gavilanez Paucar,Niños,Activo,,no";
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
      const monthlyPrice = parsePrice(cols[5]);
      const isNew = /^(si|sí|1|true)$/i.test(cols[6] || "");

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
        status: isNew ? "Activo" : status.toLowerCase().includes("inac") ? "Inactivo" : "Activo",
        since: currentMonthKey(),
        isNew,
        ...(isNew ? { enrollmentExemptMonth: currentMonthKey() } : {}),
        monthlyPrice
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
  forcePaidMonthly = false;
  if ($("payStudentId")) $("payStudentId").value = "";
  if ($("payStudentSearch")) $("payStudentSearch").value = "";
  $("payStudentSearch")?.classList.remove("hidden");
  $("payStudentSelected")?.classList.add("hidden");
  resetPaymentFormToNew();
});

function selectStudentForPayment(studentId) {
  const s = data.students.find(x => x.id === studentId); if (!s) return;
  if ((s.status || "Activo") === "Inactivo") { notice("Este alumno está inactivo. Actívalo para poder registrar un pago.", true); return; }
  resetPaymentExtras();
  if ($("payStudentId")) $("payStudentId").value = s.id;
  $("payStudentSearch")?.classList.add("hidden"); $("payStudentResults")?.classList.add("hidden");
  $("payStudentSelected")?.classList.remove("hidden");
  if ($("payStudentName")) $("payStudentName").textContent = `${s.names} ${s.last}`;
  updateSuggestedAmount();
  warnIfMonthlyPaid();
}

// Advierte si la mensualidad del mes actual ya está cancelada.
// Si se acepta, se habilita el recobro de ese mes como comprobante adicional.
async function warnIfMonthlyPaid() {
  forcePaidMonthly = false;
  const s = selectedStudent();
  const concept = $("payConcept")?.value || "";
  if (!s || !/mensualidad/i.test(concept)) { updateSuggestedAmount(); return; }

  updateSuggestedAmount();
  const cm = currentMonthKey();
  const since = s.since || cm;
  // Solo advertir cuando no hay meses pendientes: si debe meses anteriores,
  // el cobro es legítimo y no se agrega el mes actual para evitar dobles cobros.
  if (cm < since || studentDebt(s).months.length > 0 || !hasPaidMonthly(s.id, cm)) return;

  const ok = await confirmDialog({
    title: "Mensualidad ya cancelada",
    message: `${s.names} ${s.last} ya tiene cancelada la mensualidad de ${monthLabel(cm)}. ¿Deseas emitir un comprobante adicional para ese mes?`,
    confirmText: "Aceptar",
    cancelText: "Omitir",
    danger: false,
    icon: "⚠️"
  });
  forcePaidMonthly = ok;
  updateSuggestedAmount();
}

function resetPaymentExtras() {
  lateFeeManuallySet = false;
  if ($("lateFeeToggle")) $("lateFeeToggle").checked = false;
  if ($("matriculaAmount")) $("matriculaAmount").value = 10;
}

function resetPaymentFormToNew() {
  resetPaymentExtras();
  if ($("payConcept")) updateSuggestedAmount();
}

function tariffFor(concept, type, student) {
  if (concept === "Mensualidad") return studentPrice(student, type);
  if (concept === "Mensualidad + Matrícula") return studentPrice(student, "normal") + (Number($("matriculaAmount")?.value) || 0);
  if (concept === "Implementos deportivos") return data.tariffs.implements;
  if (concept === "Uniformes") return 0;
  return data.tariffs.other;
}

function recomputeAmount() {
  const concept = $("payConcept")?.value;
  const suggested = Number(tariffFor(concept, "normal", selectedStudent())).toFixed(2);
  if ($("payAmount")) $("payAmount").value = suggested;
  if ($("payAbono")) $("payAbono").value = suggested;
  updateBalance();
}

// Mensualidades: se cobra por mes; el recargo se aplica automáticamente a cada mes vencido
function selectedStudent() {
  const id = $("payStudentId")?.value;
  return id ? data.students.find(s => s.id === id) : null;
}

// Un alumno con obligaciones o abonos ya es socio: la opción de matrícula es solo para nuevos.
function hasPaymentHistory(studentId) {
  if (!studentId) return false;
  return (data.obligations || []).some(o => o.studentId === studentId)
    || (data.abonos || []).some(a => a.studentId === studentId);
}

// El mes de ingreso de un alumno nuevo no lleva recargo; desde el segundo mes aplica el reglamento.
function isEnrollmentMonthFree(student, monthKey) {
  return !!student && !!student.enrollmentExemptMonth && student.enrollmentExemptMonth === monthKey;
}

function monthIsLateFor(student, monthKey) {
  return !!student && !isEnrollmentMonthFree(student, monthKey) && monthIsLate(monthKey);
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

  // Si se aceptó la advertencia, se agrega el mes actual aunque ya esté cancelado
  const cm = currentMonthKey();
  let months = debt.months;
  if (forcePaidMonthly && isMonthly && hasPaidMonthly(s.id, cm) && !months.some(m => m.month === cm)) {
    months = [...months, { month: cm, label: monthLabel(cm), amount: 0, paid: monthPaidFor(s.id, cm), late: false }];
  }

  // Recargo: se puede aplicar o quitar cuando ya venció el plazo (según la fecha del recibo)
  const refDate = $("recordDate")?.value || today();
  const refMonth = String(refDate).slice(0, 7);
  const lateRow = $("lateFeeRow");
  const refMonthPendingLate = isMonthly && isPastDue(refDate) && months.some(m => m.month === refMonth && !isEnrollmentMonthFree(s, m.month));
  if (lateRow) {
    lateRow.classList.toggle("hidden", !refMonthPendingLate);
    if (refMonthPendingLate && !lateFeeManuallySet && $("lateFeeToggle")) $("lateFeeToggle").checked = true;
    if ($("lateFeeLabel")) $("lateFeeLabel").textContent = `Aplicar recargo por atraso (+${money(lateSurcharge())})`;
  }

  if (!months.length) {
    list.innerHTML = `<div class="muted" style="font-size:13px;">No hay mensualidades pendientes.</div>`;
  } else {
    list.innerHTML = months.map(m => {
      const ch = monthChargeForForm(m.month);
      return `
      <label class="month-item${ch.late ? " late" : ""}">
        <input type="checkbox" class="month-check" value="${m.month}" data-amount="${ch.amount}" ${m.month === cm ? "checked" : ""}>
        <span class="month-name">${esc(m.label)}</span>
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
  if (isEnrollmentMonthFree(s, monthKey)) late = false;
  else if (monthKey < refMonth) late = true;
  else if (monthKey === refMonth) late = isPastDue(refDate) && !waive;
  else late = false;
  const adjustedTarget = (fixedTarget != null && late) ? monthTargetWithLate(s, monthKey, fixedTarget) : fixedTarget;
  const target = adjustedTarget != null ? adjustedTarget : studentPrice(s, late ? "late" : "normal");
  let amount = Math.max(0, target - monthPaidFor(s.id, monthKey));
  if (forcePaidMonthly && amount <= 0) amount = target;
  return { amount, late: late && (fixedTarget == null || adjustedTarget > fixedTarget) };
}

function recomputeMonthlyAmount() {
  const concept = $("payConcept")?.value || "";
  const checks = [...document.querySelectorAll("#pendingMonthsList .month-check:checked")];
  let total = checks.reduce((s, c) => s + (Number(c.dataset.amount) || 0), 0);
  if (/matr[ií]cula/i.test(concept)) total += Number($("matriculaAmount")?.value) || 0;
  if ($("payAmount")) $("payAmount").value = total.toFixed(2);
  if ($("payAbono")) $("payAbono").value = total.toFixed(2);
  updateBalance();
}

function updateSuggestedAmount() {
  const select = $("payConcept");
  const option = select && [...select.options].find(o => o.value === "Mensualidad + Matrícula");
  const s = selectedStudent();
  const canEnroll = !s || (s.isNew === true && !hasPaymentHistory(s.id));
  if (option) {
    option.hidden = !canEnroll;
    option.disabled = !canEnroll;
    if (!canEnroll && select.value === option.value) select.value = "Mensualidad";
  }
  const concept = select?.value || "";
  const isMonthly = /mensualidad/i.test(concept);
  $("matriculaRow")?.classList.toggle("hidden", !/matr[ií]cula/i.test(concept));
  renderPendingMonths();
  if (isMonthly) recomputeMonthlyAmount(); else recomputeAmount();
}

$("payConcept")?.addEventListener("change", () => warnIfMonthlyPaid());
$("matriculaAmount")?.addEventListener("input", updateSuggestedAmount);
$("recordDate")?.addEventListener("change", updateSuggestedAmount);
$("lateFeeToggle")?.addEventListener("change", () => {
  lateFeeManuallySet = true;
  const checked = [...document.querySelectorAll("#pendingMonthsList .month-check:checked")].map(cb => cb.value);
  renderPendingMonths();
  document.querySelectorAll("#pendingMonthsList .month-check").forEach(cb => {
    cb.checked = checked.includes(cb.value);
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
  forcePaidMonthly = false;
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
  if (/matr[ií]cula/i.test(concept) && (!s.isNew || hasPaymentHistory(s.id))) {
    notice("Esa opción es solo para alumnos nuevos; este alumno es antiguo o ya tiene historial.", true);
    updateSuggestedAmount();
    return;
  }
  const cleanDate = ($("recordDate")?.value || today()).trim();
  const notes = $("payNotes")?.value.trim() || "";
  const isMonthly = /mensualidad/i.test(concept);
  const created = [];

  if (isMonthly) {
    const checks = [...document.querySelectorAll("#pendingMonthsList .month-check:checked")]
      .map(c => ({ month: c.value, outstanding: Number(c.dataset.amount) || 0 }))
      .sort((a, b) => a.month.localeCompare(b.month));

    if (!checks.length) { notice("Selecciona al menos un mes a cancelar.", true); return; }

    const matricula = /matr[ií]cula/i.test(concept) ? (Number($("matriculaAmount")?.value) || 0) : 0;

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
    
    <div class="receipt-paper" id="receiptPaper" style="padding:0; overflow:hidden; border:1px solid #d8d3ca; border-radius:4px; background:#fff;">
        <div style="background-color: #252321; color: #fff; padding: 22px 28px; display: flex; align-items: center; gap: 18px;">
            <img
    class="receipt-logo"
    src="./img/Pum.png?v=2"
    alt="Sello Club Los Pumas"
    style="width: 66px; height: 66px; border-radius: 50%; object-fit: contain; background: #fff; padding: 3px; box-shadow: 0 0 0 1px rgba(255,255,255,.35);"
>
            <div>
                <h2 style="margin: 0 0 6px 0; font-size: 17px; line-height: 1.2; font-family: Georgia, 'Times New Roman', serif; letter-spacing: .3px;">Club Deportivo Formativo Especializado<br>Los Pumas</h2>
                <p style="margin: 0; font-size: 10px; color: #cfc9bf; line-height: 1.5; letter-spacing: .4px;">SANTA ISABEL, CALLE<br>QUEVEDO Y PICHINCHA<br>CEL: 0984302599</p>
            </div>
        </div>
        
        <div style="padding: 30px 32px;">
            <div style="text-align: center; margin-bottom: 26px;">
                <h1 style="margin: 0 0 12px 0; font-size: 28px; font-weight: normal; font-family: Georgia, 'Times New Roman', serif; letter-spacing: 3px; color: #1f1f1f;">RECIBO</h1>
                <div style="height: 1px; background: #c9c4bb;"></div>
                <div style="width: 64px; height: 2px; background: #252321; margin: 3px auto 0;"></div>
            </div>
            
            <div style="font-size: 13px; margin-bottom: ${p.notes ? "10px" : "26px"}; color: #1f1f1f; font-family: Georgia, 'Times New Roman', serif;">
                <div style="display: flex; gap: 14px; margin-bottom: 14px;">
                    <b style="flex: 0 0 100px; text-align: right; color: #4a453e;">Recibo N° :</b>
                    <span style="flex: 1; border-bottom: 1px solid #c9c4bb; padding-bottom: 4px;">${esc(p.receipt)}</span>
                </div>
                <div style="display: flex; gap: 14px; margin-bottom: 14px;">
                    <b style="flex: 0 0 100px; text-align: right; color: #4a453e;">Recibo a: :</b>
                    <span style="flex: 1; border-bottom: 1px solid #c9c4bb; padding-bottom: 4px;">${esc(p.studentName)}</span>
                </div>
                <div style="display: flex; gap: 14px;">
                    <b style="flex: 0 0 100px; text-align: right; color: #4a453e;">Fecha :</b>
                    <span style="flex: 1; border-bottom: 1px solid #c9c4bb; padding-bottom: 4px;">${esc(p.recordDate)}</span>
                </div>
            </div>
            ${p.notes ? `<div style="margin-bottom: 26px; background: #faf9f7; border-left: 2px solid #252321; padding: 10px 14px; font-family: Georgia, 'Times New Roman', serif; font-size: 13px; color: #1f1f1f;">
                <b>Observaciones:</b> <i>${esc(p.notes)}</i>
            </div>` : ""}
            
            <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 26px;">
                <div style="flex: 1 1 180px; border: 1px solid #c9c4bb; background: #faf9f7; padding: 10px 14px; display: flex; justify-content: space-between; align-items: baseline; gap: 10px;">
                    <b style="font-family: Georgia, 'Times New Roman', serif; font-size: 11px; color: #4a453e;">SALDO:</b>
                    <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-weight: bold; color: var(--red);">${money(p.balance)}</span>
                </div>
                <div style="flex: 1 1 180px; border: 1px solid #c9c4bb; background: #faf9f7; padding: 10px 14px; display: flex; justify-content: space-between; align-items: baseline; gap: 10px;">
                    <b style="font-family: Georgia, 'Times New Roman', serif; font-size: 11px; color: #4a453e;">Pago Total:</b>
                    <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-weight: bold; color: #1f1f1f;">${money(p.amount)}</span>
                </div>
            </div>
            
            <div style="text-align: center;">
                <div style="font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 22px; color: #1f1f1f; margin-bottom: 6px;">G Gavilanez</div>
                <div style="width: 120px; height: 1px; background: #1f1f1f; margin: 0 auto 8px;"></div>
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 11.5px; letter-spacing: .3px; line-height: 1.4; color: #1f1f1f;">Lic. Galo Gavilanez<br>Director y Maestro</div>
            </div>
        </div>
        <div style="background-color: #252321; height: 25px; width: 100%;"></div>
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
  doc.setFillColor(37, 35, 33);
  doc.rect(0, 0, 148, 44, 'F');

  if (logo) {
    try {
      doc.addImage(logo, "PNG", 12, 6, 28, 28);
    } catch (e) {
      console.warn("No se pudo incrustar el sello:", e);
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("times", "bold");
  doc.setFontSize(13.5);
  doc.text("Club Deportivo Formativo Especializado", 46, 16);
  doc.text("Los Pumas", 46, 23);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(207, 201, 191);
  doc.text("SANTA ISABEL, CALLE QUEVEDO Y PICHINCHA", 46, 31);
  doc.text("CEL: 0984302599", 46, 36);

  doc.setTextColor(31, 31, 31);
  doc.setFont("times", "bold");
  doc.setFontSize(26);
  doc.text("RECIBO", 74, 58, { align: "center" });
  doc.setDrawColor(201, 196, 187); doc.setLineWidth(0.15);
  doc.line(15, 64, 133, 64);
  doc.setDrawColor(37, 35, 33); doc.setLineWidth(0.4);
  doc.line(58, 65.2, 90, 65.2);

  doc.setFont("times", "normal");
  doc.setFontSize(11.5);
  doc.setTextColor(31, 31, 31);
  doc.text("Recibo Nº :", 42, 75, { align: "right" }); doc.text(String(p.receipt), 45, 75);
  doc.text("Recibo a: :", 42, 83, { align: "right" }); doc.text(String(p.studentName), 45, 83);
  doc.text("Fecha :", 42, 91, { align: "right" }); doc.text(String(p.recordDate), 45, 91);

  doc.setDrawColor(201, 196, 187); doc.setLineWidth(0.15);
  doc.line(45, 76, 133, 76); doc.line(45, 84, 133, 84); doc.line(45, 92, 133, 92);

  if (p.notes) {
    const allNoteLines = doc.splitTextToSize(p.notes, 112);
    const noteLines = allNoteLines.slice(0, 4);
    if (allNoteLines.length > 4) noteLines[noteLines.length - 1] = noteLines[noteLines.length - 1].replace(/\s+\S+$/, "") + " …";
    const panelBottom = 95 + 6 + noteLines.length * 5 + 3;
    doc.setFillColor(250, 249, 247);
    doc.rect(15, 95, 118, panelBottom - 95, 'F');
    doc.setDrawColor(37, 35, 33); doc.setLineWidth(0.4);
    doc.line(15, 95, 15, panelBottom);
    doc.setFont("times", "bold"); doc.setFontSize(10.5); doc.setTextColor(74, 69, 62);
    doc.text("Observaciones:", 19, 101);
    doc.setFont("times", "italic"); doc.setTextColor(31, 31, 31);
    noteLines.forEach((line, i) => doc.text(line, 19, 107 + i * 5));
  }

  doc.setFillColor(250, 249, 247); doc.setDrawColor(201, 196, 187); doc.setLineWidth(0.15);
  doc.rect(15, 145, 52, 9, 'FD');
  doc.rect(81, 145, 52, 9, 'FD');
  doc.setFont("times", "bold"); doc.setFontSize(10); doc.setTextColor(74, 69, 62);
  doc.text("SALDO:", 18, 151.5);
  doc.text("Pago Total:", 84, 151.5);
  doc.setFontSize(13);
  doc.setTextColor(199, 25, 45); doc.text(money(p.balance), 64, 151.5, { align: "right" });
  doc.setTextColor(31, 31, 31); doc.text(money(p.amount), 130, 151.5, { align: "right" });

  doc.setFont("times", "italic"); doc.setFontSize(20); doc.setTextColor(31, 31, 31);
  doc.text("G Gavilanez", 74, 178, { align: "center" });
  doc.setDrawColor(31, 31, 31); doc.setLineWidth(0.15); doc.line(59, 181, 89, 181);
  doc.setFont("times", "normal"); doc.setFontSize(10.5);
  doc.text("Lic. Galo Gavilanez", 74, 187, { align: "center" });
  doc.text("Director y Maestro", 74, 192, { align: "center" });

  doc.setFillColor(37, 35, 33); doc.rect(0, 202, 148, 8, 'F');
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

  let file;
  try {
    file = new File([doc.output('blob')], fileName, { type: 'application/pdf' });
  } catch (e) {
    doc.save(fileName);
    notice("📥 PDF descargado en tu dispositivo.");
    return;
  }

  // Compartir solo el archivo PDF, sin mensaje predefinido
  const fileOnly = { files: [file] };

  if (navigator.share && navigator.canShare) {
    try {
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
  const SERIF = 'Georgia, "Times New Roman", serif';

  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Franja superior oscura
  ctx.fillStyle = "#252321"; ctx.fillRect(0, 0, X(148), Y(44));
  if (logoImg) { try { ctx.drawImage(logoImg, X(12), Y(6), X(28), Y(28)); } catch (e) { console.warn(e); } }

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${fs(13.5)}px ${SERIF}`;
  ctx.fillText("Club Deportivo Formativo Especializado", X(46), Y(16));
  ctx.fillText("Los Pumas", X(46), Y(23));
  ctx.font = `${fs(8.5)}px ${SANS}`;
  ctx.fillStyle = "#cfc9bf";
  ctx.fillText("SANTA ISABEL, CALLE QUEVEDO Y PICHINCHA", X(46), Y(31));
  ctx.fillText("CEL: 0984302599", X(46), Y(36));

  // Título
  ctx.fillStyle = "#1f1f1f";
  ctx.font = `bold ${fs(26)}px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.fillText("RECIBO", X(74), Y(58));
  ctx.textAlign = "left";
  ctx.strokeStyle = "#c9c4bb"; ctx.lineWidth = Math.max(1, scale * 0.05);
  ctx.beginPath(); ctx.moveTo(X(15), Y(64)); ctx.lineTo(X(133), Y(64)); ctx.stroke();
  ctx.strokeStyle = "#252321"; ctx.lineWidth = Math.max(1, scale * 0.12);
  ctx.beginPath(); ctx.moveTo(X(58), Y(65.2)); ctx.lineTo(X(90), Y(65.2)); ctx.stroke();

  // Datos
  ctx.font = `${fs(11.5)}px ${SERIF}`;
  ctx.strokeStyle = "#c9c4bb"; ctx.lineWidth = Math.max(1, scale * 0.05);
  const dataRows = [["Recibo N° :", String(p.receipt), 75], ["Recibo a: :", String(p.studentName), 83], ["Fecha :", String(p.recordDate), 91]];
  dataRows.forEach(([label, val, y]) => {
    ctx.fillStyle = "#1f1f1f";
    ctx.textAlign = "right"; ctx.fillText(label, X(42), Y(y));
    ctx.textAlign = "left"; ctx.fillText(val, X(45), Y(y));
    ctx.beginPath(); ctx.moveTo(X(45), Y(y + 1)); ctx.lineTo(X(133), Y(y + 1)); ctx.stroke();
  });

  if (p.notes) {
    ctx.font = `italic ${fs(10.5)}px ${SERIF}`;
    const words = p.notes.split(/\s+/);
    const allNoteLines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? current + " " + word : word;
      if (current && ctx.measureText(candidate).width > X(112)) {
        allNoteLines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) allNoteLines.push(current);
    const noteLines = allNoteLines.slice(0, 4);
    if (allNoteLines.length > 4) noteLines[noteLines.length - 1] = noteLines[noteLines.length - 1].replace(/\s+\S+$/, "") + " …";
    const panelBottom = 95 + 6 + noteLines.length * 5 + 3;
    ctx.fillStyle = "#faf9f7"; ctx.fillRect(X(15), Y(95), X(118), Y(panelBottom - 95));
    ctx.strokeStyle = "#252321"; ctx.lineWidth = Math.max(1, scale * 0.12);
    ctx.beginPath(); ctx.moveTo(X(15), Y(95)); ctx.lineTo(X(15), Y(panelBottom)); ctx.stroke();
    ctx.fillStyle = "#4a453e"; ctx.font = `bold ${fs(10.5)}px ${SERIF}`;
    ctx.fillText("Observaciones:", X(19), Y(101));
    ctx.fillStyle = "#1f1f1f"; ctx.font = `italic ${fs(10.5)}px ${SERIF}`;
    noteLines.forEach((line, i) => ctx.fillText(line, X(19), Y(107 + i * 5)));
  }

  // Saldo y pago total
  ctx.fillStyle = "#faf9f7"; ctx.strokeStyle = "#c9c4bb"; ctx.lineWidth = Math.max(1, scale * 0.05);
  ctx.fillRect(X(15), Y(145), X(52), Y(9)); ctx.strokeRect(X(15), Y(145), X(52), Y(9));
  ctx.fillRect(X(81), Y(145), X(52), Y(9)); ctx.strokeRect(X(81), Y(145), X(52), Y(9));
  ctx.font = `bold ${fs(10)}px ${SERIF}`; ctx.fillStyle = "#4a453e";
  ctx.fillText("SALDO:", X(18), Y(151.5));
  ctx.fillText("Pago Total:", X(84), Y(151.5));
  ctx.font = `bold ${fs(13)}px ${SERIF}`;
  ctx.fillStyle = "#c7192d"; ctx.textAlign = "right"; ctx.fillText(money(p.balance), X(64), Y(151.5));
  ctx.fillStyle = "#1f1f1f"; ctx.fillText(money(p.amount), X(130), Y(151.5));
  ctx.textAlign = "left";

  // Firma
  ctx.textAlign = "center"; ctx.fillStyle = "#1f1f1f";
  ctx.font = `italic ${fs(20)}px ${SERIF}`;
  ctx.fillText("G Gavilanez", X(74), Y(178));
  ctx.strokeStyle = "#1f1f1f"; ctx.lineWidth = Math.max(1, scale * 0.05);
  ctx.beginPath(); ctx.moveTo(X(59), Y(181)); ctx.lineTo(X(89), Y(181)); ctx.stroke();
  ctx.font = `${fs(10.5)}px ${SERIF}`;
  ctx.fillText("Lic. Galo Gavilanez", X(74), Y(187));
  ctx.fillText("Director y Maestro", X(74), Y(192));
  ctx.textAlign = "left";

  // Franja inferior
  ctx.fillStyle = "#252321"; ctx.fillRect(0, Y(202), X(148), Y(8));
  return canvas;
}

// Comparte el recibo como IMAGEN (PNG) sin mensaje predefinido.
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

  let file;
  try {
    file = new File([blob], fileName, { type: "image/png" });
  } catch (e) {
    downloadBlob(blob, fileName);
    notice("📥 Imagen descargada en tu dispositivo.");
    return;
  }

  const fileOnly = { files: [file] };

  if (navigator.share && navigator.canShare) {
    try {
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
          (data.students || []).forEach(s => {
            if (!s.since) s.since = currentMonthKey();
            if (!("monthlyPrice" in s)) s.monthlyPrice = null;
          });
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
  const rateType = late ? "late" : "normal";
  const rates = [...new Set(enrolled.map(s => studentPrice(s, rateType)))].sort((a, b) => a - b);
  const rateText = rates.length
    ? (rates.length === 1 ? money(rates[0]) : `${money(rates[0])} – ${money(rates[rates.length - 1])}`)
    : money(0);
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
    if (monthKey === currentMonth) {
      const due = monthlyDueDate(today());
      const dueLabel = due.toLocaleDateString("es-EC", { day: "numeric", month: "long" });
      monthlyHint.textContent = late
        ? `Recargo de ${money(lateSurcharge())} aplicado; plazo venció el ${dueLabel}. Tarifa atrasada: ${rateText}.`
        : `Sin recargo hasta el ${dueLabel}. Tarifa normal: ${rateText}.`;
    }
    else if (monthKey > currentMonth) monthlyHint.textContent = `Mes futuro · tarifa por alumno: ${rateText}.`;
    else monthlyHint.textContent = `Mes cerrado · tarifa por alumno: ${rateText}.`;
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

function shiftDashMonth(dir) {
  dashMonthKey = monthAdd(dashMonthKey || currentMonthKey(), dir);
  renderDashboard();
  const panel = $("dashMonthlyPanel");
  if (panel) { panel.classList.remove("month-fade"); void panel.offsetWidth; panel.classList.add("month-fade"); }
}
$("dashMonthPrev")?.addEventListener("click", () => shiftDashMonth(-1));
$("dashMonthNext")?.addEventListener("click", () => shiftDashMonth(1));
$("dashMonthToday")?.addEventListener("click", () => {
  dashMonthKey = null;
  renderDashboard();
  const panel = $("dashMonthlyPanel");
  if (panel) { panel.classList.remove("month-fade"); void panel.offsetWidth; panel.classList.add("month-fade"); }
});

function renderAll() {
  renderDashboard();
  renderStudents();
  renderHistory();
  if ($("studentId")) $("studentId").value = `LP-${String(data.nextStudent || 1).padStart(4, "0")}`;
  if ($("recordDate") && !$("recordDate").value) $("recordDate").value = today();
}