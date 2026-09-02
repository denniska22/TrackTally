# TrackTally

Eine private, statische Spotify-Quizseite für dich und deine Freunde. Sie enthält einen vollständigen Browser-Login über **OAuth 2.0 mit PKCE** – ohne Client Secret im Frontend – sowie einen spielbaren Demo-Modus.

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
