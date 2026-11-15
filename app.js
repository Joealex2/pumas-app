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
            <img src="./img/Pum.png" alt="Logo" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; background: #fff; padding: 2px;">
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
        <button class="secondary" id="downloadReceipt">📥 Descargar PDF</button>
        <button class="primary" id="shareReceiptPdf">📄 Compartir PDF WhatsApp</button>
        <button class="secondary btn-whatsapp-green" id="sendWhatsappText">💬 Enviar Mensaje WhatsApp</button>
    </div>`;

  $("downloadReceipt")?.addEventListener("click", () => generateAndActionPdf(p, 'download'));
  $("shareReceiptPdf")?.addEventListener("click", () => generateAndActionPdf(p, 'share'));
  $("sendWhatsappText")?.addEventListener("click", () => sendWhatsappMessage(p));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Función auxiliar unificada que carga la imagen de forma segura antes de crear el PDF
function generateAndActionPdf(p, actionType) {
  if (!window.jspdf) { notice("Requiere internet para el PDF.", true); return; }

  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = './img/Pum.png';

  // Si la imagen ya está en caché o carga correctamente
  img.onload = function () {
    const doc = buildPdfDocWithLogo(p, img);
    executePdfAction(doc, p, actionType);
  };

  // Si falla la carga de la imagen, genera el PDF de todas formas sin romper la app
  img.onerror = function () {
    const doc = buildPdfDocWithLogo(p, null);
    executePdfAction(doc, p, actionType);
  };
}

function buildPdfDocWithLogo(p, imgLogo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ format: 'a5' });

  doc.setFillColor(33, 30, 30);
  doc.rect(0, 0, 148, 42, 'F');

  // Si el logo cargó bien, lo pintamos en el PDF de manera síncrona
  if (imgLogo) {
    try {
      doc.addImage(imgLogo, 'PNG', 12, 6, 28, 28);
    } catch (e) {
      console.error("Error al incrustar imagen en PDF:", e);
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

async function executePdfAction(doc, p, actionType) {
  const textMsg = getReceiptMessage(p);

  if (actionType === 'download') {
    doc.save(`Recibo_${p.receipt}.pdf`);
    return;
  }

  if (actionType === 'share') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(textMsg.replace(/\\n/g, '\n'));
        notice("📋 Resumen copiado. Abriendo WhatsApp con el PDF...");
      } catch (e) {}
    }

    if (navigator.share) {
      try {
        const pdfBlob = doc.output('blob');
        const file = new File([pdfBlob], `Recibo_${p.receipt}.pdf`, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Recibo ${p.receipt} - Club Los Pumas`,
            text: textMsg
          });
          return;
        }
      } catch (err) {
        console.log("Web Share nativo falló o fue cancelado:", err);
      }
    }

    sendWhatsappMessage(p);
  }
}

function sendWhatsappMessage(p) {
  const textMsg = getReceiptMessage(p);
  const waUrl = `https://wa.me/?text=${encodeURIComponent(textMsg.replace(/\\n/g, '\n'))}`;
  window.open(waUrl, "_blank", "noopener");
}
