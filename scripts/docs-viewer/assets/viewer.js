/*
 * Das bisschen Verhalten, das der Viewer braucht: Suche, Scrollspy im
 * Inhaltsverzeichnis, Lesefortschritt und die Hervorhebung in der Verweis-Karte.
 *
 * KLASSISCHES SKRIPT, kein Modul, kein fetch. Der Viewer wird als Datei
 * geöffnet (`file://`); dort verweigert Chrome beides, und die Suche stünde
 * ohne Index da. Der Index kommt deshalb als `assets/index.js`, das vor dieser
 * Datei geladen wird und `window.DOCS_INDEX` setzt.
 */
;(function () {
  'use strict'

  var auf = document.body.getAttribute('data-auf') || ''
  var index = window.DOCS_INDEX || []

  /* ── Schwebende Schichten ──────────────────────────────────────────────
   * EINE Stelle für alles, was über der Seite liegt: Menüs, Klappen, später
   * Tooltips.
   *
   * Die Regel dahinter, dreimal schmerzhaft gelernt: Ein Overlay, das im DOM
   * dort hängt, wo sein Griff sitzt, wird früher oder später abgeschnitten.
   * Schuld ist selten der z-index — schuld sind die Vorfahren:
   *
   *   - `overflow: hidden` (Karten mit runden Ecken, Aufklapper, Gitter),
   *   - `backdrop-filter` (Kopfleiste, Glas-Panels): Chrome clippt die
   *     Nachfahren eines solchen Elements auf dessen eigene Fläche,
   *   - jeder `transform`/`filter`-Vorfahre, der `position: fixed` bricht.
   *
   * Deshalb: beim Öffnen an den `body` hängen, `position: fixed`, Position aus
   * dem Griff berechnen — und dabei in den Viewport klemmen, sonst hängt das
   * Menü am unteren Rand halb draußen.
   */
  var schwebendOffen = null

  function schliesseSchwebend() {
    if (!schwebendOffen) return
    var s = schwebendOffen
    schwebendOffen = null
    s.schicht.hidden = true
    if (s.griff) s.griff.setAttribute('aria-expanded', 'false')
    if (s.wurzel) s.wurzel.classList.remove('offen')
    if (s.beimSchliessen) s.beimSchliessen()
  }

  /**
   * @param schicht  das Overlay-Element
   * @param griff    das anklickbare Element, an dem es hängt
   * @param opt      { wurzel, beimSchliessen }
   */
  function zeigeSchwebend(schicht, griff, opt) {
    opt = opt || {}
    schliesseSchwebend()
    if (schicht.parentElement !== document.body) {
      document.body.appendChild(schicht)
      schicht.classList.add('schwebt')
    }
    schicht.hidden = false

    // Erst sichtbar machen, dann messen: Ein `hidden`-Element hat keine Größe,
    // und ohne Größe kann man nicht entscheiden, ob es nach unten passt.
    var g = griff.getBoundingClientRect()
    var s = schicht.getBoundingClientRect()
    var rand = 10
    var platzUnten = window.innerHeight - g.bottom - rand
    var nachOben = platzUnten < s.height && g.top - rand > s.height
    var oben = nachOben ? g.top - s.height - 6 : g.bottom + 6
    oben = Math.max(rand, Math.min(oben, window.innerHeight - s.height - rand))
    // Rechtsbündig zum Griff, aber niemals über den Rand hinaus.
    var links = opt.zentriert
      ? g.left + g.width / 2 - s.width / 2
      : opt.breiteWie
        ? g.left
        : Math.min(g.right - s.width, window.innerWidth - s.width - rand)
    links = Math.min(links, window.innerWidth - s.width - rand)
    links = Math.max(rand, links)

    schicht.style.top = Math.round(oben) + 'px'
    schicht.style.left = Math.round(links) + 'px'
    // Ein Auswahlfeld sieht falsch aus, wenn seine Liste schmaler ist als der
    // Griff darüber — sie gehört zu ihm, nicht daneben.
    if (opt.breiteWie) schicht.style.minWidth = Math.round(opt.breiteWie.offsetWidth) + 'px'
    if (griff.hasAttribute('aria-expanded')) griff.setAttribute('aria-expanded', 'true')
    if (opt.wurzel) opt.wurzel.classList.add('offen')
    schwebendOffen = {
      schicht: schicht,
      griff: griff,
      wurzel: opt.wurzel,
      beimSchliessen: opt.beimSchliessen,
    }
  }

  function istOffen(schicht) {
    return !!schwebendOffen && schwebendOffen.schicht === schicht
  }

  document.addEventListener('click', schliesseSchwebend)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') schliesseSchwebend()
  })

  /* Die Hinweis-Tupfer sind dieselbe Sorte Schicht wie die Menüs — und waren
     dieselbe Falle: Im Glas-Panel der Karte (backdrop-filter) und in der
     Fußzeile lag die Blase halb außerhalb des Bildes. */
  ;[].slice.call(document.querySelectorAll('.hinweis')).forEach(function (h) {
    var griff = h.querySelector('button')
    var blase = h.querySelector('.hinweis-blase')
    if (!griff || !blase) return
    var zeige = function () {
      zeigeSchwebend(blase, griff, { zentriert: true })
    }
    griff.addEventListener('mouseenter', zeige)
    griff.addEventListener('focus', zeige)
    griff.addEventListener('click', function (e) {
      e.stopPropagation()
      if (istOffen(blase)) schliesseSchwebend()
      else zeige()
    })
    griff.addEventListener('mouseleave', function () {
      if (istOffen(blase) && document.activeElement !== griff) schliesseSchwebend()
    })
    griff.addEventListener('blur', function () {
      if (istOffen(blase)) schliesseSchwebend()
    })
  })
  // Beim Scrollen mitwandern wäre die halbe Lösung: Der Griff verschwindet
  // dabei aus dem Bild, das Menü stünde ohne Bezug da. Also zu.
  window.addEventListener('scroll', schliesseSchwebend, true)
  window.addEventListener('resize', schliesseSchwebend)

  /* ── Auswahlfelder ────────────────────────────────────────────────────
   * Ein eigenes Dropdown über dem echten `<select>`.
   *
   * Das native Feld BLEIBT im DOM und behält den Wert: Es ist die Wahrheit,
   * an der die Filter hängen, und ohne Skript ist es weiterhin bedienbar. Das
   * Sichtbare ist nur eine Hülle davor — Browser gestalten `<select>` und vor
   * allem seine aufgeklappte Liste kaum, und ein Fokusring in Systemblau neben
   * amberfarbenen Chips ist der Bruch, den man zuerst sieht.
   *
   * Die Liste ist eine schwebende Schicht wie jedes andere Overlay hier (s.
   * „Schwebende Schichten"), also am body und in den Viewport geklemmt.
   */
  function schmueckeAuswahl(feld) {
    if (feld.dataset.geschmueckt) return
    feld.dataset.geschmueckt = '1'
    var huelle = feld.closest('.filterwahl, .karte-teilwahl, .wz-gruppe') || feld.parentElement
    huelle.classList.add('hat-auswahl')

    var griff = document.createElement('button')
    griff.type = 'button'
    griff.className = 'auswahl-griff'
    griff.setAttribute('aria-haspopup', 'listbox')
    griff.setAttribute('aria-expanded', 'false')
    var text = document.createElement('span')
    text.className = 'auswahl-wert'
    griff.appendChild(text)
    griff.insertAdjacentHTML(
      'beforeend',
      '<svg class="auswahl-winkel" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 2.5 L6 6.5 L11 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    )

    var liste = document.createElement('div')
    liste.className = 'auswahl-liste'
    liste.setAttribute('role', 'listbox')
    liste.hidden = true

    var optionen = [].slice.call(feld.options).map(function (o) {
      var eintrag = document.createElement('button')
      eintrag.type = 'button'
      eintrag.className = 'auswahl-eintrag'
      eintrag.setAttribute('role', 'option')
      eintrag.dataset.wert = o.value
      // Die Zahl in Klammern wird eigenständig gesetzt: In einer Liste ist sie
      // eine Spalte, kein Teil des Namens.
      var teile = /^(.*?)\s*\((\d+)\)\s*$/.exec(o.textContent)
      eintrag.innerHTML = teile
        ? '<span>' + teile[1] + '</span><b>' + teile[2] + '</b>'
        : '<span>' + o.textContent + '</span>'
      liste.appendChild(eintrag)
      return { o: o, el: eintrag }
    })

    var zeigeWert = function () {
      var gewaehlt = feld.options[feld.selectedIndex]
      text.textContent = gewaehlt ? gewaehlt.textContent.replace(/\s*\(\d+\)$/, '') : ''
      // Nur FILTER färben sich ein: Eine Sortierung schränkt nichts ein, und
      // ein amberfarbenes Feld ließe eine vollständige Liste unvollständig
      // aussehen.
      const filtert =
        feld.dataset.sortierung === undefined && feld.value !== 'alle' && feld.value !== ''
      huelle.classList.toggle('gefiltert', filtert)
      optionen.forEach(function (p) {
        p.el.classList.toggle('gewaehlt', p.o.value === feld.value)
        p.el.setAttribute('aria-selected', p.o.value === feld.value ? 'true' : 'false')
      })
    }
    zeigeWert()

    var waehle = function (wert) {
      feld.value = wert
      zeigeWert()
      // Das echte Feld meldet die Änderung — daran hängt die Filterlogik, und
      // sie soll nichts von dieser Hülle wissen müssen.
      feld.dispatchEvent(new Event('change', { bubbles: true }))
      schliesseSchwebend()
      griff.focus()
    }

    optionen.forEach(function (p) {
      p.el.addEventListener('click', function (e) {
        e.stopPropagation()
        waehle(p.o.value)
      })
    })

    griff.addEventListener('click', function (e) {
      e.stopPropagation()
      if (istOffen(liste)) return schliesseSchwebend()
      zeigeSchwebend(liste, huelle, { wurzel: huelle, breiteWie: huelle })
    })
    griff.addEventListener('keydown', function (e) {
      var i = feld.selectedIndex
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        // Zu ohne offene Liste heißt: durchsteppen. Das ist das Verhalten
        // jedes nativen Feldes, und wer es kennt, vermisst es sofort.
        var neu = Math.min(optionen.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
        waehle(feld.options[neu].value)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        griff.click()
      }
    })

    feld.insertAdjacentElement('afterend', griff)
    huelle.appendChild(liste)
  }

  ;[].slice.call(document.querySelectorAll('select')).forEach(schmueckeAuswahl)

  /* ── Suche ─────────────────────────────────────────────────────────────
   * Bewertet wird nach Fundstelle, nicht nach Häufigkeit: ein Treffer im
   * Titel schlägt zehn im Fließtext. Sonst gewinnt immer das längste
   * Dokument, und das ist nie die Antwort. */

  var schicht = document.querySelector('[data-such-schicht]')
  var feld = document.querySelector('[data-such-feld]')
  var liste = document.querySelector('[data-such-treffer]')
  var gewaehlt = 0

  function bewerte(eintrag, suche) {
    var punkte = 0
    var titel = eintrag.t.toLowerCase()
    if (titel === suche) punkte += 160
    if (titel.indexOf(suche) === 0) punkte += 90
    else if (titel.indexOf(suche) >= 0) punkte += 70
    if (eintrag.k.toLowerCase().indexOf(suche) >= 0) punkte += 18
    // „android" oder „studio" findet, was diesen Teil betrifft.
    if ((eintrag.s || []).join(' ').toLowerCase().indexOf(suche) >= 0) punkte += 26
    // Abschnitte zählen EINMAL, nicht je Fundstelle: Sonst schlägt ein langes
    // Dokument mit sechs beiläufigen Erwähnungen das Dokument, das genau so
    // heißt („video" fand zuerst den Zeitleisten-Umbau, nicht den Video-Export).
    var abschnitt = null
    for (var i = 0; i < eintrag.u.length; i++) {
      if (eintrag.u[i].t.toLowerCase().indexOf(suche) >= 0) {
        if (!abschnitt) {
          abschnitt = eintrag.u[i]
          punkte += 24
        }
      }
    }
    var stelle = eintrag.v.indexOf(suche)
    if (stelle >= 0) punkte += 8
    // Archiviertes rutscht hinter Gleichwertiges, verschwindet aber nicht:
    // Manchmal IST die alte Begründung die Antwort.
    if (eintrag.a && punkte > 0) punkte = Math.max(1, punkte - 30)
    return { punkte: punkte, abschnitt: abschnitt, stelle: stelle }
  }

  function auszug(eintrag, stelle, suche) {
    if (stelle < 0) return eintrag.k
    var von = Math.max(0, stelle - 46)
    var text = eintrag.v.slice(von, stelle + suche.length + 74)
    return (von > 0 ? '…' : '') + text + '…'
  }

  function hervor(text, suche) {
    var sicher = text.replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]
    })
    if (!suche) return sicher
    var regel = new RegExp(suche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig')
    return sicher.replace(regel, function (m) {
      return '<mark>' + m + '</mark>'
    })
  }

  function zeichneTreffer() {
    if (!liste) return
    var suche = feld.value.trim().toLowerCase()
    if (suche.length < 2) {
      liste.innerHTML = index
        .slice(0, 8)
        .map(function (e) {
          return (
            '<li><a href="' +
            auf +
            e.z +
            '"><b>' +
            hervor(e.t, '') +
            '</b><small>' +
            e.b +
            '</small></a></li>'
          )
        })
        .join('')
      gewaehlt = 0
      markiere()
      return
    }
    var treffer = []
    for (var i = 0; i < index.length; i++) {
      var w = bewerte(index[i], suche)
      if (w.punkte > 0) treffer.push({ e: index[i], w: w })
    }
    treffer.sort(function (a, b) {
      return b.w.punkte - a.w.punkte
    })
    liste.innerHTML = treffer.length
      ? treffer
          .slice(0, 12)
          .map(function (t) {
            var ziel = auf + t.e.z + (t.w.abschnitt ? '#' + t.w.abschnitt.i : '')
            var unter = t.w.abschnitt
              ? t.e.b + ' · ' + hervor(t.w.abschnitt.t, suche)
              : hervor(auszug(t.e, t.w.stelle, suche), suche)
            var marke = t.e.a ? '<span class="treffer-archiv">Archiv</span>' : ''
            var teile = (t.e.s || []).length ? ' · ' + t.e.s.slice(0, 2).join(', ') : ''
            return (
              '<li' +
              (t.e.a ? ' class="ist-archiv"' : '') +
              '><a href="' +
              ziel +
              '"><b>' +
              marke +
              hervor(t.e.t, suche) +
              '</b><small>' +
              unter +
              teile +
              '</small></a></li>'
            )
          })
          .join('')
      : '<li><a><b>Nichts gefunden</b><small>Anderes Wort versuchen.</small></a></li>'
    gewaehlt = 0
    markiere()
  }

  function markiere() {
    var eintraege = liste ? liste.querySelectorAll('li') : []
    for (var i = 0; i < eintraege.length; i++)
      eintraege[i].classList.toggle('gewaehlt', i === gewaehlt)
  }

  function oeffneSuche() {
    if (!schicht) return
    schicht.hidden = false
    feld.value = ''
    zeichneTreffer()
    feld.focus()
  }

  function schliesseSuche() {
    if (schicht) schicht.hidden = true
  }

  // Mehrere Griffe öffnen dieselbe Suche: der Knopf im Kopf, der große Knopf
  // im Titel und der Ausweg unter einer leeren Trefferliste.
  var knoepfe = document.querySelectorAll('[data-suche-oeffnen]')
  for (var ki = 0; ki < knoepfe.length; ki++) knoepfe[ki].addEventListener('click', oeffneSuche)
  if (schicht)
    schicht.addEventListener('click', function (e) {
      if (e.target === schicht) schliesseSuche()
    })
  if (feld) {
    feld.addEventListener('input', zeichneTreffer)
    feld.addEventListener('keydown', function (e) {
      var eintraege = liste.querySelectorAll('li')
      if (e.key === 'ArrowDown') {
        gewaehlt = Math.min(gewaehlt + 1, eintraege.length - 1)
        markiere()
        e.preventDefault()
      } else if (e.key === 'ArrowUp') {
        gewaehlt = Math.max(gewaehlt - 1, 0)
        markiere()
        e.preventDefault()
      } else if (e.key === 'Enter') {
        var link = eintraege[gewaehlt] && eintraege[gewaehlt].querySelector('a')
        if (link && link.href) location.href = link.href
      }
    })
  }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      schicht && schicht.hidden ? oeffneSuche() : schliesseSuche()
    } else if (e.key === 'Escape') {
      schliesseSuche()
    } else if (
      e.key === '/' &&
      document.activeElement === document.body &&
      schicht &&
      schicht.hidden
    ) {
      e.preventDefault()
      oeffneSuche()
    }
  })

  /* ── Schreiben: bearbeiten, archivieren, zurückholen ──────────────────
   * Nur wenn die Seite über HTTP kam — als Datei geöffnet gibt es keinen
   * Dienst, der antworten könnte. `body.mit-dienst` schaltet die Knöpfe
   * sichtbar; im Markup stehen sie immer, damit dieselbe Ausgabe beide Wege
   * bedient. */

  var mitDienst = location.protocol === 'http:' || location.protocol === 'https:'
  if (mitDienst) document.body.classList.add('mit-dienst')

  function melde(text, schlimm) {
    var tafel = document.querySelector('.meldung')
    if (!tafel) {
      tafel = document.createElement('div')
      tafel.className = 'meldung'
      document.body.appendChild(tafel)
    }
    tafel.textContent = text
    tafel.classList.toggle('schlimm', !!schlimm)
    tafel.classList.add('sichtbar')
    clearTimeout(tafel._zeit)
    tafel._zeit = setTimeout(
      function () {
        tafel.classList.remove('sichtbar')
      },
      schlimm ? 6000 : 2600,
    )
  }

  function ruf(aktion, daten) {
    return fetch(auf + 'api/' + aktion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(daten || {}),
    })
      .then(function (a) {
        return a.json()
      })
      .then(function (a) {
        if (!a.ok) throw new Error(a.meldung || 'Fehlgeschlagen')
        return a
      })
  }

  /* ── Datei, Editor, Name ──────────────────────────────────────────────
   * Drei Dinge am selben Ort: WO steht das, WIE öffne ich es, WIE heißt es.
   * Das Kopieren geht auch ohne Dienst — es ist eine Zeichenkette und braucht
   * niemanden, der antwortet. Öffnen und Umbenennen brauchen ihn.
   */

  // `wort` benennt, WAS kopiert wurde — Pfad, wo nichts dabeisteht, und
  // „Commit" beim Verlauf. Eine Meldung „Pfad kopiert: 30cae4f" wäre falsch.
  function kopierePfad(pfad, wort) {
    var fertig = function () {
      melde((wort || 'Pfad') + ' kopiert: ' + pfad)
    }
    if (navigator.clipboard && navigator.clipboard.writeText)
      return navigator.clipboard.writeText(pfad).then(fertig, ersatzKopie)
    ersatzKopie()

    // Ohne Zwischenablage-Recht (älterer Browser, unsicherer Kontext) bleibt
    // der Weg über eine Auswahl. Er ist hässlich und funktioniert überall.
    function ersatzKopie() {
      var feld = document.createElement('textarea')
      feld.value = pfad
      feld.setAttribute('readonly', '')
      feld.style.position = 'fixed'
      feld.style.opacity = '0'
      document.body.appendChild(feld)
      feld.select()
      try {
        document.execCommand('copy')
        fertig()
      } catch (f) {
        melde('Kopieren ging nicht: ' + pfad, true)
      }
      feld.remove()
    }
  }

  function oeffneImEditor(pfad) {
    if (!mitDienst) return melde('Ohne Dev-Server gibt es keinen Editor-Knopf', true)
    ruf('oeffnen', { datei: pfad })
      .then(function (a) {
        melde(a.meldung)
      })
      .catch(function (f) {
        melde(f.message, true)
      })
  }

  ;[].slice
    .call(document.querySelectorAll('.kopftafel [data-pfad-kopieren]'))
    .forEach(function (k) {
      k.addEventListener('click', function () {
        kopierePfad(k.textContent.trim())
      })
    })
  /* ── Verlauf ──────────────────────────────────────────────────────────
   * Zwei Kleinigkeiten, ohne die der Block halb funktioniert: Der SHA lässt
   * sich kopieren (er ist nur als Kürzel abgedruckt, der volle steht im
   * `title`), und der Sprung aus der Kopftafel klappt die Liste AUF. Ein
   * `<details>` öffnet sich beim Fragment-Sprung nur, wenn das Ziel INNEN
   * liegt — hier trägt der Rahmen die Kennung, und der Link landete auf einer
   * zugeklappten Klappe. */

  ;[].slice.call(document.querySelectorAll('[data-sha-kopieren]')).forEach(function (k) {
    k.addEventListener('click', function () {
      var voll = (k.getAttribute('title') || '').split(' ')[1] || k.textContent.trim()
      kopierePfad(voll, 'Commit')
    })
  })

  function oeffneVerlauf() {
    if (location.hash !== '#verlauf') return
    var klappe = document.querySelector('.verlauf details')
    if (klappe) klappe.open = true
  }
  window.addEventListener('hashchange', oeffneVerlauf)
  oeffneVerlauf()

  ;[].slice
    .call(document.querySelectorAll('.kopftafel [data-editor-oeffnen]'))
    .forEach(function (k) {
      var tafel = k.closest('.kopftafel')
      var pfadKnopf = tafel && tafel.querySelector('[data-pfad-kopieren]')
      k.addEventListener('click', function () {
        if (pfadKnopf) oeffneImEditor(pfadKnopf.textContent.trim())
      })
    })

  /* ── Umbenennen ─────────────────────────────────────────────────────────
   * Eine Schicht für alle Objekte der Seite. Sie merkt sich, WELCHES gemeint
   * ist, statt vierzig Dialoge ins Markup zu legen. */

  var umbSchicht = document.querySelector('[data-umbenennen-schicht]')
  var umbZiel = ''

  function oeffneUmbenennen(datei, titel) {
    if (!umbSchicht) return
    var feldTitel = umbSchicht.querySelector('[data-umbenennen-titel]')
    var feldName = umbSchicht.querySelector('[data-umbenennen-name]')
    var pfadZeile = umbSchicht.querySelector('[data-umbenennen-pfad]')
    umbZiel = datei
    var teile = datei.split('/')
    var dateiname = teile.pop()
    var punkt = dateiname.lastIndexOf('.')
    feldTitel.value = titel || ''
    feldName.value = punkt > 0 ? dateiname.slice(0, punkt) : dateiname
    feldName.dataset.selbst = ''
    pfadZeile.textContent = teile.join('/') + '/'
    umbSchicht.hidden = false
    document.body.classList.add('schicht-offen')
    feldTitel.focus()
    feldTitel.select()
  }

  if (umbSchicht) {
    var umbTitel = umbSchicht.querySelector('[data-umbenennen-titel]')
    var umbName = umbSchicht.querySelector('[data-umbenennen-name]')

    var schliesseUmb = function () {
      umbSchicht.hidden = true
      document.body.classList.remove('schicht-offen')
    }

    // Der Dateiname folgt dem Titel, bis jemand ihn selbst anfasst: Wer den
    // Titel ändert, meint meist beides — wer den Namen tippt, meint genau ihn.
    umbName.addEventListener('input', function () {
      umbName.dataset.selbst = '1'
    })
    umbTitel.addEventListener('input', function () {
      if (umbName.dataset.selbst) return
      umbName.value = umbTitel.value
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
    })

    var los = function () {
      if (!umbZiel) return
      if (!mitDienst) return melde('Ohne Dev-Server kann nichts umbenannt werden', true)
      var titel = umbTitel.value.trim()
      if (!titel) return melde('Ohne Titel geht es nicht', true)
      schliesseUmb()
      melde('Benenne um …')
      ruf('umbenennen', { datei: umbZiel, titel: titel, name: umbName.value.trim() })
        .then(nachAktion)
        .catch(function (f) {
          melde(f.message, true)
        })
    }

    umbSchicht.querySelector('[data-umbenennen-los]').addEventListener('click', los)
    umbSchicht.querySelector('[data-umbenennen-ab]').addEventListener('click', schliesseUmb)
    umbSchicht.addEventListener('click', function (e) {
      if (e.target === umbSchicht) schliesseUmb()
    })
    umbSchicht.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        los()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        schliesseUmb()
      }
    })
  }

  if (mitDienst) {
    /* ── Ein Menü, viele Objekte ────────────────────────────────────────
     * Jede Kachel und jede Einzelseite trägt dasselbe Markup: ein Griff, eine
     * Klappe, Einträge mit Datenattributen. Geöffnet ist immer höchstens eines
     * — zwei offene Menüs nebeneinander sind eine Frage ohne Antwort. */

    var nachAktion = function (a) {
      melde(a.meldung)
      // Auf der Einzelseite eines verschobenen Objekts stimmt die Adresse
      // danach nicht mehr; in einer Liste genügt das Neuladen.
      var weg = document.body.classList.contains('seite-dokument')
        ? auf + 'index.html'
        : document.body.classList.contains('seite-prototyp')
          ? auf + 'mockups.html'
          : null
      setTimeout(function () {
        if (weg) location.href = weg
        else location.reload()
      }, 650)
    }

    ;[].slice.call(document.querySelectorAll('[data-aktionen]')).forEach(function (wurzel) {
      var knopf = wurzel.querySelector('[data-aktionen-knopf]')
      var klappe = wurzel.querySelector('[data-aktionen-klappe]')
      var datei = wurzel.getAttribute('data-datei')
      var titel = wurzel.getAttribute('data-titel')
      if (!knopf || !klappe) return

      knopf.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        if (istOffen(klappe)) return schliesseSchwebend()
        zeigeSchwebend(klappe, knopf, { wurzel: wurzel })
      })
      klappe.addEventListener('click', function (e) {
        e.stopPropagation()
      })

      ;[].slice.call(klappe.querySelectorAll('[data-roadmap-phase]')).forEach(function (eintrag) {
        eintrag.addEventListener('click', function () {
          schliesseSchwebend()
          melde('Roadmap …')
          ruf('roadmap', {
            datei: datei,
            titel: titel,
            phase: eintrag.getAttribute('data-roadmap-phase'),
          })
            .then(function (a) {
              melde(a.meldung)
              setTimeout(function () {
                location.reload()
              }, 650)
            })
            .catch(function (f) {
              melde(f.message, true)
            })
        })
      })

      var editor = klappe.querySelector('[data-editor-oeffnen]')
      if (editor)
        editor.addEventListener('click', function () {
          schliesseSchwebend()
          oeffneImEditor(datei)
        })

      var kopieren = klappe.querySelector('[data-pfad-kopieren]')
      if (kopieren)
        kopieren.addEventListener('click', function () {
          schliesseSchwebend()
          kopierePfad(datei)
        })

      var umbenennen = klappe.querySelector('[data-umbenennen]')
      if (umbenennen)
        umbenennen.addEventListener('click', function () {
          schliesseSchwebend()
          oeffneUmbenennen(datei, titel)
        })

      var archivieren = klappe.querySelector('[data-archivieren]')
      if (archivieren)
        archivieren.addEventListener('click', function () {
          schliesseSchwebend()
          if (!confirm('„' + titel + '" ins Archiv verschieben?')) return
          melde('Verschiebe …')
          ruf('archivieren', { datei: datei })
            .then(nachAktion)
            .catch(function (f) {
              melde(f.message, true)
            })
        })

      ;[].slice.call(klappe.querySelectorAll('[data-zurueckholen]')).forEach(function (eintrag) {
        eintrag.addEventListener('click', function () {
          schliesseSchwebend()
          melde('Hole zurück …')
          ruf('zurueckholen', { datei: datei, bereich: eintrag.getAttribute('data-bereich') })
            .then(nachAktion)
            .catch(function (f) {
              melde(f.message, true)
            })
        })
      })
    })

    /* ── Rangfolge und Phase ziehen ──────────────────────────────────────
     * EIN Steuerwerk für alle Spalten, nicht eines je Liste: Ein Zug kann die
     * Spalte wechseln, und dafür müssen die Zielspalten einander kennen.
     *
     * Über der Spalte steht ihr Name — ein Zug dorthin ist damit die direkteste
     * Form, die Verbindlichkeit zu ändern, und nicht die stillste. (Eine frühere
     * Fassung verbot ihn mit genau dem umgekehrten Argument. Das war falsch: Was
     * beschriftet ist, passiert nicht stillschweigend.)
     *
     * Vier Fallen, alle in dieser Reihenfolge gefunden:
     *
     * 1. `setPointerCapture` am Griff GIBT FREI, sobald das haltende Element aus
     *    dem Dokument genommen wird — `insertBefore` tut das bei jedem
     *    Umsortieren. Deshalb hängen die Ereignisse am DOKUMENT.
     * 2. Beim Umsortieren wandert die LAYOUT-Position der gezogenen Karte; die
     *    Differenz muss auf `startY`, sonst rutscht sie unter dem Finger weg.
     *    Doppelt gezählt pendelt sie zwischen zwei Plätzen.
     * 3. Beim SPALTENWECHSEL springt dieselbe Position um viel mehr — dieselbe
     *    Korrektur, nur größer. Sie ist der Grund, warum die Karte nicht in die
     *    Kopfzeile der Nachbarspalte schnellt.
     * 4. Geschrieben wird EINMAL am Ende: Reihenfolge innerhalb der Phase, oder
     *    Phasenwechsel plus Reihenfolge, wenn die Spalte gewechselt hat.
     */
    var zug = null
    var listen = [].slice.call(document.querySelectorAll('.rm-liste[data-phase]'))

    if (listen.length) {
      var karten = function (liste) {
        return [].slice.call(liste.children).filter(function (k) {
          return k.tagName === 'LI'
        })
      }

      /* Der Nachbar rückt weich an seinen neuen Platz: alte Lage merken, nach
         dem Umhängen die Differenz zurückstellen, dann auf null laufen lassen. */
      var ruecke = function (el, vorherOben) {
        var delta = vorherOben - el.getBoundingClientRect().top
        if (!delta) return
        el.style.transition = 'none'
        el.style.transform = 'translateY(' + delta + 'px)'
        void el.offsetHeight
        el.style.transition = 'transform 0.16s ease'
        el.style.transform = ''
      }

      /* Die eigene Layout-Position hat sich verschoben — Ausgleich auf `startY`,
         damit die Karte optisch stehen bleibt (Fallen 2 und 3). */
      var haltePosition = function (lageVorher, y) {
        zug.startY += zug.karte.getBoundingClientRect().top - lageVorher
        zug.dy = y - zug.startY
        zug.karte.style.transform = 'translateY(' + zug.dy + 'px)'
      }

      /** In welcher Spalte steht der Zeiger? `null`, wenn in keiner. */
      var listeUnter = function (x, y) {
        for (var i = 0; i < listen.length; i++) {
          // Die ganze Phasenkarte gilt als Ziel, nicht nur die Liste: Sonst
          // findet man beim Zug in eine kurze Spalte kein Ziel unter dem Kopf.
          var kasten = (listen[i].closest('.rm-phase') || listen[i]).getBoundingClientRect()
          if (x >= kasten.left && x <= kasten.right && y >= kasten.top && y <= kasten.bottom)
            return listen[i]
        }
        return null
      }

      var wechsleSpalte = function (ziel, y) {
        var lage = zug.karte.getBoundingClientRect().top
        // Ans Ende hängen und danach normal einsortieren — so landet die Karte
        // auch in einer leeren Spalte an einer gültigen Stelle.
        ziel.appendChild(zug.karte)
        haltePosition(lage, y)
        zug.geaendert = true
      }

      var sortiere = function (y) {
        var liste = zug.karte.parentElement
        var alle = karten(liste)
        var eigene = alle.indexOf(zug.karte)
        var kasten = zug.karte.getBoundingClientRect()
        var mitte = kasten.top + kasten.height / 2

        for (var i = 0; i < alle.length; i++) {
          if (alle[i] === zug.karte) continue
          var nachbar = alle[i].getBoundingClientRect()
          var nachOben = i < eigene && mitte < nachbar.top + nachbar.height / 2
          var nachUnten = i > eigene && mitte > nachbar.top + nachbar.height / 2
          if (!nachOben && !nachUnten) continue

          var lageNachbar = nachbar.top
          var lageEigene = kasten.top
          liste.insertBefore(zug.karte, nachOben ? alle[i] : alle[i].nextSibling)
          haltePosition(lageEigene, y)
          ruecke(alle[i], lageNachbar)
          zug.geaendert = true
          return
        }
      }

      var markiere = function (liste) {
        listen.forEach(function (l) {
          var karte = l.closest('.rm-phase') || l
          karte.classList.toggle('ziel', l === liste && l !== zug.startListe)
        })
      }

      var beende = function (abbrechen) {
        if (!zug) return
        hoere(false)
        var k = zug.karte
        var geaendert = zug.geaendert
        var startListe = zug.startListe
        var urspruenglich = zug.urspruenglich
        k.classList.remove('greift')
        k.style.transform = ''
        document.body.classList.remove('zieht-gerade')
        markiere(null)
        zug = null

        if (abbrechen) {
          // Wirklich abbrechen heißt: die alte Ordnung wiederherstellen, nicht
          // nur die Karte fallen lassen.
          if (geaendert)
            urspruenglich.forEach(function (li) {
              startListe.appendChild(li)
            })
          return
        }
        if (!geaendert) return

        var jetzt = k.parentElement
        var reihenfolge = karten(jetzt).map(function (li) {
          return li.getAttribute('data-datei')
        })
        var phase = jetzt.getAttribute('data-phase')
        if (jetzt === startListe)
          return speichere('roadmap-ordnen', { reihenfolge: reihenfolge }, phase)
        speichere(
          'roadmap-verschieben',
          { datei: k.getAttribute('data-datei'), reihenfolge: reihenfolge },
          phase,
        )
      }

      /* Die Zahlen am Spaltenkopf stammen aus der Bauzeit. Nach einem
         Spaltenwechsel stünde über einer Spalte mit vier Einträgen weiter „5" —
         ein Neuladen wäre der einfachere Weg, kostet aber einen Sprung mitten in
         der Arbeit. */
      var zaehleNeu = function () {
        listen.forEach(function (l) {
          var kopf = (l.closest('.rm-phase') || l).querySelector('.rm-zahl')
          if (kopf) kopf.textContent = String(karten(l).length)
        })
      }

      /*
       * SCHWEIGEN bei Erfolg.
       *
       * Vorher meldete jeder Zug „Speichere …" und danach das Ergebnis. Beides
       * ist überflüssig: Die Karte liegt sichtbar dort, wo man sie hingezogen
       * hat — das IST die Rückmeldung, und eine Tafel am unteren Rand erklärt
       * eine Bewegung, die man gerade selbst gemacht hat.
       *
       * Gemeldet wird nur, was man NICHT sehen kann: ein Fehlschlag. Dann kommt
       * die Seite neu, damit die Ansicht nicht etwas anderes behauptet als die
       * Datei.
       *
       * Die Phase muss dabei durchgereicht werden. Sie fehlte im Zweig für den
       * Zug INNERHALB einer Spalte, und der Server ordnete daraufhin eine Phase
       * mit dem Namen `''` — es passierte nichts, und die Antwort lautete
       * „Reihenfolge unverändert". Genau diese Meldung war der sichtbare Teil des
       * Fehlers: Sie erklärte nicht eine harmlose Nichtänderung, sondern dass
       * das Umsortieren nie in der Datei ankam.
       */
      var speichere = function (aktion, daten, phase) {
        // Ohne Phase kann der Server nichts ordnen. Das war der Fehler, und er
        // war STILL: Die Antwort lautete „Reihenfolge unverändert", also genau
        // das, was auch bei einer harmlosen Nichtänderung käme. Lieber laut.
        if (!phase) return melde('Phase fehlt — bitte die Seite neu laden', true)
        daten.phase = phase
        zaehleNeu()
        ruf(aktion, daten).catch(function (f) {
          melde(f.message, true)
          location.reload()
        })
      }

      var beiBewegung = function (e) {
        if (!zug || e.pointerId !== zug.pointerId) return
        e.preventDefault()
        zug.dy = e.clientY - zug.startY
        // Erst ab einer echten Bewegung heben — ein Klick auf den Griff soll die
        // Karte nicht zappeln lassen.
        if (!zug.hebt && Math.abs(zug.dy) < 4) return
        if (!zug.hebt) {
          zug.hebt = true
          zug.karte.classList.add('greift')
          document.body.classList.add('zieht-gerade')
        }
        zug.karte.style.transform = 'translateY(' + zug.dy + 'px)'

        var ziel = listeUnter(e.clientX, e.clientY)
        if (ziel && ziel !== zug.karte.parentElement) wechsleSpalte(ziel, e.clientY)
        markiere(zug.karte.parentElement)
        sortiere(e.clientY)
      }
      var beiEnde = function (e) {
        if (!zug || (e && e.pointerId !== undefined && e.pointerId !== zug.pointerId)) return
        beende(false)
      }
      var beiAbbruch = function () {
        beende(true)
      }
      var hoere = function (an) {
        var tu = an ? 'addEventListener' : 'removeEventListener'
        document[tu]('pointermove', beiBewegung)
        document[tu]('pointerup', beiEnde)
        document[tu]('pointercancel', beiAbbruch)
        window[tu]('blur', beiAbbruch)
      }

      listen.forEach(function (liste) {
        ;[].slice.call(liste.querySelectorAll('[data-rm-griff]')).forEach(function (griff) {
          var karte = griff.closest('li')

          griff.addEventListener('pointerdown', function (e) {
            if (e.button !== undefined && e.button !== 0) return
            if (zug) beende(true)
            e.preventDefault()
            zug = {
              karte: karte,
              pointerId: e.pointerId,
              startY: e.clientY,
              dy: 0,
              hebt: false,
              geaendert: false,
              startListe: liste,
              urspruenglich: karten(liste),
            }
            hoere(true)
          })

          /* Die Tastatur bewegt innerhalb der Spalte um einen Platz. Für den
             Phasenwechsel gibt es das „…"-Menü, das die Phasen beim Namen nennt —
             eine Taste, die eine Spalte weiterspringt, wäre ohne Beschriftung. */
          griff.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            e.preventDefault()
            var alle = karten(liste)
            var i = alle.indexOf(karte)
            var j = i + (e.key === 'ArrowUp' ? -1 : 1)
            if (j < 0 || j >= alle.length) return melde('Steht schon am Rand seiner Phase')
            var lage = alle[j].getBoundingClientRect().top
            liste.insertBefore(karte, e.key === 'ArrowUp' ? alle[j] : alle[j].nextSibling)
            ruecke(alle[j], lage)
            griff.focus()
            speichere(
              'roadmap-ordnen',
              {
                reihenfolge: karten(liste).map(function (li) {
                  return li.getAttribute('data-datei')
                }),
              },
              liste.getAttribute('data-phase'),
            )
          })
        })
      })

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && zug) beende(true)
      })
    }

    /* Das × an einem Roadmap-Eintrag der Übersicht. */
    ;[].slice.call(document.querySelectorAll('[data-roadmap-weg]')).forEach(function (k) {
      k.addEventListener('click', function () {
        melde('Nehme von der Roadmap …')
        ruf('roadmap', { datei: k.getAttribute('data-datei'), phase: '' })
          .then(function (a) {
            melde(a.meldung)
            // Der Eintrag verschwindet erst mit dem nächsten Laden — ihn hier
            // schon auszublenden zeigt den Erfolg sofort.
            var zeile = k.closest('li')
            if (zeile) zeile.style.display = 'none'
          })
          .catch(function (f) {
            melde(f.message, true)
          })
      })
    })

    /* ── Editor ──────────────────────────────────────────────────────────
     * Der Text kommt beim Öffnen FRISCH vom Dienst und steckt nicht in der
     * Seite: Sonst bearbeitet man den Stand des letzten Baus und überschreibt
     * damit stillschweigend, was inzwischen im Editor des Rechners entstand. */

    var tisch = document.querySelector('[data-schreibtisch]')
    var schreibfeld = tisch && tisch.querySelector('[data-schreibfeld]')
    var knopfBearbeiten = document.querySelector('[data-bearbeiten]')
    var prosa = document.querySelector('[data-prosa]')
    if (tisch && schreibfeld && knopfBearbeiten && prosa) {
      var editorDatei = document.querySelector('[data-werkzeuge]').getAttribute('data-datei')
      var offen = false

      var zeige = function (an) {
        offen = an
        tisch.hidden = !an
        prosa.hidden = an
        knopfBearbeiten.classList.toggle('an', an)
        if (an) schreibfeld.focus()
      }

      knopfBearbeiten.addEventListener('click', function () {
        if (offen) return zeige(false)
        ruf('quelle', { datei: editorDatei })
          .then(function (a) {
            schreibfeld.value = a.text
            zeige(true)
            // Höhe an den Inhalt: Ein Feld mit fester Höhe zwingt in einem
            // 2000-Zeilen-Dokument zum Scrollen im Scrollen.
            schreibfeld.style.height = 'auto'
            schreibfeld.style.height = Math.max(420, schreibfeld.scrollHeight + 40) + 'px'
          })
          .catch(function (f) {
            melde(f.message, true)
          })
      })

      var speichere = function () {
        melde('Speichere …')
        ruf('speichern', { datei: editorDatei, text: schreibfeld.value })
          .then(function (a) {
            melde(a.meldung)
            setTimeout(function () {
              location.reload()
            }, 500)
          })
          .catch(function (f) {
            melde(f.message, true)
          })
      }

      tisch.querySelector('[data-speichern]').addEventListener('click', speichere)
      tisch.querySelector('[data-abbrechen]').addEventListener('click', function () {
        zeige(false)
      })
      schreibfeld.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          speichere()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          zeige(false)
        } else if (e.key === 'Tab') {
          // Ein Tabulator, der den Fokus wegnimmt, ist in einem Textfeld für
          // Markdown-Listen die falsche Antwort.
          e.preventDefault()
          var a = schreibfeld.selectionStart
          var b = schreibfeld.selectionEnd
          schreibfeld.value = schreibfeld.value.slice(0, a) + '  ' + schreibfeld.value.slice(b)
          schreibfeld.selectionStart = schreibfeld.selectionEnd = a + 2
        }
      })
      window.addEventListener('beforeunload', function (e) {
        if (offen && schreibfeld.value) {
          e.preventDefault()
          e.returnValue = ''
        }
      })
    }
  }

  /* ── Scrollspy im Inhaltsverzeichnis ──────────────────────────────────
   * Zwei Anzeigen aus einer Messung: der Balken sagt, WIE WEIT man im Text
   * ist, die hervorgehobene Zeile sagt, WO. Das CSS für beides (`.fortschritt
   * i`, `.inhalt li a.hier`) stand längst da, nur gesetzt hat es niemand.
   *
   * Vier Dinge, die man dabei leicht falsch herum baut:
   *
   *   - Die Lesemarke wird nicht geraten, sondern aus dem CSS abgeleitet, das
   *     auch der Anker-Sprung benutzt: `scroll-padding-top` des `html` PLUS
   *     `scroll-margin-top` der Überschrift (92 + 84 = 176). Genau dort legt
   *     der Browser sie ab. Mit der Höhe der Kopfleiste (58) hat das nichts zu
   *     tun — mit ihr als Marke galt die eben angesprungene Überschrift als
   *     noch nicht erreicht, man klickte einen Punkt an und der vorige blieb
   *     markiert.
   *   - Am Dokumentende wird die LETZTE Überschrift erzwungen: Der Schluss ist
   *     oft kürzer als ein Bildschirm und wanderte nie über die Marke — man
   *     liest ihn, und im Verzeichnis leuchtet der Abschnitt davor. Gemessen
   *     wird das am `scrollingElement`, nicht am `body`: Gescrollt wird hier
   *     das `html` (`overflow-y: auto`), und die beiden Höhen sind nicht
   *     dieselbe Zahl. Mit der falschen sprang der Klick auf den letzten
   *     Eintrag ans Seitenende und markierte trotzdem den vorletzten.
   *   - Mitgeführt wird über `scrollTop` der eigenen Spalte, nicht über
   *     `scrollIntoView`: Das scrollt den nächsten scrollbaren Vorfahren mit,
   *     also die Seite — und die Seite bewegt gleich wieder den Scrollspy.
   *   - Gemessen wird im `requestAnimationFrame`, nicht je Scroll-Ereignis;
   *     `getBoundingClientRect` in der Ereignisschleife ist ein Layout je Rad-
   *     rastung.
   */

  var inhaltNav = document.querySelector('.inhalt')
  if (inhaltNav) {
    var balken = inhaltNav.querySelector('[data-fortschritt]')
    var spalte = inhaltNav.querySelector('.inhalt-innen')
    var prosa = document.querySelector('[data-prosa]')

    var eintraege = []
    Array.prototype.forEach.call(inhaltNav.querySelectorAll('a[href^="#"]'), function (a) {
      var ziel = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))
      if (ziel) eintraege.push({ a: a, ziel: ziel })
    })

    if (eintraege.length) {
      var aktiv = null
      var geplant = false

      function zahl(wert) {
        var n = parseFloat(wert)
        return isNaN(n) ? 0 : n
      }

      function linie(ziel) {
        // Die vier Pixel Puffer fangen die Rundung des Sprungziels ab.
        return (
          zahl(getComputedStyle(document.documentElement).scrollPaddingTop) +
          zahl(getComputedStyle(ziel).scrollMarginTop) +
          4
        )
      }

      function fuehreMit(a) {
        if (!spalte || spalte.scrollHeight <= spalte.clientHeight) return
        var oben = a.offsetTop - spalte.offsetTop
        var unten = oben + a.offsetHeight
        if (oben < spalte.scrollTop + 8) spalte.scrollTop = oben - 8
        else if (unten > spalte.scrollTop + spalte.clientHeight - 8)
          spalte.scrollTop = unten - spalte.clientHeight + 8
      }

      function setze(eintrag) {
        if (eintrag === aktiv) return
        if (aktiv) aktiv.a.classList.remove('hier')
        aktiv = eintrag
        if (!aktiv) return
        aktiv.a.classList.add('hier')
        aktiv.a.setAttribute('aria-current', 'true')
        eintraege.forEach(function (e) {
          if (e !== aktiv) e.a.removeAttribute('aria-current')
        })
        fuehreMit(aktiv.a)
      }

      function miss() {
        geplant = false
        var se = document.scrollingElement || document.documentElement
        var amEnde = se.scrollTop + se.clientHeight >= se.scrollHeight - 2

        var treffer = amEnde ? eintraege[eintraege.length - 1] : null
        if (!treffer) {
          for (var i = 0; i < eintraege.length; i++) {
            var e = eintraege[i]
            if (e.ziel.getBoundingClientRect().top - linie(e.ziel) <= 0) treffer = e
            else break
          }
          // Vor der ersten Überschrift steht die Kopftafel; dort ist noch
          // nichts erreicht, aber „nichts hervorgehoben" liest sich wie ein
          // Defekt — also gilt der erste Eintrag.
          if (!treffer) treffer = eintraege[0]
        }
        setze(treffer)

        // Der Balken misst die PROSA und nicht das Dokument: Verlaufs-Klappe
        // und Fußnote hängen darunter, und mit ihnen stünde der Balken am
        // Textende noch bei zwei Dritteln. Voll ist er, wenn die letzte
        // Textzeile im Bild steht.
        if (balken) {
          var k = prosa || document.body
          var start = k.getBoundingClientRect().top + window.scrollY
          var anteil =
            k.offsetHeight > 0 ? (window.scrollY + window.innerHeight - start) / k.offsetHeight : 1
          balken.style.width = Math.max(0, Math.min(1, anteil)) * 100 + '%'
        }
      }

      function plane() {
        if (geplant) return
        geplant = true
        requestAnimationFrame(miss)
      }

      window.addEventListener('scroll', plane, { passive: true })
      window.addEventListener('resize', plane)
      // Ein Klick springt sofort — auf das Scroll-Ereignis zu warten, ließe die
      // angeklickte Zeile einen Wimpernschlag lang unmarkiert.
      inhaltNav.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href^="#"]')
        if (!a) return
        for (var i = 0; i < eintraege.length; i++)
          if (eintraege[i].a === a) return setze(eintraege[i])
      })
      miss()
    }
  }

  /* ── Bereichs-Klappe im Kopf ─────────────────────────────────────────── */

  var menueKnopf = document.querySelector('[data-menue-knopf]')
  var menue = document.querySelector('[data-menue]')
  if (menueKnopf && menue) {
    menueKnopf.addEventListener('click', function (e) {
      e.stopPropagation()
      if (istOffen(menue)) return schliesseSchwebend()
      zeigeSchwebend(menue, menueKnopf)
    })
    menue.addEventListener('click', function (e) {
      e.stopPropagation()
    })
  }

  /* ── Filter auf der Bereichsseite ─────────────────────────────────────
   * Zwei Filter, die sich UND-verknüpfen: Statuschip und Textfeld. Getrennt
   * gedacht wäre der zweite Filter ein Zurücksetzen des ersten, und man
   * verlöre beim Tippen still die gewählte Ampel. */

  var kartenFeld = document.querySelector('[data-karten]')
  if (kartenFeld) {
    var karten = [].slice.call(kartenFeld.querySelectorAll('.dok-karte, .mockup'))
    var filterFeld = document.querySelector('[data-filter-feld]')
    var teilWahl = document.querySelector('[data-teilwahl]')
    var statusWahl = document.querySelector('[data-statuswahl]')
    var zaehler = document.querySelector('[data-zaehler]')
    var leer = document.querySelector('[data-leer]')

    // Drei Filter, UND-verknüpft: Text, Systemteil, Zustand. Getrennt gedacht
    // wäre jeder neue Filter ein stilles Zurücksetzen der anderen.
    var wende = function () {
      var suche = filterFeld ? filterFeld.value.trim().toLowerCase() : ''
      var teil = teilWahl ? teilWahl.value : 'alle'
      var status = statusWahl ? statusWahl.value : 'alle'
      var sichtbar = 0
      karten.forEach(function (k) {
        var teile = (k.getAttribute('data-teile') || '').split(' ')
        var passt =
          (status === 'alle' || (k.getAttribute('data-ampel') || 'ohne') === status) &&
          (teil === 'alle' || teile.indexOf(teil) >= 0) &&
          (!suche || (k.getAttribute('data-suchtext') || '').indexOf(suche) >= 0)
        k.hidden = !passt
        if (passt) sichtbar++
      })
      if (leer) leer.hidden = sichtbar > 0
      if (zaehler) {
        // Der Zähler ersetzt die Zahlen auf den Pillen: Er sagt, was die
        // Filter GERADE übrig lassen, und das ist die Zahl, die interessiert.
        zaehler.textContent =
          sichtbar === karten.length
            ? karten.length + (karten.length === 1 ? ' Eintrag' : ' Einträge')
            : sichtbar + ' von ' + karten.length
      }
    }

    /* ── Sortieren ────────────────────────────────────────────────────
     * Die Liste kam in Dateinamen-Reihenfolge: Für den Leser eine zufällige
     * Ordnung, denn alle „konzept_*" landen beieinander, weil sie so heißen.
     * Sortiert wird im DOM (die Karten stehen ja schon da) — das hält den
     * Wechsel sofort und braucht keinen zweiten Datensatz im Browser. */
    var sortWahl = document.querySelector('[data-sortierung]')
    var sortiere = function () {
      var art = sortWahl ? sortWahl.value : 'datum'
      var geordnet = karten.slice().sort(function (a, b) {
        if (art === 'titel')
          return (a.getAttribute('data-titel') || '').localeCompare(
            b.getAttribute('data-titel') || '',
            'de',
          )
        if (art === 'kurz')
          return Number(a.getAttribute('data-minuten')) - Number(b.getAttribute('data-minuten'))
        if (art === 'verweise')
          return Number(b.getAttribute('data-verweise')) - Number(a.getAttribute('data-verweise'))
        // Nach Datum, das Jüngste zuerst. Was gar kein Datum hat (ungetrackt),
        // steht hinten statt vorne — sonst führte eine fehlende Angabe die
        // Liste an.
        var da = a.getAttribute('data-datum') || ''
        var db = b.getAttribute('data-datum') || ''
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return db.localeCompare(da)
      })
      geordnet.forEach(function (k) {
        kartenFeld.appendChild(k)
      })
    }
    if (sortWahl) {
      sortWahl.addEventListener('change', sortiere)
      sortiere()
    }

    if (filterFeld) filterFeld.addEventListener('input', wende)
    if (teilWahl) teilWahl.addEventListener('change', wende)
    if (statusWahl) statusWahl.addEventListener('change', wende)
  }

  /* ── Karte: zoomen und schieben ───────────────────────────────────────
   * Ohne das ist die Karte eine Grafik zum Anschauen: 43 Beschriftungen auf
   * einer Kreisbahn sind selbst auf einem großen Schirm klein. Gezoomt wird um
   * den ZEIGER herum, nicht um die Bildmitte — sonst wandert die Stelle, die
   * man ansieht, beim Zoomen aus dem Bild. */

  var karteSvg = document.querySelector('.verweiskarte')
  var welt = karteSvg && karteSvg.querySelector('[data-welt]')
  // Der Zoom (weiter oben definiert) und die Simulation (weiter unten) müssen
  // sich EINE Sache sagen: die aktuelle Stufe. Der Halter ist die Leitung.
  var gegenSkalaHalter = null
  if (karteSvg && welt) {
    var stand = { k: 1, x: 0, y: 0 }
    var box = karteSvg.viewBox.baseVal
    var kante = box.height

    /* Die viewBox folgt der FORM des Fensters: In einem breiten Fenster wird
       sie breit, und der Kreis bleibt in der Mitte. Bliebe sie quadratisch,
       stünde die Karte in einem Kasten mit toten Rändern — und genau dorthin
       schöbe man beim Zoomen die Beschriftungen. */
    var passeAn = function () {
      var r = karteSvg.getBoundingClientRect()
      if (!r.width || !r.height) return
      var w = kante * (r.width / r.height)
      karteSvg.setAttribute('viewBox', (kante - w) / 2 + ' 0 ' + w + ' ' + kante)
    }
    passeAn()
    window.addEventListener('resize', passeAn)

    /* DIE TAFEL LINKS VERDECKT KARTE.
       Sie schwebt über der Fläche — das ist richtig, denn bei einem Graphen ist
       die Fläche der Inhalt — aber der Graph beginnt darunter: Zwei Punkte
       lagen hinter dem Glas und waren nur durch Ziehen zu finden. Die Startlage
       rückt ihn deshalb neben die Tafel und verkleinert ihn so weit, dass er in
       den Rest passt. Gerechnet wird gegen die WIRKLICHE Ausdehnung der Punkte
       (nicht gegen die viewBox): Das Feld hat oben und unten Rand für die
       Etiketten, und den zweimal zu berücksichtigen schrumpfte die Karte grundlos. */
    var startLage = function () {
      var lage = { k: 1, x: 0, y: 0 }
      var r = karteSvg.getBoundingClientRect()
      var hud = document.querySelector('.karte-hud')
      if (!r.width || !r.height) return lage
      var x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity
      ;[].slice.call(karteSvg.querySelectorAll('.knoten')).forEach(function (g) {
        var t = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(g.getAttribute('transform'))
        if (!t) return
        var x = parseFloat(t[1]),
          y = parseFloat(t[2]),
          rad = parseFloat(g.getAttribute('data-r')) || 6
        // Der Zuschlag ist das ETIKETT: Es steht mittig unter dem Punkt und
        // ragt seitlich weit über ihn hinaus. Ohne ihn schnitt der Rand die
        // äußeren Namen ab — sichtbar war der Punkt, lesbar nichts.
        x0 = Math.min(x0, x - rad - 110)
        x1 = Math.max(x1, x + rad + 110)
        y0 = Math.min(y0, y - rad - 52)
        y1 = Math.max(y1, y + rad + 44)
      })
      if (!isFinite(x0)) return lage
      var proPx = box.width / r.width
      var frei = hud ? (hud.getBoundingClientRect().right - r.left + 22) * proPx : 0
      var links = box.x + frei
      var kx = (box.x + box.width - links) / (x1 - x0)
      var ky = box.height / (y1 - y0)
      // Auch VERGRÖSSERN, nicht nur verkleinern: Die Fläche ist meist breiter
      // als das gebaute Feld, und der Rest stand als leerer Rand rechts. Die
      // Etiketten wachsen dabei nicht mit (sie halten ihre Bildschirmgröße),
      // also wird mit der Stufe auch der Abstand zwischen ihnen größer.
      lage.k = Math.max(0.4, Math.min(1.15, kx, ky))
      lage.x = links - x0 * lage.k
      lage.y = box.y + (box.height - (y1 - y0) * lage.k) / 2 - y0 * lage.k
      return lage
    }

    var zeichne = function () {
      welt.setAttribute(
        'transform',
        'translate(' +
          stand.x.toFixed(2) +
          ',' +
          stand.y.toFixed(2) +
          ') scale(' +
          stand.k.toFixed(3) +
          ')',
      )
      // Ab dieser Stufe blendet das Blatt alle Beschriftungen ein: Vorher
      // stehen nur die der gut vernetzten Punkte da, sonst überlagern sich in
      // den dichten Ecken ein Dutzend Titel.
      // Ab hier stehen alle Etiketten, nicht nur die der gut vernetzten
      // Punkte: Bei doppelter Vergrößerung ist Platz dafür.
      karteSvg.classList.toggle('gezoomt', stand.k > 1.3)
      if (typeof gegenSkalaHalter === 'function') gegenSkalaHalter(stand.k)
    }

    // Die Startlage gilt, bis jemand selbst zoomt oder schiebt: Danach wäre ein
    // Zurückspringen beim Fensterwechsel eine Bevormundung, davor wäre das
    // Stehenbleiben ein halb verdeckter Graph.
    var beruehrt = false
    stand = startLage()
    zeichne()
    window.addEventListener('resize', function () {
      if (beruehrt) return
      stand = startLage()
      zeichne()
    })

    // Bildschirmpunkt → Koordinate der viewBox: Ohne diese Umrechnung zoomt
    // man in Pixeln auf einer Fläche, die in eigenen Einheiten rechnet.
    var inWelt = function (e) {
      var r = karteSvg.getBoundingClientRect()
      return {
        x: box.x + ((e.clientX - r.left) / r.width) * box.width,
        y: box.y + ((e.clientY - r.top) / r.height) * box.height,
      }
    }

    var zoomeAuf = function (neu, punkt) {
      beruehrt = true
      neu = Math.min(6, Math.max(0.4, neu))
      if (neu === stand.k) return
      // Der Punkt unter dem Zeiger bleibt liegen: p = (p - x)/k  →  x = p - p'*k
      stand.x = punkt.x - ((punkt.x - stand.x) / stand.k) * neu
      stand.y = punkt.y - ((punkt.y - stand.y) / stand.k) * neu
      stand.k = neu
      zeichne()
    }

    karteSvg.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault()
        zoomeAuf(stand.k * (e.deltaY < 0 ? 1.16 : 1 / 1.16), inWelt(e))
      },
      { passive: false },
    )

    var zieht = null
    karteSvg.addEventListener('pointerdown', function (e) {
      // Auf einem Knoten beginnt kein FLÄCHEN-Zug: Dort zieht man den Knoten
      // selbst (s. unten) oder klickt ihn an.
      if (e.target.closest('.knoten')) return
      beruehrt = true
      zieht = { x: e.clientX, y: e.clientY, ax: stand.x, ay: stand.y }
      karteSvg.setPointerCapture(e.pointerId)
      karteSvg.classList.add('zieht')
    })
    karteSvg.addEventListener('pointermove', function (e) {
      if (!zieht) return
      var r = karteSvg.getBoundingClientRect()
      stand.x = zieht.ax + ((e.clientX - zieht.x) / r.width) * box.width
      stand.y = zieht.ay + ((e.clientY - zieht.y) / r.height) * box.height
      zeichne()
    })
    var loslassen = function (e) {
      if (!zieht) return
      zieht = null
      karteSvg.classList.remove('zieht')
      try {
        karteSvg.releasePointerCapture(e.pointerId)
      } catch (f) {}
    }
    karteSvg.addEventListener('pointerup', loslassen)
    karteSvg.addEventListener('pointercancel', loslassen)
    karteSvg.addEventListener('dblclick', function (e) {
      // Auf einem Knoten heißt Doppelklick „öffnen" (s. unten) — dort wäre ein
      // zurückspringender Ausschnitt genau die Bewegung, die man nicht wollte.
      if (e.target.closest && e.target.closest('.knoten')) return
      beruehrt = false
      stand = startLage()
      zeichne()
    })

    /* VOLLBILD ist das Vollbild des Bildschirms, nicht das des Dokuments.
       Die Klasse allein räumte nur die Kopfleiste weg — Fensterrahmen, Tabs und
       Menüleiste standen weiter da, und genau die sind der Grund, warum man bei
       einem Graphen überhaupt danach greift. Also die Fullscreen-API, mit der
       Klasse als Rückfall (sie trägt weiterhin das Layout, und wo die API
       fehlt oder der Browser sie verweigert, bleibt es beim alten Verhalten).
       Der Zustand wird NICHT selbst geführt: Verlassen kann man auch über Esc
       oder die Browserleiste, davon erfährt man nur über `fullscreenchange`. */
    var flaeche = document.querySelector('.karten-vollflaeche')
    var vollbild = document.querySelector('[data-vollbild]')
    var zeigeStand = function (an) {
      document.body.classList.toggle('karte-vollbild', an)
      if (vollbild) vollbild.textContent = an ? 'Schließen' : 'Vollbild'
      requestAnimationFrame(passeAn)
    }
    document.addEventListener('fullscreenchange', function () {
      zeigeStand(!!document.fullscreenElement)
    })
    if (vollbild)
      vollbild.addEventListener('click', function () {
        if (document.fullscreenElement) return document.exitFullscreen()
        if (flaeche && flaeche.requestFullscreen)
          // Schlägt es fehl (etwa ohne Nutzergeste oder per Richtlinie
          // gesperrt), bleibt wenigstens die Kopfleiste weg.
          flaeche.requestFullscreen().catch(function () {
            zeigeStand(!document.body.classList.contains('karte-vollbild'))
          })
        else zeigeStand(!document.body.classList.contains('karte-vollbild'))
      })
    document.addEventListener('keydown', function (e) {
      // Im echten Vollbild räumt Esc der Browser selbst ab; hier geht es nur
      // um den Rückfall ohne API.
      if (
        e.key === 'Escape' &&
        !document.fullscreenElement &&
        document.body.classList.contains('karte-vollbild')
      )
        zeigeStand(false)
    })

    /* ── Filter und Suche im Graphen ────────────────────────────────────
     * Bereiche lassen sich ausblenden, die Suche hebt hervor statt zu filtern:
     * Ein Punkt ohne seine Nachbarn beantwortet die Frage nicht, die man an
     * eine Verweiskarte stellt. */

    var alleKnoten = [].slice.call(karteSvg.querySelectorAll('.knoten'))
    var alleBoegen = [].slice.call(karteSvg.querySelectorAll('.bogen'))
    var ausgeblendet = {}

    /* ── Der Graph lebt ───────────────────────────────────────────────────
     * Das gebaute SVG ist der Startzustand; hier laufen die Kräfte weiter.
     *
     * Zwei Dinge machen den Unterschied zwischen einer Grafik mit Lupe und
     * einer Karte, mit der man arbeitet:
     *
     * 1. Sie BEWEGT sich. Man zieht einen Knoten, die Nachbarn folgen, der
     *    Rest weicht aus — dabei sieht man, was zusammenhängt. Eine starre
     *    Zeichnung zeigt dieselben Kanten und sagt nichts.
     * 2. Beim Zoomen wächst der Text NICHT mit. Man zoomt, um mehr zu lesen,
     *    nicht um größere Buchstaben zu sehen: Die Etiketten behalten ihre
     *    Bildschirmgröße, dadurch passen bei jeder Stufe mehr davon nebenein-
     *    ander und die Schwelle für „alle anzeigen" wird von selbst erreicht.
     */

    var punkte = alleKnoten.map(function (g) {
      var t = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(g.getAttribute('transform')) || [0, 0, 0]
      return {
        g: g,
        abs: g.getAttribute('data-abs'),
        x: parseFloat(t[1]),
        y: parseFloat(t[2]),
        vx: 0,
        vy: 0,
        // Wer keine Kante hat, steht in der ABLAGE unter dem Feld und bleibt
        // dort: Ohne Feder hat ein Punkt im Kräftespiel keinen Ort, er würde
        // aus der Reihe geschoben und läge gleich wieder irgendwo. Die Reihe
        // ist eine Ordnung von Hand — die darf die Simulation nicht auflösen.
        fest: Number(g.getAttribute('data-grad'))
          ? null
          : { x: parseFloat(t[1]), y: parseFloat(t[2]) },
        heim: { x: parseFloat(t[1]), y: parseFloat(t[2]) },
        grad: Number(g.getAttribute('data-grad')) || 0,
        etikett: g.querySelector('.etikett'),
        r: parseFloat(g.getAttribute('data-r')) || 6,
      }
    })
    var nachAbs = {}
    punkte.forEach(function (p) {
      nachAbs[p.abs] = p
    })
    var federn = alleBoegen
      .map(function (linie) {
        return {
          linie: linie,
          a: nachAbs[linie.getAttribute('data-von')],
          b: nachAbs[linie.getAttribute('data-nach')],
        }
      })
      .filter(function (f) {
        return f.a && f.b
      })

    /* Der Schwerpunkt liegt NEBEN der Tafel, nicht in der Mitte des Bildes.
       Die Startlage rückt den Graphen rechts an die Tafel; die Kräfte ziehen
       ihn danach zurück zur Bildmitte — nach ein paar Sekunden lagen wieder
       Punkte hinter dem Glas. Gerechnet wird EINMAL (aus der Startlage in
       Weltkoordinaten): Hinge der Zug am aktuellen Ausschnitt, liefe der Graph
       jedem Schieben hinterher, statt sich schieben zu lassen. */
    var freiLinks = (function () {
      var r = karteSvg.getBoundingClientRect()
      var hud = document.querySelector('.karte-hud')
      if (!hud || !r.width) return 0
      return hud.getBoundingClientRect().right - r.left + 22
    })()
    var mitteX =
      (box.x +
        ((freiLinks + karteSvg.getBoundingClientRect().width) /
          2 /
          Math.max(1, karteSvg.getBoundingClientRect().width)) *
          box.width -
        stand.x) /
      stand.k
    var mitteY = (box.y + box.height / 2 - stand.y) / stand.k
    var hitze = 0.35
    var laeuft = false

    var schritt = function () {
      // Abstoßung: 43 Knoten sind 900 Paare je Bild — für eine Schleife in
      // JavaScript nichts, und ein Quadtree wäre hier mehr Code als Nutzen.
      for (var i = 0; i < punkte.length; i++) {
        for (var j = i + 1; j < punkte.length; j++) {
          var a = punkte[i]
          var b = punkte[j]
          var dx = b.x - a.x
          var dy = b.y - a.y
          var d2 = dx * dx + dy * dy || 0.01
          // DIESELBEN ZAHLEN WIE BEIM BAUEN (grafiken.mjs `verteile`).
          // Standen sie auseinander, hatte der Browser ein anderes
          // Gleichgewicht als die gebaute Lage: Der Graph dehnte sich in den
          // ersten Sekunden um gut ein Zehntel, und der Ausschnitt, der beim
          // Laden genau passte, schnitt danach oben und rechts ab.
          var kraft = 26000 / d2
          var d = Math.sqrt(d2)
          a.vx -= (dx / d) * kraft
          a.vy -= (dy / d) * kraft
          b.vx += (dx / d) * kraft
          b.vy += (dy / d) * kraft
        }
      }
      federn.forEach(function (f) {
        var dx = f.b.x - f.a.x
        var dy = f.b.y - f.a.y
        var d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        var ruhe = 130 + Math.min(120, (f.a.grad + f.b.grad) * 4)
        var kraft = (d - ruhe) * 0.012
        f.a.vx += (dx / d) * kraft
        f.a.vy += (dy / d) * kraft
        f.b.vx -= (dx / d) * kraft
        f.b.vy -= (dy / d) * kraft
      })
      punkte.forEach(function (p) {
        // Ein sanfter Zug zur Mitte hält den Graphen zusammen; ohne ihn
        // driften die Randgruppen mit jedem Zug weiter nach außen.
        p.vx += (mitteX - p.x) * 0.0016
        p.vy += (mitteY - p.y) * 0.0016
        if (p.fest) {
          p.x = p.fest.x
          p.y = p.fest.y
          p.vx = 0
          p.vy = 0
        } else {
          p.x += Math.max(-40, Math.min(40, p.vx)) * hitze
          p.y += Math.max(-40, Math.min(40, p.vy)) * hitze
        }
        p.vx *= 0.72
        p.vy *= 0.72
        p.g.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')')
      })
      federn.forEach(function (f) {
        f.linie.setAttribute('x1', f.a.x.toFixed(1))
        f.linie.setAttribute('y1', f.a.y.toFixed(1))
        f.linie.setAttribute('x2', f.b.x.toFixed(1))
        f.linie.setAttribute('y2', f.b.y.toFixed(1))
      })
    }

    var bild = function () {
      schritt()
      hitze *= 0.94
      // Unter dieser Schwelle sieht man keine Bewegung mehr — weiterzurechnen
      // hieße, ein stehendes Bild sechzigmal je Sekunde neu zu zeichnen.
      if (hitze > 0.004) requestAnimationFrame(bild)
      else laeuft = false
    }
    var erhitze = function (wert) {
      hitze = Math.max(hitze, wert || 0.3)
      if (!laeuft) {
        laeuft = true
        requestAnimationFrame(bild)
      }
    }
    erhitze(0.35)

    /* Etiketten und Strichstärken gegen den Zoom skalieren. */
    gegenSkalaHalter = function (k) {
      var f = 1 / k
      punkte.forEach(function (p) {
        // Der ABSTAND zum Kreisrand muss mitskaliert werden, nicht nur die
        // Schrift: Sonst rutscht das Etikett beim Hineinzoomen in den Knoten,
        // weil sein Versatz in Weltkoordinaten steht und der Knoten wächst.
        p.etikett.setAttribute(
          'transform',
          'translate(0 ' + (p.r + 9 * f).toFixed(1) + ') scale(' + f.toFixed(3) + ')',
        )
      })
      karteSvg.style.setProperty('--k', k.toFixed(3))
    }
    gegenSkalaHalter(1)

    /* Knoten ziehen. Ein Zug ist erst ein Zug, wenn die Maus sich bewegt hat —
       sonst verlöre man den Klick, der das Dokument öffnet.
       GEFANGEN wird der Zeiger deshalb erst bei der ersten Bewegung. Am
       `pointerdown` gesetzt, kostete die Fangleine genau den Klick, den der
       Kommentar darüber retten will: Solange ein Element den Zeiger hält,
       bekommt DIESES Element das `click`-Ereignis — es lief am Knoten vorbei
       aufs SVG, und kein Dokument der Karte ließ sich mehr öffnen. */
    var zug = null
    karteSvg.addEventListener('pointerdown', function (e) {
      var g = e.target.closest && e.target.closest('.knoten')
      if (!g) return
      var p = nachAbs[g.getAttribute('data-abs')]
      if (!p) return
      e.stopPropagation()
      var start = inWelt(e)
      zug = { p: p, dx: p.x - start.x, dy: p.y - start.y, bewegt: false, id: e.pointerId }
    })
    karteSvg.addEventListener('pointermove', function (e) {
      if (!zug) return
      if (!zug.bewegt) karteSvg.setPointerCapture(zug.id)
      var w = inWelt(e)
      zug.bewegt = true
      zug.p.fest = { x: w.x + zug.dx, y: w.y + zug.dy }
      erhitze(0.5)
    })
    var zugEnde = function () {
      if (!zug) return
      // Losgelassen wird der Knoten wieder frei: Ein Graph, in dem jeder
      // angefasste Punkt für immer klebt, ist nach zehn Zügen ein Diagramm
      // von Hand — und das war er vorher schon. Ein Punkt aus der Ablage kehrt
      // dorthin zurück; im Feld hätte er nichts, was ihn hält.
      zug.p.fest = zug.p.grad ? null : zug.p.heim
      erhitze(0.35)
      zug = null
    }
    karteSvg.addEventListener('pointerup', zugEnde)
    karteSvg.addEventListener('pointercancel', zugEnde)

    var wendeFilter = function () {
      alleKnoten.forEach(function (k) {
        k.style.display = ausgeblendet[k.getAttribute('data-bereich')] ? 'none' : ''
      })
      alleBoegen.forEach(function (bg) {
        var vonK = karteSvg.querySelector('.knoten[data-abs="' + bg.getAttribute('data-von') + '"]')
        var nachK = karteSvg.querySelector(
          '.knoten[data-abs="' + bg.getAttribute('data-nach') + '"]',
        )
        var weg =
          (vonK && vonK.style.display === 'none') || (nachK && nachK.style.display === 'none')
        bg.style.display = weg ? 'none' : ''
      })
    }

    ;[].slice
      .call(document.querySelectorAll('[data-karte-bereiche] .filterchip'))
      .forEach(function (chip) {
        chip.addEventListener('click', function () {
          var id = chip.getAttribute('data-bereich')
          ausgeblendet[id] = !ausgeblendet[id]
          chip.classList.toggle('an', !ausgeblendet[id])
          wendeFilter()
        })
      })

    var teilWahlKarte = document.querySelector('[data-karte-teil]')
    if (teilWahlKarte)
      teilWahlKarte.addEventListener('change', function () {
        var wahl = teilWahlKarte.value
        karteSvg.classList.toggle('sucht', wahl !== 'alle')
        alleKnoten.forEach(function (k) {
          var teile = (k.getAttribute('data-teile') || '').split(' ')
          k.classList.toggle('treffer', wahl !== 'alle' && teile.indexOf(wahl) >= 0)
        })
      })

    var karteSuche = document.querySelector('[data-karte-suche]')
    if (karteSuche)
      karteSuche.addEventListener('input', function () {
        var wort = karteSuche.value.trim().toLowerCase()
        karteSvg.classList.toggle('sucht', !!wort)
        alleKnoten.forEach(function (k) {
          k.classList.toggle('treffer', !!wort && k.getAttribute('data-titel').indexOf(wort) >= 0)
        })
      })

    ;[].slice.call(document.querySelectorAll('[data-zoom]')).forEach(function (k) {
      k.addEventListener('click', function () {
        var richtung = Number(k.getAttribute('data-zoom'))
        if (!richtung) {
          beruehrt = false
          stand = startLage()
          return zeichne()
        }
        zoomeAuf(stand.k * (richtung > 0 ? 1.35 : 1 / 1.35), {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        })
      })
    })
  }

  /* ── Verweis-Karte ────────────────────────────────────────────────────
   * Zeigen hebt die Nachbarschaft hervor. Beim Verlassen wird sie ganz
   * zurückgesetzt — ohne das Aufräumen bleibt nach schnellem Überfahren
   * dauerhaft die halbe Karte gedimmt. */

  var karte = document.querySelector('.verweiskarte')
  if (karte) {
    var knoten = [].slice.call(karte.querySelectorAll('.knoten'))
    var boegen = [].slice.call(karte.querySelectorAll('.bogen'))
    var gehalten = null

    var zuruecksetzen = function () {
      karte.classList.remove('fokussiert')
      knoten.concat(boegen).forEach(function (el) {
        el.classList.remove('aktiv')
      })
    }

    /** Ein Punkt und seine Nachbarschaft treten hervor, der Rest zurück. */
    var hebeHervor = function (k) {
      zuruecksetzen()
      if (!k) return
      var abs = k.getAttribute('data-abs')
      karte.classList.add('fokussiert')
      k.classList.add('aktiv')
      var nachbarn = {}
      boegen.forEach(function (b) {
        var von = b.getAttribute('data-von')
        var nach = b.getAttribute('data-nach')
        if (von === abs || nach === abs) {
          b.classList.add('aktiv')
          nachbarn[von] = nachbarn[nach] = true
        }
      })
      knoten.forEach(function (n) {
        if (nachbarn[n.getAttribute('data-abs')]) n.classList.add('aktiv')
      })
    }

    knoten.forEach(function (k) {
      k.addEventListener('mouseenter', function () {
        hebeHervor(k)
      })
      // Beim Verlassen fällt die Karte auf das ZURÜCK, was festgehalten ist —
      // nicht auf nichts. Sonst wäre ein gehaltener Punkt beim ersten
      // Mausweg wieder weg.
      k.addEventListener('mouseleave', function () {
        hebeHervor(gehalten)
      })

      /* GEÖFFNET wird mit dem DOPPELKLICK.
         Auf einem Einzelklick lag das Dokument denkbar ungünstig: Auf einer
         Fläche, die man schiebt und zieht, ist der einfache Klick die Geste,
         die dabei aus Versehen passiert — jeder Zug, der zu kurz gerät, war
         eine Navigation weg von der Karte. Der Einzelklick HÄLT stattdessen die
         Nachbarschaft fest. Das ist zugleich der Weg auf dem Touchgerät: Dort
         gibt es kein Zeigen, und ohne Klickbedeutung wäre die Hervorhebung
         dort gar nicht erreichbar. */
      k.addEventListener('click', function () {
        gehalten = gehalten === k ? null : k
        hebeHervor(gehalten)
      })
      k.addEventListener('dblclick', function (e) {
        e.preventDefault()
        location.href = auf + k.getAttribute('data-ziel')
      })
    })

    // Ein Klick ins Leere lässt wieder los. Ohne ihn bliebe die halbe Karte
    // gedimmt, und der einzige Weg zurück wäre, denselben Punkt wiederzufinden.
    karte.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.knoten')) return
      gehalten = null
      zuruecksetzen()
    })
  }
})()
