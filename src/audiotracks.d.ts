// Typen für src/audiotracks.js (Vanilla-JS des Players; `allowJs` ist aus).
//
// Deklariert werden die REINEN Helfer — sie sind das, was sich Player und Studio
// teilen müssen: feuert ein Klang hier, feuert er im fertigen Film an derselben
// Stelle; Video-Ton-Hülle und Musik-Duck folgen derselben Kurve. `createAudioTracks`
// bleibt bewusst außen vor: es gehört zur Wiedergabe-Schleife des Players (und
// kann keinen Eintritts-Seek, den das Studio braucht — s. src/studio/abspielen.ts).

export function istAktiv(spur: { f0: number; f1: number }, frac: number): boolean

export function sfxSollFeuern(vorher: number, nachher: number, f0: number, istPlayback: boolean): boolean

/** Default-Ducking-Faktor (0..1) bei voller Video-Lautstärke — später im Editor individualisierbar. */
export const VIDEO_DUCK: number

/** Dauer der Video-Ton-Ein-/Ausblendung in Sekunden. */
export const VIDEO_FADE_S: number

/** Lineare Ton-Hülle 0..1 über die Videodauer (Fade-in / Fade-out). */
export function videoTonHuelle(t: number, dauer: number, fadeS?: number): number

/** Equal-Power-Lautstärke fürs Video zur Hülle. */
export function videoLautstaerke(huelle: number): number

/** Musik-Multiplikator zur Video-Hülle (1 → VIDEO_DUCK). */
export function videoMusikDuck(huelle: number): number
