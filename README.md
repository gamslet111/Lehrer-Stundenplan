# Lehrer-Suche

Meldet sich mit einem WebUntis-Account bei `htlstp.webuntis.com` an, liest alle 15 Minuten die Stundenpläne **aller Klassen** (diese und nächste Woche) und zeigt sie auf einer Webseite an:

- **Lehrer finden**: wo ist ein Lehrer gerade (Raum, Klasse, Fach), wo war er zuletzt, wo ist er als Nächstes
- **Stundenplan**: Wochenplan pro Klasse, Lehrer oder Raum
- **Vertretungen**: alle Vertretungen, Entfälle und Raumänderungen ab heute

## Einrichten

1. `pip install -r requirements.txt`
2. `.env.example` als `.env` kopieren, `UNTIS_BENUTZER` und `UNTIS_PASSWORT` eintragen
3. Login testen: `python app.py --einmal`
4. Starten: `python app.py` (oder `start.bat`), dann http://localhost:5000 öffnen

## Dateien

| Datei | Inhalt |
|---|---|
| `untis.py` | Login bei WebUntis, Stundenpläne lesen, ins eigene Format umwandeln |
| `app.py` | Webserver (Flask) und automatischer Scan im Hintergrund |
| `static/` | Webseite (`index.html`, `app.js`, `style.css`) |
| `daten/stundenplan.json` | letzter Scan (wird automatisch angelegt) |
