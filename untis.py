"""WebUntis-Anbindung: Login mit dem eigenen Account und Auslesen aller Klassen-Stundenpläne."""
import base64
import datetime as dt
import time

import requests

KLASSE, LEHRER, FACH, RAUM = 1, 2, 3, 4
GEAENDERT = {"SUBSTITUTION", "ADDITIONAL", "ROOMSUBSTITUTION", "SHIFT"}


class UntisFehler(Exception):
    pass


def datum_int(d):
    return int(d.strftime("%Y%m%d"))


def datum_text(zahl):
    s = str(zahl)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def zeit_text(zahl):
    return f"{zahl // 100:02d}:{zahl % 100:02d}"


class Untis:
    def __init__(self, server, schule, benutzer, passwort):
        self.server = server
        self.basis = f"https://{server}/WebUntis"
        self.schule = schule
        self.benutzer = benutzer
        self.passwort = passwort
        self.token = None
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "Lehrer-Suche/1.0"

    # ---------- JSON-RPC (offizielle Schnittstelle) ----------
    def rpc(self, methode, params=None):
        r = self.s.post(f"{self.basis}/jsonrpc.do", params={"school": self.schule},
                        json={"id": "1", "method": methode, "params": params or {}, "jsonrpc": "2.0"},
                        timeout=30)
        r.raise_for_status()
        antwort = r.json()
        if "error" in antwort:
            f = antwort["error"]
            raise UntisFehler(f"{methode}: {f.get('message')} (Code {f.get('code')})")
        return antwort["result"]

    def versuche(self, methode, params=None):
        """Wie rpc(), aber fehlende Rechte sind kein Abbruch (Schüler dürfen nicht alles abfragen)."""
        try:
            return self.rpc(methode, params)
        except UntisFehler as e:
            print("  Hinweis:", e)
            return None

    def login(self):
        self.rpc("authenticate", {"user": self.benutzer, "password": self.passwort, "client": "Lehrer-Suche"})
        # Die Web-Schnittstelle (wie im Browser) braucht zusätzlich das Schul-Cookie und ein Token
        schule64 = base64.b64encode(self.schule.encode()).decode()
        self.s.cookies.set("schoolname", f'"_{schule64}"', domain=self.server, path="/")
        try:
            r = self.s.get(f"{self.basis}/api/token/new", timeout=30)
            if r.ok and r.text and not r.text.lstrip().startswith("<"):
                self.token = r.text.strip()
        except requests.RequestException:
            pass

    def logout(self):
        try:
            self.rpc("logout")
        except Exception:
            pass

    def stundenplan_rpc(self, klassen_id, von, bis):
        felder = ["id", "name", "longname"]
        return self.rpc("getTimetable", {"options": {
            "element": {"id": klassen_id, "type": KLASSE},
            "startDate": datum_int(von), "endDate": datum_int(bis),
            "showInfo": True, "showSubstText": True, "showLsText": True,
            "klasseFields": felder, "teacherFields": felder,
            "subjectFields": felder, "roomFields": felder,
        }})

    # ---------- Web-Schnittstelle (Fallback, liefert dasselbe wie die Wochenansicht im Browser) ----------
    def stundenplan_web(self, klassen_id, montag):
        kopf = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        r = self.s.get(f"{self.basis}/api/public/timetable/weekly/data", headers=kopf, timeout=30,
                       params={"elementType": KLASSE, "elementId": klassen_id,
                               "date": montag.isoformat(), "formatId": 1})
        r.raise_for_status()
        daten = ((r.json().get("data") or {}).get("result") or {}).get("data")
        if daten is None:
            raise UntisFehler("Web-Stundenplan: keine Daten (fehlende Berechtigung?)")
        return daten


# ---------- Umwandeln in ein einheitliches Format ----------
def _element(e, stamm):
    """Lehrer/Raum/Fach/Klasse aus getTimetable -> {k: Kürzel, n: Name, statt: ursprüngliches Kürzel}"""
    s = stamm.get(e.get("id"), {})
    x = {"k": e.get("name") or s.get("k", ""), "n": e.get("longname") or s.get("n", "")}
    if e.get("orgid"):
        x["statt"] = e.get("orgname") or stamm.get(e["orgid"], {}).get("k", "?")
    return x


def _status(entfall, geaendert, lehrer, raeume):
    if entfall:
        return "entfall"
    if any("statt" in l for l in lehrer):
        return "vertretung"
    if any("statt" in r for r in raeume):
        return "raum"
    return "aenderung" if geaendert else "normal"


def _text(*teile):
    return " · ".join(t.strip() for t in teile if t and t.strip())


def aus_rpc(e, stamm):
    lehrer = [_element(x, stamm[LEHRER]) for x in e.get("te", [])]
    raeume = [_element(x, stamm[RAUM]) for x in e.get("ro", [])]
    return {
        "id": e["id"],
        "datum": datum_text(e["date"]), "von": zeit_text(e["startTime"]), "bis": zeit_text(e["endTime"]),
        "klassen": [_element(x, stamm[KLASSE])["k"] for x in e.get("kl", [])],
        "faecher": [_element(x, stamm[FACH]) for x in e.get("su", [])],
        "lehrer": lehrer, "raeume": raeume,
        "status": _status(e.get("code") == "cancelled", e.get("code") == "irregular", lehrer, raeume),
        "text": _text(e.get("substText"), e.get("lstext"), e.get("info")),
    }


