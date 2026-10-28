const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "losPumas_VFinal"; // Clave actualizada para refrescar credenciales
const defaultTariffs = {normal:25, late:30, matricula:15, implements:0, uniform:0, other:0};
const defaultAuth = {user: "admin", pass: "pumas123"}; // Modifica aquí tus credenciales por defecto si deseas

let data = loadData();

function loadData(){
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch(e){}
  if(!saved) return {students:[], obligations:[], abonos:[], tariffs:{...defaultTariffs}, auth:{...defaultAuth}, nextStudent:1, nextReceipt:1, nextObligation:1};
  if(!saved.obligations) saved.obligations = [];
  if(!saved.abonos) saved.abonos = [];
  if(!saved.tariffs) saved.tariffs = {...defaultTariffs};
  if(!saved.auth) saved.auth = {...defaultAuth};
  
  if(saved.students) {
      saved.students.forEach(s => { if(!s.status) s.status = "Activo"; });
  }
  return saved;
}

function saveData(){ 
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); 
    renderAll(); 
}

function money(n){ return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n)||0); }
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}

function notice(msg, error=false){
    const n = $("notice");
    if(!n) return;
    n.textContent = msg;
    n.classList.remove("hidden","error");
    if(error) n.classList.add("error");
    window.scrollTo({top:0, behavior:"smooth"});
    setTimeout(() => n.classList.add("hidden"), 4000);
}

function showLoginError(msg){
    const ln = $("loginNotice");
    if(!ln) return;
    ln.textContent = msg;
    ln.classList.remove("hidden");
    setTimeout(() => ln.classList.add("hidden"), 4000);
}

function showView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  const v = $("view-"+name);
  if(v) v.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="payment") resetPaymentFormToNew();
  if(name==="history") renderHistory();
  if(name==="tariffs") fillTariffs();
}

function login(){ 
    $("loginScreen")?.classList.add("hidden");
    $("appShell")?.classList.remove("hidden");
    showView("dashboard");
    renderAll(); 
}

$("loginForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const u = $("loginUser")?.value.trim().toLowerCase();
    const p = $("loginPass")?.value.trim();
    
    if(u === data.auth.user.toLowerCase() && p === data.auth.pass){
        login();
        notice("Sesión iniciada.");
    } else {
        showLoginError("Usuario o contraseña incorrectos.");
    }
});

$("logoutBtn")?.addEventListener("click",()=>{
    $("appShell")?.classList.add("hidden");
    $("loginScreen")?.classList.remove("hidden");
    if($("loginPass")) $("loginPass").value="";
});

document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));

// --- LÓGICA DE ALUMNOS ---
let editingStudentId = null;

function resetStudentForm() {
    $("studentForm")?.reset();
    if($("studentId")) $("studentId").value = `LP-${String(data.nextStudent||1).padStart(4,"0")}`;
    if($("studentFormTitle")) $("studentFormTitle").textContent = "Registro de alumnos";
    if($("studentSubmitBtn")) $("studentSubmitBtn").textContent = "Guardar alumno";
    $("studentCancelEditBtn")?.classList.add("hidden");
    if($("studentCedula")) $("studentCedula").disabled = false; 
    editingStudentId = null;
}

$("studentCancelEditBtn")?.addEventListener("click", resetStudentForm);
$("studentCedula")?.addEventListener("input",e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,10));

