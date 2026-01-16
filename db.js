const DB_NAME = "btx_agenda_tdah_v3";
const DB_VERSION = 1;

function uid(){
  return (crypto?.randomUUID?.() || ("id-"+Math.random().toString(16).slice(2)+"-"+Date.now()));
}
function nowISO(){ return new Date().toISOString(); }
function ymd(d){
  const x = (d instanceof Date) ? d : new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth()+1).padStart(2,'0');
  const dd = String(x.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

let _dbPromise = null;

function openDB(){
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      const meta = db.createObjectStore("meta", { keyPath: "key" });

      const tasks = db.createObjectStore("tasks", { keyPath: "id" });
      tasks.createIndex("by_date", "date", { unique:false });
      tasks.createIndex("by_bucket_date", ["bucket","date"], { unique:false });
      tasks.createIndex("by_person", "personId", { unique:false });

      const appts = db.createObjectStore("appts", { keyPath: "id" });
      appts.createIndex("by_date", "date", { unique:false });
      appts.createIndex("by_person", "personId", { unique:false });

      const people = db.createObjectStore("people", { keyPath: "id" });
      people.createIndex("by_name", "name", { unique:false });

      const cash = db.createObjectStore("cash", { keyPath: "id" });
      cash.createIndex("by_date", "date", { unique:false });
      cash.createIndex("by_person", "personId", { unique:false });

      const docs = db.createObjectStore("docs", { keyPath: "id" });
      docs.createIndex("by_date", "date", { unique:false });
      docs.createIndex("by_person", "personId", { unique:false });
      docs.createIndex("by_related", ["relatedType","relatedId"], { unique:false });

      meta.put({ key:"createdAt", value: nowISO() });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function tx(storeNames, mode, fn){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = {};
    storeNames.forEach(n => stores[n] = t.objectStore(n));
    let result;
    Promise.resolve().then(() => fn(stores)).then(r => { result = r; })
      .catch(err => reject(err));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

function reqToPromise(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function getAll(store){
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function getAllFromIndex(index, range){
  return new Promise((resolve, reject) => {
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function clearStore(store){
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function blobToBase64(blob){
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(dataUrl, mime){
  const parts = dataUrl.split(",");
  const b64 = parts[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr], {
    type: mime || (parts[0].match(/data:(.*?);base64/)||[])[1] || "application/octet-stream"
  });
}

const DB = {
  uid, nowISO, ymd,

  async getMeta(key){
    return tx(["meta"], "readonly", async ({meta}) => {
      const r = await reqToPromise(meta.get(key));
      return r?.value ?? null;
    });
  },
  async setMeta(key, value){
    return tx(["meta"], "readwrite", async ({meta}) => meta.put({key, value}));
  },

  async listPeople(query=""){
    query = (query||"").trim().toLowerCase();
    return tx(["people"], "readonly", async ({people}) => {
      const all = await getAll(people);
      const filtered = query ? all.filter(p => (p.name||"").toLowerCase().includes(query)) : all;
      filtered.sort((a,b) => (a.name||"").localeCompare(b.name||""));
      return filtered;
    });
  },
  async upsertPerson(p){
    const obj = {
      id: p.id || uid(),
      name: (p.name||"").trim(),
      phone: (p.phone||"").trim(),
      notes: (p.notes||"").trim(),
      createdAt: p.createdAt || nowISO(),
      updatedAt: nowISO(),
    };
    return tx(["people"], "readwrite", async ({people}) => {
      await reqToPromise(people.put(obj));
      return obj;
    });
  },
  async getPerson(id){
    return tx(["people"], "readonly", async ({people}) => reqToPromise(people.get(id)));
  },
  async deletePerson(id){
    return tx(["people","tasks","appts","cash","docs"], "readwrite", async ({people,tasks,appts,cash,docs}) => {
      await reqToPromise(people.delete(id));
      const [ts, ap, cs, ds] = await Promise.all([getAll(tasks), getAll(appts), getAll(cash), getAll(docs)]);
      for (const t of ts){ if(t.personId===id){ t.personId=null; t.updatedAt=nowISO(); await reqToPromise(tasks.put(t)); } }
      for (const a of ap){ if(a.personId===id){ a.personId=null; a.updatedAt=nowISO(); await reqToPromise(appts.put(a)); } }
      for (const c of cs){ if(c.personId===id){ c.personId=null; c.updatedAt=nowISO(); await reqToPromise(cash.put(c)); } }
      for (const d of ds){ if(d.personId===id){ d.personId=null; await reqToPromise(docs.put(d)); } }
    });
  },

  async listTasksByDate(date){
    return tx(["tasks"], "readonly", async ({tasks}) => {
      const idx = tasks.index("by_date");
      const items = await getAllFromIndex(idx, IDBKeyRange.only(date));
      items.sort((a,b) => (a.bucket||"").localeCompare(b.bucket||"") || (a.createdAt||"").localeCompare(b.createdAt||""));
      return items;
    });
  },
  async upsertTask(t){
    const obj = {
      id: t.id || uid(),
      date: t.date,
      bucket: t.bucket,
      text: (t.text||"").trim(),
      done: !!t.done,
      personId: t.personId || null,
      createdAt: t.createdAt || nowISO(),
      updatedAt: nowISO(),
    };
    return tx(["tasks"], "readwrite", async ({tasks}) => {
      await reqToPromise(tasks.put(obj));
      return obj;
    });
  },
  async deleteTask(id){
    return tx(["tasks"], "readwrite", async ({tasks}) => reqToPromise(tasks.delete(id)));
  },

  async listAppts(date){
    return tx(["appts"], "readonly",
