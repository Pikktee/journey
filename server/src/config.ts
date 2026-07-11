// Zentrale Konfiguration aus der Umgebung. Alle Werte haben Dev-taugliche
// Defaults; in Produktion (Docker Compose) kommen sie aus dem Environment.

export interface Konfig {
  /** TCP-Port der API */
  port: number
  /** Datenverzeichnis: SQLite-Datei + Tour-Ablage (Medien, Manifeste, tour.json) */
  datenDir: string
  /** Geheimnis zum Signieren der Session-Cookies */
  cookieSecret: string
  /** Seed-Admin: wird beim Start angelegt, falls noch kein Benutzer existiert */
  adminEmail: string | null
  adminPasswort: string | null
  /** Maximale Größe einer einzelnen Mediendatei (Bytes) */
  maxMediumBytes: number
  /** true hinter TLS (Prod): Cookies bekommen `secure` */
  hinterTls: boolean
}

export function konfigAusEnv(env: NodeJS.ProcessEnv = process.env): Konfig {
  return {
    port: Number(env.PORT ?? 8787),
    datenDir: env.LUHAMBO_DATEN_DIR ?? './daten',
    cookieSecret: env.LUHAMBO_COOKIE_SECRET ?? 'dev-geheimnis-nicht-fuer-prod',
    adminEmail: env.LUHAMBO_ADMIN_EMAIL ?? null,
    adminPasswort: env.LUHAMBO_ADMIN_PASSWORT ?? null,
    maxMediumBytes: Number(env.LUHAMBO_MAX_MEDIUM_BYTES ?? 500 * 1024 * 1024),
    hinterTls: env.LUHAMBO_HINTER_TLS === '1',
  }
}
