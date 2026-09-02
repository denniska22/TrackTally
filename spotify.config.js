/*
 * Nur die Client-ID ist in einer Browser-App öffentlich sichtbar – das ist bei
 * Spotify PKCE vorgesehen. Niemals ein Client Secret hier eintragen.
 *
 * 1. Im Spotify Developer Dashboard eine App erstellen.
 * 2. Die unten genannte Redirect-URI dort EXAKT als Redirect URI hinterlegen.
 * 3. Die Client-ID eintragen und diese Datei speichern.
 */
window.TRACKTALLY_CONFIG = {
  clientId: "4f5e3a37204446b683eecf6ccc47dff5",
  // Diese Adresse muss im Spotify Developer Dashboard exakt identisch hinterlegt sein.
  redirectUri: "https://denniska22.github.io/TrackTally/"
};

