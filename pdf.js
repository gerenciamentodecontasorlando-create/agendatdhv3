/* =========================================================
   BTX FLOW • PDF
   jsPDF – PDFs enquadrados, borda externa + cantos regulares
   ========================================================= */

function fmtBRL(n){
  const v = Number(n||0);
  return v.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

function pdfFrame(doc, x, y, w, h, r=6){
  // borda com “cantos regulares” (aproximação com linhas + arcos)
  // jsPDF tem roundedRect em versões; aqui usamos se existir.
  if (typeof doc.roundedRect === "function"){
    doc.roundedRect(x, y, w, h, r, r, "S");
    return;
  }
  doc.rect(x, y, w, h);
}

function pdfSection(doc, x, y, w, h, title){
  doc.setDrawColor(40);
  doc.setLineWidth(0.2);
  pdfFrame(doc, x, y, w, h, 5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title, x+6, y+9);

  doc.setDrawColor(90);
  doc.setLineWidth(0.2);
  doc.line(x+6, y+12, x+w-6, y+12);
}

function safeText(doc, text, x, y, maxW){
  const t = String(text||"").trim();
  const lines = doc.splitTextToSize(t, maxW);
  doc.text(lines, x, y);
  return lines.length;
}

/* =========================================================
   PDF: Agenda do dia
   ========================================================= */
async function pdfToday({date, tasksByBucket, appts, peopleIndex}){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"mm", format:"a4" });

  // Página A4: 210 x 297
  const margin = 10;
  const W = 210, H = 297;

  // Moldura externa
  doc.setDrawColor(20);
  doc.setLineWidth(0.35);
  pdfFrame(doc, margin, margin, W-2*margin, H-2*margin, 8);

  // Cabeçalho
  doc.setFont("helvetica","bold");
  doc.setFontSize(15);
  doc.text("BTX Flow — Agenda do Dia", margin+6, margin+12);

  doc.setFont("helvetica","normal");
  doc.setFontSize(10);
  doc.text(`Data: ${date}`, margin+6, margin+18);

  // Seções
  const top = margin+22;
  const colGap = 4;

  const boxW = (W - 2*margin - 2*colGap) / 3;
  const boxH = 70;

  const buckets = [
    { key:"must",  title:"NÃO POSSO FALHAR", color:[255,91,110] },
    { key:"money", title:"FUNÇÃO PRINCIPAL", color:[41,209,125] },
    { key:"extra", title:"SE SOBRAR TEMPO", color:[64,156,255] }
  ];

  buckets.forEach((b, i) => {
    const x = margin + i*(boxW+colGap);
    const y = top;

    doc.setDrawColor(b.color[0], b.color[1], b.color[2]);
    doc.setLineWidth(0.35);
    pdfFrame(doc, x, y, boxW, boxH, 6);

    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.text(b.title, x+4, y+8);

    doc.setFont("helvetica","normal");
    doc.setFontSize(9);

    const items = tasksByBucket[b.key] || [];
    let yy = y+14;

    if (!items.length){
      doc.setTextColor(130);
      doc.text("—", x+4, yy);
      doc.setTextColor(0);
      return;
    }

    for (const t of items.slice(0, 9)){
      const mark = t.done ? "✔" : "•";
      const line = `${mark} ${t.text}`;
      const linesUsed = safeText(doc, line, x+4, yy, boxW-8);
      yy += 5 * linesUsed;
      if (yy > y+boxH-6) break;
    }
  });

  // Compromissos
  const apptY = top + boxH + 8;
  const apptH = H - margin - apptY - 10;

  doc.setDrawColor(33,69,103);
  doc.setLineWidth(0.25);
  pdfSection(doc, margin, apptY, W-2*margin, apptH, "Compromissos do dia");

  doc.setFont("helvetica","normal");
  doc.setFontSize(10);

  let yCursor = apptY + 18;
  const x0 = margin + 6;

  if (!appts.length){
    doc.setTextColor(130);
    doc.text("Nenhum compromisso cadastrado.", x0, yCursor);
    doc.setTextColor(0);
  } else {
    for (const a of appts){
      const person = a.personId ? (peopleIndex[a.personId]?.name || "") : "";
      const left = a.time ? `${a.time}  ` : "";
      const title = a.text || "(sem título)";
      const status = a.status || "pendente";
      const meta = [person, status].filter(Boolean).join(" • ");

      doc.setFont("helvetica","bold");
      const used1 = safeText(doc, `${left}${title}`, x0, yCursor, W-2*margin-12);
      yCursor += 6 * used1;

      if (meta){
        doc.setFont("helvetica","normal");
        doc.setFontSize(9);
        doc.setTextColor(90);
        const used2 = safeText(doc, meta, x0, yCursor, W-2*margin-12);
        yCursor += 5 * used2;
        doc.setTextColor(0);
        doc.setFontSize(10);
      }

      // linha separadora
      doc.setDrawColor(60);
      doc.setLineWidth(0.15);
      doc.line(margin+6, yCursor, W-margin-6, yCursor);
      yCursor += 6;

      if (yCursor > apptY + apptH - 10) break;
    }
  }

  // Rodapé
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Gerado pelo BTX Flow (offline-first)", margin+6, H-margin-4);
  doc.setTextColor(0);

  doc.save(`BTX_Flow_Agenda_${date}.pdf`);
}

