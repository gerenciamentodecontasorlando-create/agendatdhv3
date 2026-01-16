/* =========================================================
   BTX FLOW • APP
   UI + lógica TDAH (Dia Válido, Foco 25, Rollover)
   ========================================================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  day: DB.ymd(new Date()),
  activeView: "today",
  activePersonId: null,
  focusMode: false,
  editContext: null, // {type, id?, mode, preset?}
};

/* ------------------ utils ------------------ */
function fmtDatePretty(ymd){
  // 2026-01-16 -> 16/01/2026
  const [y,m,d] = String(ymd).split("-");
  return `${d}/${m}/${y}`;
}
function addDays(ymdStr, delta){
  const d = new Date(ymdStr + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return DB.ymd(d);
}
function sameDay(a,b){ return String(a)===String(b); }
function clampText(s, max=140){
  s = String(s||"").trim();
  return s.length > max ? (s.slice(0,max-1) + "…") : s;
}
function safe(v){ return (v==null) ? "" : String(v); }
function setSub(txt){ $("#appSub").textContent = txt; }

/* ------------------ modais ------------------ */
function openModal(id){
  const m = $("#"+id);
  if(!m) return;
  m.setAttribute("aria-hidden","false");
}
function closeModal(id){
  const m = $("#"+id);
  if(!m) return;
  m.setAttribute("aria-hidden","true");
}
function closeAllModals(){
  $$(".modal").forEach(m => m.setAttribute("aria-hidden","true"));
}
function wireModalClosers(){
  $$(".modal [data-close]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      closeModal(btn.getAttribute("data-close"));
    });
  });
  // clicar fora
  $$(".modal").forEach(m=>{
    m.addEventListener("click", (e)=>{
      if(e.target === m) m.setAttribute("aria-hidden","true");
    });
  });
}

/* ------------------ navegação ------------------ */
function setView(view){
  state.activeView = view;
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view===view));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
  if(view==="today") setSub("Agora & Próximo");
  if(view==="people") setSub("Memória longitudinal");
  if(view==="cash") setSub("Fluxo de dinheiro");
  if(view==="docs") setSub("Arquivos offline");
}

/* ------------------ Dia válido ------------------ */
async function computeDayValid(dateYMD){
  const tasks = await DB.listTasksByDate(dateYMD);
  const mustDone = tasks.some(t => t.bucket==="must" && t.done);
  const mainDone = tasks.some(t => t.bucket==="money" && t.done);
  return mustDone && mainDone;
}
async function refreshDayValidUI(){
  const ok = await computeDayValid(state.day);
  const bar = $("#statusBar");
  if(!bar) return;
  bar.style.display = ok ? "block" : "none";
}

/* ------------------ Rollover (fechamento automático) ------------------ */
async function rolloverDay(fromYMD, toYMD){
  // Move pendências do dia anterior para o dia novo
  const tasks = await DB.listTasksByDate(fromYMD);
  const pending = tasks.filter(t => !t.done);

  if(!pending.length) return;

  for (const t of pending){
    const keepMust = t.bucket === "must";
    const newBucket = keepMust ? "must" : "extra";

    // cria cópia no dia novo
    await DB.upsertTask({
      date: toYMD,
      bucket: newBucket,
      text: t.text,
      done: false,
      personId: t.personId || null
    });

    // marca a antiga como migrada (sem sensação de falha)
    await DB.upsertTask({
      ...t,
      done: true,
      text: `${t.text} (migrado)`
    });
  }
}

/* ------------------ render Hoje ------------------ */
function renderDayHeader(){
  const lbl = $("#dayLabel");
  const dt = $("#dayDate");
  if(lbl) lbl.textContent = sameDay(state.day, DB.ymd(new Date())) ? "Hoje" : "Dia";
  if(dt) dt.textContent = fmtDatePretty(state.day);
}

function pickNowAndNext(tasks, appts){
  // Estratégia:
  // 1) Se houver item MUST não feito, ele vira AGORA
  // 2) Senão, se houver FUNÇÃO PRINCIPAL não feita, vira AGORA
  // 3) Senão, se houver compromisso pendente mais cedo, vira AGORA
  // 4) Senão, AGORA = "dia válido / livre"
  const must = tasks.filter(t=>t.bucket==="must" && !t.done);
  const main = tasks.filter(t=>t.bucket==="money" && !t.done);
  const extra = tasks.filter(t=>t.bucket==="extra" && !t.done);

  const ap = appts.filter(a => (a.status||"pendente")!=="feito")
                  .sort((a,b)=>safe(a.time).localeCompare(safe(b.time)));

  const queue = [];
  if(must[0]) queue.push({kind:"task", item:must[0], label:"⚠️ Não posso falhar"});
  if(!queue.length && main[0]) queue.push({kind:"task", item:main[0], label:"🎯 Função principal"});
  if(!queue.length && ap[0]) queue.push({kind:"appt", item:ap[0], label:"🗓️ Compromisso"});
  if(!queue.length && extra[0]) queue.push({kind:"task", item:extra[0], label:"🟦 Se sobrar tempo"});

  // NEXT: pega o próximo candidato que não seja o NOW
  const now = queue[0] || null;
  const candidates = [
    ...must.slice( now?.item?.id ? 0 : 0),
    ...main,
    ...extra
  ];

  let next = null;
  if(now?.kind==="task"){
    const left = tasks.filter(t=>!t.done && t.id !== now.item.id);
    next = left[0] ? {kind:"task", item:left[0], label:"Próximo passo"} : null;
  } else if(now?.kind==="appt"){
    const nextAp = ap[1];
    next = nextAp ? {kind:"appt", item:nextAp, label:"Próximo compromisso"} : null;
  } else {
    next = null;
  }

  return { now, next };
}

