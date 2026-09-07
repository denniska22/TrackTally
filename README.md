# TrackTally

Eine private, statische Spotify-Quizseite für dich und deine Freunde. Sie enthält einen vollständigen Browser-Login über **OAuth 2.0 mit PKCE** – ohne Client Secret im Frontend – sowie einen spielbaren Demo-Modus.

## Progressive Audio Reveal

Über die Quizauswahl oder `progressive-audio-reveal.html` erreichbar. Dieser Modus nutzt die bestehende Spotify-Anmeldung und benötigt Spotify Premium zur Wiedergabe. Der Demo-Modus des klassischen Quiz bleibt separat verfügbar.

- Fünf verschiedene Songs, automatisch von Easy bis Impossible, mit je sechs Versuchen.
- Fehler und Überspringen verlängern den Ausschnitt; erneutes Anhören verbraucht keinen Versuch.
- Songsuche nach Titel oder Artist mit Tastaturbedienung und ausdrücklicher Antwortabgabe. Doppelte falsche Antworten kosten keinen weiteren Versuch.
- „Mein Geschmack“ kombiniert bis zu 50 Top-Songs und 50 gespeicherte Titel. Alternativ stehen Pop und Hip-Hop zur Auswahl. Ein Kategorienwechsel beginnt eine neue Runde.
- Auflösung nach jedem Song, Gesamtwertung, kopierbarer Ergebnistext und eine PNG-Ergebniskarte. Der Spielstand wird im aktuellen Tab gespeichert und beim Neuladen wiederhergestellt.

| Stufe | Ausschnitte in Sekunden | Punktefaktor |
| --- | --- | --- |
| Easy | 1 / 2 / 4 / 7 / 11 / 16 | 1 |
| Medium | 0,1 / 0,5 / 1 / 2 / 4 / 8 | 1,15 |
| Hard | 0,08 / 0,2 / 0,5 / 1 / 2 / 4 | 1,3 |
| Expert | 0,05 / 0,1 / 0,3 / 0,8 / 2 / 4 | 1,5 |
| Impossible | 0,03 / 0,08 / 0,15 / 0,4 / 1 / 2 | 1,75 |

Eine richtige Antwort erhält je nach Versuch 100 / 85 / 70 / 55 / 40 / 25 Basispunkte, multipliziert mit dem Stufenfaktor und pro Song gerundet. Maximal sind 670 Punkte möglich. Ausschnittlängen und Wertung orientieren sich an [tastedtracks](https://www.tastedtracks.com/game); die Implementierung verwendet TrackTallys eigenen Spotify-Zugang.

Die Wiedergabe startet für jeden Versuch mit einem einzelnen Befehl an derselben Songposition. Der Ausschnitt-Timer beginnt bei bestätigter Wiedergabe, unabhängig von der Antwort auf den Startbefehl. Eine zusätzliche Startfrist begrenzt die Wiedergabe auch bei ausbleibenden Player-Meldungen. Beim Ausschnittende, bei Fehlern und beim Tabwechsel stoppen das lokale Spotify SDK und ein gerätespezifischer API-Befehl parallel; der API-Stopp wartet nicht auf Songsuchen. Nicht bestätigte oder hängende SDK-Stopps trennen die Player-Verbindung. Abgebrochene Startbefehle werden nicht nachträglich aus der Warteschlange gesendet. Browser-, Netzwerk- und SDK-Latenz können besonders bei sehr kurzen Ausschnitten die tatsächliche Dauer beeinflussen; eine samplegenaue Grenze ist beim Spotify-Stream nicht garantiert. Technische Wiedergabefehler verbrauchen keinen Versuch. Der Spotify-Login kehrt über die bereits registrierte Root-Adresse zu diesem Modus zurück; eine zusätzliche Redirect URI ist nicht erforderlich.

Prüfungen ohne externe Abhängigkeiten: `node --test tests/reveal-game.test.js tests/reveal-player.test.js tests/reveal-ui.test.js`. Die Tests verwenden Spotify-Testobjekte und prüfen Spielregeln, Audio-Abbrüche, den vollständigen UI-Ablauf, Speichern/Neuladen und die Login-Rückkehr. Echte Spotify-Wiedergabe muss mit einem freigeschalteten Premium-Konto im Browser überprüft werden.

## Lokal ansehen

Öffne `index.html` in einem Browser. Der Demo-Modus funktioniert sofort. Für den Spotify-Login muss die Seite über `http://localhost` oder HTTPS ausgeliefert werden; eine `file://`-Adresse ist keine gültige Redirect URI.

## Spotify einmal einrichten

1. Öffne das [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) und erstelle eine App.
2. Lege die finale Adresse deiner Seite als **Redirect URI** fest, z. B. `https://dein-name.github.io/tracktally/`.
3. Die veröffentlichte TrackTally-Version enthält die öffentliche Client ID bereits im App-Code. Für eine andere Spotify-App wird sie in `app.js` bei `DEFAULT_CONFIG.clientId` ersetzt. Ein Client Secret gehört niemals in diese Datei.
4. Lade die Website anschließend über genau diese Adresse neu.

Die Seite nutzt ausschließlich diese Spotify-Berechtigungen:

- `playlist-read-private`
- `playlist-read-collaborative`
- `user-read-private`
- `user-read-email`
- `user-library-read`
- `streaming`
- `user-modify-playback-state`

Es werden keine Playlists verändert und es wird nichts in Spotify veröffentlicht.

## Hosting für Freunde

Die Dateien können unverändert auf GitHub Pages, Netlify oder Cloudflare Pages gehostet werden. Wichtig ist, die veröffentlichte HTTPS-Adresse zuvor als Redirect URI im Spotify Dashboard einzutragen.

## Vollständige Songwiedergabe

TrackTally verwendet den Spotify Web Playback SDK. Damit können alle auf dem jeweiligen Konto verfügbaren Tracks einer Playlist im Browser gespielt werden – auch wenn Spotify keine `preview_url` bereitstellt.

- Jede spielende Person benötigt Spotify Premium.
- Beim nächsten Login fragt die App zusätzlich die Berechtigungen `streaming` und `user-modify-playback-state` ab.
- Spotify streamt direkt in das Konto der jeweiligen Person. Die App überträgt oder broadcastet keine Musik an andere Teilnehmende.
- Der Spotify Player muss für die App im Spotify Developer Dashboard aktiviert sein. Bei einigen Browser-Erweiterungen kann der Player blockiert werden.

Für einen kleinen privaten Nutzerkreis gelten zudem die aktuellen Zugriffs- und Nutzerregeln deiner Spotify-Developer-App. Prüfe diese vor dem Teilen im Developer Dashboard.