/* =========================================================
   PDF: Dinheiro (período)
   ========================================================= */
async function pdfCash({title, from, to, items, totals, peopleIndex}){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"mm", format:"a4" });

  const margin = 10;
  const W = 210, H = 297;

  doc.setDrawColor(20);
  doc.setLineWidth(0.35);
  pdfFrame(doc, margin, margin, W-2*margin, H-2*margin, 8);

  doc.setFont("helvetica","bold");
  doc.setFontSize(15);
  doc.text("BTX Flow — Dinheiro", margin+6, margin+12);

  doc.setFont("helvetica","normal");
  doc.setFontSize(10);
  doc.text(`${title}`, margin+6, margin+18);
  doc.text(`De: ${from}  Até: ${to}`, margin+6, margin+24);

  // Totais
  doc.setDrawColor(33,69,103);
  doc.setLineWidth(0.25);
  pdfSection(doc, margin, margin+28, W-2*margin, 26, "Resumo do período");

  doc.setFontSize(10);
  doc.setFont("helvetica","bold");
  doc.text(`Entradas: ${fmtBRL(totals.in)}`, margin+8, margin+45);
  doc.text(`Saídas: ${fmtBRL(totals.out)}`, margin+8, margin+52);

  doc.setTextColor(41,209,125);
  doc.text(`Saldo: ${fmtBRL(totals.balance)}`, margin+120, margin+49);
  doc.setTextColor(0);

  // Lista
  const listY = margin+58;
  const listH = H - margin - listY - 10;
  pdfSection(doc, margin, listY, W-2*margin, listH, "Lançamentos");

  let yCursor = listY + 18;
  doc.setFont("helvetica","normal");
  doc.setFontSize(10);

  if (!items.length){
    doc.setTextColor(130);
    doc.text("Nenhum lançamento no período.", margin+6, yCursor);
    doc.setTextColor(0);
  } else {
    for (const c of items.slice(0, 40)){
      const person = c.personId ? (peopleIndex[c.personId]?.name || "") : "";
      const sign = c.type === "in" ? "+" : "-";
      const val = fmtBRL(c.value);
      const head = `${c.date}  ${sign}${val}`;
      const meta = [c.category, person].filter(Boolean).join(" • ");
      const text = c.text || "";

      doc.setFont("helvetica","bold");
      const used1 = safeText(doc, head, margin+6, yCursor, W-2*margin-12);
      yCursor += 6 * used1;

      doc.setFont("helvetica","normal");
      doc.setFontSize(9);
      doc.setTextColor(90);
      if (meta){
        const used2 = safeText(doc, meta, margin+6, yCursor, W-2*margin-12);
        yCursor += 5 * used2;
      }
      if (text){
        const used3 = safeText(doc, text, margin+6, yCursor, W-2*margin-12);
        yCursor += 5 * used3;
      }
      doc.setTextColor(0);
      doc.setFontSize(10);

      doc.setDrawColor(60);
      doc.setLineWidth(0.15);
      doc.line(margin+6, yCursor, W-margin-6, yCursor);
      yCursor += 6;

      if (yCursor > listY + listH - 10) break;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Gerado pelo BTX Flow (offline-first)", margin+6, H-margin-4);
  doc.setTextColor(0);

  doc.save(`BTX_Flow_Dinheiro_${from}_a_${to}.pdf`);
}

/* =========================================================
   PDF: Pessoa (linha do tempo)
   ========================================================= */
async function pdfPerson({person, timeline, totals, peopleIndex}){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"mm", format:"a4" });

  const margin = 10;
  const W = 210, H = 297;

  doc.setDrawColor(20);
  doc.setLineWidth(0.35);
  pdfFrame(doc, margin, margin, W-2*margin, H-2*margin, 8);

  doc.setFont("helvetica","bold");
  doc.setFontSize(15);
  doc.text("BTX Flow — Pessoa", margin+6, margin+12);

  doc.setFont("helvetica","normal");
  doc.setFontSize(10);
  doc.text(`Nome: ${person.name || ""}`, margin+6, margin+18);
  if (person.phone) doc.text(`Contato: ${person.phone}`, margin+6, margin+24);

  // Totais
  pdfSection(doc, margin, margin+28, W-2*margin, 26, "Resumo");
  doc.setFont("helvetica","bold");
  doc.setFontSize(10);
  doc.text(`Entradas: ${fmtBRL(totals.in)}`, margin+8, margin+45);
  doc.text(`Saídas: ${fmtBRL(totals.out)}`, margin+8, margin+52);
  doc.setTextColor(41,209,125);
  doc.text(`Saldo: ${fmtBRL(totals.balance)}`, margin+120, margin+49);
  doc.setTextColor(0);

  // Timeline
  const listY = margin+58;
  const listH = H - margin - listY - 10;
  pdfSection(doc, margin, listY, W-2*margin, listH, "Linha do tempo");

  let yCursor = listY + 18;
  doc.setFont("helvetica","normal");
  doc.setFontSize(10);

  if (!timeline.length){
    doc.setTextColor(130);
    doc.text("Sem registros ainda.", margin+6, yCursor);
    doc.setTextColor(0);
  } else {
    for (const it of timeline.slice(0, 40)){
      doc.setFont("helvetica","bold");
      const head = `${it.date} • ${it.typeLabel}`;
      const u1 = safeText(doc, head, margin+6, yCursor, W-2*margin-12);
      yCursor += 6 * u1;

      doc.setFont("helvetica","normal");
      doc.setFontSize(9);
      doc.setTextColor(90);
      if (it.meta){
        const u2 = safeText(doc, it.meta, margin+6, yCursor, W-2*margin-12);
        yCursor += 5 * u2;
      }
      doc.setTextColor(0);
      doc.setFontSize(10);

      if (it.text){
        const u3 = safeText(doc, it.text, margin+6, yCursor, W-2*margin-12);
        yCursor += 5 * u3;
      }

      doc.setDrawColor(60);
      doc.setLineWidth(0.15);
      doc.line(margin+6, yCursor, W-margin-6, yCursor);
      yCursor += 6;

      if (yCursor > listY + listH - 10) break;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Gerado pelo BTX Flow (offline-first)", margin+6, H-margin-4);
  doc.setTextColor(0);

  doc.save(`BTX_Flow_Pessoa_${(person.name||"Pessoa").replace(/\\s+/g,"_")}.pdf`);
}

window.BTXPDF = { pdfToday, pdfCash, pdfPerson, fmtBRL };
