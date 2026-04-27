// src/main.js (TELJES, működőképes – minden funkcióval)
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://rgrvufqroyyibphhtmvf.supabase.co",
  "sb_publishable_XGMWGP-mqLKdal3ytwyfXw_JDYqdJKT"
);

const ADMIN_PASSWORD = "ebedadmin";
const STORAGE_NAME = "ebedszavazo_name";
const STORAGE_DEVICE = "ebedszavazo_device";

const DAY = new Date().toISOString().slice(0, 10);

const RESTAURANTS = [
  { name: "Korona", cls: "vote-korona", icon: "👑", border: "var(--korona)" },
  { name: "Turul", cls: "vote-turul", icon: "🦅", border: "var(--turul)" },
  { name: "Nagy Magyarország", cls: "vote-nmo", icon: "🏛️", border: "var(--nmo)" },
  { name: "Mokka", cls: "vote-mokka", icon: "☕", border: "var(--mokka)" },
  { name: "Hoztam kaját", cls: "vote-hazai", icon: "🍱", border: "var(--hazai)", fixed: true }
];

function getDeviceId() {
  let id = localStorage.getItem(STORAGE_DEVICE);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_DEVICE, id);
  }
  return id;
}

function qs(id) {
  return document.getElementById(id);
}

function cleanLines(text) {
  return (text || "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
}

async function safeUpsert(table, payload, onConflict) {
  const res = await supabase.from(table).upsert(payload, onConflict ? { onConflict } : undefined);
  if (res.error) throw res.error;
  return res.data;
}

async function safeInsert(table, payload) {
  const res = await supabase.from(table).insert(payload);
  if (res.error) throw res.error;
  return res.data;
}

async function safeUpdate(table, payload, whereKey, whereVal) {
  const res = await supabase.from(table).update(payload).eq(whereKey, whereVal);
  if (res.error) throw res.error;
  return res.data;
}

async function safeDelete(table, whereKey, whereVal) {
  const res = await supabase.from(table).delete().eq(whereKey, whereVal);
  if (res.error) throw res.error;
  return res.data;
}

async function safeSelect(queryBuilder) {
  const res = await queryBuilder;
  if (res.error) throw res.error;
  return res.data;
}

/* ---- NAPI ÁLLAPOT (DB) ----
   day_state(day date primary key, voting_closed boolean not null default false)
*/
async function getVotingClosed() {
  try {
    const row = await safeSelect(
      supabase.from("day_state").select("voting_closed").eq("day", DAY).maybeSingle()
    );
    if (!row) return false;
    return !!row.voting_closed;
  } catch {
    // ha nincs tábla, fallback: nyitott
    return false;
  }
}

async function setVotingClosed(val) {
  try {
    await safeUpsert("day_state", { day: DAY, voting_closed: !!val }, "day");
  } catch {
    // ha nincs tábla, ne dobja el a UI-t
  }
}

/* ---- NAPI VICCES (DB) ----
   daily_joke(day date primary key, text text not null)
*/
async function loadDailyJoke() {
  const dailyJoke = qs("dailyJoke");
  try {
    const row = await safeSelect(
      supabase.from("daily_joke").select("text").eq("day", DAY).maybeSingle()
    );
    dailyJoke.textContent = row?.text || "—";
  } catch {
    dailyJoke.textContent = "—";
  }
}

async function saveDailyJoke(text) {
  await safeUpsert("daily_joke", { day: DAY, text }, "day");
}

/* ---- MENÜK (DB) ----
   menus(day date, restaurant text, menu_text text, image_url text)
   UNIQUE(day,restaurant)
*/
async function loadMenus() {
  const rows = await safeSelect(
    supabase.from("menus").select("*").eq("day", DAY)
  );
  return rows || [];
}

async function upsertMenu(restaurant, menu_text) {
  await safeUpsert(
    "menus",
    { day: DAY, restaurant, menu_text },
    "day,restaurant"
  );
}

async function deleteMenu(restaurant) {
  // töröljük a napi-étterem sort (ha van)
  const rows = await safeSelect(
    supabase.from("menus").select("id").eq("day", DAY).eq("restaurant", restaurant)
  );
  if (rows?.length) {
    for (const r of rows) {
      await safeDelete("menus", "id", r.id);
    }
  }
}

/* ---- SZAVAZÁS (DB) ----
   votes(day date, device_id text, name text, restaurant text)
   UNIQUE(day,device_id)
*/
async function getMyVote(deviceId) {
  return await safeSelect(
    supabase.from("votes")
      .select("id,name,restaurant")
      .eq("day", DAY)
      .eq("device_id", deviceId)
      .maybeSingle()
  );
}

async function upsertVote(deviceId, name, restaurant) {
  // ha van, update; ha nincs, insert (végig error kezelve)
  const existing = await getMyVote(deviceId);
  if (existing?.id) {
    await safeUpdate("votes", { name, restaurant }, "id", existing.id);
  } else {
    await safeInsert("votes", { day: DAY, device_id: deviceId, name, restaurant });
  }
}

async function loadVotes() {
  const rows = await safeSelect(
    supabase.from("votes").select("id,name,restaurant,device_id").eq("day", DAY)
  );
  return rows || [];
}

/* ---- CHAT (DB) ----
   messages(day date, name text, message text, created_at timestamp default now())
*/
async function loadMessages() {
  const rows = await safeSelect(
    supabase.from("messages")
      .select("id,name,message,created_at")
      .eq("day", DAY)
      .order("created_at", { ascending: true })
  );
  return rows || [];
}

async function insertMessage(name, message) {
  await safeInsert("messages", { day: DAY, name, message });
}

/* ---- RENDER ---- */
function renderMenus(menus, myRestaurant, votingClosed) {
  const todayMenu = qs("todayMenu");
  todayMenu.innerHTML = "";

  for (const r of RESTAURANTS) {
    const m = r.fixed
      ? { restaurant: r.name, menu_text: "Otthonról hozott ebéd.", image_url: null }
      : (menus.find(x => x.restaurant === r.name) || { restaurant: r.name, menu_text: "" });

    const card = document.createElement("div");
    card.className = "menu-card" + (myRestaurant && myRestaurant !== r.name ? " voted" : "");
    card.style.borderLeftColor = r.border;

    const title = document.createElement("strong");
    title.textContent = `${r.icon} ${r.name}`;
    card.appendChild(title);

    const ul = document.createElement("ul");
    const lines = cleanLines(m.menu_text);
    if (lines.length) {
      for (const line of lines) {
        const li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      }
    } else {
      const li = document.createElement("li");
      li.textContent = "—";
      ul.appendChild(li);
    }
    card.appendChild(ul);

    if (m.image_url) {
      const img = document.createElement("img");
      img.src = m.image_url;
      img.alt = `${r.name} menü kép`;
      card.appendChild(img);
    }

    const btn = document.createElement("button");
    btn.className = r.cls;
    btn.textContent = myRestaurant === r.name ? "✔ Erre szavaztál" : "Szavazok";
    btn.disabled = votingClosed;
    if (votingClosed) btn.classList.add("vote-disabled");
    btn.onclick = () => window.__vote(r.name);

    card.appendChild(btn);
    todayMenu.appendChild(card);
  }

  const votedInfo = qs("votedInfo");
  votedInfo.textContent = myRestaurant ? `✅ A te szavazatod: ${myRestaurant}` : "";
}

function renderResults(votes) {
  const liveRanking = qs("liveRanking");
  const voteList = qs("voteList");
  liveRanking.innerHTML = "";
  voteList.innerHTML = "";

  const counts = {};
  for (const v of votes) {
    counts[v.restaurant] = (counts[v.restaurant] || 0) + 1;
    const row = document.createElement("div");
    row.className = "ranking-item";
    row.textContent = `${v.name} – ${v.restaurant}`;
    voteList.appendChild(row);
  }

  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  for (const [rest, n] of sorted) {
    const row = document.createElement("div");
    row.className = "ranking-item";
    row.textContent = `${rest}: ${n}`;
    liveRanking.appendChild(row);
  }
}

function renderChat(messages) {
  const box = qs("messages");
  box.innerHTML = "";
  for (const m of messages) {
    const row = document.createElement("div");
    row.className = "message";
    row.textContent = `${m.name}: ${m.message}`;
    box.appendChild(row);
  }
}

function renderAdminMenus(menus) {
  const adminMenus = qs("adminMenus");
  adminMenus.innerHTML = "";

  for (const r of RESTAURANTS.filter(x => !x.fixed)) {
    const existing = menus.find(x => x.restaurant === r.name);

    const row = document.createElement("div");
    row.className = "admin-row";

    const title = document.createElement("strong");
    title.textContent = `${r.icon} ${r.name}`;
    row.appendChild(title);

    const ta = document.createElement("textarea");
    ta.rows = 4;
    ta.value = existing?.menu_text || "";
    row.appendChild(ta);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = r.cls;
    saveBtn.textContent = "Mentés";
    saveBtn.onclick = async () => {
      try {
        await upsertMenu(r.name, ta.value);
        await refreshAll();
      } catch (e) {
        alert(e.message);
      }
    };

    const delBtn = document.createElement("button");
    delBtn.className = "vote-danger";
    delBtn.textContent = "Törlés";
    delBtn.onclick = async () => {
      try {
        await deleteMenu(r.name);
        ta.value = "";
        await refreshAll();
      } catch (e) {
        alert(e.message);
      }
    };

    actions.appendChild(saveBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);
    adminMenus.appendChild(row);
  }
}

function renderAdminVotes(votes) {
  const adminVotes = qs("adminVotes");
  adminVotes.innerHTML = "";
  for (const v of votes) {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.textContent = `${v.name} – ${v.restaurant}`;

    const del = document.createElement("button");
    del.className = "vote-danger";
    del.textContent = "Törlés";
    del.onclick = async () => {
      try {
        await safeDelete("votes", "id", v.id);
        await refreshAll();
      } catch (e) {
        alert(e.message);
      }
    };

    row.appendChild(del);
    adminVotes.appendChild(row);
  }
}

function renderAdminMessages(msgs) {
  const adminMessages = qs("adminMessages");
  adminMessages.innerHTML = "";
  for (const m of msgs) {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.textContent = `${m.name}: ${m.message}`;

    const del = document.createElement("button");
    del.className = "vote-danger";
    del.textContent = "Törlés";
    del.onclick = async () => {
      try {
        await safeDelete("messages", "id", m.id);
        await refreshAll();
      } catch (e) {
        alert(e.message);
      }
    };

    row.appendChild(del);
    adminMessages.appendChild(row);
  }
}

/* ---- APP ---- */
let __admin = false;

async function refreshAll() {
  const deviceId = getDeviceId();
  const votingClosed = await getVotingClosed();

  const menus = await loadMenus();
  const myVote = await getMyVote(deviceId);
  const votes = await loadVotes();
  const msgs = await loadMessages();

  renderMenus(menus, myVote?.restaurant || null, votingClosed);
  renderResults(votes);
  renderChat(msgs);

  if (__admin) {
    renderAdminMenus(menus);
    renderAdminVotes(votes);
    renderAdminMessages(msgs);
  }

  qs("voteStatus").textContent = votingClosed ? "Szavazás lezárva" : "Szavazás nyitva";
  qs("voteStatus").className = "badge " + (votingClosed ? "closed" : "open");

  await loadDailyJoke();
}

document.addEventListener("DOMContentLoaded", async () => {
  qs("todayDate").textContent = new Date().toLocaleDateString("hu-HU");

  qs("nameInput").value = localStorage.getItem(STORAGE_NAME) || "";
  qs("nameInput").addEventListener("input", () => {
    localStorage.setItem(STORAGE_NAME, qs("nameInput").value);
  });

  qs("tabVoteBtn").onclick = () => {
    qs("voteTab").classList.add("active");
    qs("adminTab").classList.remove("active");
    qs("tabVoteBtn").classList.add("active");
    qs("tabAdminBtn").classList.remove("active");
  };

  qs("tabAdminBtn").onclick = () => {
    qs("adminTab").classList.add("active");
    qs("voteTab").classList.remove("active");
    qs("tabAdminBtn").classList.add("active");
    qs("tabVoteBtn").classList.remove("active");
  };

  qs("adminLoginBtn").onclick = async () => {
    if (qs("adminPassword").value !== ADMIN_PASSWORD) {
      qs("adminStatus").textContent = "Hibás jelszó";
      return;
    }
    __admin = true;
    qs("adminStatus").textContent = "Admin mód aktív";
    qs("adminPanel").style.display = "block";
    await refreshAll();
  };

  qs("toggleVotingBtn").onclick = async () => {
    try {
      const closed = await getVotingClosed();
      await setVotingClosed(!closed);
      await refreshAll();
    } catch (e) {
      alert(e.message);
    }
  };

  qs("sendMessageBtn").onclick = async () => {
    const name = (qs("nameInput").value || "").trim();
    const msg = (qs("messageInput").value || "").trim();
    if (!name || !msg) return;
    try {
      await insertMessage(name, msg);
      qs("messageInput").value = "";
      await refreshAll();
    } catch (e) {
      alert(e.message);
    }
  };

  qs("saveJokeBtn").onclick = async () => {
    try {
      await saveDailyJoke(qs("adminJokeText").value || "");
      qs("adminJokeText").value = "";
      await loadDailyJoke();
    } catch (e) {
      alert(e.message);
    }
  };

  window.__vote = async (restaurant) => {
    const name = (qs("nameInput").value || "").trim();
    if (!name) {
      alert("Add meg a neved!");
      return;
    }
    const closed = await getVotingClosed();
    if (closed) return;

    try {
      await upsertVote(getDeviceId(), name, restaurant);
      localStorage.setItem(STORAGE_NAME, name);
      await refreshAll();
    } catch (e) {
      alert(e.message);
    }
  };

  await refreshAll();
});