"""Lehrer-Suche: Webseite + automatischer WebUntis-Scan.

Start:  python app.py           Webseite auf http://localhost:5000, scannt alle SCAN_MINUTEN Minuten
        python app.py --einmal  nur einmal scannen (zum Testen des Logins)
"""
import json
import os
import sys
import threading
import time
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory

from untis import Untis, scannen

ORDNER = Path(__file__).resolve().parent
load_dotenv(ORDNER / ".env")

DATEI = ORDNER / "daten" / "stundenplan.json"
SCAN_MINUTEN = int(os.getenv("SCAN_MINUTEN", "15"))
TAGE = int(os.getenv("TAGE", "14"))
SEITEN_PASSWORT = os.getenv("SEITEN_PASSWORT", "")

app = Flask(__name__, static_folder=str(ORDNER / "static"), static_url_path="")
zustand = {"daten": None, "fehler": None}


def scan_einmal():
    benutzer, passwort = os.getenv("UNTIS_BENUTZER"), os.getenv("UNTIS_PASSWORT")
    if not benutzer or not passwort:
        raise RuntimeError("UNTIS_BENUTZER und UNTIS_PASSWORT in der Datei .env eintragen")
    u = Untis(os.getenv("UNTIS_SERVER", "htlstp.webuntis.com"), os.getenv("UNTIS_SCHULE", "htlstp"),
              benutzer, passwort)
    beginn = time.time()
    daten = scannen(u, TAGE)
    if not daten["stunden"] and daten["fehler"]:
        raise RuntimeError("Keine Stunden gelesen: " + "; ".join(daten["fehler"][:3]))

    DATEI.parent.mkdir(exist_ok=True)
    tmp = DATEI.with_suffix(".tmp")
    tmp.write_text(json.dumps(daten, ensure_ascii=False), encoding="utf-8")
    tmp.replace(DATEI)
    zustand["daten"], zustand["fehler"] = daten, None
    print(f"Scan fertig: {len(daten['klassen'])} Klassen, {len(daten['lehrer'])} Lehrer, "
          f"{len(daten['stunden'])} Stunden in {time.time() - beginn:.0f} s"
          + (f", {len(daten['fehler'])} Fehler" if daten["fehler"] else ""))


def scan_schleife():
    while True:
        try:
            scan_einmal()
        except Exception as e:
            zustand["fehler"] = str(e)
            print("Scan fehlgeschlagen:", e)
        time.sleep(SCAN_MINUTEN * 60)


@app.before_request
def passwortschutz():
    if SEITEN_PASSWORT:
        a = request.authorization
        if not a or a.password != SEITEN_PASSWORT:
            return Response("Passwort nötig", 401, {"WWW-Authenticate": 'Basic realm="Lehrer-Suche"'})


@app.route("/")
def startseite():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/daten")
def api_daten():
    if zustand["daten"] is None:
        return jsonify({"fehler": zustand["fehler"] or "Erster Scan läuft noch …"}), 503
    return jsonify({**zustand["daten"], "scan_fehler": zustand["fehler"]})


if __name__ == "__main__":
    if DATEI.exists():
        zustand["daten"] = json.loads(DATEI.read_text(encoding="utf-8"))
    if "--einmal" in sys.argv:
        scan_einmal()
        sys.exit()
    threading.Thread(target=scan_schleife, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
