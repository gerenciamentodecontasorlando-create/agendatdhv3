/* =========================================================
   BTX FLOW • app.js (UNICO / ESTAVEL / ANTI-TRAVAMENTO)
   - Hoje (3 listas) + Compromissos
   - Quick (+Rapido)
   - Foco 25 (nao trava botoes principais)
   - PDFs (dia / dinheiro) usando BTXPDF do pdf.js
   - Backup export/import usando DB.exportAll / DB.importAll
   ========================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  day: DB.ymd(new Date()),
  view: "today",
  focus: false,
  edit: null // {type, id, preset}
};

/* ----------------- helpers ----------------- */
function safe(v){ return v == null ? "" : String(v); }
function clamp(t, n=120){ t=String(t||"").trim(); return t.length>n ? t.slice(0,n-1)+"…" : t; }
function fmtDatePretty(ymd){
  const p = String(ymd||"").split("-");
  if(p.length!==3) return ymd;
  return `${p[2]}/${p[1]}/${p[0]}`;
}
function addDays(ymdStr, delta){
  const d = new Date(ymdStr + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return DB.ymd(d);
}
function sameDay(a,b){ return String(a)===String(b); }

/* ----------------- modais ----------------- */
function openModal(id){ const m=$("#"+id); if(m) m.setAttribute("aria-hidden","false"); }
function closeModal(id){ const m=$("#"+id); if(m) m.setAttribute("aria-hidden","true"); }
function closeAllModals(){ $$(".modal").forEach(m=>m.setAttribute("aria-hidden","true")); }

function wireModalClosers(){
  $$(".modal [data-close]").forEach(btn=>{
    btn.addEventListener("click", ()=> closeModal(btn.getAttribute("data-close")));
  });
  $$(".modal").forEach(m=>{
    m.addEventListener("click",(e)=>{ if(e.target===m) m.setAttribute("aria-hidden","true"); });
  });
}

/* ----------------- view / tabs ----------------- */
function setView(v){
  state.view = v;
  $$(".tab").forEach(t=>t.classList.toggle("active", t.dataset.view===v));
  $$(".view").forEach(s=>s.classList.toggle("active", s.id===`view-${v}`));
}

/* ----------------- Dia valido ----------------- */
async function refreshDayValid(){
  const tasks = await DB.listTasksByDate(state.day);
  const ok = tasks.some(t=>t.bucket==="must" && t.done) && tasks.some(t=>t.bucket==="money" && t.done);
  const bar = $("#statusBar");
  if(bar) bar.style.display = ok ? "block" : "none";
}

/* ----------------- Hero (AGORA/PROXIMO) ----------------- */
function pickNowNext(tasks, appts){
  const openTasks = tasks.filter(t=>!t.done);
  const must = openTasks.find(t=>t.bucket==="must");
  const main = openTasks.find(t=>t.bucket==="money");
  const extra = openTasks.find(t=>t.bucket==="extra");

  const openAppts = appts
    .filter(a => (a.status||"pendente")!=="feito")
    .sort((a,b)=>safe(a.time).localeCompare(safe(b.time)));

  let now = null;
  if(must) now = {kind:"task", item: must, label:"⚠️ Não posso falhar"};
  else if(main) now = {kind:"task", item: main, label:"🎯 Função principal"};
  else if(openAppts[0]) now = {kind:"appt", item: openAppts[0], label:"🗓️ Compromisso"};
  else if(extra) now = {kind:"task", item: extra, label:"🟦 Se sobrar tempo"};

  let next = null;
  if(now?.kind==="task"){
    const left = openTasks.filter(t=>t.id!==now.item.id);
    if(left[0]) next = {kind:"task", item:left[0], label:"Próximo passo"};
  } else if(now?.kind==="appt"){
    if(openAppts[1]) next = {kind:"appt", item:openAppts[1], label:"Próximo compromisso"};
  }
  return {now, next};
}

function renderHeroBox(el, obj){
  if(!el) return;
  if(!obj){
    el.innerHTML = `<div class="muted">Sem sugestão agora. Coloque 1 item em “Não posso falhar” e 1 em “Função principal”.</div>`;
    return;
  }
  const meta = obj.kind==="task"
    ? (obj.item.bucket==="must" ? "⚠️" : obj.item.bucket==="money" ? "🎯" : "🟦")
    : (obj.item.time ? `⏱ ${obj.item.time}` : "🗓️");
  el.innerHTML = `
    <div class="itemTitle">${meta} ${clamp(obj.item.text, 120)}</div>
    <div class="itemMeta">${safe(obj.label)}</div>
  `;
}

/* ----------------- render Hoje ----------------- */
function renderDayHeader(){
  const lbl = $("#dayLabel");
  const dt = $("#dayDate");
  if(lbl) lbl.textContent = sameDay(state.day, DB.ymd(new Date())) ? "Hoje" : "Dia";
  if(dt) dt.textContent = fmtDatePretty(state.day);
}

async function renderBuckets(){
  const tasks = await DB.listTasksByDate(state.day);
  const buckets = ["must","money","extra"];

  for(const b of buckets){
    const container = $(`#list-${b}`);
    if(!container) continue;
    container.innerHTML = "";

    const items = tasks
      .filter(t=>t.bucket===b)
      .sort((a,b)=> (a.done===b.done ? 0 : a.done ? 1 : -1));

    if(!items.length){
      container.innerHTML = `<div class="muted smallText">Sem itens.</div>`;
      continue;
    }

    for(const t of items){
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="itemLeft">
          <div class="itemTitle">${clamp(t.text, 90)}</div>
          <div class="itemMeta">${t.personId ? "👤 vinculado" : ""}</div>
        </div>
        <div class="pills">
          <span class="pill ${t.done ? "done" : ""}">${t.done ? "feito" : "pendente"}</span>
          <button class="btn small ghost" data-edit-task="${t.id}">Editar</button>
          <button class="btn small" data-toggle-task="${t.id}">${t.done ? "Desfazer" : "Feito"}</button>
        </div>
      `;
      container.appendChild(row);
    }
  }

  $$("[data-toggle-task]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-toggle-task");
      const all = await DB.listTasksByDate(state.day);
      const t = all.find(x=>x.id===id);
      if(!t) return;
      t.done = !t.done;
      await DB.upsertTask(t);
      await renderToday();
    };
  });

  $$("[data-edit-task]").forEach(btn=>{
    btn.onclick = ()=> openEditModal({type:"task", id: btn.getAttribute("data-edit-task")});
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

  for(const a of appts){
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemLeft">
        <div class="itemTitle">${a.time ? `⏱ ${a.time} ` : ""}${clamp(a.text, 90)}</div>
        <div class="itemMeta">${a.status || "pendente"}${a.personId ? " • 👤 vinculado" : ""}</div>
      </div>
      <div class="pills">
        <span class="pill">${a.status || "pendente"}</span>
        <button class="btn small ghost" data-edit-appt="${a.id}">Editar</button>
        <button class="btn small" data-toggle-appt="${a.id}">${a.status==="feito" ? "Reabrir" : "Feito"}</button>
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
    btn.onclick = ()=> openEditModal({type:"appt", id: btn.getAttribute("data-edit-appt")});
  });
}

async function renderHero(){
  const tasks = await DB.listTasksByDate(state.day);
  const appts = await DB.listAppts(state.day);
  const { now, next } = pickNowNext(tasks, appts);
  renderHeroBox($("#nowBox"), now);
  renderHeroBox($("#nextBox"), next);
}

async function renderToday(){
  renderDayHeader();
  await renderHero();
  await renderBuckets();
  await renderAppts();
  await refreshDayValid();
}

/* ----------------- Pessoas (mantem simples: so cadastro e select) ----------------- */
async function fillPersonSelect(selectedId=null){
  const sel = $("#fPerson");
  if(!sel) return;
  const people = await DB.listPeople("");
  sel.innerHTML = `<option value="">(sem pessoa)</option>`;
  for(const p of people){
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || "(sem nome)";
    if(selectedId && selectedId===p.id) opt.selected = true;
    sel.appendChild(opt);
  }
}

/* ----------------- Dinheiro / Docs / People (render basico) ----------------- */
async function buildPeopleIndex(){
  const people = await DB.listPeople("");
  const map = {};
  for(const p of people) map[p.id]=p;
  return map;
}

function rangeToDates(){
  const mode = $("#cashRange")?.value || "today";
  const today = state.day;
  if(mode==="today") return {from: today, to: today};
  if(mode==="7") return {from: addDays(today,-6), to: today};
  if(mode==="30") return {from: addDays(today,-29), to: today};
  return {from: $("#cashFrom")?.value || today, to: $("#cashTo")?.value || today};
}

async function renderCash(){
  const mode = $("#cashRange")?.value || "today";
  const fromEl = $("#cashFrom"), toEl = $("#cashTo");
  if(fromEl && toEl){
    const show = mode==="custom";
    fromEl.style.display = show ? "" : "none";
    toEl.style.display = show ? "" : "none";
  }

  const {from,to} = rangeToDates();
  const peopleIndex = await buildPeopleIndex();
  const items = await DB.listCashByRange(from,to);

  let sumIn=0,sumOut=0;
  for(const c of items){ (c.type==="in") ? sumIn+=Number(c.value||0) : sumOut+=Number(c.value||0); }
  $("#kpiIn").textContent = BTXPDF.fmtBRL(sumIn);
  $("#kpiOut").textContent = BTXPDF.fmtBRL(sumOut);
  $("#kpiBalance").textContent = BTXPDF.fmtBRL(sumIn - sumOut);

  const list = $("#cashList");
  list.innerHTML = "";
  if(!items.length){
    list.innerHTML = `<div class="muted smallText">Nenhum lançamento no período.</div>`;
    return;
  }

  for(const c of items){
    const person = c.personId ? (peopleIndex[c.personId]?.name || "") : "";
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemLeft">
        <div class="itemTitle">${fmtDatePretty(c.date)} • ${(c.type==="in"?"+":"-")}${BTXPDF.fmtBRL(c.value)}</div>
        <div class="itemMeta">${[c.category, person].filter(Boolean).join(" • ")}</div>
        <div class="smallText">${clamp(c.text, 140)}</div>
      </div>
      <div class="pills">
        <button class="btn small ghost" data-edit-cash="${c.id}">Editar</button>
        <button class="btn small" data-del-cash="${c.id}">Excluir</button>
      </div>
    `;
    list.appendChild(row);
  }

  $$("[data-edit-cash]").forEach(btn=> btn.onclick=()=>openEditModal({type:"cash", id: btn.getAttribute("data-edit-cash")}));
  $$("[data-del-cash]").forEach(btn=> btn.onclick=async()=>{
    const id = btn.getAttribute("data-del-cash");
    if(confirm("Excluir lançamento?")){
      await DB.deleteCash(id);
      await renderCash();
    }
  });
}

async function renderDocs(){
  const q = ($("#docsSearch")?.value || "").trim();
  const docs = await DB.listDocs(q);
  const list = $("#docsList");
  list.innerHTML = "";

  if(!docs.length){
    list.innerHTML = `<div class="muted smallText">Nenhum arquivo salvo.</div>`;
    return;
  }

  for(const d of docs){
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemLeft">
        <div class="itemTitle">${clamp(d.name, 80)}</div>
        <div class="itemMeta">${fmtDatePretty(d.date)}</div>
        <div class="smallText">${safe(d.mime)}</div>
      </div>
      <div class="pills">
        <button class="btn small" data-dl-doc="${d.id}">Baixar</button>
        <button class="btn small ghost" data-del-doc="${d.id}">Excluir</button>
      </div>
    `;
    list.appendChild(row);
  }

  $$("[data-dl-doc]").forEach(btn=> btn.onclick=()=>downloadDoc(btn.getAttribute("data-dl-doc")));
  $$("[data-del-doc]").forEach(btn=> btn.onclick=async()=>{
    const id = btn.getAttribute("data-del-doc");
    if(confirm("Excluir este arquivo?")){
      await DB.deleteDoc(id);
      await renderDocs();
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

async function renderPeople(){
  const q = ($("#peopleSearch")?.value || "").trim();
  const people = await DB.listPeople(q);
  const list = $("#peopleList");
  list.innerHTML = "";
  if(!people.length){
    list.innerHTML = `<div class="muted smallText">Nenhuma pessoa encontrada.</div>`;
    return;
  }
  for(const p of people){
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemLeft">
        <div class="itemTitle">${clamp(p.name, 60) || "(sem nome)"}</div>
        <div class="itemMeta">${p.phone ? "📞 "+p.phone : ""}</div>
      </div>
      <div class="pills">
        <button class="btn small ghost" data-edit-person="${p.id}">Editar</button>
      </div>
    `;
    list.appendChild(row);
  }
  $$("[data-edit-person]").forEach(btn=> btn.onclick=()=>openEditModal({type:"person", id: btn.getAttribute("data-edit-person")}));
}

/* ----------------- Editor modal ----------------- */
function showEditFields({showTime=false, showMoney=false, showDoc=false}){
  const tw = $("#fTimeWrap"), mr=$("#moneyRow"), dw=$("#docWrap");
  if(tw) tw.style.display = showTime ? "" : "none";
  if(mr) mr.style.display = showMoney ? "" : "none";
  if(dw) dw.style.display = showDoc ? "" : "none";
}

function normalizePersonField(isPerson){
  const wrap = $("#fTimeWrap");
  const inp = $("#fTime");
  const label = wrap?.querySelector("span");
  if(!wrap || !inp) return;
  if(isPerson){
    wrap.style.display = "";
    inp.type = "text";
    inp.placeholder = "Contato (opcional)";
    if(label) label.textContent = "Contato";
  } else {
    inp.type = "time";
    inp.placeholder = "";
    if(label) label.textContent = "Hora";
  }
}

async function openEditModal(ctx){
  ctx = ctx || {};
  ctx.preset = ctx.preset || {};
  state.edit = ctx;

  $("#btnDelete").style.display = "none";
  $("#editTitle").textContent = "Adicionar";
  $("#editSubtitle").textContent = "preencha o mínimo";

  $("#fText").value = "";
  $("#fTime").value = "";
  $("#fValue").value = "";
  $("#fCashType").value = "in";
  $("#fCategory").value = "Outros";
  $("#fDate").value = state.day;
  $("#fFile").value = "";

  await fillPersonSelect(ctx.preset.personId || null);

  if(ctx.type==="task"){
    showEditFields({showTime:false, showMoney:false, showDoc:false});
    normalizePersonField(false);
    $("#editTitle").textContent = "Tarefa";
    $("#editSubtitle").textContent = "texto curto e direto";
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
      ctx.preset.bucket = t.bucket;
    } else {
      if(!ctx.preset.bucket) ctx.preset.bucket = "extra";
    }
  }

  if(ctx.type==="appt"){
    showEditFields({showTime:true, showMoney:false, showDoc:false});
    normalizePersonField(false);
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
    normalizePersonField(false);
    $("#editTitle").textContent = "Dinheiro";
    $("#editSubtitle").textContent = "entrada/saída + valor + descrição";

    if(ctx.preset.type) $("#fCashType").value = ctx.preset.type;

    if(ctx.id){
      const all = (await DB.exportAll()).cash || [];
      const c = all.find(x=>x.id===ctx.id);
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
        }
      };
    }
  }

  if(ctx.type==="doc"){
    showEditFields({showTime:false, showMoney:false, showDoc:true});
    normalizePersonField(false);
    $("#editTitle").textContent = "Arquivo";
    $("#editSubtitle").textContent = "anexar e salvar offline";
  }

  if(ctx.type==="person"){
    showEditFields({showTime:false, showMoney:false, showDoc:false});
    normalizePersonField(true);
    $("#editTitle").textContent = "Pessoa";
    $("#editSubtitle").textContent = "nome + contato opcional";

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
          await renderAll();
        }
      };
    }
  }

  openModal("modalEdit");
}