function renderHeroBox(el, obj){
  if(!el) return;
  if(!obj){
    el.innerHTML = `<div class="muted">Sem sugestão agora. Coloque 1 item em “Não posso falhar” e 1 em “Função principal”.</div>`;
    return;
  }
  const t = obj.kind==="task" ? obj.item.text : obj.item.text;
  const meta = obj.kind==="task"
    ? (obj.item.bucket==="must" ? "⚠️" : obj.item.bucket==="money" ? "🎯" : "🟦")
    : (obj.item.time ? `⏱ ${obj.item.time}` : "🗓️");
  el.innerHTML = `
    <div class="itemTitle">${meta} ${clampText(t, 120)}</div>
    <div class="itemMeta">${safe(obj.label)}</div>
  `;
}

async function renderBuckets(){
  const tasks = await DB.listTasksByDate(state.day);
  const buckets = ["must","money","extra"];
  for (const b of buckets){
    const container = $(`#list-${b}`);
    if(!container) continue;
    container.innerHTML = "";

    const items = tasks.filter(t=>t.bucket===b)
      .sort((a,b)=> (a.done===b.done ? 0 : a.done ? 1 : -1));

    if(!items.length){
      container.innerHTML = `<div class="muted smallText">Sem itens.</div>`;
      continue;
    }

    for (const t of items){
      const pillClass = t.done ? "pill done" : "pill";
      const color = b==="must" ? "red" : b==="money" ? "green" : "blue";

      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="itemLeft">
          <div class="itemTitle">${clampText(t.text, 90)}</div>
          <div class="itemMeta">${t.personId ? "👤 vinculado" : ""}</div>
        </div>
        <div class="pills">
          <span class="${pillClass} ${color}">${t.done ? "feito" : "pendente"}</span>
          <button class="btn small ghost" data-edit-task="${t.id}">Editar</button>
          <button class="btn small" data-done-task="${t.id}">${t.done ? "Desfazer" : "Feito"}</button>
        </div>
      `;
      container.appendChild(row);
    }
  }

  // handlers
  $$("[data-done-task]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-done-task");
      const all = await DB.listTasksByDate(state.day);
      const t = all.find(x=>x.id===id);
      if(!t) return;
      t.done = !t.done;
      await DB.upsertTask(t);
      await renderToday();
    };
  });
  $$("[data-edit-task]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-edit-task");
      openEditModal({type:"task", id});
    };
  });
}

async function renderAppts(){
  const list = $("#apptList");
  if(!list) return;
  list.innerHTML = "";

  const appts = await DB.listAppts(state.day);
  if(!appts.length){
    list.innerHTML = `<div class="muted smallText">Sem compromissos.</div>`;
    return;
  }

  for (const a of appts){
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemLeft">
        <div class="itemTitle">${a.time ? `⏱ ${a.time} ` : ""}${clampText(a.text, 90)}</div>
        <div class="itemMeta">${a.status || "pendente"} ${a.personId ? "• 👤 vinculado" : ""}</div>
      </div>
      <div class="pills">
        <span class="pill">${a.status || "pendente"}</span>
        <button class="btn small ghost" data-edit-appt="${a.id}">Editar</button>
        <button class="btn small" data-toggle-appt="${a.id}">${(a.status==="feito") ? "Reabrir" : "Feito"}</button>
      </div>
    `;
    list.appendChild(row);
  }

  $$("[data-toggle-appt]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-toggle-appt");
      const appts = await DB.listAppts(state.day);
      const a = appts.find(x=>x.id===id);
      if(!a) return;
      a.status = (a.status==="feito") ? "pendente" : "feito";
      await DB.upsertAppt(a);
      await renderToday();
    };
  });
  $$("[data-edit-appt]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-edit-appt");
      openEditModal({type:"appt", id});
    };
  });
}

async function renderHero(){
  const tasks = await DB.listTasksByDate(state.day);
  const appts = await DB.listAppts(state.day);
  const { now, next } = pickNowAndNext(tasks, appts);
  renderHeroBox($("#nowBox"), now);
  renderHeroBox($("#nextBox"), next);
}

async function renderToday(){
  renderDayHeader();
  await renderHero();
  await renderBuckets();
  await renderAppts();
  await refreshDayValidUI();
}

/* ------------------ Pessoas ------------------ */
function personTotalsFromCash(items){
  let inV=0, outV=0;
  for (const c of items){
    if(c.type==="in") inV += Number(c.value||0);
    else outV += Number(c.value||0);
  }
  return { in: inV, out: outV, balance: inV - outV };
}

