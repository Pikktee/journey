// Kompakte Sonnenstands-Berechnung (NOAA-/SunCalc-Formeln, Genauigkeit ~0.1°):
// liefert Höhe über dem Horizont und Azimut (von Norden, im Uhrzeigersinn).
const rad = Math.PI / 180
const DAY_MS = 86400000
const J1970 = 2440588
const J2000 = 2451545
const E = rad * 23.4397 // Neigung der Erdachse

const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000

function eclipticLongitude(d) {
  const M = rad * (357.5291 + 0.98560028 * d) // mittlere Anomalie
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  return M + C + rad * 102.9372 + Math.PI
}

export function sunPosition(date, lat, lng) {
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(date)
  const L = eclipticLongitude(d)
  const dec = Math.asin(Math.sin(0) * Math.cos(E) + Math.cos(0) * Math.sin(E) * Math.sin(L))
  const ra = Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L))
  const H = rad * (280.16 + 360.9856235 * d) - lw - ra // Stundenwinkel
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
  return {
    altitude: alt / rad, // Grad über dem Horizont (negativ = untergegangen)
    azimuth: az / rad + 180, // Grad von Norden, im Uhrzeigersinn
  }
}
