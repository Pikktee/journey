// Typen für src/audiotracks.js (Vanilla-JS des Players; `allowJs` ist aus).
//
// Deklariert werden nur die beiden REINEN Helfer — sie sind das, was sich
// Player und Studio teilen müssen: feuert ein Klang hier, feuert er im fertigen
// Film an derselben Stelle. `createAudioTracks` bleibt bewusst außen vor: es
// gehört zur Wiedergabe-Schleife des Players (und kann keinen Eintritts-Seek,
// den das Studio braucht — s. src/studio/abspielen.ts).

export function istAktiv(spur: { f0: number; f1: number }, frac: number): boolean

export function sfxSollFeuern(vorher: number, nachher: number, f0: number, istPlayback: boolean): boolean

/** Default-Ducking-Faktor (0..1), wenn Video-Ton läuft — später im Editor individualisierbar. */
export const VIDEO_DUCK: number