async function buildPersonTimeline(personId){
  // junta: tarefas (todas datas), compromissos, dinheiro, docs
  const payload = await DB.exportAll(); // simples e confiável (dados já estão na memória)
  const tasks = (payload.tasks||[]).filter(t=>t.personId===personId);
  const appts = (payload.appts||[]).filter(a=>a.personId===personId);
  const cash  = (payload.cash||[]).filter(c=>c.personId===personId);
  const docs  = (payload.docs||[]).filter(d=>d.personId===personId);

  const timeline = [];

  for (const t of tasks){
    timeline.push({
      date: t.date,
      type: "task",
      typeLabel: "Tarefa",
      meta: t.bucket==="must" ? "Não posso falhar" : t.bucket==="money" ? "Função principal" : "Se sobrar tempo",
      text: (t.done ? "✔ " : "• ") + t.text,
      raw: t
    });
  }
  for (const a of appts){
    timeline.push({
      date: a.date,
      type: "appt",
      typeLabel: "Compromisso",
      meta: [a.time, a.status].filter(Boolean).join(" • "),
      text: a.text,
      raw: a
    });
  }
  for (const c of cash){
    timeline.push({
      date: c.date,
      type: "cash",
      typeLabel: "Dinheiro",
      meta: `${c.type==="in" ? "Entrada" : "Saída"} • ${c.category}`,
      text: `${c.text} — ${BTXPDF.fmtBRL(c.value)}`,
      raw: c
    });
  }
  for (const d of docs){
    timeline.push({
      date: d.date,
      type: "doc",
      typeLabel: "Arquivo",
      meta: d.mime || "",
      text: d.name,
      raw: d
    });
  }

  timeline.sort((a,b)=> (b.date||"").localeCompare(a.date||"") || (b.type||"").localeCompare(a.type||""));
  return { timeline, cash };
}

async function renderPeople(){
  const q = ($("#peopleSearch")?.value || "").trim();
  const people = await DB.listPeople(q);
  const list = $("#peopleList");
  const panel = $("#personPanel");
  if(list) list.innerHTML = "";

  if(!people.length){
    if(list) list.innerHTML = `<div class="muted smallText">Nenhuma pessoa encontrada.</div>`;
  } else {
    for (const p of people){
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="itemLeft">
          <div class="itemTitle">${clampText(p.name, 60) || "(sem nome)"}</div>
          <div class="itemMeta">${p.phone ? "📞 "+p.phone : " "}</div>
        </div>
        <div class="pills">
          <button class="btn small" data-open-person="${p.id}">Abrir</button>
          <button class="btn small ghost" data-edit-person="${p.id}">Editar</button>
        </div>
      `;
      list.appendChild(row);
    }
  }

  $$("[data-open-person]").forEach(btn=>{
    btn.onclick = async ()=>{
      state.activePersonId = btn.getAttribute("data-open-person");
      await openPersonPanel(state.activePersonId);
    };
  });
  $$("[data-edit-person]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-edit-person");
      openEditModal({type:"person", id});
    };
  });

  if(!state.activePersonId){
    if(panel) panel.style.display = "none";
  }
}

async function openPersonPanel(personId){
  const panel = $("#personPanel");
  if(!panel) return;

  const person = await DB.getPerson(personId);
  if(!person){
    panel.style.display = "none";
    state.activePersonId = null;
    return;
  }

  $("#personName").textContent = person.name || "Pessoa";
  $("#personMeta").textContent = "Linha do tempo • histórico";
  panel.style.display = "block";

  const { timeline, cash } = await buildPersonTimeline(personId);
  const totals = personTotalsFromCash(cash);

  const tl = $("#personTimeline");
  tl.innerHTML = "";

  if(!timeline.length){
    tl.innerHTML = `<div class="muted smallText">Sem registros ainda. Use os botões acima para adicionar.</div>`;
  } else {
    for (const it of timeline.slice(0, 80)){
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="itemLeft">
          <div class="itemTitle">${fmtDatePretty(it.date)} • ${it.typeLabel}</div>
          <div class="itemMeta">${safe(it.meta)}</div>
          <div class="smallText">${clampText(it.text, 160)}</div>
        </div>
        <div class="pills">
          ${it.type==="doc" ? `<button class="btn small" data-dl-doc="${it.raw.id}">Baixar</button>` : ""}
          ${it.type==="doc" ? `<button class="btn small ghost" data-del-doc="${it.raw.id}">Excluir</button>` : ""}
        </div>
      `;
      tl.appendChild(row);
    }
  }

  // botões do painel
  $("#btnPersonAddNote").onclick = ()=> openEditModal({type:"note", preset:{ personId }});
  $("#btnPersonAddIn").onclick = ()=> openEditModal({type:"cash", preset:{ personId, type:"in" }});
  $("#btnPersonAddOut").onclick = ()=> openEditModal({type:"cash", preset:{ personId, type:"out" }});
  $("#btnPersonAttach").onclick = ()=> openEditModal({type:"doc", preset:{ personId }});
  $("#btnPersonPDF").onclick = async ()=>{
    const peopleIndex = await buildPeopleIndex();
    const { timeline, cash } = await buildPersonTimeline(personId);
    const totals = personTotalsFromCash(cash);
    await BTXPDF.pdfPerson({ person, timeline, totals, peopleIndex });
  };

  // docs actions
  $$("[data-dl-doc]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-dl-doc");
      await downloadDoc(id);
    };
  });
  $$("[data-del-doc]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del-doc");
      if(confirm("Excluir este arquivo?")){
        await DB.deleteDoc(id);
        await openPersonPanel(personId);
        await renderDocs();
      }
    };
  });
}