async function onEditSubmit(e){
  e.preventDefault();
  const ctx = state.edit;
  if(!ctx) return;

  const text = $("#fText").value.trim();
  const date = $("#fDate").value || state.day;
  const personId = $("#fPerson").value || null;

  if(ctx.type==="task"){
    if(!text) return alert("Digite um texto.");
    if(ctx.id){
      const tasks = await DB.listTasksByDate(state.day);
      const t = tasks.find(x=>x.id===ctx.id);
      if(!t) return;
      t.text = text; t.date = date; t.personId = personId;
      await DB.upsertTask(t);
    } else {
      await DB.upsertTask({ date, bucket: ctx.preset.bucket || "extra", text, done:false, personId });
    }
    closeModal("modalEdit");
    await renderAll();
    return;
  }

  if(ctx.type==="appt"){
    const time = $("#fTime").value.trim();
    if(!text) return alert("Digite um texto.");
    if(ctx.id){
      const appts = await DB.listAppts(state.day);
      const a = appts.find(x=>x.id===ctx.id);
      if(!a) return;
      a.text=text; a.time=time; a.date=date; a.personId=personId;
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
      c.value=value; c.type=type; c.category=category; c.text=text; c.date=date; c.personId=personId;
      await DB.upsertCash(c);
    } else {
      await DB.upsertCash({ date, type, value, category, text, personId });
    }
    closeModal("modalEdit");
    await renderAll();
    return;
  }

  if(ctx.type==="doc"){
    const file = $("#fFile").files?.[0];
    if(!file) return alert("Escolha um arquivo.");
    await DB.addDoc({
      date,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size || 0,
      personId: personId,
      relatedType: null,
      relatedId: null,
      blob: file
    });
    closeModal("modalEdit");
    await renderAll();
    return;
  }

  if(ctx.type==="person"){
    const phone = $("#fTime").value.trim();
    if(!text) return alert("Digite o nome.");
    await DB.upsertPerson({ id: ctx.id || null, name:text, phone });
    closeModal("modalEdit");
    await renderAll();
    return;
  }
}

