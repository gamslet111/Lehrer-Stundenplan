"use strict";
const WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WT_LANG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const FARBEN = ["#B02E26", "#3C44AA", "#5E7C16", "#D9700F", "#8932B8", "#158A8A", "#9C7A0A", "#C2477A", "#835432", "#4F7F1A", "#474F52", "#1E73BE"];
const STATUS_TEXT = {vertretung: "Vertretung", entfall: "Entfall", raum: "Raumänderung", aenderung: "Änderung"};

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

let D = null;          // Daten vom Server
let zeilen = [];       // Stunden-Zeilen (Zeitraster)
let S = {
  ansicht: store.get("ls-ansicht", "lehrer"),
  gewaehlt: store.get("ls-gewaehlt", []),
  klasse: store.get("ls-klasse", ""),
  raum: store.get("ls-raum", ""),
};
let montag = null;     // angezeigte Woche
let mTag = null;       // angezeigter Tag am Handy

// ---------- Hilfsfunktionen ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const zwei = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
const heute = () => iso(new Date());
const jetzt = () => { const d = new Date(); return `${zwei(d.getHours())}:${zwei(d.getMinutes())}`; };
const tag = s => new Date(s + "T12:00");
const plusTage = (s, n) => { const d = tag(s); d.setDate(d.getDate() + n); return iso(d); };
const montagVon = s => plusTage(s, -((tag(s).getDay() + 6) % 7));
const datumKurz = s => { const d = tag(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };
const datumText = s => `${WT[(tag(s).getDay() + 6) % 7]} ${datumKurz(s)}`;
const minuten = z => +z.slice(0, 2) * 60 + +z.slice(3);
const mobil = matchMedia("(max-width: 720px)");

const farbe = t => FARBEN[S.gewaehlt.indexOf(t) % FARBEN.length];
const person = x => x.statt ? `<s>${esc(x.statt)}</s> ${esc(x.k || "—")}` : esc(x.k);
const liste = xs => xs.map(person).join(", ");
const fach = s => esc(s.faecher.map(f => f.k).join(", ") || s.text || "?");
const findet = s => s.status !== "entfall";                         // Stunde findet wirklich statt
const unterrichtet = (s, t) => s.status !== "entfall" && s.lehrer.some(l => l.k === t);
const anzahlTage = () => D.stunden.some(s => tag(s.datum).getDay() === 6) ? 6 : 5;
const wochenTage = () => Array.from({length: anzahlTage()}, (_, i) => plusTage(montag, i));

// ---------- Daten laden ----------
async function laden() {
  try {
    const r = await fetch("api/daten", {cache: "no-store"});
    const j = await r.json();
    if (!r.ok) { $("stand").textContent = j.fehler; setTimeout(laden, 10000); return; }
    D = j;
    zeilen = zeilenBerechnen();
    vorbereiten();
    const stand = new Date(D.stand).toLocaleString("de-AT", {weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit"});
    $("stand").textContent = `Stand: ${stand}` + (D.scan_fehler ? " · ⚠ letzter Scan fehlgeschlagen" : "");
    $("stand").title = D.scan_fehler || "";
    alles();
  } catch (e) {
    $("stand").textContent = "Server nicht erreichbar";
    setTimeout(laden, 10000);
  }
}

function zeilenBerechnen() {
  const r = D.zeitraster.map(z => ({...z}));
  // Stunden außerhalb des Zeitrasters bekommen eine eigene Zeile (kurze zuerst, damit Doppelstunden nicht alles schlucken)
  const nachLaenge = [...D.stunden].sort((a, b) => (minuten(a.bis) - minuten(a.von)) - (minuten(b.bis) - minuten(b.von)));
  for (const s of nachLaenge)
    if (!r.some(x => s.von < x.bis && s.bis > x.von)) r.push({name: "", von: s.von, bis: s.bis});
  r.sort((a, b) => a.von.localeCompare(b.von) || a.bis.localeCompare(b.bis));
  // Zeilen ohne eine einzige Stunde am Anfang/Ende weglassen
  const belegt = r.map(x => D.stunden.some(s => s.von < x.bis && s.bis > x.von));
  const a = belegt.indexOf(true), b = belegt.lastIndexOf(true);
  return a < 0 ? r : r.slice(a, b + 1);
}

function vorbereiten() {
  const codes = D.lehrer.map(l => l.k);
  S.gewaehlt = S.gewaehlt.filter(t => codes.includes(t));
  klassenAuswahl();
  if (!D.raeume.includes(S.raum)) S.raum = D.raeume[0] || "";
  $("raum").innerHTML = D.raeume.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
  if (!montag) {
    const erster = montagVon(D.von), letzter = montagVon(D.bis);
    montag = montagVon(heute());
    if ([0, 6].includes(new Date().getDay()) && plusTage(montag, 7) <= letzter) montag = plusTage(montag, 7);  // Wochenende: nächste Woche
    if (montag < erster) montag = erster;
    if (montag > letzter) montag = letzter;
  }
}

function klassenAuswahl() {
  const kl = D.klassen;
  if (!kl.includes(S.klasse)) S.klasse = kl[0] || "";
  $("klasse").innerHTML = kl.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("klasse").value = S.klasse;
}

// ---------- Stundenraster (wie beim Kollegen: Zeilen = Stunden, überlappende Stunden nebeneinander) ----------
function rasterItems(stunden, schluessel) {
  const tg = wochenTage(), roh = [];
  for (const s of stunden) {
    const d = tg.indexOf(s.datum);
    if (d < 0) continue;
    const idx = zeilen.map((r, i) => s.von < r.bis && s.bis > r.von ? i : -1).filter(i => i >= 0);
    if (idx.length) roh.push({...s, d, p1: idx[0], p2: idx.at(-1)});
  }
  // Gleiche Stunden direkt hintereinander zu einem Block zusammenfassen (Doppelstunden)
  const gruppen = {}, aus = [];
  for (const x of roh) (gruppen[x.d + "|" + schluessel(x)] ??= []).push(x);
  for (const g of Object.values(gruppen)) {
    g.sort((a, b) => a.p1 - b.p1);
    let cur = null;
    for (const x of g) {
      if (cur && x.p1 <= cur.p2 + 1) { cur.p2 = Math.max(cur.p2, x.p2); if (x.bis > cur.bis) cur.bis = x.bis; }
      else { cur = {...x}; aus.push(cur); }
    }
  }
  return aus;
}

function rasterZeichnen(el, tabsEl, items, itemHtml) {
  const tg = wochenTage(), h = heute(), z = jetzt(), m = mobil.matches;
  const heuteIdx = tg.indexOf(h);
  if (mTag === null || mTag >= tg.length) mTag = heuteIdx >= 0 ? heuteIdx : 0;
  const tage = m ? [mTag] : tg.map((_, i) => i);
  const spalte = d => tage.indexOf(d) + 2;
  el.style.gridTemplateColumns = m ? "48px minmax(0,1fr)" : `58px repeat(${tg.length},minmax(130px,1fr))`;
  el.style.gridTemplateRows = `auto repeat(${zeilen.length},var(--zeile))`;
  el.classList.toggle("einzeln", m);
  tabsEl.hidden = !m;
  tabsEl.innerHTML = m ? tg.map((t, i) => {
    const n = items.filter(x => x.d === i).length;
    return `<button type="button" role="tab" data-tag="${i}" aria-selected="${i === mTag}" class="${t === h ? "heute" : ""}">${WT[i]}<small>${n || "–"}</small></button>`;
  }).join("") : "";

  let html = '<div class="gh" style="grid-row:1;grid-column:1"></div>';
  tage.forEach(i => html += `<div class="gh${tg[i] === h ? " heute" : ""}" style="grid-row:1;grid-column:${spalte(i)}">${m ? WT_LANG[i] : WT[i]} ${datumKurz(tg[i])}</div>`);
  zeilen.forEach((r, p) => {
    const jetztZeile = heuteIdx >= 0 && r.von <= z && z < r.bis;
    html += `<div class="pt${jetztZeile ? " jetzt" : ""}" style="grid-row:${p + 2};grid-column:1"><b>${esc(r.name)}</b><span>${r.von}</span><span>${r.bis}</span></div>`;
    for (const d of tage) html += `<div class="zelle${jetztZeile && tg[d] === h ? " jetzt" : ""}" style="grid-row:${p + 2};grid-column:${spalte(d)}"></div>`;
  });
  for (const d of tage) {
    const amTag = items.filter(x => x.d === d).sort((a, b) => a.p1 - b.p1 || (b.p2 - b.p1) - (a.p2 - a.p1));
    let cl = null;
    const gruppen = [];
    for (const x of amTag) {
      if (!cl || x.p1 > cl.ende) { cl = {start: x.p1, ende: x.p2, items: [], bahnen: []}; gruppen.push(cl); }
      cl.ende = Math.max(cl.ende, x.p2);
      let b = cl.bahnen.findIndex(e => e < x.p1);
      if (b < 0) { b = cl.bahnen.length; cl.bahnen.push(x.p2); } else cl.bahnen[b] = x.p2;
      cl.items.push({x, b});
    }
    for (const c of gruppen) {
      const n = c.bahnen.length, reihen = c.ende - c.start + 1;
      html += `<div class="cl${n >= 3 ? " schmal" : n === 2 ? " halb" : ""}" style="grid-row:${c.start + 2}/${c.ende + 3};grid-column:${spalte(d)};grid-template-columns:repeat(${n},minmax(0,1fr));grid-template-rows:repeat(${reihen},minmax(0,1fr))">`;
      for (const {x, b} of c.items)
        html += `<div class="slot" style="grid-row:${x.p1 - c.start + 1}/${x.p2 - c.start + 2};grid-column:${b + 1}">${itemHtml(x)}</div>`;
      html += "</div>";
    }
  }
  el.innerHTML = html;
}

function wocheZeichnen(el) {
  const erster = montagVon(D.von), letzter = montagVon(D.bis);
  el.innerHTML = `<button class="btn hell klein" data-woche="-1"${montag <= erster ? " disabled" : ""} aria-label="Woche zurück">◀</button>`
    + `<button class="btn hell klein" data-woche="0">Diese Woche</button>`
    + `<button class="btn hell klein" data-woche="1"${montag >= letzter ? " disabled" : ""} aria-label="Woche vor">▶</button>`
    + `<span>${datumText(montag)} – ${datumText(plusTage(montag, anzahlTage() - 1))}</span>`;
}

const zeitText = x => `${x.von}–${x.bis}`;
const marke = (status, text) => STATUS_TEXT[status] || text ? `<i class="marke ${status}">${esc(text || STATUS_TEXT[status])}</i>` : "";
const tipp = x => [x.klassen.join(", ") + ":", x.faecher.map(f => f.n || f.k).join(", "),
  x.lehrer.map(l => l.statt ? `${l.k || "—"} statt ${l.statt}` : l.k).join(", "),
  x.raeume.length ? "Raum " + x.raeume.map(r => r.k).join(", ") : "", zeitText(x), x.text].filter(Boolean).join(" ");

function lehrerItem(x) {
  const meine = x.lehrer.filter(l => S.gewaehlt.includes(l.k));
  const tags = meine.map(l => `<span class="tg" style="background:${farbe(l.k)}">${esc(l.k)}</span>`).join("");
  return `<div class="it ${x.status}" style="border-left-color:${farbe(meine[0]?.k)}" title="${esc(tipp(x))}">`
    + `<span class="k">${esc(x.klassen.join(", "))} ${tags}</span>`
    + `<span class="m">${fach(x)}${x.raeume.length ? " · " + liste(x.raeume) : ""}</span>`
    + (x.status !== "normal" ? marke(x.status) : "")
    + (x.p2 > x.p1 ? `<span class="tr">${zeitText(x)}</span>` : "") + "</div>";
}

function klassenItem(x) {
  return `<div class="it ${x.status}" title="${esc(tipp(x))}"><span class="k">${liste(x.lehrer) || "—"}</span>`
    + `<span class="m">${fach(x)}${x.raeume.length ? " · " + liste(x.raeume) : ""}</span>`
    + (x.status !== "normal" ? marke(x.status) : "")
    + (x.p2 > x.p1 ? `<span class="tr">${zeitText(x)}</span>` : "") + "</div>";
}

function raumItem(x) {
  return `<div class="it ${x.status}" title="${esc(tipp(x))}"><span class="k">${esc(x.klassen.join(", "))}</span>`
    + `<span class="m">${fach(x)} · ${liste(x.lehrer) || "—"}</span>`
    + (x.status !== "normal" ? marke(x.status) : "")
    + (x.p2 > x.p1 ? `<span class="tr">${zeitText(x)}</span>` : "") + "</div>";
}

// ---------- Ansicht: Nach Lehrern ----------
function wann(s) {
  const h = heute();
  const tagTxt = s.datum === h ? "heute" : s.datum === plusTage(h, 1) ? "morgen" : `${WT_LANG[(tag(s.datum).getDay() + 6) % 7]} ${datumKurz(s.datum)}`;
  const nr = zeilen.find(r => s.von < r.bis && s.bis > r.von)?.name;
  return `${tagTxt}, ${nr ? nr + ". Stunde " : ""}(${s.von}–${s.bis})`;
}

function lehrerZeile(t) {
  const h = heute(), z = jetzt();
  const meine = D.stunden.filter(s => unterrichtet(s, t) && (s.datum > h || (s.datum === h && s.bis > z)));
  const wo = s => `<strong>${esc(s.klassen.join(", "))}</strong> (${fach(s)}${s.raeume.length ? ", " + liste(s.raeume) : ""})`;
  const vertreten = D.stunden.some(s => s.datum === h && s.lehrer.some(l => l.statt === t))
    ? ' <i class="marke vertretung">wird heute vertreten</i>' : "";
  const akt = meine.find(s => s.datum === h && s.von <= z);
  if (akt) {
    // Ende des Blocks (gleiche Klasse und Fach direkt danach)
    let ende = akt;
    for (const s of meine)
      if (s.datum === h && s.klassen.join() === ende.klassen.join() && fach(s) === fach(ende) && minuten(s.von) >= minuten(ende.bis) && minuten(s.von) - minuten(ende.bis) <= 15) ende = s;
    return `gerade in ${wo(akt)} bis ${ende.bis}${vertreten}`;
  }
  if (meine[0]) return `als Nächstes ${wann(meine[0])} in ${wo(meine[0])}${vertreten}`;
  return `keine Stunden mehr gefunden${vertreten}`;
}

function zeigeLehrer() {
  $("chips").innerHTML = S.gewaehlt.map(t =>
    `<span class="chip" style="background:${farbe(t)}">${esc(t)}<button type="button" data-weg="${esc(t)}" aria-label="${esc(t)} entfernen">✕</button></span>`).join("");
  const q = $("q").value.trim().split(/[\s,;]+/).pop().toLowerCase();
  const gezeigt = D.lehrer.filter(l => !q || l.k.toLowerCase().startsWith(q) || (l.n || "").toLowerCase().includes(q));
  $("alleLehrer").innerHTML = gezeigt.length
    ? gezeigt.map(l => `<button type="button" data-t="${esc(l.k)}" aria-pressed="${S.gewaehlt.includes(l.k)}" title="${esc(l.n)}">${esc(l.k)}</button>`).join("")
    : `<span class="keiner">Kein Lehrer mit „${esc(q)}“ gefunden.</span>`;

  const hat = S.gewaehlt.length > 0;
  $("l-aus").hidden = !hat;
  $("l-leer").hidden = hat;
  if (!hat) return;
  $("l-status").innerHTML = S.gewaehlt.map(t => `<li><span class="sq" style="background:${farbe(t)}"></span><span><strong>${esc(t)}</strong>: ${lehrerZeile(t)}</span></li>`).join("");

  const tg = wochenTage();
  const woche = D.stunden.filter(s => tg.includes(s.datum));
  wocheZeichnen($("l-woche"));
  const relevant = woche.filter(s => S.gewaehlt.some(t => unterrichtet(s, t)));
  const schluessel = x => [x.klassen.join(), fach(x), x.raeume.map(r => r.k).join(), x.status,
    x.lehrer.map(l => l.k).filter(t => S.gewaehlt.includes(t)).sort().join()].join("|");
  rasterZeichnen($("l-grid"), $("l-tage"), rasterItems(relevant, schluessel), lehrerItem);
}

function lehrerHinzu(eingaben) {
  const unbekannt = [];
  for (const roh of eingaben) {
    const c = roh.trim();
    if (!c) continue;
    const gross = c.toUpperCase(), klein = c.toLowerCase();
    let treffer = D.lehrer.find(l => l.k.toUpperCase() === gross);
    if (!treffer) {
      const kandidaten = D.lehrer.filter(l => l.k.toUpperCase().startsWith(gross) || (l.n || "").toLowerCase().includes(klein));
      if (kandidaten.length === 1) treffer = kandidaten[0];
    }
    if (treffer) { if (!S.gewaehlt.includes(treffer.k)) S.gewaehlt.push(treffer.k); }
    else unbekannt.push(c);
  }
  store.set("ls-gewaehlt", S.gewaehlt);
  return unbekannt;
}

function lehrerUmschalten(t) {
  const i = S.gewaehlt.indexOf(t);
  if (i >= 0) S.gewaehlt.splice(i, 1); else S.gewaehlt.push(t);
  store.set("ls-gewaehlt", S.gewaehlt);
  alles();
}

// ---------- Ansicht: Nach Klasse ----------
function zeigeKlasse() {
  $("klasse").value = S.klasse;
  const h = heute(), z = jetzt();
  const alle = D.stunden.filter(s => findet(s) && s.klassen.includes(S.klasse));
  const gerade = alle.filter(s => s.datum === h && s.von <= z && z < s.bis && s.status !== "entfall");
  $("k-status").innerHTML = gerade.length
    ? `<span class="live"></span>Gerade: ${gerade.map(s => `<strong>${fach(s)}</strong> bei ${liste(s.lehrer) || "—"}${s.raeume.length ? " in " + liste(s.raeume) : ""}`).join(" / ")}.`
    : `<span class="live idle"></span>Gerade keine Stunde in dieser Klasse.`;
  wocheZeichnen($("k-woche"));
  const tg = wochenTage();
  const schluessel = x => [fach(x), x.raeume.map(r => r.k + (r.statt || "")).join(), x.lehrer.map(l => l.k + (l.statt || "")).join(), x.status].join("|");
  rasterZeichnen($("k-grid"), $("k-tage"), rasterItems(alle.filter(s => tg.includes(s.datum)), schluessel), klassenItem);
}

// ---------- Ansicht: Nach Raum ----------
function zeigeRaum() {
  $("raum").value = S.raum;
  const h = heute(), z = jetzt();
  const alle = D.stunden.filter(s => findet(s) && s.raeume.some(r => r.k === S.raum));
  const gerade = alle.filter(s => s.datum === h && s.von <= z && z < s.bis);
  $("r-status").innerHTML = gerade.length
    ? `<span class="live"></span>Gerade: ${gerade.map(s => `<strong>${esc(s.klassen.join(", "))}</strong> mit ${fach(s)} bei ${liste(s.lehrer) || "—"}`).join(" / ")}.`
    : `<span class="live idle"></span>Der Raum ist gerade frei.`;
  wocheZeichnen($("r-woche"));
  const tg = wochenTage();
  const schluessel = x => [x.klassen.join(), fach(x), x.lehrer.map(l => l.k + (l.statt || "")).join(), x.raeume.map(r => r.k).join(), x.status].join("|");
  rasterZeichnen($("r-grid"), $("r-tage"), rasterItems(alle.filter(s => tg.includes(s.datum)), schluessel), raumItem);
}

// ---------- Ansicht: Vertretungen ----------
function zeigeVertretung() {
  const q = $("vfilter").value.trim().toLowerCase();
  const h = heute();
  const text = s => [s.klassen.join(" "), s.faecher.map(f => f.k + " " + f.n).join(" "),
    s.lehrer.map(x => `${x.k} ${x.n} ${x.statt || ""}`).join(" "), s.raeume.map(x => `${x.k} ${x.statt || ""}`).join(" "), s.text].join(" ").toLowerCase();
  const aend = D.stunden.filter(s => s.datum >= h && s.status !== "normal" && (!q || text(s).includes(q)));
  const tage = [...new Set(aend.map(s => s.datum))];
  $("vliste").innerHTML = tage.map(t => {
    const rows = aend.filter(s => s.datum === t).sort((a, b) => a.von.localeCompare(b.von) || a.klassen.join().localeCompare(b.klassen.join()));
    return `<h2>${WT_LANG[(tag(t).getDay() + 6) % 7]} ${datumKurz(t)}${t === h ? " · heute" : ""}</h2>
      <div class="scroll"><table class="vtabelle"><thead><tr><th>Zeit</th><th>Klasse</th><th>Fach</th><th>Lehrer</th><th>Raum</th><th>Art</th><th>Info</th></tr></thead><tbody>
      ${rows.map(s => `<tr class="${s.status}"><td>${s.von}–${s.bis}</td><td>${esc(s.klassen.join(", "))}</td><td>${fach(s)}</td>
        <td>${liste(s.lehrer)}</td><td>${liste(s.raeume)}</td><td>${marke(s.status)}</td><td>${esc(s.text)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }).join("") || '<p class="leer">Keine Vertretungen oder Änderungen.</p>';
}

// ---------- Alles zeichnen ----------
function alles() {
  if (!D) return;
  for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", b.dataset.ansicht === S.ansicht);
  $("v-lehrer").hidden = S.ansicht !== "lehrer";
  $("v-klasse").hidden = S.ansicht !== "klasse";
  $("v-raum").hidden = S.ansicht !== "raum";
  $("v-vertretung").hidden = S.ansicht !== "vertretung";
  ({lehrer: zeigeLehrer, klasse: zeigeKlasse, raum: zeigeRaum, vertretung: zeigeVertretung})[S.ansicht]();
}

function ansicht(v) { S.ansicht = v; store.set("ls-ansicht", v); alles(); }

// ---------- Bedienung ----------
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (b) ansicht(b.dataset.ansicht); });
$("suchform").addEventListener("submit", e => {
  e.preventDefault();
  const unbekannt = lehrerHinzu($("q").value.split(/[\s,;]+/));
  $("q").value = unbekannt.join(", ");
  alles();
});
$("alleWeg").addEventListener("click", () => { S.gewaehlt = []; store.set("ls-gewaehlt", []); alles(); });
$("q").addEventListener("input", zeigeLehrer);
$("alleLehrer").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (b) lehrerUmschalten(b.dataset.t); });
$("lehrerliste").open = store.get("ls-liste-offen", true);
$("lehrerliste").addEventListener("toggle", () => store.set("ls-liste-offen", $("lehrerliste").open));
$("chips").addEventListener("click", e => { const b = e.target.closest("button[data-weg]"); if (b) lehrerUmschalten(b.dataset.weg); });
$("klasse").addEventListener("change", e => { S.klasse = e.target.value; store.set("ls-klasse", S.klasse); alles(); });
$("raum").addEventListener("change", e => { S.raum = e.target.value; store.set("ls-raum", S.raum); alles(); });
document.addEventListener("click", e => {
  const w = e.target.closest("[data-woche]");
  if (w && !w.disabled) {
    const n = +w.dataset.woche;
    montag = n === 0 ? null : plusTage(montag, 7 * n);
    if (n === 0) vorbereiten();
    mTag = null;
    alles();
  }
  const t = e.target.closest(".tagtabs button[data-tag]");
  if (t) { mTag = +t.dataset.tag; alles(); }
});
mobil.addEventListener("change", alles);

laden();
setInterval(laden, 5 * 60 * 1000);   // neue Scan-Daten holen
setInterval(alles, 60 * 1000);       // "Jetzt"-Anzeige aktuell halten