/* ------------------ Dinheiro ------------------ */
function rangeToDates(){
  const mode = $("#cashRange")?.value || "today";
  const today = state.day;
  if(mode==="today") return { from: today, to: today };
  if(mode==="7") return { from: addDays(today,-6), to: today };
  if(mode==="30") return { from: addDays(today,-29), to: today };
  const from = $("#cashFrom")?.value || today;
  const to = $("#cashTo")?.value || today;
  return { from, to };
}

async function buildPeopleIndex(){
  const people = await DB.listPeople("");
  const map = {};
  for (const p of people) map[p.id] = p;
  return map;
}

async function renderCash(){
  const mode = $("#cashRange")?.value || "today";
  const fromEl = $("#cashFrom");
  const toEl = $("#cashTo");
  if(fromEl && toEl){
    const show = mode==="custom";
    fromEl.style.display = show ? "" : "none";
    toEl.style.display = show ? "" : "none";
  }

  const { from, to } = rangeToDates();
  const peopleIndex = await buildPeopleIndex();
  const items = await DB.listCashByRange(from, to);

  let sumIn=0, sumOut=0;
  for (const c of items){
    if(c.type==="in") sumIn += Number(c.value||0);
    else sumOut += Number(c.value||0);
  }
  const balance = sumIn - sumOut;

  $("#kpiIn").textContent = BTXPDF.fmtBRL(sumIn);
  $("#kpiOut").textContent = BTXPDF.fmtBRL(sumOut);
  $("#kpiBalance").textContent = BTXPDF.fmtBRL(balance);

  const list = $("#cashList");
  list.innerHTML = "";

  if(!items.length){
    list.innerHTML = `<div class="muted smallText">Nenhum lançamento no período.</div>`;
    return;
  }

  for (const c of items){
    const person = c.personId ? (peopleIndex[c.personId]?.name || "") : "";
    const sign = c.type==="in" ? "+" : "-";
    const colorPill = c.type==="in" ? "green" : "red";

    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemLeft">
        <div class="itemTitle">${fmtDatePretty(c.date)} • ${sign}${BTXPDF.fmtBRL(c.value)}</div>
        <div class="itemMeta">${[c.category, person].filter(Boolean).join(" • ")}</div>
        <div class="smallText">${clampText(c.text, 140)}</div>
      </div>
      <div class="pills">
        <span class="pill ${colorPill}">${c.type==="in" ? "entrada" : "saída"}</span>
        <button class="btn small ghost" data-edit-cash="${c.id}">Editar</button>
        <button class="btn small" data-del-cash="${c.id}">Excluir</button>
      </div>
    `;
    list.appendChild(row);
  }

  $$("[data-edit-cash]").forEach(btn=>{
    btn.onclick = ()=> openEditModal({type:"cash", id: btn.getAttribute("data-edit-cash")});
  });
  $$("[data-del-cash]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del-cash");
      if(confirm("Excluir lançamento?")){
        await DB.deleteCash(id);
        await renderCash();
        if(state.activePersonId) await openPersonPanel(state.activePersonId);
      }
    };
  });
}

/* ------------------ Arquivos ------------------ */
async function renderDocs(){
  const q = ($("#docsSearch")?.value || "").trim();
  const docs = await DB.listDocs(q);
  const list = $("#docsList");
  list.innerHTML = "";

  if(!docs.length){
    list.innerHTML = `<div class="muted smallText">Nenhum arquivo salvo.</div>`;
    return;
  }

  const peopleIndex = await buildPeopleIndex();

  for (const d of docs.slice(0, 200)){
    const person = d.personId ? (peopleIndex[d.personId]?.name || "") : "";
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemLeft">
        <div class="itemTitle">${clampText(d.name, 70)}</div>
        <div class="itemMeta">${fmtDatePretty(d.date)} ${person ? "• 👤 "+person : ""}</div>
        <div class="smallText">${(d.mime||"")} ${d.size ? "• "+Math.round(d.size/1024)+" KB" : ""}</div>
      </div>
      <div class="pills">
        <button class="btn small" data-dl-doc="${d.id}">Baixar</button>
        <button class="btn small ghost" data-del-doc="${d.id}">Excluir</button>
      </div>
    `;
    list.appendChild(row);
  }

  $$("[data-dl-doc]").forEach(btn=> btn.onclick = async ()=> downloadDoc(btn.getAttribute("data-dl-doc")));
  $$("[data-del-doc]").forEach(btn=> btn.onclick = async ()=>{
    const id = btn.getAttribute("data-del-doc");
    if(confirm("Excluir este arquivo?")){
      await DB.deleteDoc(id);
      await renderDocs();
      if(state.activePersonId) await openPersonPanel(state.activePersonId);
    }
  });
}

