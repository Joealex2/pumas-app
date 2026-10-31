// Configuración de Firebase para Club Los Pumas[cite: 8]
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
    } else {
      await db.collection("pumas_db").doc("configuracion_general").set(data);
    }
  } catch (e) {
    console.error("Error al cargar de Firestore:", e);
    notice("Error de conexión con la nube.", true);
  }
  renderAll();
}

// Guardar datos automáticamente en Firestore
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

function notice(msg, error = false) {
  const n = $("notice");
  if (!n) return;
  n.textContent = msg;
  n.classList.remove("hidden", "error");
  if (error) n.classList.add("error");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => n.classList.add("hidden"), 4000);
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