$("studentForm")?.addEventListener("submit",e=>{
    e.preventDefault();
    const cedula = $("studentCedula")?.value.trim();
    if(!/^\d{10}$/.test(cedula)){notice("La cédula debe tener 10 dígitos.",true);return;}
    
    if(editingStudentId) {
        const sIndex = data.students.findIndex(s => s.id === editingStudentId);
        if(sIndex > -1) {
            if(data.students.some(s => s.cedula === cedula && s.id !== editingStudentId)){
                notice("Cédula duplicada.",true);return;
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
        if(data.students.some(s=>s.cedula===cedula)){notice("Cédula duplicada.",true);return;}
        const s = {
            id: `LP-${String(data.nextStudent++).padStart(4,"0")}`,
            cedula, names: $("studentNames")?.value.trim(), last: $("studentLast")?.value.trim(),
            repPhone: $("studentRepPhone")?.value.trim(), phone: $("studentPhone")?.value.trim(),
            group: $("studentGroup")?.value, status: $("studentStatus")?.value
        };
        data.students.push(s);
        saveData(); notice("Alumno guardado."); resetStudentForm();
    }
});

$("studentSearch")?.addEventListener("input",renderStudents);
$("studentFilterStatus")?.addEventListener("change",renderStudents);

function contactLinks(repPhone, studentPhone){
 let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;
 if(repPhone) {
     html += `<div style="display:flex; gap:6px; align-items:center;">
                 <span class="subline" style="margin:0; width:28px;">Rep:</span>
                 <a class="mini-btn" style="padding:5px 8px; font-size:12px;" href="tel:${esc(repPhone)}" title="Llamar">📞</a> 
                 <a class="mini-btn" style="color:#177344; border-color:#c2e8d3; background:#e6f7ed; padding:5px 8px; display:flex; align-items:center; gap:4px;" target="_blank" href="https://wa.me/${repPhone.replace(/\D/g,"")}?text=Hola">💬 WhatsApp</a>
              </div>`;
 }
 if(studentPhone) {
     html += `<div style="display:flex; gap:6px; align-items:center;">
                 <span class="subline" style="margin:0; width:28px;">Alu:</span>
                 <a class="mini-btn" style="padding:5px 8px; font-size:12px;" href="tel:${esc(studentPhone)}" title="Llamar">📞</a> 
                 <a class="mini-btn" style="color:#177344; border-color:#c2e8d3; background:#e6f7ed; padding:5px 8px; display:flex; align-items:center; gap:4px;" target="_blank" href="https://wa.me/${studentPhone.replace(/\D/g,"")}?text=Hola">💬 WhatsApp</a>
              </div>`;
 }
 html += `</div>`;
 return html;
}

window.editStudent = function(id) {
    const s = data.students.find(x => x.id === id);
    if(!s) return;
    editingStudentId = s.id;
    if($("studentId")) $("studentId").value = s.id;
    if($("studentCedula")) $("studentCedula").value = s.cedula;
    if($("studentNames")) $("studentNames").value = s.names;
    if($("studentLast")) $("studentLast").value = s.last;
    if($("studentRepPhone")) $("studentRepPhone").value = s.repPhone;
    if($("studentPhone")) $("studentPhone").value = s.phone || "";
    if($("studentGroup")) $("studentGroup").value = s.group;
    if($("studentStatus")) $("studentStatus").value = s.status || "Activo";
    
    if($("studentFormTitle")) $("studentFormTitle").textContent = `Editando a: ${s.names} ${s.last}`;
    if($("studentSubmitBtn")) $("studentSubmitBtn").textContent = "Actualizar";
    $("studentCancelEditBtn")?.classList.remove("hidden");
    window.scrollTo({top: $("view-students")?.offsetTop || 0, behavior: "smooth"});
};

function renderStudents(){
 if(!$("studentsList")) return;
 const q = ($("studentSearch")?.value||"").toLowerCase();
 const filterStatus = $("studentFilterStatus")?.value || "all";
 
 const arr = data.students.filter(s => {
     const status = s.status || "Activo"; 
     const matchSearch = [s.cedula, s.names, s.last].join(" ").toLowerCase().includes(q);
     const matchStatus = filterStatus === "all" || status === filterStatus;
     return matchSearch && matchStatus;
 });
 
 if(!arr.length){$("studentsList").innerHTML='<div class="empty-state">No hay alumnos.</div>';return;}
 
 $("studentsList").innerHTML=`<table style="min-width: 920px;"><thead><tr><th>Alumno</th><th>Cédula / ID</th><th>Grupo</th><th>Estado</th><th>Contactos</th><th>Acciones</th></tr></thead><tbody>${arr.map(s=>{
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
 
 document.querySelectorAll("[data-pay-for]").forEach(b=>b.addEventListener("click",()=>{ showView("payment"); selectStudentForPayment(b.dataset.payFor); }));
}

// --- LÓGICA DE PAGOS ---
$("payStudentSearch")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim(); const res = $("payStudentResults");
    if(q.length < 2) { res?.classList.add("hidden"); return; }
    const arr = data.students.filter(s => [s.cedula, s.names, s.last].join(" ").toLowerCase().includes(q));
    if(res){
        res.innerHTML = arr.length ? arr.map(s => `<div class="search-item" data-id="${s.id}"><b>${esc(s.names)} ${esc(s.last)}</b> - ${esc(s.cedula)}</div>`).join("") : '<div class="search-item muted">Sin resultados.</div>';
        res.querySelectorAll(".search-item[data-id]").forEach(el => el.addEventListener("click", () => selectStudentForPayment(el.dataset.id)));
        res.classList.remove("hidden");
    }
});

$("payStudentClear")?.addEventListener("click", () => {
    if($("payStudentId")) $("payStudentId").value = ""; 
    if($("payStudentSearch")) $("payStudentSearch").value = ""; 
    $("payStudentSearch")?.classList.remove("hidden");
    $("payStudentSelected")?.classList.add("hidden"); 
    $("pendingObligationsWrap")?.classList.add("hidden");
    resetPaymentFormToNew();
});

function selectStudentForPayment(studentId) {
    const s = data.students.find(x => x.id === studentId); if(!s) return;
    if($("payStudentId")) $("payStudentId").value = s.id; 
    $("payStudentSearch")?.classList.add("hidden"); $("payStudentResults")?.classList.add("hidden");
    $("payStudentSelected")?.classList.remove("hidden"); 
    if($("payStudentName")) $("payStudentName").textContent = `${s.names} ${s.last}`;
    
    const pending = data.obligations.filter(o => o.studentId === studentId && o.balance > 0);
    if(pending.length > 0) {
        $("pendingObligationsWrap")?.classList.remove("hidden");
        if($("pendingObligationsList")) $("pendingObligationsList").innerHTML = pending.map(o => `<div class="pending-item"><div><b>${esc(o.concept)}</b> - Deuda: ${money(o.total)}</div><div><b style="color:var(--red);margin-right:10px">Saldo: ${money(o.balance)}</b> <button type="button" class="mini-btn red" onclick="fillPaymentFormForObligation('${o.id}')">Abonar</button></div></div>`).join("");
    } else { $("pendingObligationsWrap")?.classList.add("hidden"); }
    resetPaymentFormToNew();
}

function resetPaymentFormToNew() {
    if($("payObligationId")) $("payObligationId").value = ""; 
    if($("payConcept")) $("payConcept").disabled = false; 
    if($("monthlyType")) $("monthlyType").disabled = false;
    if($("payAmount")) $("payAmount").readOnly = false; 
    if($("formModeLabel")) $("formModeLabel").textContent = "Crear nueva obligación y abonar";
    if($("payConcept")) updateSuggestedAmount();
}

window.fillPaymentFormForObligation = function(obId) {
    const ob = data.obligations.find(o => o.id === obId); if(!ob) return;
    if($("payObligationId")) $("payObligationId").value = ob.id; 
    if($("payConcept")) { $("payConcept").value = ob.concept; $("payConcept").disabled = true; }
    if($("monthlyType")) { $("monthlyType").value = ob.monthlyType || "normal"; $("monthlyType").disabled = true; }
    if($("payAmount")) { $("payAmount").value = ob.total.toFixed(2); $("payAmount").readOnly = true; }
    if($("payAbono")) $("payAbono").value = ob.balance.toFixed(2); 
    if($("formModeLabel")) $("formModeLabel").textContent = "Abonar a deuda existente";
    updateBalance(); 
    if($("paymentForm")) window.scrollTo({top: $("paymentForm").offsetTop, behavior: "smooth"});
};

function tariffFor(concept,type){
 if(concept==="Mensualidad") return type==="late"?data.tariffs.late:data.tariffs.normal;
 if(concept==="Mensualidad + Matrícula") return data.tariffs.normal+data.tariffs.matricula;
 if(concept==="Implementos deportivos") return data.tariffs.implements;
 if(concept==="Uniformes") return data.tariffs.uniform;
 return data.tariffs.other;
}

function updateSuggestedAmount(){
 if($("payObligationId")?.value !== "") return; 
 const concept=$("payConcept")?.value;
 $("monthlyTypeWrap")?.classList.toggle("hidden", concept!=="Mensualidad");
 if($("payAmount")) $("payAmount").value=Number(tariffFor(concept,$("monthlyType")?.value)).toFixed(2);
 updateBalance();
}

$("payConcept")?.addEventListener("change",updateSuggestedAmount);
$("monthlyType")?.addEventListener("change",updateSuggestedAmount);
$("payAbono")?.addEventListener("input",updateBalance);
$("payAmount")?.addEventListener("input",updateBalance);

function updateBalance(){
    const total = Number($("payAmount")?.value) || 0;
    const abono = Number($("payAbono")?.value) || 0;
    if($("payBalance")) $("payBalance").textContent = money(Math.max(0, total - abono));
}

$("paymentForm")?.addEventListener("reset",()=>setTimeout(()=>{ 
    if($("recordDate")) $("recordDate").value = today();
    if($("payAbono")) $("payAbono").value = "";
    resetPaymentFormToNew();
},0));

$("paymentForm")?.addEventListener("submit",e=>{
 e.preventDefault(); 
 const studentId = $("payStudentId")?.value;
 if(!studentId){notice("Selecciona un alumno.",true);return;}
 const total=Number($("payAmount")?.value), abono=Number($("payAbono")?.value);
 if(!Number.isFinite(total)||total<0||!Number.isFinite(abono)||abono<0){notice("Valores inválidos.",true);return;}
 
 const s=data.students.find(x=>x.id===studentId); 
 const isExisting = $("payObligationId")?.value !== "";
 let obId = $("payObligationId")?.value;
 
 if(!isExisting) {
     if(abono>total) {notice("El abono no puede superar el total.",true);return;}
     obId = `OB-${String(data.nextObligation++).padStart(5,"0")}`;
     data.obligations.push({ id: obId, studentId: s.id, concept: $("payConcept")?.value, monthlyType: $("monthlyType")?.value, total: total, balance: Math.max(0,total-abono), created: $("recordDate")?.value });
 } else {
     const ob = data.obligations.find(o => o.id === obId);
     if(abono > ob.balance) {notice("Abono supera el saldo pendiente.",true);return;}
     ob.balance = Math.max(0, ob.balance - abono);
 }
 
 const p={ receipt:`LP-${String(data.nextReceipt++).padStart(6,"0")}`, obligationId: obId, studentId: s.id, studentName:`${s.names} ${s.last}`, cedula: s.cedula, concept: $("payConcept")?.value, recordDate:$("recordDate")?.value, amount: abono, notes:$("payNotes")?.value.trim() };
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
function renderReceipt(p){
    const box = $("receiptResult");
    if(!box) return;
    box.classList.remove("hidden");
    
    box.innerHTML=`
    <div class="section-head">
        <div><h3>Recibo emitido</h3><p class="muted">Documento ${esc(p.receipt)}</p></div>
        <span class="badge ${p.balance>0?"partial":""}">${p.balance===0?"Pagado":"Abono registrado"}</span>
    </div>
    
    <div class="receipt-paper" id="receiptPaper" style="padding:0; overflow:hidden; border-top:none;">
        <div style="background-color: #211e1e; color: #fff; padding: 20px; display: flex; align-items: center; gap: 15px;">
            <img src="img/Pum.png" alt="Logo" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; background: #fff; padding: 2px;">
            <div>
                <h2 style="margin: 0 0 5px 0; font-size: 16.5px; line-height: 1.1; font-family: Arial, sans-serif;">Club Deportivo Formativo Especializado<br>Los Pumas</h2>
                <p style="margin: 0; font-size: 10px; color: #d4d4d4; line-height: 1.4;">SANTA ISABEL, CALLE<br>QUEVEDO Y PICHINCHA<br>CEL: 0984302599</p>
            </div>
        </div>
        
        <div style="padding: 25px;">
            <h1 style="margin: 0 0 25px 0; font-size: 26px; font-weight: 900; letter-spacing: 0.5px; color: #000;">RECIBO</h1>
            
            <div style="display: grid; grid-template-columns: 85px 1fr; gap: 12px; font-size: 14px; margin-bottom: 25px; color: #000;">
                <b style="text-align: right;">Recibo N° :</b> <span style="border-bottom: 1px solid #777; padding-bottom: 2px;">${esc(p.receipt)}</span>
                <b style="text-align: right;">Recibo a: :</b> <span style="border-bottom: 1px solid #777; padding-bottom: 2px;">${esc(p.studentName)}</span>
                <b style="text-align: right;">Fecha :</b> <span style="border-bottom: 1px solid #777; padding-bottom: 2px;">${esc(p.recordDate)}</span>
            </div>
            
            <div style="margin-bottom: 40px;">
                <div style="background-color: #26292b; color: #fff; display: inline-block; padding: 6px 14px; font-weight: bold; font-size: 13px;">Descripción:</div>
                <div style="padding: 10px 0; border-bottom: 1px solid #777; font-size: 14px; min-height: 30px; color: #000;">
                    ${esc(p.concept)} - Deuda total: ${money(p.total)}
                    ${p.notes ? `<br><span style="font-size: 12px; color: #555;">(Nota: ${esc(p.notes)})</span>` : ""}
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px;">
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="background-color: #b5b5b5; padding: 6px 10px; font-weight: bold; color: #000;">SALDO:</div>
                        <div style="border-bottom: 1px solid #777; width: 85px; text-align: center; color: var(--red); font-weight: bold;">${money(p.balance)}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; align-self: flex-end; margin-left: 30px;">
                        <div style="background-color: #b5b5b5; padding: 6px 10px; font-weight: bold; color: #000;">Pago Total:</div>
                        <div style="border-bottom: 1px solid #777; width: 85px; text-align: center; font-weight: bold; color: #000;">${money(p.amount)}</div>
                    </div>
                </div>
                
                <div style="text-align: center; width: 150px;">
                    <div style="font-family: 'Georgia', serif; font-style: italic; font-size: 24px; color: #333; margin-bottom: 5px;">J Gavilanez</div>
                    <div style="border-top: 1px solid #000; padding-top: 5px; font-size: 11px; font-weight: bold; line-height: 1.2; color: #000;">Lic. Galo Gavilanez<br>Director y Maestro</div>
                </div>
            </div>
        </div>
        
        <div style="background-color: #26292b; height: 35px; width: 100%;"></div>
    </div>
    
    <div class="receipt-actions" style="justify-content: center; margin-top: 20px;">
        <button class="primary" id="downloadReceipt">Descargar PDF</button>
        <button class="secondary" id="shareReceipt">Compartir WhatsApp</button>
    </div>`;
    
    $("downloadReceipt")?.addEventListener("click",()=>downloadPdf(p)); 
    $("shareReceipt")?.addEventListener("click",()=>shareReceipt(p));
    box.scrollIntoView({behavior:"smooth",block:"start"});
}

function downloadPdf(p){
    if(!window.jspdf){notice("Error: Requiere internet para el PDF.",true);return;}
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({ format: 'a5' }); 
    
    doc.setFillColor(33, 30, 30);
    doc.rect(0, 0, 148, 42, 'F');
    
    const logo = new Image();
    logo.src = 'img/Pum.png';
    
    logo.onload = function() {
        doc.addImage(logo, 'PNG', 12, 6, 28, 28);
        drawPdfContent(doc, p);
    };
    
    logo.onerror = function() {
        drawPdfContent(doc, p);
    };
    
    function drawPdfContent(doc, p) {
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
        doc.text("Recibo Nº :", 15, 75); doc.text(p.receipt, 42, 75);
        doc.text("Recibo a: :", 15, 83); doc.text(p.studentName, 42, 83);
        doc.text("Fecha :", 15, 91); doc.text(p.recordDate, 42, 91);
        
        doc.setDrawColor(120, 120, 120);
        doc.line(40, 76, 133, 76);
        doc.line(40, 84, 133, 84);
        doc.line(40, 92, 133, 92);
        
        doc.setFillColor(38, 41, 43);
        doc.rect(15, 105, 30, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Descripción:", 18, 110.5);
        
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "normal");
        const descText = `${p.concept} - Deuda Total: ${money(p.total)}`;
        doc.text(descText, 15, 122);
        if(p.notes) {
            doc.setFontSize(9); doc.setTextColor(80, 80, 80);
            doc.text("(Nota: " + p.notes + ")", 15, 128);
        }
        
        doc.setDrawColor(120, 120, 120);
        doc.line(15, 132, 133, 132);
        
        doc.setFillColor(181, 181, 181);
        doc.rect(15, 145, 22, 8, 'F');
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text("SALDO:", 17, 150.5);
        doc.setTextColor(199, 25, 45);
        doc.text(money(p.balance), 40, 150.5);
        doc.line(39, 152, 65, 152);
        
        doc.setTextColor(0, 0, 0);
        doc.rect(70, 155, 26, 8, 'F');
        doc.text("Pago Total:", 72, 160.5);
        doc.text(money(p.amount), 98, 160.5);
        doc.line(98, 162, 125, 162);
        
        doc.setFont("times", "italic");
        doc.setFontSize(22);
        doc.text("J Gavilanez", 105, 182, { align: "center" });
        
        doc.setDrawColor(0, 0, 0);
        doc.line(80, 185, 130, 185);
        
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Lic. Galo Gavilanez", 105, 190, { align: "center" });
        doc.text("Director y Maestro", 105, 195, { align: "center" });
        
        doc.setFillColor(38, 41, 43);
        doc.rect(0, 202, 148, 8, 'F');
        
        doc.save(`Recibo_${p.receipt}.pdf`);
    }
}

async function shareReceipt(p){
    const text = `*CLUB LOS PUMAS* 🐆\n_Comprobante de Movimiento_\n\n*Recibo:* ${p.receipt}\n*Alumno:* ${p.studentName}\n*Concepto:* ${p.concept}\n*Fecha:* ${p.recordDate}\n\n*Total a pagar:* ${money(p.total)}\n*Abono:* 💵 ${money(p.amount)}\n*Saldo:* 🔴 ${money(p.balance)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,"_blank","noopener");
}

// --- LÓGICA HISTORIAL ---
["historyMonth","historyConcept","historyStatus"].forEach(id=>{
    $(id)?.addEventListener("change",renderHistory);
});
if($("historyMonth")) $("historyMonth").value=today().slice(0,7);

function renderHistory(){
 if(!$("historyList"))return;
 const month=$("historyMonth")?.value, concept=$("historyConcept")?.value, status=$("historyStatus")?.value;
 let arr = data.abonos.map(ab => getJoinedReceipt(ab)).filter(p=>{
  if(month&&!(p.recordDate||"").startsWith(month))return false;
  if(concept && concept!=="all"&&p.concept!==concept)return false;
  if(status==="paid"&&p.balance>0)return false;
  if(status==="partial"&&!(p.amount>0&&p.balance>0))return false;
  if(status==="pending"&&p.balance<=0)return false;
  return true;
 }).sort((a,b)=>(b.recordDate||"").localeCompare(a.recordDate||""));
 
 if($("historyCount")) $("historyCount").textContent=arr.length;
 if($("historyRevenue")) $("historyRevenue").textContent=money(arr.reduce((s,p)=>s+p.amount,0));
 
 const uniqueObs = new Set(); let totalBalance = 0;
 arr.forEach(p => { if(!uniqueObs.has(p.obligationId)){ uniqueObs.add(p.obligationId); totalBalance += p.balance; } });
 if($("historyBalance")) $("historyBalance").textContent=money(totalBalance);
 
 if(!arr.length){$("historyList").innerHTML='<div class="empty-state">No hay movimientos.</div>';return;}
 
 $("historyList").innerHTML=`<table><thead><tr><th>Fecha</th><th>Recibo</th><th>Alumno</th><th>Concepto</th><th>Total a pagar</th><th>Abono</th><th>Saldo</th><th>Recibo</th></tr></thead><tbody>${arr.map(p=>`<tr><td>${esc(p.recordDate)}</td><td>${esc(p.receipt)}</td><td><b>${esc(p.studentName)}</b></td><td>${esc(p.concept)}</td><td>${money(p.total)}</td><td>${money(p.amount)}</td><td>${money(p.balance)}</td><td><button class="mini-btn red" data-receipt="${p.receipt}">Ver PDF</button></td></tr>`).join("")}</tbody></table>`;
 
 document.querySelectorAll("[data-receipt]").forEach(b=>b.addEventListener("click",()=>{const p=arr.find(x=>x.receipt===b.dataset.receipt);if(p)renderReceipt(p);showView("payment");}));
}

// --- CONFIGURACIÓN DE TARIFAS Y SEGURIDAD ---
function fillTariffs(){
    if($("tariffNormal")) $("tariffNormal").value=data.tariffs.normal;
    if($("tariffLate")) $("tariffLate").value=data.tariffs.late;
    if($("tariffMatricula")) $("tariffMatricula").value=data.tariffs.matricula;
    if($("tariffImplements")) $("tariffImplements").value=data.tariffs.implements;
    if($("tariffUniform")) $("tariffUniform").value=data.tariffs.uniform;
    if($("tariffOther")) $("tariffOther").value=data.tariffs.other;
}

$("tariffForm")?.addEventListener("submit",e=>{
    e.preventDefault();
    const vals={normal:$("tariffNormal")?.value,late:$("tariffLate")?.value,matricula:$("tariffMatricula")?.value,implements:$("tariffImplements")?.value,uniform:$("tariffUniform")?.value,other:$("tariffOther")?.value};
    for(const [k,v] of Object.entries(vals)){data.tariffs[k]=Number(v);}
    saveData();notice("Tarifas guardadas.");
});

$("resetTariffs")?.addEventListener("click",()=>{
    if(confirm("¿Restablecer?")){data.tariffs={...defaultTariffs};saveData();fillTariffs();notice("Valores por defecto aplicados.");}
});

$("authConfigForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const newUser = $("cfgUser")?.value.trim();
    const newPass = $("cfgPass")?.value.trim();
    
    if(newUser.length < 3 || newPass.length < 4) {
        notice("Usuario o contraseña demasiado cortos.", true);
        return;
    }
    
    data.auth = { user: newUser, pass: newPass };
    saveData();
    notice("Credenciales actualizadas correctamente.");
    $("authConfigForm").reset();
});

// --- EXPORTACIÓN E IMPORTACIÓN DE RESPALDOS ---
$("btnExportData")?.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchor = document.createElement("a");
    const dateStr = today();
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `Respaldo_ClubLosPumas_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    notice("Copia de seguridad descargada.");
});

$("btnImportData")?.addEventListener("change", e => {
    const file = e.target.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const importedData = JSON.parse(event.target.result);
            if(importedData.students && importedData.obligations && importedData.abonos) {
                if(confirm("¿Estás seguro de restaurar este respaldo? Se sobreescribirán los registros actuales.")) {
                    data = importedData;
                    saveData();
                    notice("Datos restaurados correctamente.");
                    setTimeout(() => location.reload(), 1000);
                }
            } else {
                notice("El archivo no tiene el formato válido del sistema.", true);
            }
        } catch(err) {
            notice("Error al leer el archivo de respaldo.", true);
        }
    };
    reader.readAsText(file);
});

function renderDashboard(){ 
    if($("statStudents")) $("statStudents").textContent=data.students.filter(s => s.status !== "Inactivo").length; 
    if($("statPayments")) $("statPayments").textContent=data.abonos.length; 
    if($("statRevenue")) $("statRevenue").textContent=money(data.abonos.reduce((s,a)=>s+a.amount,0)); 
}

function renderAll(){ 
    renderDashboard(); 
    renderStudents(); 
    renderHistory(); 
    if($("studentId"))$("studentId").value=`LP-${String(data.nextStudent||1).padStart(4,"0")}`; 
    if($("recordDate") && !$("recordDate").value) $("recordDate").value=today();
}

window.addEventListener("DOMContentLoaded", () => {
    if($("recordDate")) $("recordDate").value=today();
});