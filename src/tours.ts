// Tour-Registry: jede Tour besteht aus Segmenten mit Fortbewegungsmodus
// (walk / tram / ferry / bike), Foto-Ankern und Text-Metadaten.
// Segment-Nahtpunkte teilen sich exakt dieselbe Koordinate.
//
// Diese Datei ist zugleich die TYPQUELLE des Players: `TourConfig` beschreibt,
// was Engine und Verdrahter aus einer Tour lesen — nicht das ganze Server-Schema
// (das steht in docs/specs/austauschformat.md und kommt über `RemoteTourCfg` in
// src/remote.ts herein, das dieselbe Form mit Remote-Extras trägt).

/**
 * Fortbewegungsmittel eines Segments. Die Liste steht heute an mehreren Stellen
 * (MODE_SPEED/MODE_SCALE in tour.ts, MODE_ICONS in map.ts, MODE_SOUND in
 * vehicle.ts, MODI in server/src/schema/upload.ts) und wird von einem
 * Drift-Wächter zusammengehalten; die Zusammenführung zu einer Quelle ist ein
 * eigener Plan (docs/concepts/modi-konsolidierung.md).
 */
export type Modus = 'walk' | 'bike' | 'moped' | 'jeep' | 'tram' | 'ferry'

/** Wegpunkt [lng, lat, ele] — Höhe in Metern (elevation.ts überschreibt sie später). */
export type Wegpunkt = [number, number, number]

/** Ankerkoordinate eines Fotos [lng, lat] — ohne Höhe (nearestS sucht auf der Route). */
export type Ankerpunkt = [number, number]

export interface TourSegment {
  mode: Modus
  /** Anzeigename in der Telemetrie; ohne Angabe zeigt main.ts den Modus-Schlüssel. */
  label?: string
  pts: Wegpunkt[]
}

export interface TourFoto {
  src: string
  title: string
  caption: string
  anchor: Ankerpunkt
}

/** Pseudo-Zeit der Tour: Streckenanteil ↦ linear interpolierte Uhrzeit. */
export interface TourZeit {
  start: string
  end: string
  /** IANA-Zone — Auto-Wetter fragt Open-Meteo in genau dieser Zone ab. */
  zone: string
}

/** Kuratierte Wetter-Timeline (km entlang der Route); schlägt das Auto-Wetter. */
export interface TourWetter {
  km: number
  mode: string
  k: number
}

/** Tour-eigene Audio-Spur, verankert am Streckenanteil f (s. audiotracks.ts). */
export interface TourAudio {
  type: string
  src: string
  f0: number
  f1: number
  gain?: number
  loop?: boolean
  startS?: number
  /**
   * Filmsekunde des Einsatzes (E10) — geht `f0` vor, wenn sie da ist.
   *
   * Der Streckenanteil kann den Halt nicht ausdrücken: Dort läuft der Film und
   * die Strecke steht, ein Klip mitten in einer Standzeit fiele auf die
   * Halt-Kante. Kuratierte Touren (diese Datei) tragen das Feld nie — für sie
   * gilt dauerhaft der Rückfall über die Filmachse.
   */
  filmS?: number
  /** Filmsekunde des Endes; nur bei Bereichen (ein One-Shot hat keine) */
  filmBisS?: number
}

export interface TourConfig {
  no: string
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  /** true = Endscreen; fehlt/false = zurück zum Startscreen */
  showFinale?: boolean
  finaleTitle: string
  /** Ohne `time` bleibt die Tag/Nacht-Regie aus (main.ts prüft das Feld). */
  time?: TourZeit
  /** m: Geoid über WGS84-Ellipsoid in der Region (nur für den Google-3D-Testmodus) */
  geoid?: number
  segments: TourSegment[]
  photos: TourFoto[]
  weather?: TourWetter[]
  audio?: TourAudio[]
  /**
   * Master-Faktor über alle `audio`-Spuren (audiotracks.ts). Fehlt er, gilt der
   * gedämpfte Vorgabewert der kuratierten Touren — dort ist `gain` gegen ihn
   * ausgemessen (0.22 × 0.8 ≈ 0.16, s. kohphangan). AUFGEZEICHNETE Touren setzen
   * ihn auf 1: Ihr `gain` IST der Pegel, den der Autor im Studio-Abspieler
   * gehört hat, und ein zweiter Faktor darüber machte den Film leiser als den
   * Schnitt (gemessen Faktor 3,6 — der Grund, warum der Player „viel leiser" war).
   */
  audioPegel?: number
}