async function downloadDoc(id){
  const d = await DB.getDoc(id);
  if(!d || !d.blob) return alert("Arquivo não encontrado.");
  const url = URL.createObjectURL(d.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = d.name || "arquivo";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------ Editor modal (add/edit) ------------------ */
async function fillPersonSelect(selectedId=null){
  const sel = $("#fPerson");
  if(!sel) return;
  const people = await DB.listPeople("");
  sel.innerHTML = `<option value="">(sem pessoa)</option>`;
  for (const p of people){
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || "(sem nome)";
    if(selectedId && selectedId===p.id) opt.selected = true;
    sel.appendChild(opt);
  }
}

function showEditFields({showTime=false, showMoney=false, showDoc=false}){
  $("#fTimeWrap").style.display = showTime ? "" : "none";
  $("#moneyRow").style.display = showMoney ? "" : "none";
  $("#docWrap").style.display = showDoc ? "" : "none";
}

async function openEditModal(ctx){
  // ctx: {type: task|appt|cash|doc|person|note, id?, preset?}
  state.editContext = ctx;

  $("#btnDelete").style.display = "none";
  $("#editTitle").textContent = "Adicionar";
  $("#editSubtitle").textContent = "preencha o mínimo";

  // defaults
  $("#fText").value = "";
  $("#fTime").value = "";
  $("#fValue").value = "";
  $("#fCashType").value = "in";
  $("#fCategory").value = "Serviço/Trabalho";
  $("#fDate").value = state.day;
  $("#fFile").value = "";

  // carregar pessoas no select
  const presetPersonId = ctx.preset?.personId || null;
  await fillPersonSelect(presetPersonId);

  // tipo
  if(ctx.type==="task"){
    showEditFields({showTime:false, showMoney:false, showDoc:false});
    $("#editTitle").textContent = "Tarefa";
    $("#editSubtitle").textContent = "texto objetivo: verbo + ação + fim";

    if(ctx.id){
      const tasks = await DB.listTasksByDate(state.day);
      const t = tasks.find(x=>x.id===ctx.id);
      if(!t) return;
      $("#fText").value = t.text || "";
      $("#fDate").value = t.date || state.day;
      await fillPersonSelect(t.personId || null);
      $("#btnDelete").style.display = "";
      $("#btnDelete").onclick = async ()=>{
        if(confirm("Excluir tarefa?")){
          await DB.deleteTask(t.id);
          closeModal("modalEdit");
          await renderAll();
        }
      };
    }
  }

  if(ctx.type==="appt"){
    showEditFields({showTime:true, showMoney:false, showDoc:false});
    $("#editTitle").textContent = "Compromisso";
    $("#editSubtitle").textContent = "coloque hora se ajudar";

    if(ctx.id){
      const appts = await DB.listAppts(state.day);
      const a = appts.find(x=>x.id===ctx.id);
      if(!a) return;
      $("#fText").value = a.text || "";
      $("#fTime").value = a.time || "";
      $("#fDate").value = a.date || state.day;
      await fillPersonSelect(a.personId || null);
      $("#btnDelete").style.display = "";
      $("#btnDelete").onclick = async ()=>{
        if(confirm("Excluir compromisso?")){
          await DB.deleteAppt(a.id);
          closeModal("modalEdit");
          await renderAll();
        }
      };
    }
  }

  if(ctx.type==="cash"){
    showEditFields({showTime:false, showMoney:true, showDoc:false});
    $("#editTitle").textContent = "Lançamento (Dinheiro)";
    $("#editSubtitle").textContent = "entrada/saída + valor + descrição";

    if(ctx.preset?.type) $("#fCashType").value = ctx.preset.type;
    if(ctx.id){
      const { from, to } = rangeToDates();
      const items = await DB.listCashByRange(from, to);
      const c = items.find(x=>x.id===ctx.id) || (await DB.exportAll()).cash.find(x=>x.id===ctx.id);
      if(!c) return;
      $("#fText").value = c.text || "";
      $("#fValue").value = String(c.value ?? "");
      $("#fCashType").value = c.type || "in";
      $("#fCategory").value = c.category || "Outros";
      $("#fDate").value = c.date || state.day;
      await fillPersonSelect(c.personId || null);

      $("#btnDelete").style.display = "";
      $("#btnDelete").onclick = async ()=>{
        if(confirm("Excluir lançamento?")){
          await DB.deleteCash(c.id);
          closeModal("modalEdit");
          await renderAll();
          if(state.activePersonId) await openPersonPanel(state.activePersonId);
        }
      };
    }
  }

  if(ctx.type==="doc"){
    showEditFields({showTime:false, showMoney:false, showDoc:true});
    $("#editTitle").textContent = "Arquivo";
    $("#editSubtitle").textContent = "anexar e salvar offline";
    // para doc sempre é “novo”
  }

  if(ctx.type==="person"){
    showEditFields({showTime:false, showMoney:false, showDoc:false});
    $("#editTitle").textContent = "Pessoa";
    $("#editSubtitle").textContent = "nome + opcional: contato";

    // hack: usa fText para "nome" e fTime para "contato" (escondido)
    $("#fTimeWrap").style.display = ""; // reusa como “Contato”
    $("#fTime").type = "text";
    $("#fTime").placeholder = "Contato (opcional)";
    $("#fTimeWrap span").textContent = "Contato";

    if(ctx.id){
      const p = await DB.getPerson(ctx.id);
      if(!p) return;
      $("#fText").value = p.name || "";
      $("#fTime").value = p.phone || "";
      $("#btnDelete").style.display = "";
      $("#btnDelete").onclick = async ()=>{
        if(confirm("Excluir pessoa? (os registros ficam sem vínculo)")){
          await DB.deletePerson(p.id);
          closeModal("modalEdit");
          state.activePersonId = null;
          await renderAll();
        }
      };
    }
  }

  if(ctx.type==="note"){
    showEditFields({showTime:false, showMoney:false, showDoc:false});
    $("#editTitle").textContent = "Nota (na linha do tempo)";
    $("#editSubtitle").textContent = "anotação rápida e útil";
    // vamos salvar como tarefa bucket extra, done true? (não) -> como tarefa extra (pendente)?? melhor como tarefa feita (nota)
    // aqui salvaremos como tarefa bucket extra com done=true e prefixo "Nota:"
  }

  openModal("modalEdit");
}

/* form submit */
async function onEditSubmit(e){
  e.preventDefault();
  const ctx = state.editContext;
  if(!ctx) return;

  const text = $("#fText").value.trim();
  const time = $("#fTime").value.trim();
  const date = $("#fDate").value || state.day;
  const personId = $("#fPerson").value || null;

  if(ctx.type==="task"){
    if(!text) return alert("Digite um texto.");
    // bucket vem do preset, ou inferimos pela chamada (guardada em ctx.preset.bucket)
    const bucket = ctx.preset?.bucket || (ctx.id ? null : null);

    if(ctx.id){
      const tasks = await DB.listTasksByDate(state.day);
      const t = tasks.find(x=>x.id===ctx.id);
      if(!t) return;
      t.text = text;
      t.date = date;
      t.personId = personId;
      await DB.upsertTask(t);
    } else {
      const b = ctx.preset?.bucket || "extra";
      await DB.upsertTask({ date, bucket: b, text, done:false, personId });
    }
    closeModal("modalEdit");
    await renderAll();
    return;
  }

  if(ctx.type==="appt"){
    if(!text) return alert("Digite um texto.");
    if(ctx.id){
      const appts = await DB.listAppts(state.day);
      const a = appts.find(x=>x.id===ctx.id);
      if(!a) return;
      a.text = text;
      a.time = time;
      a.date = date;
      a.personId = personId;
      await DB.upsertAppt(a);
    } else {
      await DB.upsertAppt({ date, time, text, status:"pendente", personId });
    }
    closeModal("modalEdit");
    await renderAll();
    return;
  }

  if(ctx.type==="cash"){
    const value = Number($("#fValue").value || 0);
    const type = $("#fCashType").value;
    const category = $("#fCategory").value || "Outros";
    if(!value || value<=0) return alert("Informe um valor.");
    if(!text) return alert("Informe uma descrição.");
    if(ctx.id){
      const all = (await DB.exportAll()).cash || [];
      const c = all.find(x=>x.id===ctx.id);
      if(!c) return;
      c.value = value;
      c.type = type;
      c.category = category;
      c.text = text;
      c.date = date;
      c.personId = personId;
      await DB.upsertCash(c);
    } else {
      await DB.upsertCash({ date, type, value, category, text, personId });
    }
    closeModal("modalEdit");
    await renderAll();
    if(state.activePersonId) await openPersonPanel(state.activePersonId);
    return;
  }

  if(ctx.type==="doc"){
    const file = $("#fFile").files?.[0];
    if(!file) return alert("Escolha um arquivo.");
    const blob = file;
    await DB.addDoc({
      date,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size || 0,
      personId: ctx.preset?.personId || personId || null,
      relatedType: null,
      relatedId: null,
      blob
    });
    closeModal("modalEdit");
    await renderAll();
    if(state.activePersonId) await openPersonPanel(state.activePersonId);
    return;
  }

  if(ctx.type==="person"){
    if(!text) return alert("Digite o nome.");
    const phone = time; // reuso
    const obj = { id: ctx.id || null, name:text, phone };
    const saved = await DB.upsertPerson(obj);
    closeModal("modalEdit");
    await renderAll();
    // abrir painel se foi criação com preset
    state.activePersonId = saved.id;
    await openPersonPanel(saved.id);
    return;
  }

  if(ctx.type==="note"){
    if(!text) return alert("Digite a nota.");
    await DB.upsertTask({
      date,
      bucket: "extra",
      text: "Nota: " + text,
      done: true,
      personId: ctx.preset?.personId || null
    });
    closeModal("modalEdit");
    await renderAll();
    if(state.activePersonId) await openPersonPanel(state.activePersonId);
    return;
  }
}

/* ------------------ ações rápidas ------------------ */
function openQuick(){
  openModal("modalQuick");
}
function bindQuickButtons(){
  $$("[data-quick]").forEach(btn=>{
    btn.onclick = async ()=>{
      const k = btn.getAttribute("data-quick");
      closeModal("modalQuick");

      if(k==="must") return openEditModal({type:"task", preset:{bucket:"must"}});
      if(k==="money") return openEditModal({type:"task", preset:{bucket:"money"}});
      if(k==="extra") return openEditModal({type:"task", preset:{bucket:"extra"}});
      if(k==="appt") return openEditModal({type:"appt"});
      if(k==="in") return openEditModal({type:"cash", preset:{type:"in"}});
      if(k==="out") return openEditModal({type:"cash", preset:{type:"out"}});
      if(k==="doc") return openEditModal({type:"doc"});
      if(k==="person") return openEditModal({type:"person"});
    };
  });
}

/* ------------------ backups ------------------ */
async function exportBackup(){
  const payload = await DB.exportAll();
  const blob = new Blob([JSON.stringify(payload)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BTX_Flow_Backup_${DB.ymd(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function importBackup(file){
  const txt = await file.text();
  const payload = JSON.parse(txt);
  await DB.importAll(payload);
}

/* ------------------ PDFs ------------------ */
async function pdfDay(){
  const tasks = await DB.listTasksByDate(state.day);
  const appts = await DB.listAppts(state.day);
  const peopleIndex = await buildPeopleIndex();
  const tasksByBucket = {
    must: tasks.filter(t=>t.bucket==="must"),
    money: tasks.filter(t=>t.bucket==="money"),
    extra: tasks.filter(t=>t.bucket==="extra"),
  };
  await BTXPDF.pdfToday({date: state.day, tasksByBucket, appts, peopleIndex});
}
async function pdfMoney(){
  const { from, to } = rangeToDates();
  const peopleIndex = await buildPeopleIndex();
  const items = await DB.listCashByRange(from, to);
  let sumIn=0,sumOut=0;
  for(const c of items){
    if(c.type==="in") sumIn += Number(c.value||0);
    else sumOut += Number(c.value||0);
  }
  const totals = { in: sumIn, out: sumOut, balance: sumIn - sumOut };
  const title = ($("#cashRange")?.value==="custom") ? "Período selecionado" : "Período";
  await BTXPDF.pdfCash({title, from, to, items, totals, peopleIndex});
}

/* ------------------ render geral ------------------ */
async function renderAll(){
  if(state.activeView==="today") await renderToday();
  if(state.activeView==="people") { await renderPeople(); if(state.activePersonId) await openPersonPanel(state.activePersonId); }
  if(state.activeView==="cash") await renderCash();
  if(state.activeView==="docs") await renderDocs();
}

/* ------------------ setup events ------------------ */
function setupEvents(){
  // tabs
  $$(".tab").forEach(t=>{
    t.onclick = async ()=>{
      setView(t.dataset.view);
      await renderAll();
    };
  });

  // dia - navegar
  $("#prevDay").onclick = async ()=>{
    const from = state.day;
    const to = addDays(state.day, -1);
    await rolloverDay(from, to);
    state.day = to;
    await renderAll();
  };
  $("#nextDay").onclick = async ()=>{
    const from = state.day;
    const to = addDays(state.day, +1);
    await rolloverDay(from, to);
    state.day = to;
    await renderAll();
  };

  // add dos buckets
  $$("[data-add]").forEach(btn=>{
    btn.onclick = ()=>{
      const b = btn.getAttribute("data-add"); // must|money|extra
      openEditModal({type:"task", preset:{bucket:b}});
    };
  });

  // compromisso
  $("#btnAddAppt").onclick = ()=> openEditModal({type:"appt"});

  // PDFs
  $("#btnTodayPDF").onclick = pdfDay;
  $("#btnCashPDF").onclick = pdfMoney;
  $("#btnPDF").onclick = ()=>{
    // no Hoje: PDF do dia; no Dinheiro: PDF do dinheiro; se não, abre menu simples
    if(state.activeView==="today") return pdfDay();
    if(state.activeView==="cash") return pdfMoney();
    return pdfDay();
  };

  // pessoas
  $("#btnAddPerson").onclick = ()=> openEditModal({type:"person"});
  $("#peopleSearch").addEventListener("input", renderPeople);
  $("#btnClearPeopleSearch").onclick = async ()=>{ $("#peopleSearch").value=""; await renderPeople(); };

  // dinheiro
  $("#cashRange").onchange = renderCash;
  $("#cashFrom").onchange = renderCash;
  $("#cashTo").onchange = renderCash;
  $("#btnAddCash").onclick = ()=> openEditModal({type:"cash"});

  // arquivos
  $("#btnAddDoc").onclick = ()=> openEditModal({type:"doc"});
  $("#docsSearch").addEventListener("input", renderDocs);
  $("#btnClearDocsSearch").onclick = async ()=>{ $("#docsSearch").value=""; await renderDocs(); };

  // quick
  $("#btnQuick").onclick = openQuick;

  // backup
  $("#btnBackup").onclick = ()=> openModal("modalBackup");
  $("#btnExport").onclick = exportBackup;
  $("#backupFile").onchange = async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    if(confirm("Importar backup vai substituir os dados atuais. Continuar?")){
      await importBackup(f);
      closeModal("modalBackup");
      state.activePersonId = null;
      await renderAll();
      alert("Backup importado!");
    }
    e.target.value = "";
  };

  // ajuda
  $("#btnHelp").onclick = ()=> openModal("modalHelp");

  // foco
  $("#btnFocus").onclick = ()=>{
    state.focusMode = true;
    document.body.classList.add("focusMode");
    $("#btnFocus").style.display = "none";
    $("#btnUnfocus").style.display = "inline-flex";
  };
  $("#btnUnfocus").onclick = ()=>{
    state.focusMode = false;
    document.body.classList.remove("focusMode");
    $("#btnUnfocus").style.display = "none";
    $("#btnFocus").style.display = "inline-flex";
  };

  // form editor
  $("#editForm").addEventListener("submit", onEditSubmit);

  // ESC fecha modal
  document.addEventListener("keydown", (e)=>{
    if(e.key==="Escape") closeAllModals();
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="k"){
      e.preventDefault();
      openQuick();
    }
  });

  wireModalClosers();
  bindQuickButtons();
}

/* ------------------ init ------------------ */
async function seedIfEmpty(){
  const createdAt = await DB.getMeta("seededAt");
  if(createdAt) return;

  // Seed universal, nada de profissão:
  await DB.upsertTask({ date: state.day, bucket:"must", text:"Resolver 1 pendência que dá dor de cabeça (5 min)", done:false, personId:null });
  await DB.upsertTask({ date: state.day, bucket:"money", text:"FUNÇÃO PRINCIPAL: avançar 1 etapa do objetivo do mês (25 min)", done:false, personId:null });
  await DB.upsertTask({ date: state.day, bucket:"extra", text:"Organizar 1 coisa pequena (2 min)", done:false, personId:null });
  await DB.upsertAppt({ date: state.day, time:"09:00", text:"Bloco de foco (exemplo) — 25 min", status:"pendente", personId:null });

  await DB.setMeta("seededAt", DB.nowISO());
}

document.addEventListener("DOMContentLoaded", async ()=>{
  await openDB();
  await seedIfEmpty();
  setupEvents();
  setView("today");
  await renderAll();
});/* =========================================================
   BTX FLOW • APP (PARTE 2)
   Ajustes finais / compat / pequenos helpers
   ========================================================= */

/* --------- Correção: o seed e o editor de Pessoa reutilizam fTime como texto --------- */
function normalizePersonEditField(){
  // sempre que fechar modal, volta o fTime para type=time e rótulo "Hora"
  const wrap = $("#fTimeWrap");
  if(!wrap) return;
  const inp = $("#fTime");
  const label = wrap.querySelector("span");
  const isPerson = state.editContext?.type === "person";

  if(isPerson){
    inp.type = "text";
    inp.placeholder = "Contato (opcional)";
    if(label) label.textContent = "Contato";
  } else {
    // volta pro padrão
    inp.type = "time";
    inp.placeholder = "";
    if(label) label.textContent = "Hora";
  }
}

// fecha modal -> normaliza
(function hookModalCloseNormalize(){
  const m = $("#modalEdit");
  if(!m) return;
  const obs = new MutationObserver(()=>{
    // se fechou
    if(m.getAttribute("aria-hidden") !== "false"){
      state.editContext = null;
      normalizePersonEditField();
    }
  });
  obs.observe(m, { attributes:true, attributeFilter:["aria-hidden"] });
})();

/* --------- Corrige: abrir Editor de tarefa sem bucket definido --------- */
const _openEditModal = openEditModal;
openEditModal = async function(ctx){
  // garantir preset
  ctx = ctx || {};
  ctx.preset = ctx.preset || {};

  // se for tarefa nova e não veio bucket, assume extra
  if(ctx.type === "task" && !ctx.id && !ctx.preset.bucket){
    ctx.preset.bucket = "extra";
  }

  await _openEditModal(ctx);
  normalizePersonEditField();
};

/* --------- Fix: pickNowAndNext mais estável --------- */
function pickNowAndNextStable(tasks, appts){
  const openTasks = tasks.filter(t=>!t.done);
  const must = openTasks.filter(t=>t.bucket==="must");
  const main = openTasks.filter(t=>t.bucket==="money");
  const extra = openTasks.filter(t=>t.bucket==="extra");

  const ap = appts
    .filter(a => (a.status||"pendente")!=="feito")
    .sort((a,b)=>safe(a.time).localeCompare(safe(b.time)));

  let now = null;

  if(must[0]) now = {kind:"task", item:must[0], label:"⚠️ Não posso falhar"};
  else if(main[0]) now = {kind:"task", item:main[0], label:"🎯 Função principal"};
  else if(ap[0]) now = {kind:"appt", item:ap[0], label:"🗓️ Compromisso"};
  else if(extra[0]) now = {kind:"task", item:extra[0], label:"🟦 Se sobrar tempo"};

  let next = null;
  if(now?.kind==="task"){
    const left = openTasks.filter(t=>t.id !== now.item.id);
    if(left[0]) next = {kind:"task", item:left[0], label:"Próximo passo"};
  } else if(now?.kind==="appt"){
    const nextAp = ap[1];
    if(nextAp) next = {kind:"appt", item:nextAp, label:"Próximo compromisso"};
  }

  return {now, next};
}

// substitui a função usada no renderHero
pickNowAndNext = pickNowAndNextStable;

/* --------- Fix: renderHeroBox sem HTML “solto” --------- */
const _renderHeroBox = renderHeroBox;
renderHeroBox = function(el, obj){
  if(!el) return;
  if(!obj){
    el.innerHTML = `<div class="muted">Sem sugestão agora. Coloque 1 item em “Não posso falhar” e 1 em “Função principal”.</div>`;
    return;
  }
  const text = clampText(obj.item?.text || "", 120);
  const meta = obj.kind==="task"
    ? (obj.item.bucket==="must" ? "⚠️" : obj.item.bucket==="money" ? "🎯" : "🟦")
    : (obj.item.time ? `⏱ ${obj.item.time}` : "🗓️");

  el.innerHTML = `
    <div class="itemTitle">${meta} ${text}</div>
    <div class="itemMeta">${safe(obj.label)}</div>
  `;
};

/* --------- Sugestão: Ctrl/⌘ + K abre Quick --------- */
(function showShortcutHint(){
  // só atualiza o subtítulo se quiser
  // setSub("Ctrl/⌘+K para +Rápido");
})();

/* --------- Registro do Service Worker --------- */
(async function registerSW(){
  try{
    if("serviceWorker" in navigator){
      await navigator.serviceWorker.register("./sw.js");
    }
  }catch(e){
    // sem drama: o app funciona mesmo sem SW
    console.warn("SW erro:", e);
  }
})();
