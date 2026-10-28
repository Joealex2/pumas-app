const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "losPumas_VFinal_V2";
const defaultTariffs = { normal: 25, late: 30, matricula: 15, implements: 0, uniform: 0, other: 0 };
const defaultAuth = { user: "Galo", pass: "17021975" }; // Credenciales configuradas

let data = loadData();

function loadData() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
  if (!saved) return { students: [], obligations: [], abonos: [], tariffs: { ...defaultTariffs }, auth: { ...defaultAuth }, nextStudent: 1, nextReceipt: 1, nextObligation: 1 };
  if (!saved.obligations) saved.obligations = [];
  if (!saved.abonos) saved.abonos = [];
  if (!saved.tariffs) saved.tariffs = { ...defaultTariffs };
  if (!saved.auth) saved.auth = { ...defaultAuth };

  if (saved.students) {
    saved.students.forEach(s => { if (!s.status) s.status = "Activo"; });
  }
  return saved;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  renderAll();
}

function money(n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function notice(msg, error = false) {
  const n = $("notice");
  if (!n) return;
  n.textContent = msg;
  n.classList.remove("hidden", "error");
  if (error) n.classList.add("error");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => n.classList.add("hidden"), 4000);
}

function showLoginError(msg) {
  const ln = $("loginNotice");
  if (!ln) return;
  ln.textContent = msg;
  ln.classList.remove("hidden");
  setTimeout(() => ln.classList.add("hidden"), 4000);
}

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const v = $("view-" + name);
  if (v) v.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  if (name === "payment") resetPaymentFormToNew();
  if (name === "history") renderHistory();
  if (name === "tariffs") fillTariffs();
}

function login() {
  $("loginScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");
  showView("dashboard");
  renderAll();
}

$("loginForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const u = $("loginUser")?.value.trim().toLowerCase();
  const p = $("loginPass")?.value.trim();

  if (u === data.auth.user.toLowerCase() && p === data.auth.pass) {
    login();
    notice("Sesión iniciada.");
  } else {
    showLoginError("Usuario o contraseña incorrectos.");
  }
});

$("logoutBtn")?.addEventListener("click", () => {
  $("appShell")?.classList.add("hidden");
  $("loginScreen")?.classList.remove("hidden");
  if ($("loginPass")) $("loginPass").value = "";
});

document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showView(b.dataset.go)));

// --- LÓGICA DE ALUMNOS ---
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
      data.students[sIndex].repPhone = $("studentRepPhone")?.value.trim();
      data.students[sIndex].phone = $("studentPhone")?.value.trim();
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
      cedula, names: $("studentNames")?.value.trim(), last: $("studentLast")?.value.trim(),
      repPhone: $("studentRepPhone")?.value.trim(), phone: $("studentPhone")?.value.trim(),
      group: $("studentGroup")?.value, status: $("studentStatus")?.value
    };
    data.students.push(s);
    saveData(); notice("Alumno guardado."); resetStudentForm();
  }
});

$("studentSearch")?.addEventListener("input", renderStudents);
$("studentFilterStatus")?.addEventListener("change", renderStudents);

function contactLinks(repPhone, studentPhone) {
  let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;
  if (repPhone) {
    html += `<div style="display:flex; gap:6px; align-items:center;">
                 <span class="subline" style="margin:0; width:28px;">Rep:</span>
                 <a class="mini-btn" style="padding:5px 8px; font-size:12px;" href="tel:${esc(repPhone)}" title="Llamar">📞</a> 
                 <a class="mini-btn" style="color:#177344; border-color:#c2e8d3; background:#e6f7ed; padding:5px 8px; display:flex; align-items:center; gap:4px;" target="_blank" href="https://wa.me/${repPhone.replace(/\D/g, "")}?text=Hola">💬 WhatsApp</a>
              </div>`;
  }
  if (studentPhone) {
    html += `<div style="display:flex; gap:6px; align-items:center;">
                 <span class="subline" style="margin:0; width:28px;">Alu:</span>
                 <a class="mini-btn" style="padding:5px 8px; font-size:12px;" href="tel:${esc(studentPhone)}" title="Llamar">📞</a> 
                 <a class="mini-btn" style="color:#177344; border-color:#c2e8d3; background:#e6f7ed; padding:5px 8px; display:flex; align-items:center; gap:4px;" target="_blank" href="https://wa.me/${studentPhone.replace(/\D/g, "")}?text=Hola">💬 WhatsApp</a>
              </div>`;
  }
  html += `</div>`;
  return html;
}