export const TOURS = {
  oberland: {
    no: 'N°01',
    brandTitle: 'Berner Oberland',
    kicker: 'Eine Reise durch das',
    titleHtml: 'Berner<br />Oberland',
    stops: ['Lauterbrunnen', 'Zweilütschinen', 'Lütschental', 'Grindelwald'],
    showFinale: true,
    finaleTitle: 'Grindelwald',
    // Pseudo-Timestamps: Streckenanteil ↦ linear interpolierte Uhrzeit.
    // Mittsommer — Aufbruch in der Morgendämmerung, Ankunft zur goldenen Stunde
    time: { start: '2025-06-21T06:15:00+02:00', end: '2025-06-21T20:45:00+02:00', zone: 'Europe/Zurich' },
    geoid: 48, // m: Geoid über WGS84-Ellipsoid in der Region (für den Google-3D-Testmodus)
    segments: [
      {
        mode: 'bike',
        label: 'Rad',
        // Reale Talstrasse auf dem OSM-Strassennetz (BRouter, Auto-Profil): das
        // Lauterbrunnental hinaus nach Zweilütschinen und über das Lütschental nach
        // Grindelwald — die EINZIGE mit dem Rad fahrbare Verbindung. Wengen/Kleine
        // Scheidegg sind autofrei bzw. nur per Zahnradbahn erreichbar und daher raus.
        // 16 km, ~460 Hm: sanft talwärts, dann stetiger Anstieg. Höhen aus BRouter-DEM
        // (elevation.ts überschreibt sie ohnehin mit Terrarium-Werten).
        //
        // DICHTE Geometrie (338 Stützpunkte, Median-Abstand 29 m). Die Vorgängerfassung
        // hatte nur 35 Punkte auf 16 km — über solche Lücken schneidet die Catmull-Rom-
        // Glättung in buildRoute() die Kurven ab und überschwingt, die gerenderte Linie
        // lag im Median 18 m und stellenweise 250 m NEBEN der Strasse. Die Punktdichte
        // ist deshalb kein Beiwerk: ausgedünnt wurde adaptiv (Douglas-Peucker) gegen die
        // GERENDERTE Abweichung, nicht gegen die Rohgeometrie — Ziel und Ergebnis:
        // Median 0,3 m, max 4,2 m, also innerhalb der Fahrbahn.
        //
        // Auto- statt Radprofil, weil alle Radprofile ab Burglauenen auf den
        // ausgeschilderten Radweg (Schafeyweg, teils highway=construction/path)
        // ausweichen — der läuft NEBEN der Talstrasse und ist im Satellitenbild kaum
        // zu sehen. Das Auto-Profil bleibt zu 100 % auf benannten Strassen (83 %
        // secondary), und genau die fährt man hier mit dem Rad auch.
        pts: [
          [7.90843, 46.59341, 791], // Lauterbrunnen
          [7.9084, 46.59307, 792],
          [7.90831, 46.5929, 795],
          [7.90818, 46.59277, 797],
          [7.90802, 46.59268, 798],
          [7.90785, 46.59266, 799],
          [7.90773, 46.59267, 800],
          [7.90761, 46.59273, 801],
          [7.90753, 46.59282, 802],
          [7.90747, 46.59295, 803],
          [7.90726, 46.59374, 808],
          [7.90726, 46.59381, 808],
          [7.90737, 46.59407, 809],
          [7.90747, 46.59475, 812],
          [7.90741, 46.59556, 813],
          [7.90759, 46.59682, 807],
          [7.90761, 46.59709, 805],
          [7.90741, 46.59754, 803],
          [7.90743, 46.59764, 803],
          [7.90758, 46.59797, 801],
          [7.90758, 46.59875, 798],
          [7.90752, 46.59899, 797],
          [7.90741, 46.59916, 796],
          [7.90728, 46.59928, 795],
          [7.90686, 46.59959, 791],
          [7.90672, 46.59971, 790],
          [7.90666, 46.59981, 789],
          [7.90658, 46.60021, 788],
          [7.90633, 46.60086, 782],
          [7.90632, 46.60105, 782],
          [7.90635, 46.60125, 780],
          [7.90653, 46.60172, 775],
          [7.9066, 46.60229, 771],
          [7.90649, 46.60315, 765],
          [7.90645, 46.60334, 763],
          [7.90628, 46.60381, 759],
          [7.90585, 46.6046, 753],
          [7.90549, 46.60537, 748],
          [7.90535, 46.60557, 747],
          [7.90509, 46.60582, 745],
          [7.905, 46.60595, 744],
          [7.90502, 46.60607, 742],
          [7.90528, 46.60646, 739],
          [7.90534, 46.60665, 738],
          [7.90535, 46.60686, 736],
          [7.9053, 46.60705, 736],
          [7.90518, 46.60723, 736],
          [7.90492, 46.60748, 735],
          [7.90477, 46.60757, 735],
          [7.90454, 46.60767, 734],
          [7.90391, 46.60788, 738],
          [7.90365, 46.60801, 737],
          [7.90342, 46.60817, 738],
          [7.903, 46.60858, 735],
          [7.90277, 46.60893, 734],
          [7.90267, 46.60925, 738],
          [7.90255, 46.60996, 736],
          [7.90229, 46.61086, 731],
          [7.90193, 46.61168, 729],
          [7.90189, 46.61178, 729],
          [7.90186, 46.61202, 729],
          [7.90186, 46.61265, 728],
          [7.90191, 46.61292, 728],
          [7.90197, 46.61304, 728],
          [7.90235, 46.61353, 728],
          [7.9024, 46.61366, 728],
          [7.90233, 46.61424, 729],
          [7.90227, 46.61437, 728],
          [7.90221, 46.61443, 727],
          [7.90154, 46.61489, 724],
          [7.90146, 46.61503, 723],
          [7.90144, 46.61511, 722],
          [7.90145, 46.61529, 721],
          [7.90211, 46.61739, 704],
          [7.90225, 46.61886, 694],
          [7.90221, 46.61908, 693],
          [7.90208, 46.61944, 695],
          [7.90207, 46.61957, 693],
          [7.9021, 46.61982, 691],
          [7.90223, 46.62018, 687],
          [7.9025, 46.62069, 684],
          [7.90299, 46.62151, 681],
          [7.90336, 46.62204, 677],
          [7.90346, 46.62224, 676],
          [7.90351, 46.62245, 675],
          [7.90355, 46.6233, 674],
          [7.90382, 46.62426, 672],
          [7.90383, 46.62451, 672],
          [7.90378, 46.62521, 667],
          [7.90372, 46.62545, 666],
          [7.90313, 46.62661, 663],
          [7.9024, 46.6276, 659],
          [7.90221, 46.62794, 658],
          [7.90202, 46.62846, 657],
          [7.9019, 46.62935, 656],
          [7.90178, 46.62967, 655],
          [7.90165, 46.62984, 654],
          [7.90147, 46.63, 654],
          [7.90067, 46.63044, 655],
          [7.90102, 46.63063, 654],
          [7.90178, 46.63092, 654],
          [7.90222, 46.63098, 658],
          [7.90286, 46.63097, 656],
          [7.90322, 46.63103, 657],
          [7.90371, 46.63119, 657],
          [7.90448, 46.63158, 657],
          [7.90466, 46.63165, 656],
          [7.9048, 46.63167, 655],
          [7.90515, 46.63166, 655],
          [7.90516, 46.6317, 655], // Zweilütschinen
          [7.90515, 46.63166, 655],
          [7.90738, 46.63149, 657],
          [7.90834, 46.63121, 658],
          [7.90858, 46.63116, 657],
          [7.90897, 46.63112, 657],
          [7.90948, 46.63113, 657],
          [7.90989, 46.63121, 659],
          [7.9109, 46.63157, 658],
          [7.91171, 46.63167, 659],
          [7.91232, 46.63181, 659],
          [7.91286, 46.63198, 661],
          [7.91338, 46.63219, 663],
          [7.91399, 46.63239, 665],
          [7.91429, 46.63252, 667],
          [7.91491, 46.63291, 670],
          [7.9152, 46.63304, 672],
          [7.91614, 46.6333, 676],
          [7.91635, 46.63339, 677],
          [7.91715, 46.63381, 681],
          [7.91751, 46.63394, 683],
          [7.91861, 46.63421, 687],
          [7.91886, 46.63432, 687],
          [7.919, 46.63444, 688],
          [7.91927, 46.63488, 691],
          [7.91942, 46.63505, 692],
          [7.91967, 46.63521, 691],
          [7.9199, 46.63531, 694],
          [7.92028, 46.63538, 692],
          [7.9214, 46.63549, 694],
          [7.92208, 46.63561, 692],
          [7.92263, 46.63567, 690],
          [7.92289, 46.63573, 691],
          [7.92321, 46.63584, 693],
          [7.92371, 46.63617, 694],
          [7.92392, 46.63627, 695],
          [7.92425, 46.63639, 694],
          [7.92463, 46.63645, 694],
          [7.92504, 46.63645, 694],
          [7.92527, 46.63643, 694],
          [7.92706, 46.63618, 694],
          [7.92746, 46.63614, 694],
          [7.92776, 46.63614, 694],
          [7.93016, 46.63647, 693],
          [7.93053, 46.63646, 694],
          [7.93173, 46.63638, 691],
          [7.93237, 46.63638, 692],
          [7.93424, 46.63643, 692],
          [7.93903, 46.63616, 694],
          [7.94074, 46.63609, 698],
          [7.94144, 46.63615, 699],
          [7.94451, 46.63661, 705],
          [7.94746, 46.63693, 709],
          [7.94819, 46.63706, 711],
          [7.94842, 46.63715, 712],
          [7.94863, 46.63731, 712],
          [7.9487, 46.63743, 712],
          [7.9489, 46.63801, 712],
          [7.94898, 46.63811, 713],
          [7.94919, 46.63822, 714],
          [7.9494, 46.63825, 714],
          [7.95016, 46.6382, 716],
          [7.95021, 46.63826, 716],
          [7.95026, 46.63829, 716],
          [7.95066, 46.6384, 719],
          [7.95109, 46.63845, 722],
          [7.95167, 46.63859, 728],
          [7.9521, 46.63863, 732],
          [7.95235, 46.63863, 735],
          [7.95286, 46.63846, 736],
          [7.95314, 46.63843, 740],
          [7.95387, 46.63848, 748],
          [7.95446, 46.63837, 754],
          [7.95585, 46.63822, 763],
          [7.95629, 46.6382, 768],
          [7.95657, 46.63815, 771],
          [7.95687, 46.63804, 774],
          [7.95719, 46.63799, 775],
          [7.95746, 46.63802, 776],
          [7.95766, 46.63801, 778],
          [7.95817, 46.63777, 778],
          [7.95828, 46.63777, 778],
          [7.95869, 46.63787, 778],
          [7.96054, 46.63813, 787],
          [7.96141, 46.63817, 796],
          [7.96238, 46.63826, 809],
          [7.96338, 46.63829, 820],
          [7.96373, 46.63834, 824],
          [7.96409, 46.63836, 828],
          [7.96435, 46.63841, 831],
          [7.96493, 46.63844, 835],
          [7.9655, 46.63844, 843], // Lütschental
          [7.96567, 46.63842, 845],
          [7.96608, 46.63819, 847],
          [7.96613, 46.63814, 848],
          [7.9662, 46.63797, 846],
          [7.9663, 46.63791, 846],
          [7.96668, 46.63778, 848],
          [7.9673, 46.63752, 850],
          [7.96748, 46.63747, 850],
          [7.9676, 46.63746, 851],
          [7.96799, 46.63749, 852],
          [7.96798, 46.63741, 851],
          [7.96801, 46.63735, 850],
          [7.96817, 46.63736, 852],
          [7.96825, 46.63734, 853],
          [7.96854, 46.63723, 855],
          [7.9687, 46.63711, 857],
          [7.9689, 46.63689, 859],
          [7.96904, 46.63678, 860],
          [7.96922, 46.63668, 862],
          [7.96939, 46.63661, 861],
          [7.96957, 46.63657, 861],
          [7.96976, 46.63656, 862],
          [7.97082, 46.63667, 872],
          [7.97111, 46.63665, 873],
          [7.97134, 46.63657, 876],
          [7.97146, 46.6365, 877],
          [7.97175, 46.63622, 880],
          [7.97196, 46.63611, 881],
          [7.97225, 46.63606, 883],
          [7.97323, 46.63606, 889],
          [7.97342, 46.63602, 891],
          [7.97394, 46.6358, 891],
          [7.97407, 46.63578, 892],
          [7.97463, 46.63584, 894],
          [7.97493, 46.63585, 895],
          [7.97519, 46.63582, 895],
          [7.9757, 46.63571, 895],
          [7.97592, 46.63571, 896],
          [7.97893, 46.63607, 899],
          [7.97974, 46.63616, 899],
          [7.98446, 46.63636, 902],
          [7.98723, 46.63625, 904],
          [7.98824, 46.63618, 903],
          [7.99038, 46.63591, 905],
          [7.99215, 46.63574, 907],
          [7.99289, 46.63563, 907],
          [7.9936, 46.63547, 907],
          [7.99408, 46.63531, 909],
          [7.99641, 46.63436, 917], // Burglauenen
          [7.99681, 46.63416, 911],
          [7.99782, 46.63352, 914],
          [7.9981, 46.6334, 918],
          [7.99847, 46.63328, 915],
          [7.99869, 46.63323, 917],
          [7.99916, 46.63316, 922],
          [7.99962, 46.63306, 919],
          [8.00138, 46.63261, 922],
          [8.00177, 46.63248, 922],
          [8.00205, 46.63234, 922],
          [8.00238, 46.63208, 922],
          [8.00295, 46.63129, 924],
          [8.00312, 46.63114, 926],
          [8.00334, 46.63101, 927],
          [8.00406, 46.63073, 928],
          [8.00437, 46.63059, 930],
          [8.00501, 46.63024, 932],
          [8.00519, 46.63007, 933],
          [8.00526, 46.62997, 933],
          [8.00557, 46.62941, 936],
          [8.00565, 46.62931, 936],
          [8.00594, 46.6291, 938],
          [8.00617, 46.62902, 940],
          [8.00645, 46.62897, 939],
          [8.00781, 46.62891, 941],
          [8.00814, 46.62884, 941],
          [8.00844, 46.62873, 941],
          [8.00863, 46.62864, 941],
          [8.00886, 46.62845, 940],
          [8.00916, 46.62805, 941],
          [8.00929, 46.62791, 941],
          [8.00945, 46.62779, 941],
          [8.01009, 46.62748, 940],
          [8.01079, 46.62696, 941],
          [8.01098, 46.62685, 941],
          [8.01126, 46.62673, 944],
          [8.01154, 46.62667, 945],
          [8.01179, 46.62665, 945],
          [8.01317, 46.62663, 950],
          [8.01362, 46.62661, 950],
          [8.01399, 46.62654, 952],
          [8.01479, 46.62628, 956],
          [8.01511, 46.62622, 957],
          [8.01702, 46.62611, 960],
          [8.01908, 46.62581, 959],
          [8.01944, 46.62575, 961],
          [8.01954, 46.62571, 961],
          [8.01962, 46.62573, 961],
          [8.01966, 46.6258, 962],
          [8.01977, 46.62583, 963],
          [8.01984, 46.62583, 963],
          [8.02024, 46.62572, 965],
          [8.0204, 46.62571, 966],
          [8.02062, 46.62573, 967],
          [8.02085, 46.6258, 968],
          [8.02247, 46.62639, 977],
          [8.02263, 46.62644, 979],
          [8.02286, 46.62645, 980],
          [8.02315, 46.62639, 981],
          [8.02329, 46.62633, 983],
          [8.02374, 46.62593, 986],
          [8.02401, 46.62585, 987],
          [8.02433, 46.62579, 988],
          [8.02455, 46.62571, 990],
          [8.02489, 46.62548, 992],
          [8.02509, 46.62541, 994],
          [8.0259, 46.62527, 996],
          [8.02623, 46.62521, 997],
          [8.02669, 46.62517, 1000],
          [8.02696, 46.62518, 1000],
          [8.02728, 46.62523, 1002],
          [8.02795, 46.62548, 1006],
          [8.02816, 46.62551, 1007],
          [8.02839, 46.62547, 1008],
          [8.02856, 46.6254, 1009],
          [8.02946, 46.62493, 1016],
          [8.02961, 46.62489, 1017],
          [8.03012, 46.62481, 1018],
          [8.0303, 46.62476, 1019],
          [8.03066, 46.62457, 1020],
          [8.0308, 46.62452, 1021],
          [8.03128, 46.62447, 1024],
          [8.03208, 46.62428, 1028],
          [8.03278, 46.62406, 1029],
          [8.03298, 46.62405, 1030],
          [8.0331, 46.62407, 1031],
          [8.03398, 46.62436, 1033],
          [8.0341, 46.62438, 1034], // Grindelwald
        ],
      },
    ],
    // Foto-Anker liegen exakt auf der Route (auf < 1 m projiziert); Pseudo-Zeit + echtes
    // Wetter (Open-Meteo, 2025-06-21) ergeben den Tagesbogen: klarer Morgen →
    // Nachmittagsschauer im Lütschental → aufklarende goldene Stunde in Grindelwald.
    // Die letzten beiden Anker lagen auf dem Radweg-Korridor der Vorgänger-Route und
    // wären 300 m neben der Talstrasse gelandet — sie sind auf die Strasse gezogen,
    // ihr Streckenanteil (und damit Uhrzeit und Wetter) bleibt praktisch gleich.
    photos: [
      {
        src: '/photos/oberland/01-lauterbrunnen.jpg',
        title: 'Staubbachfall',
        caption: 'Erstes Licht im Tal, 300 Meter freier Fall, die Wände noch im Schatten.',
        anchor: [7.90747, 46.59479], // km 0,4 · ~06:34, klar
      },
      {
        src: '/photos/oberland/02-weisse-luetschine.jpg',
        title: 'Weisse Lütschine',
        caption: 'Talauswärts am Gletscherfluss, die Sonne steht endlich über den Felswänden.',
        anchor: [7.90186, 46.61263], // km 2,5 · ~08:31, sonnig
      },
      {
        src: '/photos/oberland/03-zweiluetschinen.jpg',
        title: 'Zweilütschinen',
        caption: 'Wo Weisse und Schwarze Lütschine sich treffen, ab hier geht es bergan.',
        anchor: [7.90494, 46.63167], // km 5,0 · ~10:47, klar
      },
      {
        src: '/photos/oberland/04-luetschental.jpg',
        title: 'Lütschental',
        caption: 'Der Nachmittag zieht zu, erste Tropfen auf der Strasse, Quellwolken über den Graten.',
        anchor: [7.96337, 46.63829], // km 9,8 · ~15:11, leichter Schauer
      },
      {
        src: '/photos/oberland/05-eiger-anfahrt.jpg',
        title: 'Vor Grindelwald',
        caption: 'Die Wolken reissen auf, die Eigernordwand tritt hervor, der lange Anstieg lohnt sich.',
        anchor: [8.01073, 46.62701], // km 14,0 · ~18:58, halb bewölkt, aufklarend
      },
      {
        src: '/photos/oberland/06-grindelwald.jpg',
        title: 'Grindelwald',
        caption: 'Goldene Stunde am Ziel, Wetterhorn und Eiger glühen über dem Dorf.',
        anchor: [8.02873, 46.62531], // km 15,5 · ~20:20, klar
      },
    ],
  },

  stockholm: {
    no: 'N°02',
    brandTitle: 'Stockholm & Schären',
    kicker: 'Ein Sommertag in',
    titleHtml: 'Stockholm<br />& Schären',
    stops: ['Gamla Stan', 'Djurgården', 'Fjäderholmarna', 'Vaxholm'],
    showFinale: true,
    finaleTitle: 'Vaxholm',
    // Spätsommertag bis in die Nacht: Sonnenuntergang ~20:10, Finale im Dunkeln
    time: { start: '2025-08-24T09:30:00+02:00', end: '2025-08-24T23:00:00+02:00', zone: 'Europe/Stockholm' },
    geoid: 22, // m: Geoid über WGS84-Ellipsoid in der Region (für den Google-3D-Testmodus)
    // Landwege: reale Straßenrouten (FOSSGIS-OSRM, Fußprofil, OSM-Wegenetz);
    // Tram: echte Gleistrasse aus OSM (railway=tram, via Overpass gestitcht)
    segments: [
      {
        mode: 'walk',
        label: 'Zu Fuß',
        pts: [
          [18.07094, 59.32491, 5], // Stortorget, Gamla Stan
          [18.0713, 59.32499, 5],
          [18.07114, 59.32566, 5], // Köpmangatan
          [18.073, 59.32593, 5],
          [18.07294, 59.32606, 5],
          [18.07307, 59.32617, 5],
          [18.07304, 59.32621, 5],
          [18.0742, 59.32641, 5], // Slottsbacken / Königspalast
          [18.07424, 59.32648, 5],
          [18.0741, 59.3266, 5],
          [18.07418, 59.32662, 5],
          [18.07265, 59.32788, 5], // Skeppsbron → Slottskajen
          [18.07228, 59.32784, 5],
          [18.07117, 59.3275, 5],
          [18.07101, 59.32764, 5],
          [18.07068, 59.32754, 5],
          [18.06981, 59.32824, 5], // Norrbro
          [18.0694, 59.32812, 5],
          [18.0694, 59.32825, 5],
          [18.06933, 59.32825, 5],
          [18.06922, 59.32847, 5],
          [18.06947, 59.32853, 5],
          [18.06946, 59.32857, 5],
          [18.06891, 59.32903, 5], // Gustav Adolfs torg
          [18.06929, 59.32916, 5],
          [18.0693, 59.32928, 5],
          [18.06913, 59.32952, 5],
          [18.06894, 59.32964, 5],
          [18.06947, 59.32984, 5],
          [18.07087, 59.3302, 5], // Kungsträdgården
          [18.07146, 59.33026, 5],
          [18.07066, 59.33161, 5],
          [18.07079, 59.33163, 5],
          [18.07038, 59.33232, 5],
          [18.07056, 59.33231, 5],
          [18.07109, 59.33239, 5],
          [18.07144, 59.3326, 5],
          [18.07137, 59.33267, 5],
          [18.0718, 59.3327, 5],
          [18.07189, 59.33278, 5],
          [18.07231, 59.33286, 5],
          [18.07343, 59.3329, 5],
          [18.07343, 59.33301, 5],
          [18.07438, 59.333, 5], // Nybroplan
          [18.07439, 59.33293, 5], // Tram-Haltestelle
        ],
      },
      {
        mode: 'tram',
        label: 'Tram 7',
        pts: [
          [18.07439, 59.33293, 5], // Nybroplan
          [18.07519, 59.33295, 5],
          [18.0755, 59.33294, 5],
          [18.0758, 59.3329, 5],
          [18.08116, 59.33148, 5], // Strandvägen (diagonale Trasse)
          [18.0816, 59.3314, 5],
          [18.09144, 59.33164, 5], // Kai-Seite
          [18.09218, 59.33173, 5],
          [18.09312, 59.33174, 5],
          [18.09338, 59.33168, 5],
          [18.09352, 59.33157, 5],
          [18.09364, 59.33138, 5], // Djurgårdsbron
          [18.09401, 59.33087, 5],
          [18.09431, 59.33027, 5], // Haltestelle Nordiska museet/Vasamuseet
        ],
      },
      {
        mode: 'walk',
        label: 'Zu Fuß',
        pts: [
          [18.09431, 59.33027, 5],
          [18.09406, 59.33021, 5],
          [18.09335, 59.33026, 5],
          [18.09296, 59.32985, 5], // Galärparken
          [18.09275, 59.32934, 5],
          [18.09243, 59.32894, 5],
          [18.09243, 59.32886, 5],
          [18.09252, 59.32879, 5],
          [18.09222, 59.32865, 5],
          [18.09227, 59.32846, 5],
          [18.09208, 59.32813, 5], // Vasamuseet
          [18.09232, 59.32774, 5],
          [18.09213, 59.32768, 5],
          [18.09216, 59.32753, 5],
          [18.09191, 59.32744, 5],
          [18.0919, 59.32726, 5],
          [18.09454, 59.3267, 5], // Djurgårdsvägen
          [18.09496, 59.32608, 5],
          [18.0955, 59.32584, 5],
          [18.0954, 59.32576, 5],
          [18.09524, 59.32544, 5],
          [18.09527, 59.32532, 5],
          [18.09587, 59.32462, 5],
          [18.09619, 59.32442, 5], // Allmänna gränd / Gröna Lund
          [18.09507, 59.32419, 5],
          [18.09452, 59.32401, 2], // Fähranleger Allmänna gränd
        ],
      },
      {
        mode: 'ferry',
        label: 'Schärenfähre',
        // Echtes Fahrwasser aus OSM (route=ferry: Pendelbåt 80/84, Waxholmsbolaget) —
        // südlich um Beckholmen, an Fjäderholmarna vorbei, durch Lilla Värtan nach Vaxholm
        pts: [
          [18.09452, 59.32401, 0], // Anleger Allmänna gränd
          [18.09379, 59.32299, 0],
          [18.09677, 59.32004, 0], // westlich um Beckholmen
          [18.09943, 59.31895, 0],
          [18.10907, 59.31772, 0], // südlich Djurgården
          [18.14289, 59.31986, 0],
          [18.15501, 59.32021, 0], // Fjäderholmarna querab
          [18.18107, 59.32665, 0],
          [18.2079, 59.33697, 0], // Lilla Värtan
          [18.22748, 59.34523, 0],
          [18.23816, 59.3495, 0],
          [18.26636, 59.35956, 0], // Höggarnsfjärden
          [18.28169, 59.36134, 0],
          [18.28552, 59.36007, 0],
          [18.29391, 59.36284, 0],
          [18.29569, 59.3681, 0],
          [18.30793, 59.37497, 0],
          [18.30868, 59.37586, 0],
          [18.30865, 59.3762, 0],
          [18.31541, 59.37618, 0],
          [18.31848, 59.37513, 0],
          [18.33318, 59.37933, 0],
          [18.3375, 59.38214, 0],
          [18.34345, 59.38417, 0],
          [18.34297, 59.38446, 0],
          [18.34236, 59.38694, 0],
          [18.34201, 59.38706, 0],
          [18.34106, 59.38843, 0],
          [18.34341, 59.39294, 0], // Anfahrt Vaxholm
          [18.35167, 59.39849, 0],
          [18.35417, 59.40184, 0], // Vaxholm Terminal (Söderhamnen)
        ],
      },
      {
        mode: 'walk',
        label: 'Zu Fuß',
        pts: [
          [18.35417, 59.40184, 3], // Vaxholm Terminal
          [18.3534, 59.40194, 5],
          [18.35283, 59.40214, 5],
          [18.35295, 59.40239, 5],
          [18.35285, 59.40246, 5],
          [18.35052, 59.40319, 6], // Hamngatan
          [18.35121, 59.40374, 6], // Rådhustorget-Richtung
          [18.35129, 59.40369, 6],
          [18.35155, 59.40389, 6],
          [18.35212, 59.40374, 6],
          [18.35315, 59.40363, 6],
          [18.35314, 59.40371, 6],
          [18.35362, 59.40391, 6], // Waterfront
          [18.35485, 59.40341, 5],
          [18.35461, 59.4038, 4], // Blick zum Kastell
        ],
      },
    ],
    photos: [
      {
        // erster Foto-Stopp jetzt am Kungsträdgården — bewusst so spät, dass der
        // Intro-Anflug abgeschlossen ist, bevor der erste Stopp auslöst
        src: '/photos/stockholm/kungstradgarden.jpg',
        title: 'Kungsträdgården',
        caption: 'Stockholms grünes Wohnzimmer, Linden, Fontäne, Sommerpause.',
        anchor: [18.07087, 59.3302],
      },
      {
        src: '/photos/stockholm/strandvagen.jpg',
        title: 'Strandvägen',
        caption: 'Aus der Tram 7: Prachtfassaden links, Segler am Kai rechts.',
        anchor: [18.086, 59.3315],
      },
      {
        src: '/photos/stockholm/02-vasa.jpg',
        title: 'Vasamuseet',
        caption: 'Ein Kriegsschiff von 1628, fast unversehrt aus dem Hafenschlamm geborgen.',
        anchor: [18.0916, 59.3281],
      },
      {
        src: '/photos/stockholm/vasa-heck.jpg',
        title: 'Galionsfiguren',
        caption: 'Vergoldete Löwen und Wappen, das Heck sollte Feinde beeindrucken.',
        anchor: [18.0916, 59.3281],
      },
      {
        src: '/photos/stockholm/grona-lund.jpg',
        title: 'Gröna Lund',
        caption: 'Kurz vor dem Ablegen, Schreie vom Freifallturm, Zuckerwatte in der Luft.',
        anchor: [18.09619, 59.32442],
      },
      {
        src: '/photos/stockholm/saltsjon.jpg',
        title: 'Saltsjön',
        caption: 'Rückblick vom Achterdeck, die Stadt versinkt langsam im Kielwasser.',
        anchor: [18.12801, 59.31892],
      },
      {
        src: '/photos/stockholm/03-schaeren.jpg',
        title: 'Fjäderholmarna',
        caption: 'Achterdeck, Kielwasser, die ersten Schären ziehen vorbei.',
        anchor: [18.154, 59.32018],
      },
      {
        src: '/photos/stockholm/hoggarnsfjarden.jpg',
        title: 'Höggarnsfjärden',
        caption: 'Offenes Wasser, Segler in der Brise, Schären bis zum Horizont.',
        anchor: [18.25202, 59.35444],
      },
      {
        src: '/photos/stockholm/kastell.jpg',
        title: 'Vaxholm Kastell',
        caption: 'Die Festung wächst aus dem Sund, die Überfahrt ist fast geschafft.',
        anchor: [18.34926, 59.39686],
      },
      {
        src: '/photos/stockholm/04-vaxholm.jpg',
        title: 'Vaxholm',
        caption: 'Pastellhäuser am Kai, das Kastell im Sund, Endstation Idylle.',
        anchor: [18.351, 59.40303],
      },
    ],
  },

  kohphangan: {
    no: 'N°03',
    brandTitle: 'Koh Pha-ngan',
    kicker: 'Von Mittag bis Mitternacht auf',
    titleHtml: 'Koh<br />Pha-ngan',
    stops: ['Thong Sala', 'Baan Tai', 'Phaeng', 'Thong Nai Pan', 'Haad Rin'],
    showFinale: true,
    finaleTitle: 'Haad Rin',
    // Vollmond-Tag 2025-05-12 (laut Open-Meteo real verregnet). Nachmittag: schwül,
    // Regen, Gewitter über dem Inselinneren (kuratiert via `weather`), abends aufklarend.
    time: { start: '2025-05-12T14:00:00+07:00', end: '2025-05-13T00:00:00+07:00', zone: 'Asia/Bangkok' },
    geoid: -31,
    // km-Marken an die ~41,8-km-Route (Sonnenuntergang ~18:40 ≙ km 19,5). An der Küste erst
    // schwül-bewölkt: der Regen setzt bewusst KURZ NACH Foto 2 ein (Haad Baan Tai, ~km 4,2 —
    // dort regnet es noch NICHT; Grenze clouds→rain bei km 5,5 ≙ ~15:14). Dann kräftiger im
    // Dschungel, Gewitter-Höhepunkt am unteren Jeep-Anstieg (Dschungelpiste, ~km 17,3 ≙ 18:08,
    // NOCH vor Sonnenuntergang) — danach klart es KURZ VOR Sonnenuntergang auf (Grenze
    // rain→clouds bei km 19,2 ≙ 18:36): der Bergkamm (~km 19,3 ≙ 18:37) liegt schon im
    // aufklarenden Abendrot, die Nacht ist klar.
    // weatherAt() schaltet an den MITTEN zwischen den Marken; die Engine rampt weich.
    weather: [
      { km: 0, mode: 'clouds', k: 0.45 },
      { km: 3, mode: 'clouds', k: 0.55 },
      { km: 4.5, mode: 'clouds', k: 0.62 },
      { km: 5, mode: 'clouds', k: 0.6 },
      { km: 6, mode: 'rain', k: 0.35 },
      { km: 9, mode: 'rain', k: 0.6 },
      { km: 14, mode: 'rain', k: 0.68 },
      { km: 16.5, mode: 'storm', k: 0.82 },
      { km: 18.8, mode: 'rain', k: 0.4 },
      { km: 19.6, mode: 'clouds', k: 0.3 },
      { km: 23, mode: 'clouds', k: 0.18 },
      { km: 28, mode: 'off', k: 0.15 },
    ],
    // Eigene Musik statt des Ambient-Loops (main.ts lässt ihn dann weg, der
    // Musik-Schalter steuert diese Spur): „Nachtfahrt" aus der Studio-Bibliothek —
    // pulsierender Synthwave, passend zur Fahrt in die Vollmondnacht.
    // gain 0.8 ≈ der bisherige Ambient-Pegel (0.22 × 0.8 ≈ 0.16).
    audio: [{ type: 'music', src: '/audio/sfx/mus-nachtfahrt.mp3', f0: 0, f1: 1, gain: 0.8 }],
    segments: [
      { mode: 'walk', label: 'Zu Fuß',  // Ankunft in Thong Sala, Bummel durch den Ort
        pts: [
          [99.9856, 9.7133, 6],
          [99.9865, 9.7129, 6],
          [99.9868, 9.71252, 6],
        ] },
      { mode: 'moped', label: 'Moped',  // Ort → Thong-Sala-Strand → Südküste (Ao Bang Charu, Haad Baan Tai) → Phaeng-Wasserfall (OSRM driving, dichte Geometrie; kurze Abstecher direkt auf den Sand an den ersten beiden Foto-Stopps)
        pts: [
          [99.98680, 9.71252, 8],
          [99.98650, 9.71246, 8],
          [99.98657, 9.71218, 8],
          [99.98533, 9.71167, 8],
          [99.98534, 9.71155, 8],
          [99.98528, 9.71145, 8],
          [99.98538, 9.71128, 8],
          [99.98610, 9.71045, 8],
          [99.98604, 9.71037, 8],
          [99.98607, 9.70965, 8],
          [99.98612, 9.70918, 8],
          [99.98615, 9.70895, 8],
          [99.98612, 9.70918, 8],
          [99.98607, 9.70965, 8],
          [99.98604, 9.71037, 8],
          [99.98614, 9.71040, 8],
          [99.98706, 9.70941, 8],
          [99.98719, 9.70930, 8],
          [99.98730, 9.70927, 8],
          [99.98891, 9.70913, 8],
          [99.98990, 9.70912, 8],
          [99.99091, 9.70916, 8],
          [99.99157, 9.70912, 8],
          [99.99192, 9.70908, 8],
          [99.99343, 9.70872, 8],
          [99.99482, 9.70836, 8],
          [99.99479, 9.70762, 8],
          [99.99439, 9.70762, 8],
          [99.99479, 9.70762, 8],
          [99.99482, 9.70836, 8],
          [99.99533, 9.70823, 8],
          [99.99559, 9.70822, 8],
          [99.99700, 9.70854, 8],
          [99.99743, 9.70860, 8],
          [99.99967, 9.70866, 8],
          [100.00183, 9.70879, 8],
          [100.00395, 9.70872, 8],
          [100.00433, 9.70863, 8],
          [100.00460, 9.70852, 8],
          [100.00569, 9.70782, 8],
          [100.00849, 9.70641, 8],
          [100.00982, 9.70561, 8],
          [100.00884, 9.70367, 8],
          [100.00982, 9.70561, 8],
          [100.00883, 9.70620, 8],
          [100.00968, 9.70772, 8],
          [100.00995, 9.71035, 8],
          [100.01038, 9.71190, 8],
          [100.01045, 9.71236, 8],
          [100.01041, 9.71259, 8],
          [100.01032, 9.71288, 8],
          [100.00969, 9.71374, 8],
          [100.00942, 9.71390, 8],
          [100.00876, 9.71411, 8],
          [100.01003, 9.71602, 8],
          [100.01013, 9.71621, 8],
          [100.01022, 9.71660, 8],
          [100.00858, 9.71704, 8],
          [100.00732, 9.71745, 8],
          [100.00773, 9.71861, 8],
          [100.00777, 9.71884, 8],
          [100.00775, 9.71919, 8],
          [100.00747, 9.72074, 8],
          [100.00680, 9.72169, 8],
          [100.00660, 9.72184, 8],
          [100.00659, 9.72252, 8],
          [100.00648, 9.72341, 8],
          [100.00649, 9.72438, 8],
          [100.00904, 9.72455, 8],
          [100.00916, 9.72472, 8],
          [100.00926, 9.72576, 8],
          [100.00913, 9.72592, 8],
          [100.00875, 9.72592, 8],
          [100.00862, 9.72599, 8],
          [100.00883, 9.72693, 8],
          [100.00903, 9.72715, 8],
          [100.00908, 9.72742, 8],
          [100.00906, 9.72759, 8],
          [100.00871, 9.72867, 8],
          [100.00879, 9.72906, 8],
          [100.00879, 9.72945, 8],
          [100.01024, 9.72943, 8],
          [100.01137, 9.72957, 8],
          [100.01152, 9.72972, 8],
          [100.01164, 9.73022, 8],
          [100.01176, 9.73096, 8],
          [100.01169, 9.73119, 8],
          [100.01197, 9.73115, 8],
          [100.01217, 9.73137, 8],
          [100.01239, 9.73179, 8],
          [100.01265, 9.73264, 8],
          [100.01250, 9.73270, 8],
          [100.01214, 9.73271, 8],
          [100.01181, 9.73261, 8],
          [100.01201, 9.73310, 8],
          [100.01212, 9.73321, 8],
          [100.01217, 9.73340, 8],
          [100.01244, 9.73356, 8],
          [100.01273, 9.73350, 8],
          [100.01299, 9.73336, 8],
          [100.01322, 9.73333, 8],
          [100.01373, 9.73349, 8],
        ] },
      { mode: 'jeep', label: 'Jeep 4×4',
        // Echte Bergstrecke (OSRM Fuß-Routing über die realen Tracks/Pfade des Insel-
        // kerns): vom Phaeng-Sporn den berüchtigten Beton-Steilrampen-Kamm hinauf
        // (surface=concrete:plates, Pass ~290 m) und die Serpentinen nach Thong Nai Pan
        // hinab. Dichte Geometrie (overview=full, leicht RDP-gefiltert), damit die
        // Kamera exakt auf der Piste bleibt statt daneben. 17,4 km. Höhen grob
        // modelliert (elevation.ts überschreibt mit DEM-Werten).
        pts: [
          [100.01373, 9.73349, 60],
          [100.01322, 9.73333, 60],
          [100.01244, 9.73356, 55],
          [100.01217, 9.73340, 55],
          [100.01181, 9.73261, 52],
          [100.01214, 9.73271, 52],
          [100.01265, 9.73264, 49],
          [100.01217, 9.73137, 45],
          [100.01197, 9.73115, 43],
          [100.01169, 9.73119, 43],
          [100.01176, 9.73096, 43],
          [100.01164, 9.73022, 38],
          [100.01152, 9.72972, 38],
          [100.01137, 9.72957, 38],
          [100.01024, 9.72943, 38],
          [100.00879, 9.72945, 30],
          [100.00873, 9.72856, 30],
          [100.00906, 9.72759, 31],
          [100.00903, 9.72715, 31],
          [100.00915, 9.72707, 31],
          [100.01044, 9.72694, 32],
          [100.01043, 9.72745, 32],
          [100.01052, 9.72754, 32],
          [100.01079, 9.72755, 32],
          [100.01113, 9.72744, 32],
          [100.01152, 9.72756, 32],
          [100.01195, 9.72725, 32],
          [100.01191, 9.72698, 32],
          [100.01201, 9.72682, 33],
          [100.01278, 9.72654, 33],
          [100.01285, 9.72621, 33],
          [100.01274, 9.72585, 33],
          [100.01284, 9.72537, 34],
          [100.01265, 9.72490, 34],
          [100.01267, 9.72471, 34],
          [100.01276, 9.72465, 34],
          [100.01290, 9.72477, 34],
          [100.01331, 9.72488, 34],
          [100.01384, 9.72483, 34],
          [100.01401, 9.72504, 34],
          [100.01451, 9.72476, 34],
          [100.01447, 9.72458, 34],
          [100.01406, 9.72462, 34],
          [100.01384, 9.72403, 35],
          [100.01403, 9.72374, 35],
          [100.01398, 9.72254, 36],
          [100.01404, 9.72238, 36],
          [100.01437, 9.72225, 36],
          [100.01444, 9.72208, 36],
          [100.01434, 9.72194, 36],
          [100.01388, 9.72176, 36],
          [100.01383, 9.72074, 37],
          [100.01392, 9.72063, 37],
          [100.01376, 9.72041, 37],
          [100.01381, 9.72018, 37],
          [100.01369, 9.71990, 37],
          [100.01326, 9.71997, 37],
          [100.01288, 9.71983, 37],
          [100.01284, 9.71970, 37],
          [100.01317, 9.71942, 37],
          [100.01317, 9.71833, 37],
          [100.01331, 9.71820, 37],
          [100.01354, 9.71702, 38],
          [100.01368, 9.71702, 38],
          [100.01378, 9.71646, 38],
          [100.01558, 9.71667, 39],
          [100.01627, 9.71611, 40],
          [100.01637, 9.71583, 40],
          [100.01626, 9.71529, 40],
          [100.01639, 9.71474, 40],
          [100.01713, 9.71352, 41],
          [100.01725, 9.71284, 41],
          [100.01764, 9.71256, 41],
          [100.01826, 9.71245, 41],
          [100.01879, 9.71345, 42],
          [100.01866, 9.71401, 42],
          [100.01866, 9.71464, 42],
          [100.01892, 9.71575, 43],
          [100.01881, 9.71607, 43],
          [100.01873, 9.71707, 43],
          [100.02020, 9.71709, 44],
          [100.02124, 9.71687, 44],
          [100.02207, 9.71719, 44],
          [100.02301, 9.71726, 48],
          [100.02374, 9.71746, 48],
          [100.02388, 9.71694, 50],
          [100.02411, 9.71672, 50],
          [100.02480, 9.71640, 50],
          [100.02553, 9.71626, 57],
          [100.02603, 9.71581, 57],
          [100.02643, 9.71562, 57],
          [100.02684, 9.71596, 57],
          [100.02718, 9.71592, 60],
          [100.02735, 9.71617, 60],
          [100.02760, 9.71709, 60],
          [100.02784, 9.71724, 60],
          [100.02788, 9.71785, 69],
          [100.02797, 9.71809, 69],
          [100.02828, 9.71835, 69],
          [100.02843, 9.71835, 69],
          [100.02861, 9.71856, 69],
          [100.02882, 9.71896, 69],
          [100.02876, 9.71930, 69],
          [100.02940, 9.71919, 72],
          [100.02963, 9.71924, 72],
          [100.02973, 9.71947, 72],
          [100.02970, 9.71977, 73],
          [100.02982, 9.71981, 73],
          [100.03005, 9.71973, 73],
          [100.03043, 9.71980, 73],
          [100.03070, 9.71973, 78],
          [100.03148, 9.71939, 78],
          [100.03182, 9.71910, 78],
          [100.03210, 9.71873, 81],
          [100.03242, 9.71856, 81],
          [100.03293, 9.71872, 83],
          [100.03305, 9.71822, 83],
          [100.03268, 9.71751, 86],
          [100.03372, 9.71736, 90],
          [100.03397, 9.71740, 90],
          [100.03410, 9.71761, 90],
          [100.03439, 9.71880, 94],
          [100.03459, 9.71895, 94],
          [100.03532, 9.71909, 94],
          [100.03627, 9.71952, 100],
          [100.03649, 9.71971, 100],
          [100.03647, 9.71991, 100],
          [100.03607, 9.72020, 103],
          [100.03605, 9.72069, 103],
          [100.03729, 9.72125, 108],
          [100.03753, 9.72145, 108],
          [100.03789, 9.72241, 110],
          [100.03764, 9.72291, 113],
          [100.03762, 9.72316, 113],
          [100.03799, 9.72350, 113],
          [100.03882, 9.72394, 116],
          [100.03892, 9.72413, 116],
          [100.03905, 9.72505, 120],
          [100.03962, 9.72598, 125],
          [100.04015, 9.72654, 125],
          [100.04025, 9.72676, 125],
          [100.04015, 9.72706, 125],
          [100.03957, 9.72761, 131],
          [100.03932, 9.72812, 131],
          [100.03901, 9.72841, 131],
          [100.03901, 9.72882, 133],
          [100.03911, 9.72898, 133],
          [100.04075, 9.73002, 138],
          [100.04241, 9.72999, 142],
          [100.04307, 9.72976, 142],
          [100.04371, 9.72967, 147],
          [100.04403, 9.72949, 147],
          [100.04493, 9.72812, 156],
          [100.04552, 9.72765, 156],
          [100.04624, 9.72764, 161],
          [100.04660, 9.72785, 161],
          [100.04674, 9.72834, 161],
          [100.04633, 9.73042, 176],
          [100.04657, 9.73079, 176],
          [100.04658, 9.73097, 176],
          [100.04623, 9.73145, 176],
          [100.04592, 9.73229, 188],
          [100.04592, 9.73257, 188],
          [100.04565, 9.73310, 188],
          [100.04586, 9.73365, 188],
          [100.04645, 9.73420, 196],
          [100.04658, 9.73458, 196],
          [100.04659, 9.73595, 196],
          [100.04669, 9.73630, 196],
          [100.04655, 9.73681, 196],
          [100.04655, 9.73831, 219],
          [100.04666, 9.73942, 219],
          [100.04766, 9.74089, 234],
          [100.04783, 9.74145, 234],
          [100.04816, 9.74209, 234],
          [100.04866, 9.74240, 234],
          [100.04938, 9.74303, 242],
          [100.05002, 9.74424, 242],
          [100.05052, 9.74473, 258],
          [100.05102, 9.74554, 258],
          [100.05110, 9.74587, 258],
          [100.05116, 9.74718, 258],
          [100.05097, 9.74797, 277],
          [100.05108, 9.74942, 277],
          [100.05098, 9.74993, 277],
          [100.05041, 9.75080, 282],
          [100.04959, 9.75109, 290],
          [100.04918, 9.75144, 290],
          [100.04896, 9.75203, 290],
          [100.04892, 9.75326, 278],
          [100.04833, 9.75358, 278],
          [100.04706, 9.75457, 262],
          [100.04685, 9.75495, 262],
          [100.04675, 9.75594, 242],
          [100.04630, 9.75648, 242],
          [100.04606, 9.75706, 242],
          [100.04578, 9.75728, 242],
          [100.04498, 9.75718, 230],
          [100.04443, 9.75729, 230],
          [100.04423, 9.75755, 230],
          [100.04396, 9.75835, 221],
          [100.04381, 9.75946, 211],
          [100.04445, 9.76094, 211],
          [100.04464, 9.76197, 190],
          [100.04491, 9.76238, 190],
          [100.04478, 9.76307, 190],
          [100.04483, 9.76412, 177],
          [100.04439, 9.76476, 177],
          [100.04368, 9.76745, 151],
          [100.04365, 9.76950, 136],
          [100.04378, 9.77013, 136],
          [100.04415, 9.77099, 125],
          [100.04428, 9.77116, 125],
          [100.04470, 9.77135, 118],
          [100.04486, 9.77152, 118],
          [100.04507, 9.77262, 110],
          [100.04619, 9.77352, 100],
          [100.04694, 9.77313, 100],
          [100.04767, 9.77208, 86],
          [100.04852, 9.77232, 80],
          [100.04866, 9.77230, 80],
          [100.04923, 9.77173, 74],
          [100.05066, 9.77166, 64],
          [100.05117, 9.77145, 64],
          [100.05186, 9.77090, 64],
          [100.05225, 9.77081, 64],
          [100.05285, 9.77085, 64],
          [100.05332, 9.77071, 28],
          [100.05561, 9.76940, 28],
          [100.05643, 9.76918, 28],
          [100.05748, 9.76908, 15],
          [100.05789, 9.76976, 6],
          [100.05821, 9.76959, 6],
          [100.05820, 9.77020, 6],
        ] },
      { mode: 'walk', label: 'Zu Fuß',  // Strandweg zum Longtail-Steg
        pts: [
          [100.0582, 9.7702, 4],
          [100.06, 9.7699, 4],
        ] },
      { mode: 'ferry', label: 'Longtail-Boot',  // Longtail die Ostküste hinab, östlich an Haad Rin Nok
        pts: [
          [100.06, 9.7699, 0],
          [100.0605, 9.7725, 0],
          [100.063, 9.7752, 0],
          [100.07, 9.7752, 0],
          [100.0785, 9.7715, 0],
          [100.0825, 9.7655, 0],
          [100.07929, 9.76, 0],
          [100.08142, 9.753, 0],
          [100.08383, 9.746, 0],
          [100.08511, 9.739, 0],
          [100.08461, 9.732, 0],
          [100.08409, 9.725, 0],
          [100.08361, 9.718, 0],
          [100.08345, 9.711, 0],
          [100.08482, 9.704, 0],
          [100.08412, 9.697, 0],
          [100.08276, 9.69, 0],
          [100.08289, 9.683, 0],
          [100.0715, 9.6772, 0],
          [100.07, 9.6768, 0],
          [100.0688, 9.67667, 0],
        ] },
      { mode: 'walk', label: 'Zu Fuß',  // an Land am Sunrise Beach zur Full Moon Party
        pts: [
          [100.0688, 9.67667, 3],
          [100.0682, 9.67655, 3],
          [100.0678, 9.67635, 3],
        ] },
    ],
    photos: [
      {
        src: '/photos/kohphangan/01-thong-sala.jpg',
        title: 'Thong Sala',
        caption: 'Ankunft am Strand von Thong Sala, schwüle Luft, über dem Golf türmen sich dunkle Wolken, das Gewitter kündigt sich an.',
        anchor: [99.98615, 9.70895], // ~14:12 · auf dem Sand des Thong-Sala-Stadtstrands (nicht am Pier/Wasser)
      },
      {
        src: '/photos/kohphangan/02-baan-tai.jpg',
        title: 'Haad Baan Tai',
        caption: 'Südküste bei Baan Tai, schwüler grauer Himmel über bleigrauem Meer, die Palmen hängen reglos; der Regen braut sich noch in der Ferne zusammen.',
        anchor: [100.00884, 9.70367], // ~15:03 · coast · noch trocken, Regen setzt km 4,75 danach ein
      },
      {
        src: '/photos/kohphangan/03-phaeng.jpg',
        title: 'Nam Tok Phaeng',
        caption: 'Phaeng-Wasserfall im Inselinneren, Regenguss im Dschungel, der Fall führt braunes Hochwasser.',
        anchor: [100.014, 9.7339], // interior
      },
      {
        src: '/photos/kohphangan/04-dschungelbach.jpg',
        title: 'Dschungelbach',
        caption: 'Tief im tropfenden Regenwald quert die Piste einen angeschwollenen Bach, der Jeep pflügt durchs lehmbraune Wasser, Regen rauscht durchs Blätterdach, Nebel hängt zwischen den Stämmen.',
        anchor: [100.0172, 9.7134], // interior · ~17:15 · Jeep-Aufstieg im Regen
      },
      {
        src: '/photos/kohphangan/05-dschungelpiste.jpg',
        title: 'Dschungelpiste',
        caption: 'Die Betonrampe hinauf in den Inselkern, der Jeep wühlt sich durch rotbraune Pfützen, Regen peitscht durchs Scheinwerferlicht, Donner grollt über dem Kamm.',
        anchor: [100.03753, 9.72145], // interior · unterer Anstieg · Gewitter-Höhepunkt (~18:10)
      },
      {
        src: '/photos/kohphangan/06-bergpiste.jpg',
        title: 'Bergkamm',
        caption: 'Oben auf dem Kamm reißt das Gewitter auf, die letzten Wolken glühen im Abendrot, die nasse Betonrampe glänzt, tief unten dampft der Dschungel.',
        anchor: [100.04633, 9.72766], // interior · echter Grat-Hochpunkt (~326 m) · Aufklaren am Sonnenuntergang (~18:37)
      },
      {
        src: '/photos/kohphangan/07-daemmerung.jpg',
        title: 'Blaue Stunde',
        caption: 'Kammabfahrt zur Ostküste, 40 Minuten nach Sonnenuntergang glüht ein letzter Streifen Violett überm Golf, das Gewitter ist durchgezogen, der Vollmond steigt durch die aufreissenden Wolken; tief unten öffnet sich die Bucht von Thong Nai Pan.',
        anchor: [100.0494, 9.7512], // interior · Jeep-Abfahrt NO-Flanke (~291 m) · ~19:20 · blaue Stunde, Aufklaren nach dem Gewitter
      },
      {
        src: '/photos/kohphangan/08-thong-nai-pan.jpg',
        title: 'Thong Nai Pan',
        caption: 'Das Gewitter ist durchgezogen, über der Doppelbucht reißen die Wolken auf, der volle Mond steigt übers Meer und legt einen Silberpfad auf den nassen Sand.',
        anchor: [100.0582, 9.7702], // land · Einbruch der Nacht
      },
      {
        src: '/photos/kohphangan/09-ostkueste.jpg',
        title: 'Wilde Ostküste',
        caption: 'Die einsame Ostküste hinab, der Longtail tuckert unter dem Vollmond an schwarzen Dschungelbergen und verborgenen Buchten (Than Sadet) vorbei, Mondlicht zittert auf dem Wasser.',
        anchor: [100.07947, 9.75823], // water · ~21:24, füllt die lange Boot-Lücke
      },
      {
        src: '/photos/kohphangan/10-longtail.jpg',
        title: 'Auf dem Golf',
        caption: 'Longtail auf dem Golf, der Regen ist vorbei, unter dichten Wolken gleitet das Boot durch die dunkle Nacht über den weiten Golf.',
        anchor: [100.0845, 9.718], // water
      },
      {
        src: '/photos/kohphangan/11-vor-haad-rin.jpg',
        title: 'Vor Haad Rin',
        caption: 'Klare Nacht vor der Ostküste, der volle Mond steht hoch, vorn tauchen die Lichter von Haad Rin auf.',
        anchor: [100.08, 9.686], // water
      },
      {
        src: '/photos/kohphangan/12-haad-rin.jpg',
        title: 'Haad Rin',
        caption: 'Mitternacht am Sunrise Beach, Feuertänzer, Bass und Neon, der Vollmond überm Meer: die Full Moon Party.',
        anchor: [100.0679, 9.67635], // land
      },
    ],
  },
} satisfies Record<string, TourConfig>
