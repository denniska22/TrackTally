# TrackTally

Eine private, statische Spotify-Quizseite für dich und deine Freunde. Sie enthält einen vollständigen Browser-Login über **OAuth 2.0 mit PKCE** – ohne Client Secret im Frontend – sowie einen spielbaren Demo-Modus.

## Lokal ansehen

Öffne `index.html` in einem Browser. Der Demo-Modus funktioniert sofort. Für den Spotify-Login muss die Seite über `http://localhost` oder HTTPS ausgeliefert werden; eine `file://`-Adresse ist keine gültige Redirect URI.

## Spotify einmal einrichten

1. Öffne das [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) und erstelle eine App.
2. Lege die finale Adresse deiner Seite als **Redirect URI** fest, z. B. `https://dein-name.github.io/tracktally/`.
3. Kopiere die **Client ID** in `spotify.config.js`. Ein Client Secret gehört niemals in diese Datei.
4. Lade die Website anschließend über genau diese Adresse neu.

Die Seite nutzt ausschließlich diese Spotify-Berechtigungen:

- `playlist-read-private`
- `playlist-read-collaborative`
- `user-read-private`

Es werden keine Playlists verändert und es wird nichts in Spotify veröffentlicht.

## Hosting für Freunde

Die drei Dateien können unverändert auf GitHub Pages, Netlify oder Cloudflare Pages gehostet werden. Wichtig ist, die veröffentlichte HTTPS-Adresse zuvor als Redirect URI im Spotify Dashboard einzutragen.

## Wichtige Spotify-Einschränkung

Das Quiz verwendet verfügbare Spotify-Hörproben (`preview_url`). Einige Titel oder Labels stellen keine Hörprobe bereit. Die App filtert solche Titel automatisch; eine Playlist braucht mindestens vier Titel mit Hörprobe. Für die volle Songwiedergabe wäre eine zusätzliche Integration des Spotify Web Playback SDK nötig, die Spotify Premium voraussetzt.

Für einen kleinen privaten Nutzerkreis gelten zudem die aktuellen Zugriffs- und Nutzerregeln deiner Spotify-Developer-App. Prüfe diese vor dem Teilen im Developer Dashboard.