def aus_web(daten, klassen_id):
    elemente = {(e["type"], e["id"]): e for e in daten.get("elements", [])}
    stunden = []
    for p in daten.get("elementPeriods", {}).get(str(klassen_id), []):
        typen = {KLASSE: [], LEHRER: [], FACH: [], RAUM: []}
        for el in p.get("elements", []):
            if el["type"] not in typen:
                continue
            s = elemente.get((el["type"], el["id"]), {})
            x = {"k": s.get("name", ""), "n": s.get("longName", "")}
            if el.get("orgId"):
                x["statt"] = elemente.get((el["type"], el["orgId"]), {}).get("name", "?")
            typen[el["type"]].append(x)
        zustand = p.get("cellState", "STANDARD")
        stunden.append({
            "id": p["id"],
            "datum": datum_text(p["date"]), "von": zeit_text(p["startTime"]), "bis": zeit_text(p["endTime"]),
            "klassen": [k["k"] for k in typen[KLASSE]],
            "faecher": typen[FACH], "lehrer": typen[LEHRER], "raeume": typen[RAUM],
            "status": _status(zustand == "CANCEL" or (p.get("is") or {}).get("cancelled"),
                              zustand in GEAENDERT, typen[LEHRER], typen[RAUM]),
            "text": _text(p.get("substText"), p.get("lessonText"), p.get("periodText")),
        })
    return stunden


def _zeitraster(tage):
    einheiten = {}
    for t in tage:
        for u in t.get("timeUnits", []):
            einheiten[(u["startTime"], u["endTime"])] = u.get("name", "")
    return [{"name": n, "von": zeit_text(a), "bis": zeit_text(b)} for (a, b), n in sorted(einheiten.items())]


# ---------- Kompletter Scan ----------
def scannen(untis, tage=14):
    """Liest ab Montag dieser Woche `tage` Tage lang die Stundenpläne aller Klassen."""
    heute = dt.date.today()
    montag = heute - dt.timedelta(days=heute.weekday())
    ende = montag + dt.timedelta(days=tage - 1)

    untis.login()
    try:
        klassen = sorted(untis.rpc("getKlassen"), key=lambda k: k["name"])
        stamm = {
            KLASSE: {k["id"]: {"k": k["name"], "n": k.get("longName", "")} for k in klassen},
            LEHRER: {l["id"]: {"k": l["name"], "n": f'{l.get("foreName", "")} {l.get("longName", "")}'.strip()}
                     for l in untis.versuche("getTeachers") or []},
            FACH: {f["id"]: {"k": f["name"], "n": f.get("longName", "")} for f in untis.versuche("getSubjects") or []},
            RAUM: {r["id"]: {"k": r["name"], "n": r.get("longName", "")} for r in untis.versuche("getRooms") or []},
        }
        zeitraster = _zeitraster(untis.versuche("getTimegridUnits") or [])

        stunden, fehler, web = {}, [], False
        for k in klassen:
            try:
                liste = None
                if not web:
                    try:
                        liste = [aus_rpc(e, stamm) for e in untis.stundenplan_rpc(k["id"], montag, ende)]
                    except UntisFehler as e:
                        print(f"  {k['name']}: JSON-RPC verweigert ({e}), nehme Web-Schnittstelle")
                if liste is None:
                    liste, woche = [], montag
                    while woche <= ende:
                        liste += aus_web(untis.stundenplan_web(k["id"], woche), k["id"])
                        woche += dt.timedelta(days=7)
                    web = True
            except (UntisFehler, requests.RequestException, KeyError, ValueError) as e:
                fehler.append(f"{k['name']}: {e}")
                continue

            for st in liste:
                if not st["klassen"]:
                    st["klassen"] = [k["name"]]
                schluessel = (st["id"], st["datum"], st["von"])
                if schluessel in stunden:  # Stunde mit mehreren Klassen nur einmal speichern
                    vorhanden = stunden[schluessel]["klassen"]
                    vorhanden += [x for x in st["klassen"] if x not in vorhanden]
                else:
                    stunden[schluessel] = st
            time.sleep(0.2)  # WebUntis nicht überlasten
    finally:
        untis.logout()

    # Lehrer- und Raumliste: Stammdaten (falls erlaubt) + alles, was in den Stundenplänen vorkommt
    lehrer = {v["k"]: v for v in stamm[LEHRER].values() if v["k"]}
    raeume = {v["k"] for v in stamm[RAUM].values() if v["k"]}
    for st in stunden.values():
        for l in st["lehrer"]:
            if l["k"]:
                lehrer.setdefault(l["k"], {"k": l["k"], "n": l["n"]})
            if l.get("statt") and l["statt"] != "?":
                lehrer.setdefault(l["statt"], {"k": l["statt"], "n": ""})
        raeume.update(r["k"] for r in st["raeume"] if r["k"])

    return {
        "stand": dt.datetime.now().isoformat(timespec="seconds"),
        "von": montag.isoformat(), "bis": ende.isoformat(),
        "zeitraster": zeitraster,
        "klassen": [k["name"] for k in klassen],
        "lehrer": sorted(lehrer.values(), key=lambda l: l["k"].lower()),
        "raeume": sorted(raeume, key=str.lower),
        "stunden": sorted(stunden.values(), key=lambda s: (s["datum"], s["von"], s["klassen"])),
        "fehler": fehler,
    }