window.editStudent = function (id) {
  const s = data.students.find(x => x.id === id);
  if (!s) return;
  editingStudentId = s.id;
  if ($("studentId")) $("studentId").value = s.id;
  if ($("studentCedula")) $("studentCedula").value = s.cedula;
  if ($("studentNames")) $("studentNames").value = s.names;
  if ($("studentLast")) $("studentLast").value = s.last;
  if ($("studentRepPhone")) $("studentRepPhone").value = s.repPhone;
  if ($("studentPhone")) $("studentPhone").value = s.phone || "";
  if ($("studentGroup")) $("studentGroup").value = s.group;
  if ($("studentStatus")) $("studentStatus").value = s.status || "Activo";

  if ($("studentFormTitle")) $("studentFormTitle").textContent = `Editando a: ${s.names} ${s.last}`;
  if ($("studentSubmitBtn")) $("studentSubmitBtn").textContent = "Actualizar";
  $("studentCancelEditBtn")?.classList.remove("hidden");
  window.scrollTo({ top: $("view-students")?.offsetTop || 0, behavior: "smooth" });
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

  if (!arr.length) { $("studentsList").innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:var(--muted);">No hay alumnos.</div>'; return; }

  $("studentsList").innerHTML = `<table style="min-width: 750px;"><thead><tr><th>Alumno</th><th>Cédula / ID</th><th>Grupo</th><th>Estado</th><th>Contactos</th><th>Acciones</th></tr></thead><tbody>${arr.map(s => {
    const status = s.status || "Activo";
    const statusBadge = status === "Activo" ? `<span class="badge" style="background:#e6f7ed;color:#177344">Activo</span>` : `<span class="badge" style="background:#fde7e9;color:#a41327">Inactivo</span>`;
    return `<tr>
        <td><b>${esc(s.names)} ${esc(s.last)}</b></td>
        <td>${esc(s.cedula)}<span class="subline">${esc(s.id)}</span></td>
        <td>${esc(s.group)}</td>
        <td>${statusBadge}</td>
        <td>${contactLinks(s.repPhone, s.phone)}</td>
        <td>
            <div style="display:flex; gap:6px; flex-wrap:nowrap;">
                <button class="mini-btn red" style="padding:6px 12px; font-weight:600;" data-pay-for="${s.id}">Cobrar</button> 
                <button class="mini-btn" style="padding:6px 12px;" onclick="editStudent('${s.id}')">Editar</button>
            </div>
        </td>
     </tr>`;
  }).join("")}</tbody></table>`;

  document.querySelectorAll("[data-pay-for]").forEach(b => b.addEventListener("click", () => { showView("payment"); selectStudentForPayment(b.dataset.payFor); }));
}

// --- CARGA MASIVA DE ALUMNOS (CSV / EXCEL) ---
$("btnDownloadTemplate")?.addEventListener("click", () => {
  const csvHeader = "cedula,nombres,apellidos,telefono_representante,telefono_alumno,grupo,estado\n";
  const csvExample = "1727363986,Joe Alexander,Gavilanez Paucar,0984302599,0999999999,Jóvenes,Activo\n1712345678,Matias Josue,Gavilanez Paucar,0984302599,,Niños,Activo";
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

    if (lines.length < 2) {
      notice("El archivo está vacío o no contiene datos.", true);
      return;
    }

    let importCount = 0;
    let duplicateCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const separator = lines[i].includes(";") ? ";" : ",";
      const cols = lines[i].split(separator).map(c => c.trim().replace(/^["']|["']$/g, ""));

      if (cols.length < 4) continue;

      const cedula = cols[0].replace(/\D/g, "").slice(0, 10);
      const names = cols[1];
      const last = cols[2];
      const repPhone = cols[3];
      const phone = cols[4] || "";
      const group = cols[5] || "Niños";
      const status = cols[6] || "Activo";

      if (!cedula || !names || !last || !repPhone) continue;

      if (data.students.some(s => s.cedula === cedula)) {
        duplicateCount++;
        continue;
      }

      const newStudent = {
        id: `LP-${String(data.nextStudent++).padStart(4, "0")}`,
        cedula: cedula,
        names: names,
        last: last,
        repPhone: repPhone,
        phone: phone,
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
      notice(`¡Carga exitosa! Se importaron ${importCount} deportistas. ${duplicateCount > 0 ? `(${duplicateCount} ya existían).` : ""}`);
    } else {
      notice("No se importó ningún alumno nuevo. Verifica que no estén duplicados.", true);
    }
  };

  reader.readAsText(file, "UTF-8");
});

// --- LÓGICA DE PAGOS ---
$("payStudentSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim(); const res = $("payStudentResults");
  if (q.length < 2) { res?.classList.add("hidden"); return; }
  const arr = data.students.filter(s => [s.cedula, s.names, s.last].join(" ").toLowerCase().includes(q));
  if (res) {
    res.innerHTML = arr.length ? arr.map(s => `<div class="search-item" data-id="${s.id}"><b>${esc(s.names)} ${esc(s.last)}</b> - ${esc(s.cedula)}</div>`).join("") : '<div class="search-item muted">Sin resultados.</div>';
    res.querySelectorAll(".search-item[data-id]").forEach(el => el.addEventListener("click", () => selectStudentForPayment(el.dataset.id)));
    res.classList.remove("hidden");
  }
});

$("payStudentClear")?.addEventListener("click", () => {
  if ($("payStudentId")) $("payStudentId").value = "";
  if ($("payStudentSearch")) $("payStudentSearch").value = "";
  $("payStudentSearch")?.classList.remove("hidden");
  $("payStudentSelected")?.classList.add("hidden");
  $("pendingObligationsWrap")?.classList.add("hidden");
  resetPaymentFormToNew();
});

function selectStudentForPayment(studentId) {
  const s = data.students.find(x => x.id === studentId); if (!s) return;
  if ($("payStudentId")) $("payStudentId").value = s.id;
  $("payStudentSearch")?.classList.add("hidden"); $("payStudentResults")?.classList.add("hidden");
  $("payStudentSelected")?.classList.remove("hidden");
  if ($("payStudentName")) $("payStudentName").textContent = `${s.names} ${s.last}`;

  const pending = data.obligations.filter(o => o.studentId === studentId && o.balance > 0);
  if (pending.length > 0) {
    $("pendingObligationsWrap")?.classList.remove("hidden");
    if ($("pendingObligationsList")) $("pendingObligationsList").innerHTML = pending.map(o => `<div class="pending-item"><div><b>${esc(o.concept)}</b> - Deuda: ${money(o.total)}</div><div><b style="color:var(--red);margin-right:10px">Saldo: ${money(o.balance)}</b> <button type="button" class="mini-btn red" onclick="fillPaymentFormForObligation('${o.id}')">Abonar</button></div></div>`).join("");
  } else { $("pendingObligationsWrap")?.classList.add("hidden"); }
  resetPaymentFormToNew();
}

function resetPaymentFormToNew() {
  if ($("payObligationId")) $("payObligationId").value = "";
  if ($("payConcept")) $("payConcept").disabled = false;
  if ($("monthlyType")) $("monthlyType").disabled = false;
  if ($("payAmount")) $("payAmount").readOnly = false;
  if ($("formModeLabel")) $("formModeLabel").textContent = "Crear nueva obligación y abonar";
  if ($("payConcept")) updateSuggestedAmount();
}

window.fillPaymentFormForObligation = function (obId) {
  const ob = data.obligations.find(o => o.id === obId); if (!ob) return;
  if ($("payObligationId")) $("payObligationId").value = ob.id;
  if ($("payConcept")) { $("payConcept").value = ob.concept; $("payConcept").disabled = true; }
  if ($("monthlyType")) { $("monthlyType").value = ob.monthlyType || "normal"; $("monthlyType").disabled = true; }
  if ($("payAmount")) { $("payAmount").value = ob.total.toFixed(2); $("payAmount").readOnly = true; }
  if ($("payAbono")) $("payAbono").value = ob.balance.toFixed(2);
  if ($("formModeLabel")) $("formModeLabel").textContent = "Abonar a deuda existente";
  updateBalance();
  if ($("paymentForm")) window.scrollTo({ top: $("paymentForm").offsetTop, behavior: "smooth" });
};

function tariffFor(concept, type) {
  if (concept === "Mensualidad") return type === "late" ? data.tariffs.late : data.tariffs.normal;
  if (concept === "Mensualidad + Matrícula") return data.tariffs.normal + data.tariffs.matricula;
  if (concept === "Implementos deportivos") return data.tariffs.implements;
  if (concept === "Uniformes") return data.tariffs.uniform;
  return data.tariffs.other;
}

function updateSuggestedAmount() {
  if ($("payObligationId")?.value !== "") return;
  const concept = $("payConcept")?.value;
  $("monthlyTypeWrap")?.classList.toggle("hidden", concept !== "Mensualidad");
  if ($("payAmount")) $("payAmount").value = Number(tariffFor(concept, $("monthlyType")?.value)).toFixed(2);
  updateBalance();
}

$("payConcept")?.addEventListener("change", updateSuggestedAmount);
$("monthlyType")?.addEventListener("change", updateSuggestedAmount);
$("payAbono")?.addEventListener("input", updateBalance);
$("payAmount")?.addEventListener("input", updateBalance);

function updateBalance() {
  const total = Number($("payAmount")?.value) || 0;
  const abono = Number($("payAbono")?.value) || 0;
  if ($("payBalance")) $("payBalance").textContent = money(Math.max(0, total - abono));
}

$("paymentForm")?.addEventListener("reset", () => setTimeout(() => {
  if ($("recordDate")) $("recordDate").value = today();
  if ($("payAbono")) $("payAbono").value = "";
  resetPaymentFormToNew();
}, 0));

$("paymentForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const studentId = $("payStudentId")?.value;
  if (!studentId) { notice("Selecciona un alumno.", true); return; }
  const total = Number($("payAmount")?.value), abono = Number($("payAbono")?.value);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(abono) || abono < 0) { notice("Valores inválidos.", true); return; }

  const s = data.students.find(x => x.id === studentId);
  const isExisting = $("payObligationId")?.value !== "";
  let obId = $("payObligationId")?.value;

  if (!isExisting) {
    if (abono > total) { notice("El abono no puede superar el total.", true); return; }
    obId = `OB-${String(data.nextObligation++).padStart(5, "0")}`;
    data.obligations.push({ id: obId, studentId: s.id, concept: $("payConcept")?.value, monthlyType: $("monthlyType")?.value, total: total, balance: Math.max(0, total - abono), created: $("recordDate")?.value });
  } else {
    const ob = data.obligations.find(o => o.id === obId);
    if (abono > ob.balance) { notice("Abono supera el saldo pendiente.", true); return; }
    ob.balance = Math.max(0, ob.balance - abono);
  }

  const cleanDate = ($("recordDate")?.value || today()).trim();
  const p = { receipt: `LP-${String(data.nextReceipt++).padStart(6, "0")}`, obligationId: obId, studentId: s.id, studentName: `${s.names} ${s.last}`, cedula: s.cedula, concept: $("payConcept")?.value, recordDate: cleanDate, amount: abono, notes: $("payNotes")?.value.trim() };
  data.abonos.push(p);
  saveData();
  e.target.reset();
  $("payStudentClear")?.click();
  renderReceipt(getJoinedReceipt(p));
  notice("Registrado correctamente.");
});

function getJoinedReceipt(abono) {
  const ob = data.obligations.find(o => o.id === abono.obligationId) || {};
  return { ...abono, total: ob.total || 0, balance: ob.balance || 0, monthlyType: ob.monthlyType || 'normal' };
}

// --- RECIBO ---
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
        <div style="background-color: #211