/* ----------------- Quick + Backup + PDF ----------------- */
function bindQuickButtons(){
  $$("[data-quick]").forEach(btn=>{
    btn.onclick = ()=>{
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
  await DB.importAll(JSON.parse(txt));
}

async function pdfDay(){
  const tasks = await DB.listTasksByDate(state.day);
  const appts = await DB.listAppts(state.day);
  const peopleIndex = await buildPeopleIndex();
  const tasksByBucket = {
    must: tasks.filter(t=>t.bucket==="must"),
    money: tasks.filter(t=>t.bucket==="money"),
    extra: tasks.filter(t=>t.bucket==="extra")
  };
  await BTXPDF.pdfToday({date: state.day, tasksByBucket, appts, peopleIndex});
}
async function pdfMoney(){
  const {from,to} = rangeToDates();
  const peopleIndex = await buildPeopleIndex();
  const items = await DB.listCashByRange(from,to);
  let sumIn=0,sumOut=0;
  for(const c of items){ (c.type==="in") ? sumIn+=Number(c.value||0) : sumOut+=Number(c.value||0); }
  const totals = {in:sumIn, out:sumOut, balance: sumIn-sumOut};
  await BTXPDF.pdfCash({title:"Período", from, to, items, totals, peopleIndex});
}

/* ----------------- Render geral ----------------- */
async function renderAll(){
  if(state.view==="today") return renderToday();
  if(state.view==="people") return renderPeople();
  if(state.view==="cash") return renderCash();
  if(state.view==="docs") return renderDocs();
}

/* ----------------- init / eventos ----------------- */
function setupEvents(){
  // tabs
  $$(".tab").forEach(t=>{
    t.onclick = async ()=>{
      setView(t.dataset.view);
      await renderAll();
    };
  });

  // dias
  $("#prevDay").onclick = async ()=>{ state.day = addDays(state.day,-1); await renderAll(); };
  $("#nextDay").onclick = async ()=>{ state.day = addDays(state.day,+1); await renderAll(); };

  // add buckets
  $$("[data-add]").forEach(btn=>{
    btn.onclick = ()=> openEditModal({type:"task", preset:{bucket: btn.getAttribute("data-add")}});
  });

  // appt
  $("#btnAddAppt").onclick = ()=> openEditModal({type:"appt"});

  // quick
  $("#btnQuick").onclick = ()=> openModal("modalQuick");

  // PDFs
  $("#btnTodayPDF").onclick = pdfDay;
  $("#btnCashPDF").onclick = pdfMoney;
  $("#btnPDF").onclick = ()=>{
    if(state.view==="cash") return pdfMoney();
    return pdfDay();
  };

  // backup
  $("#btnBackup").onclick = ()=> openModal("modalBackup");
  $("#btnExport").onclick = exportBackup;
  $("#backupFile").onchange = async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    if(confirm("Importar backup vai substituir os dados atuais. Continuar?")){
      await importBackup(f);
      closeModal("modalBackup");
      await renderAll();
      alert("Backup importado!");
    }
    e.target.value = "";
  };

  // help
  $("#btnHelp").onclick = ()=> openModal("modalHelp");

  // busca
  $("#peopleSearch")?.addEventListener("input", renderPeople);
  $("#btnClearPeopleSearch")?.addEventListener("click", async()=>{ $("#peopleSearch").value=""; await renderPeople(); });

  $("#cashRange")?.addEventListener("change", renderCash);
  $("#cashFrom")?.addEventListener("change", renderCash);
  $("#cashTo")?.addEventListener("change", renderCash);
  $("#btnAddCash")?.addEventListener("click", ()=> openEditModal({type:"cash"}));

  $("#docsSearch")?.addEventListener("input", renderDocs);
  $("#btnClearDocsSearch")?.addEventListener("click", async()=>{ $("#docsSearch").value=""; await renderDocs(); });
  $("#btnAddDoc")?.addEventListener("click", ()=> openEditModal({type:"doc"}));

  // foco (NÃO trava os botões principais)
  $("#btnFocus").onclick = ()=>{
    state.focus = true;
    document.body.classList.add("focusMode");
    $("#btnFocus").style.display = "none";
    $("#btnUnfocus").style.display = "inline-flex";
  };
  $("#btnUnfocus").onclick = ()=>{
    state.focus = false;
    document.body.classList.remove("focusMode");
    $("#btnUnfocus").style.display = "none";
    $("#btnFocus").style.display = "inline-flex";
  };

  // editor submit
  $("#editForm").addEventListener("submit", onEditSubmit);

  // ESC
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeAllModals(); });

  wireModalClosers();
  bindQuickButtons();
}

async function seedIfEmpty(){
  const seeded = await DB.getMeta("seededAt");
  if(seeded) return;
  await DB.upsertTask({ date: state.day, bucket:"must",  text:"Resolver 1 pendência chata (5 min)", done:false, personId:null });
  await DB.upsertTask({ date: state.day, bucket:"money", text:"FUNÇÃO PRINCIPAL: avançar 1 etapa do objetivo (25 min)", done:false, personId:null });
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

  // registra SW (se existir)
  try{
    if("serviceWorker" in navigator){
      await navigator.serviceWorker.register("./sw.js");
    }
  }catch(err){
    console.warn("SW erro:", err);
  }
});
