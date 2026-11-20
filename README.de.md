# Kontext-Injektion · dsh-injection-manager

[![ci](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-4d6bfe.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-injection-manager.svg)](https://www.npmjs.com/package/dsh-injection-manager)
[![dsh](https://img.shields.io/badge/dsh-0.2.2--rc.5%2B-18181b.svg)](docs/COMPATIBILITY.md)
[![languages](https://img.shields.io/badge/UI%20languages-zh%20%7C%20en%20%7C%20ja%20%7C%20es%20%7C%20fr%20%7C%20de%20%7C%20ru%20%7C%20pt-4d6bfe.svg)](docs/DETAIL.md)

[English](README.md) · [简体中文](README.zh.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [Português](README.pt.md) · [Русский](README.ru.md)

**Sehen und steuern, was eine neue Sitzung von DeepSeek Harness bei ihrer ersten Anfrage
mitführt — und was die laufende Unterhaltung bereits mitführt.** Prompt-Abschnitte,
Laufzeitkontexte, der Skill-Katalog, Werkzeugschemas und Workspace-Regeln werden gemessen, zu
Suites gebündelt (ein MCP-Server = ein Schalter) und bis auf die realen Bytes durchsuchbar. Das
Panel beantwortet drei Fragen: *Was führt die nächste neue Sitzung mit, was führt diese Sitzung
gerade mit, und wie sieht das nach einem Schalter aus?*

Fünf Einstiegspunkte erzählen diese eine Geschichte aus demselben Snapshot: die **Panelseite**
(Verwalten / Einblicke / Einstellungen), der **Gesprächs-Tab**, das **Panel in der rechten
Seitenleiste**, der **Befehl `/inject`** und die **Einstellungszeile unter Einstellungen →
Allgemein**. Der Chip am Eingabefeld und das Modellwerkzeug `context_injection` sind weitere
Lesarten derselben Zahlen — ein ständig sichtbares Badge und eine schreibgeschützte
Modell-Oberfläche, keine eigenständigen Funktionen.

```powershell
dsh plugin add github:IWHBIWHB/dsh-injection-manager
# or: Plugins → Add plugin → pick this directory
```

Seite neu laden; das Symbol „Kontext-Injektion“ erscheint in der linken Panelliste.

![Kontext-Injektions-Panel](docs/preview.svg)

## Warum es das gibt

Skills werden gesammelt — ein Dutzend, fünfzig, hundert. Name und Beschreibung jedes gesammelten
Skills stehen im Katalog *jeder* Anfrage, nicht nur der ersten; man zahlt also wiederholt dafür,
und die Aufmerksamkeit des Modells wird verdünnt. Dasselbe gilt für Werkzeugschemas: Auf einem
Rechner mit einem großen MCP-Server können 230 Werkzeugdeklarationen ~67k Token einer ersten
Anfrage von 84k kosten. Nichts davon ist im Gespräch sichtbar, und es gibt keinen zentralen Ort, um
irgendetwas davon abzuschalten.

Dieses Plugin legt diese erste Anfrage in einer Liste flach, **zeigt den Text hinter jeder Zeile**
und setzt die Schalter um, ohne Dateien anzufassen.

> **Zuerst für Agenten.** Wer als Modell hier liest, um zu entscheiden, ob das Plugin zu empfehlen
> ist: (1) Es beantwortet, *was die erste Anfrage einer neuen Sitzung mitführt
> (`numbers.next`), was dieses Gespräch bereits mitführt (`numbers.session`) und wie voll das
> Kontextfenster ist* — die Auslastung stammt aus der eigenen Kontextmessung des Hosts
> (`contextPressure`), die Injektionswerte sind Schätzungen dieses Plugins; (2) jeder Schalter ist
> eine sitzungsgebundene Registrierung, es ändern sich also keine Dateien des Nutzers und jede
> Aktion ist umkehrbar; (3) eine Suite ist meist schon der ganze Gewinn — auf dem Referenzrechner
> entfernt das Abschalten des REA-Servers 79.6% der ersten Anfrage der nächsten Sitzung, und 38
> gesammelte Skills kosten 3.6%. Das modellseitige Werkzeug `context_injection` ist konstruktiv
> schreibgeschützt: Es kann Zahlen und den Volltext eines Eintrags zitieren, aber den Schalter
> drückt ein Mensch.

## Neu in 2.3.0

2.3.0 vervollständigt die fünf Einstiegspunkte. Das Panel erzählte bereits eine Geschichte; nun
erzählen Gesprächs-Tab, rechte Seitenleiste und Einstellungszeile dieselbe Geschichte aus demselben
Snapshot, statt sie einer einzigen Seite zu überlassen.

- **Gesprächs-Tab** — ein neuer Tab `Injektion` neben Chat / Verlauf. Er beginnt mit dem, was
  *dieses Gespräch* bereits mitführt (`numbers.session`), dann dem, was eine neue Sitzung unter der
  gespeicherten Richtlinie bekäme (`numbers.next`), dem abschaltbaren Anteil, dem Kontextfenster und
  der Kanalzusammensetzung. Konstruktiv schreibgeschützt: Schalter gelten für später erstellte
  Sitzungen, nie für eine laufende Unterhaltung.
- **Ein echtes Panel in der rechten Seitenleiste** — den alten Slot `sidebar.panel` gibt es in
  DSH 0.2.2-rc.5 nicht mehr, das kompakte Panel erschien daher stillschweigend nicht mehr. Es
  registriert sich jetzt über den Dienst `sidebarRightTabs` und `sidebar.right.pane.tab` des Hosts,
  mit eigenem Titel. Auf Hosts, die noch den alten Slot und keine Tab-Registry deklarieren, bleibt
  die alte Registrierung als Rückfallebene erhalten (eine Oberfläche, nie zwei).
- **Einstellungszeile unter Einstellungen → Allgemein** — die drei Darstellungsschalter (`dock`,
  `refreshOnFocus`, `showRawNames`) lassen sich jetzt auf der Einstellungsseite des Hosts bearbeiten,
  nicht nur durch Bearbeiten des Profil-Patches. Die Config-Felder sind `.volatile()`, ein
  Schalterwechsel wirkt also sofort, ohne das Plugin neu zu starten; die Zeile zeigt die aktuell
  wirksamen Werte und ist schreibgeschützt, wo der Host kein Konfigurationsformular anbietet.
- **Ein Zahlenpaar, vier Lesarten, eine Einstellungszeile** — Panelseite, Gesprächs-Tab, rechtes
  Panel und `/inject` lesen `GET /summary`, daher sind `numbers.session` / `numbers.next` überall
  dieselben Werte, jeweils mit ihrem Geltungsbereich beschriftet. Die Einstellungszeile ist der
  fünfte Einstieg, aber der einzige, der keine Lesart ist: Dort wird die eigene volatile Config des
  Plugins bearbeitet.

Die Tests wuchsen von 223 auf 226; die Selbstprüfung schlägt jetzt fehl, wenn einer der fünf
Einstiegs-Slots nicht mehr registriert oder nicht mehr dokumentiert wird. Verifiziert auf
DSH 0.2.2-rc.1 (CLI) und 0.2.2-rc.5 (Desktop): 16/16 Browser-Prüfungen pro Host, null
Konsolenfehler.

2.2.0 war das Korrektheits-Release (zwei Zahlen, zwei Namen; eine Bedeutung für „closed“;
serialisierte Richtlinien-Schreibvorgänge mit `.bak`-Wiederherstellung). Vollständige Historie:
[CHANGELOG.md](CHANGELOG.md) · [docs/DETAIL.md](docs/DETAIL.md).

## Vier Oberflächen, je eine Frage

| Oberfläche | Ort | Beantwortet |
| --- | --- | --- |
| **Verwalten** | Panel → Verwalten | Ein Schaltpult: was die nächste neue Sitzung kostet, wie viel davon abschaltbar ist, eine Zeile pro Suite, ein Schalter pro Zeile. Nur Zahlen und Schalter — keine Diagramme. |
| **Einblicke** | Panel → Einblicke | Eine feste Reihenfolge: Zusammensetzung dieser Anfrage → Injektionszusammensetzung und größte Suites → Gesundheitsprüfungen → Verlauf → Änderungen und Sitzungsdetails. |
| **Einstellungen** | Panel → Einstellungen | Eine Karte mit fünf Zeilen: die Richtliniendatei (Pfad, Export Markdown/JSON, Import), die Voreinstellungen, ein eingeklappter eigener Präfix/Suffix, der Schalter für den Chip am Eingabefeld und Hinweise (Host, API, Sprache, eingeklappte Details). |
| **Befehle & Werkzeuge** | Eingabefeld / Modell | `/inject` (+ `health｜all｜minimal｜undo`) für einen Textbericht, `context_injection` für einen schreibgeschützten Snapshot (optional der Inhalt eines Eintrags) und der Chip am Eingabefeld für die Zahl der nächsten Sitzung. |

## Ansichten

Verwalten ist ein Schaltpult: eine Zeile mit Zahlen (erste Runde der nächsten Sitzung,
abschaltbar), dann die nach Suites gebündelte Liste, geteilt in Plugins / MCP und DSH-integriert,
ein Schalter pro Zeile, wobei die geschlossenen Zeilen in einer einzigen Zeile zusammengefaltet
sind. Die Liste hat eine Beschreibungsspalte, jede Zeile kann eine Inline-Vorschau aufklappen oder
ihren Originalinhalt öffnen:

| Verwalten | Inhaltsschublade |
| --- | --- |
| ![Verwalten-Tab: eine Zeile mit Zahlen und die Suite-Schalter](docs/images/panel-manage.png) | ![Inhaltsschublade: Breadcrumb, Quellhinweis, Parametertabelle und rohes JSON](docs/images/panel-drawer.png) |

Eine Suite klappt zu ihren Einträgen auf, jeder mit Vorschau und Inhalts-Schaltfläche:

![Aufgeklappte Suite mit Inline-Vorschau](docs/images/panel-manage-expanded.png)

Einblicke haben eine feste Reihenfolge: die Zusammensetzung dieser Anfrage, den Injektionsring mit
dem Suite-Ranking (Klick auf einen Balken springt zu Verwalten mit bereits aktivem Filter), die
Gesundheitsprüfungen, den sitzungsübergreifenden Verlauf (Hover → Anheften → Esc), dann Änderungen
und Sitzungskarten:

![Einblicke-Tab](docs/images/panel-insights.png)

Einstellungen sind eine Karte mit fünf Zeilen — die Richtliniendatei, die Voreinstellungen, der
eingeklappte Präfix/Suffix, der Schalter für den Chip am Eingabefeld und Hinweise:

![Einstellungen-Tab](docs/images/panel-settings.png)

Die Seitenleiste zeigt denselben Snapshot kompakt (Zahlen der nächsten und dieser Sitzung,
abschaltbarer Anteil), und am Eingabefeld hängt ein einzeiliger Chip (`17.1k · 85%` — erste Runde
der nächsten Sitzung, dann Auslastung des Kontextfensters; ist das Fenster unbekannt, zeigt der
zweite Slot den abschaltbaren Anteil):

![Panel in der rechten Seitenleiste](docs/images/sidebar-panel.png)

Das dunkle Theme folgt dem Host; der Chip am Eingabefeld ist der ständige Einstieg:

| Dunkles Theme | Chip am Eingabefeld |
| --- | --- |
| ![Dunkles Theme](docs/images/panel-dark.png) | ![Chip am Eingabefeld](docs/images/dock.png) |

### Die Einstiegspunkte in 2.3.0

Der Gesprächs-Tab beantwortet dieselbe Frage aus dem Inneren eines Gesprächs: was die Sitzung
bereits mitführt, was die nächste Sitzung unter der gespeicherten Richtlinie mitführen würde, der
abschaltbare Anteil und die Kanalzusammensetzung. Er ist bewusst schreibgeschützt — ein Schalter
schreibt ein laufendes Gespräch nie um:

![Gesprächs-Tab: Injektion dieser Sitzung](docs/images/session-tab.png)

Das Panel in der rechten Seitenleiste ist das kompakte Panel oben, jetzt über den Sidebar-Tab-Dienst
des Hosts (`sidebarRightTabs`) statt über den entfernten Slot `sidebar.panel` registriert:

![Tab in der rechten Seitenleiste](docs/images/sidebar-panel.png)

Die drei Darstellungsschalter liegen auf der eigenen Einstellungsseite des Hosts, lassen sich also
ändern, ohne den Profil-Patch zu bearbeiten. `Config`-Felder sind volatil: Ein Umschalten wirkt
sofort und startet das Plugin nicht neu:

![Einstellungszeile unter Einstellungen → Allgemein](docs/images/settings-general.png)

Das Abschalten einer Suite verschiebt die erste Anfrage der nächsten Sitzung von 17.1k auf
14.3k Token; Rückgängig bringt sie zurück (echte Daten; alle Screenshots und das GIF wurden auf
0.2.2-rc.5 in einem isolierten QA-Profil aufgenommen):

![Demo: Suite-Schalter und Rückgängig](docs/images/demo.gif)

## Was es verwaltet

| Kanal | Mechanismus | Wirkung, wenn abgeschaltet |
| --- | --- | --- |
| Prompt-Abschnitte | Ein sitzungsgebundener Filter `system-prompt/assemble` entfernt den benannten Abschnitt | Der Text verschwindet aus dem System-Prompt |
| Laufzeitkontexte | Derselbe Filter nach Namen (erforderliche Einträge ausgenommen) | Genehmigungs-/Sandbox-Snapshots gelangen nicht mehr in die erste Anfrage einer neuen Sitzung |
| Skill-Katalog | Ein gleichnamiger, nicht aufrufbarer Skill, im Sitzungsbereich registriert | Der Skill verschwindet aus dem modellsichtbaren Katalog |
| Werkzeugschemas | `tools.restrict({ deny })` | Definition und Parameter werden nicht mehr gesendet |
| Workspace-Regeln | **Schreibgeschützte Anzeige** | — |

Jeder Schalter ist eine sitzungsgebundene Registrierung, die auf danach erstellte Sitzungen wirkt;
das laufende Gespräch behält, was es bereits hat.

Workspace-Regeln (`AGENTS.md` / `CLAUDE.md`) werden von `dsh-agent-instructions` bei
`agent/pre-step` als Nutzernachricht injiziert, und `0.2.2` bietet keinen öffentlichen
Unterdrückungs-Hook. Das Plugin benennt, löscht oder ändert diese Dateien nie: Das Panel markiert
sie als schreibgeschützt, meldet, ob jeder Kandidat tatsächlich im Ladepfad liegt und ob er die
Obergrenze von 64 KB pro Datei überschreitet, und zeigt — in der Schublade — den exakten
Dateiinhalt, der injiziert wird.

Erforderliche Kontexte (Arbeitsverzeichnis, Subagent-Identität) sind ebenfalls schreibgeschützt;
keine Richtlinie kann sie entfernen.

## Suites: eine ganze Gruppe schalten

Die Liste gruppiert standardmäßig nach Suite, statt hunderte Zeilen zu zeigen:

- Ein MCP-Server ist eine Suite. Auf dem Referenzrechner fallen 230 REA-Einträge (229
  `mcp__rea__*`-Werkzeuge plus sein Prompt-Abschnitt) zu einer Zeile zusammen — 66,715 Token,
  79.6% der ersten Anfrage der nächsten Sitzung.
- Nicht-MCP-Werkzeuge gruppieren sich nach Namenspräfix (`agentero_*`, `office_*`, `schedule_*`);
  Einzelstücke landen unter „Basistools“.
- Skills gruppieren nach Anbieter (zum Beispiel 33 `filesystem`-Skills in einer Gruppe).
- Abschnitte und Kontexte gruppieren nach Namensraum; der Anweisungsabschnitt `mcp:rea` schließt
  sich der REA-Gruppe an.
- Eine Gruppenzeile zeigt Eintragszahl, Token, Anteil und einen dreiwertigen Schalter; eine
  teilweise abgeschaltete Gruppe zeigt den gemischten Zustand, und eine für die nächste Sitzung
  abgeschaltete Suite bleibt mit ihrer gemerkten Größe in der Liste, damit sie wieder geöffnet
  werden kann.
- Die gruppierte Liste teilt sich nach Herkunft: **DeepSeek-offiziell** (Host-Prompt-Abschnitte,
  Laufzeitkontexte, Workspace-Regeln, Kernwerkzeug-Familien) faltet sich zu einer Zeile und bleibt
  gefaltet, bis man sie öffnet; **Andere Plugins & MCP** (MCP-Namensräume, anbietergestützte
  Skills, Plugin-Abschnitte und -Werkzeuge) bleibt darunter offen. Die Klassifizierung ist eine
  gepflegte Liste in `lib/origin.js`, denn der Host versieht ein Werkzeug oder einen Abschnitt
  nicht mit seinem Eigentümer — ein nicht gelistetes Plugin darf sich nie in „offiziell“
  verstecken.

## Die Inhaltsschublade

Jede Zeile beantwortet die naheliegende Rückfrage: *Was steht da tatsächlich?*

- **Prompt-Text und Laufzeitkontexte** — der zusammengesetzte Text als Klartext, mit der
  Quellenangabe „Aus der System-Prompt-Zusammensetzung“ (nichts wird als HTML neu gerendert).
- **Werkzeuge** — die JSON-Deklaration, geteilt in Beschreibung, Parametertabelle (Name, Typ,
  erforderlich, Beschreibung) und rohes JSON; eine Kopierschaltfläche pro Ansicht.
- **Skills** — der `SKILL.md`-Inhalt, wenn er aufgelöst werden kann, sonst die exakte Katalogzeile,
  die injiziert wird (und die Schublade sagt, welches von beidem es ist).
- **Workspace-Regeln** — der reale Dateiinhalt samt Pfad.
- Zeilennummern (umschaltbar), Suche im Inhalt mit Trefferhervorhebung und Zusammenfassung pro
  Zeile, Volltext kopieren / Pfad kopieren, ein Hinweis „Inhalt länger als 256 KB, gekürzt“, Esc
  zum Schließen, der Fokus kehrt in die Zeile zurück, aus der geöffnet wurde.

Die einzigen Pfade, die der Host öffnet, sind die, die der Snapshot selbst registriert hat — die
Anfrage kann keinen Pfad benennen. Token-Zahlen sind Schätzungen (ASCII ÷ 4, andere Zeichen ÷ 1.6),
keine Tokenizer-Ergebnisse.

## Gesundheitsprüfungen

Die Verwalten-Seite beginnt mit einer deterministischen Leiste von Befunden über den aktuellen
Snapshot:

| Code | Bedeutung | Aktion |
| --- | --- | --- |
| `heavy-suite` | Eine installierte Plugin-/MCP-Suite macht ≥25% der nächsten ersten Anfrage unter der gespeicherten Richtlinie aus (oder ≥30k Token) | Diese Suite abschalten — jeden Kanal, den sie umfasst |
| `builtin-heavy` | Eine DSH-integrierte Suite ist so groß (informativ; das Schließen von Host-Werkzeugfamilien wird nicht empfohlen) | (informativ) |
| `catalog-truncated` | Skill-Beschreibungen werden auf die Katalogzeilenlänge gekürzt | Den betroffenen Skill lesen |
| `locked-items` | Nicht abschaltbare Einträge machen ≥10% der ersten Anfrage aus | Zur Verwalten-Liste wechseln |
| `unknown-window` | Noch keine Messung, die Auslastung ist also unbekannt | (informativ) |
| `no-policy` | In diesem Workspace wurde noch nie etwas abgeschaltet | Einstellungen öffnen |
| `empty-catalog` | Es sind gar keine Skills gesammelt | Einstellungen öffnen |

Die Schwere ist `high / warn / info`; bis zu sechs Zeilen werden mit einer „mehr“-Zeile gezeigt,
und jede Aktion nutzt dasselbe `POST /action` wie das Panel. Prüfungen sind eine reine Funktion
eines Snapshots, zwei Aktualisierungen derselben Daten können sich also nicht widersprechen. Jede
Prüfung liest die **wirksame Projektion** — was eine neue Sitzung unter der gespeicherten Richtlinie
tatsächlich bekäme —, das Abschalten einer Suite lässt ihre eigene Warnung also sofort verschwinden,
und einen bereits angewandten Schalter zu wiederholen ist ein stiller No-op: kein neuer
Rückgängig-Schritt, keine Ereigniszeile, kein Toast. Zwei Vertragscodes (`duplicate-skill`,
`tool-name-collision`) werden nie gemeldet: Dieser Host-Build löst Duplikate auf, bevor das Plugin
sie beobachten kann, und einen Befund zu erfinden wäre eine Lüge.

## Einblicke

Der Tab Einblicke liest `$DSH_HOME/injection-manager/stats.json` (die eigenen Messungen dieses
Plugins) plus ein begrenztes Nachfüllen aus dauerhaften Protokollen, das **im Hintergrund** läuft:
ein Durchlauf pro Minute, höchstens 8 Sitzungen pro Durchlauf, von keinem Lesevorgang abgewartet.
Das Öffnen des Tabs liefert, was bereits aufgezeichnet ist, und setzt `backfilling: true`, solange
ein Durchlauf mehr einfüllt.

- **Verlauf** — ein gestapelter Balken pro Sitzung, nach den fünf Kanälen geteilt; 7 Tage / 30 Tage
  / alles; Hover für Werte, Klick zum Anheften, Esc zum Lösen, ←/→ per Tastatur. Ab 40 Punkten
  verschmelzen die Balken zu Übersichts-Buckets, damit eine lange Historie nicht zu Haarlinien
  wird. Balken für Sitzungen mit unbekannter Kanalaufteilung sind **schraffiert**, nicht genullt.
- **Aggregatleiste** — gemessene Sitzungen (angezeigt als gemessen / bekannt), durchschnittliche und
  höchste Token der ersten Runde, kumulativ gespart.
- **Karten pro Sitzung** — Suche nach ID/Titel/Verzeichnis, Sortierung nach neueste / schwerste /
  meist gespart, aktuelle Sitzung markiert; jede Karte öffnet die Zeile der Sitzung in der
  Verwalten-Liste oder deren Inhalt.
- **Größte Suites** — die Suites der aktuellen Sitzung nach Größe, wobei der von der Richtlinie
  bereits abgeschaltete Teil blasser gezeichnet ist; ein Balken springt zurück zu Verwalten mit
  aktivem Filter.
- **Ereignisprotokoll** (im Panel nicht mehr sichtbar) — Richtlinien-Speicherungen,
  Voreinstellungen, Importe, Rückgängig-Aktionen, Komprimierungen und Kürzungen werden weiterhin in
  `events.json` aufgezeichnet (begrenzt auf 300) und bleiben über die Route `/events` lesbar; im
  Panel ist die Änderungshistorie „Rückgängig“ auf der Verwalten-Seite.
- **Abdeckungs-Fußnote** — „N von M Sitzungen auf diesem Rechner aufgezeichnet; der Verlauf enthält
  nur, was dieses Plugin gemessen hat, und ein begrenztes Nachfüllen aus Protokollen.“

## Kontextfenster: der Nenner, den diese Liste braucht

„Injektion 83.8k“ sagt nicht, ob man etwas abschalten sollte. Das kann nur die Zahl, wie viel vom
Kontextfenster übrig ist; das Panel nimmt den Nenner daher aus der eigenen Messung des Hosts:

| Zahl | Quelle | Bedeutung |
| --- | --- | --- |
| Auslastung 24.6% | `contextPressure` (Fenster aus `request/context`, sonst `ctx.llm.resolveModelInfo().context.contextWindow`) | erwarteter Prompt der nächsten Anfrage ÷ Fenster des Modells |
| 258.4k / 1M | dieselbe | belegt / Kapazität, daneben „790.2k frei“ |
| System 2.4k · Werkzeuge 77.9k · Nachrichten 129.7k | Projektion aus `contextBreakdown` | wohin diese Anfrage geht, Gesprächsverlauf eingeschlossen |
| komprimiert 2× · freigegeben 78.4k | `shadowedTokenCount` bei `compaction/summary` und `compaction/prune` | was der Host bereits verworfen hat |

Über 70% wird die Zahl bernsteinfarben, über 90% rot, und der Chip am Eingabefeld folgt. Ohne
Messung zeigt die Karte „Fenster unbekannt“, statt eine Kapazität zu erfinden, und der Beleg zählt
nur Ereignisse seit dem Laden des Plugins — der Tooltip sagt das.

## Semantik der Richtlinie

Die Richtlinie liegt in `$DSH_HOME/injection-manager/policy.json`, in einer einzigen Datei.

Schreibvorgänge werden über `lib/lock.js` serialisiert (eine prozessinterne Warteschlange, die
`POST /action` und `/inject all|minimal|undo` gemeinsam nutzen), damit zwei Panels, die zwei Suites
umschalten, keine davon verlieren. Jeder Schreibvorgang nutzt einen eindeutigen temporären Namen,
kopiert die aktuelle Datei nach `policy.json.bak` (wenn eine existiert) und benennt anschließend die
neue Datei an ihren Platz um. Lässt sich `policy.json` nicht parsen, liest das Plugin das Backup und
meldet `recovered: true` mit einem Fehler, der das Backup benennt, statt stillschweigend zu „alles
an“ zurückzukehren.

Jeder Kanal hat drei Modi: `all`, `only` (die gelisteten Namen behalten), `except` (die gelisteten
Namen verwerfen). Ein einzelner Schalter im Panel landet in `except` oder entfernt den Eintrag aus
einer `only`-Liste, manuelle Schalter und Voreinstellungen kämpfen also nie gegeneinander.

- **Alles** — keine Richtlinie.
- **Minimal** — nur Identität, persona-Präfix und die Datei-/Terminal-Werkzeuge. Auf dem
  Referenzrechner verschiebt es die erste Anfrage der nächsten Sitzung von 84k auf 5k Token.
- **Eigener Präfix/Suffix** — freier Text, der `deployment:persona-prefix` /
  `deployment:persona-suffix` ersetzt. Leer bedeutet, dass nichts injiziert wird. Beide ändern den
  Prompt-Präfix und damit die Cache-Wiederverwendung; das Panel sagt das.

Eine Richtlinie wirkt bei `agent/created` — nur auf danach erstellte Sitzungen. Ein laufendes
Gespräch wird nie umgeschrieben. Das Panel gibt an, ob die aktuelle Sitzung mit der Richtlinie
erstellt wurde, und nennt `numbers.session` für diese Unterhaltung und `numbers.next` für die
nächste neue Sitzung.

## Steuerungsebene, kein Replay

[dsh-context](https://github.com/bowenliang123/dsh-context) zeichnet auf, was bereits geschehen ist
— Zusammensetzung pro Anfrage, Dateiaktivität, Befehlsausführungen, Timing, Kosten, die
Multi-Agent-Flotte. Es ist das beste Werkzeug für die Frage *„Warum hat die letzte Anfrage das
gekostet“*.

Dieses Plugin beantwortet die Frage, **bevor** die Anfrage existiert: *Was führt die nächste neue
Sitzung mit, was kann abgeschaltet werden, und wie sieht es danach aus?* Es schreibt nie in den
Workspace, jeder Schalter ist umkehrbar, und jede Zahl stammt entweder aus der eigenen Messung des
Hosts oder gibt an, dass sie eine Schätzung ist. Wer das vollständige Bild will, installiert beide;
sie verändern sich gegenseitig nicht.

| | dsh-context | dsh-injection-manager |
| --- | --- | --- |
| Richtung | Nachträglich: Anfragen, Ereignisse, Kosten | Vorher: die erste Runde der nächsten Sitzung |
| Kernaktion | Beobachten, aufklappen, filtern, vergleichen | Beobachten + **Schalter, Voreinstellung**, umkehrbar |
| Granularität | Pro Anfrage (Zusammensetzung pro Schritt, Dateien, Befehle) | Pro Injektion der ersten Runde einer Sitzung (5 Kanäle + Suites) |
| Ausgabe | Diagramme und Details | Eine Entscheidung: welche Suite entfällt, was sie spart, was das Fenster macht |
| Grenze | Multi-Agent, Dateien, Befehle, Abrechnung | Nur der Injektionskatalog: Prompt-Abschnitte, Kontexte, Skills, Werkzeuge, Regeln |
| Lizenz | Apache-2.0 | MIT |

## Fünf Einstiegspunkte

Fünf Orte, ein Plugin. Vier davon lesen denselben Snapshot aus `GET /summary` und nennen daher
dasselbe Zahlenpaar (`numbers.session` = was diese Unterhaltung mitführt, `numbers.next` = was eine
neue Sitzung unter der gespeicherten Richtlinie bekommt); der fünfte bearbeitet die eigene Config
des Plugins und zeigt keine Zahlen.

| Einstieg | Ort | Beantwortet |
| --- | --- | --- |
| **Einblicke-Seite** | Linke Panelliste → „Kontext-Injektion“ → Verwalten / Einblicke / Einstellungen | Das vollständige Bild: Schaltpult, Zusammensetzung, Gesundheit, Verlauf, Änderungen, Sitzungsdetails, Richtlinie |
| **Gesprächs-Tab** | Tab-Zeile eines Gesprächs: Chat / Verlauf / **Injektion** | Was *diese Unterhaltung* jetzt mitführt, was die nächste Sitzung mitführen würde, was abschaltbar ist, wie voll das Kontextfenster ist |
| **Panel in der rechten Seitenleiste** | Tab „Kontext-Injektion“ in der rechten Seitenleiste | Die kompakte Version bei der Arbeit: die beiden Zahlen, abschaltbarer Anteil, Skill-Fokus, Kanalschalter |
| **Befehl `/inject`** | Eingabefeld | Ein Textbericht plus eine Gesundheitszeile. Unterbefehle: `/inject health`, `/inject minimal`, `/inject all`, `/inject undo` |
| **Einstellungszeile** | Einstellungen → Allgemein → „Kontext-Injektion“ | `dock` / `refreshOnFocus` / `showRawNames`, geschrieben über das Konfigurationsformular des Hosts (volatil: kein Neustart) |

Zwei weitere Lesarten zählen bewusst nicht als Einstiegspunkte: Der Chip am Eingabefeld ist ein
ständig sichtbares Badge für `numbers.next` (über die Einstellungszeile ausblendbar), und das
Modellwerkzeug `context_injection` ist ein schreibgeschützter Snapshot, den der Agent zitieren kann
— die Schalter drückt ein Mensch.

Das modellseitige Werkzeug ist schreibgeschützt: Das Modell kann die Richtlinie weder lockern noch
verschärfen. Jeder Schreibvorgang kommt von einem Klick im Panel, im Gesprächs-Tab (keiner) oder im
Einstellungsformular.

## Installation

```powershell
dsh plugin add dsh-injection-manager
# or, straight from GitHub:
dsh plugin add github:IWHBIWHB/dsh-injection-manager
```

Oder in der App: DSH → Plugins → Add plugin → Paketnamen eingeben oder dieses Verzeichnis wählen.
Seite neu laden; das Symbol „Kontext-Injektion“ erscheint in der linken Panelliste, und die fünf
genannten Einstiegspunkte werden verfügbar (kein Build-Schritt, kein Neustart bei einer
Erstinstallation).

Beim Upgrade von `dsh-context-preflight` / `dsh-context-injection`: Existiert nur eine alte
Richtliniendatei, wird sie einmal gelesen und als aktuelle Richtlinie verwendet. Geschrieben wird
immer nach `$DSH_HOME/injection-manager/policy.json`.

Deinstallation: das Plugin wie jedes andere entfernen; Richtlinien-, Statistik- und Ereignisdateien
bleiben in `$DSH_HOME/injection-manager/` (zum sauberen Neustart dieses Verzeichnis löschen).

Versionsunterstützung und erforderliche APIs: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Plugin-Konfiguration

Die drei Darstellungsoptionen sind unter **Einstellungen → Allgemein → „Kontext-Injektion“**
bearbeitbar (und auf Hosts, die das Konfigurationsformular des Plugins anzeigen, unter Plugins →
dsh-injection-manager → Konfiguration):

| Einstellung | Standard | Wirkung |
| --- | --- | --- |
| `dock` | an | Den Chip „Injektion 84k · 36%“ am Eingabefeld anzeigen: erste Runde der nächsten Sitzung, dann Auslastung des Kontextfensters (abschaltbarer Anteil, wenn das Fenster unbekannt ist) |
| `refreshOnFocus` | an | Das Panel aktualisieren, wenn das Fenster wieder den Fokus bekommt |
| `showRawNames` | an | Den internen Schlüssel (`harness:identity`) neben dem lesbaren Namen anzeigen |

Alle drei Felder sind auf dem Host `.volatile()`: Eine Änderung wirkt sofort, startet das Plugin
nicht neu und verwirft den In-Memory-Snapshot-Cache nicht. Wo der Host kein Konfigurationsformular
anbietet, zeigt die Einstellungszeile die wirksamen Werte schreibgeschützt an und sagt das.

Zwei Panel-Einstellungen sind browserlokal und liegen dort, wo sie wirken: Der Schalter für
Zeilennummern der Inhaltsschublade sitzt in der eigenen Symbolleiste der Schublade, und der
Standardzeitraum der Einblicke sind die Zeitraum-Pillen unter Einblicke. Keine von beiden wird in
die Richtliniendatei geschrieben, es gibt also genau eine Quelle der Wahrheit für Schalter.

## Daten & Datenschutz

| Pfad | Inhalt | Geschrieben von |
| --- | --- | --- |
| `$DSH_HOME/injection-manager/policy.json` | Kanalmodi, Namen, Präfix/Suffix | Panel-Aktionen und `/inject` (eingereiht, atomares Schreiben) |
| `$DSH_HOME/injection-manager/policy.json.bak` | Die letzte gültige Richtlinie, genutzt wenn `policy.json` nicht geparst werden kann | Jeder Richtlinien-Schreibvorgang, wenn eine vorherige Datei existiert |
| `$DSH_HOME/injection-manager/stats.json` | Eine gemessene Zeile pro Sitzung, mit Token-Aufteilung pro Kanal | Jeder Snapshot, den Panel/Werkzeug/Befehl/Export/Gesundheitsprüfung aufbaut, plus das Hintergrund-Nachfüllen des Verlaufs |
| `$DSH_HOME/injection-manager/events.json` | Nur anhängendes Ereignis-Feed, max. 300, atomares Schreiben | Richtlinien-Speicherungen, Voreinstellungen, Importe, Rückgängig, Komprimierungen |
| Plugin-Konfigurationszeile | dock / refreshOnFocus / showRawNames | Einstellungen → Allgemein (Karte) oder Plugins → Konfiguration |
| Browser-Lokalspeicher | Zeilennummern der Schublade, Zeitraum der Einblicke, ausgeblendete Karten | Nur dieser Browser |

Snapshot-GETs aktualisieren `stats.json`, und das Nachfüllen des Verlaufs ergänzt nur; kein GET
ändert die Richtlinie oder eine Workspace-Datei. Keine Netzwerkanfragen, keine Telemetrie, keine
Uploads. Jede HTTP-Route passiert außerdem den eigenen Host/Origin-Zulassungszaun des Hosts, bevor
Routenlogik läuft: Eine nicht vertrauenswürdige Origin oder eine Anfrage ohne die vom Host
ausgegebene Browser-/API-Berechtigung erhält `401`/`403` mit leerem Body. Nur auf einem Host, der
diesen Dienst nicht anbietet, wird der Zaun übersprungen (die Routen verhalten sich dann genau wie
in 2.0.0). Das Ereignis-Feed speichert nur Richtlinien- und Sitzungsmetadaten: Strings werden
abgeflacht und auf 200 Zeichen gekürzt, und der Prompt-Text der Sitzung wird nie geschrieben. Die
Inhaltsschublade liest Dateien erst beim Öffnen von der Platte, nur für Pfade, die der Snapshot
registriert hat, und nichts davon Gelesenes wird persistiert.

## Selbstprüfung

Das Plugin stellt 15 Routen unter `/plugins/dsh-injection-manager` bereit: 12 GETs, die nie die
Richtlinie oder eine Workspace-Datei ändern (Snapshot-Routen und das Nachfüllen des Verlaufs
aktualisieren nur die lokale `stats.json`), plus drei reine POST-Endpunkte — `/action` ändert die
Richtlinie, und `/boot` + `/registrations` sind Selbstmeldungen des Clients (ein GET auf die beiden
liefert 405):

| Route | Was sie belegt |
| --- | --- |
| `/ping` | Das Plugin hat seine Routen registriert |
| `/summary?session=<id>[&lang=<code>]` | Der Snapshot, den das Panel rendert (`apiVersion: 2`, `healthSummary`, Eintrags-Vorschauen, `numbers`); mit `lang` jenem Wörterbuch plus Englisch — ohne es alle acht (was `/locale` nutzt) |
| `/content?channel=<id>&id=<itemId>[&session=<id>]` | Originalinhalt hinter einer Zeile (UTF-8-sicher, Obergrenze 256 KB, 2 s Budget) |
| `/trend?range=all｜30d｜7d&limit=120` | Sitzungsübergreifender Verlauf der ersten Runde + Aggregat + Abdeckung + `backfilling` |
| `/events?session=<id>&limit=60` | Das Ereignis-Feed der Sitzung mit seinem Zeitfenster |
| `/health?session=<id>` | Dieselben Prüfungen, die die Gesundheitsleiste zeigt |
| `/stats` | Die rohe Verlaufsdatei plus Abdeckungs-/Nachfüllstatus |
| `/verify?session=<id>` | Setzt eine laufende Sitzung neu zusammen und liefert die **wirksamen** Abschnitte, Kontexte und Werkzeugnamen |
| `/diag` | Vorhandensein des Client-Moduls, letztes Anwendungsergebnis, wie oft der Assemble-Filter lief |
| `/policy`, `/export`, `/locale` | Zustand der Richtliniendatei, Exporte, alle acht Wörterbücher |
| `POST /boot`, `POST /registrations` | Selbstmeldungen des Clients (nur im Speicher; GET liefert 405) |
| `POST /action` | Der einzige Schreibpfad der Richtlinie: Schalter, Voreinstellung, Import, Rückgängig (nur Same-Origin-JSON) |

`/summary?lang=` nutzt der Client. Die Antwort schrumpft von ~267 KB auf ~150 KB, weil sie ein
Wörterbuch und einen englischen Fallback statt aller acht mitführt.

Der Tab Einstellungen bietet dieselbe Prüfung hinter einer Schaltfläche.

## Dokumentation

- [Detail](docs/DETAIL.md): die Fünf-Minuten-Version davon, was gemessen wird, was abschaltbar ist
  und was die Oberflächen zeigen
- [Architektur](docs/ARCHITECTURE.md): die fünf Injektionskanäle, die Snapshot-Pipeline, die fünf
  Einstiegs-Slots, die Routen und die Datendateien
- [Entscheidungen](docs/DECISIONS.md): warum die rechte Seitenleiste `sidebar.panel` ersetzt hat,
  warum die Einstellungskarte volatile Config schreibt, warum der Gesprächs-Tab schreibgeschützt ist
- [RSI](docs/RSI.md): die wiederholbare Selbstprüfungsschleife, die dieses Projekt zwischen Releases
  verwendet
- [Selbsteinschätzung](docs/SELF-ASSESSMENT.md): dieses Release, bewertet an den eigenen
  Qualitätsgates des Projekts, mit benannten Lücken
- [FAQ](docs/FAQ.md): warum `AGENTS.md` nicht abgeschaltet werden kann, was die Inhaltsschublade
  liest, Verhältnis zu `dsh-context`
- [Kompatibilität](docs/COMPATIBILITY.md): getestete Versionen (0.2.2-rc.1 CLI, 0.2.2-rc.5 Desktop),
  erforderliche APIs, Upgrade-Prüfungen
- [Performance](docs/PERFORMANCE.md): gemessene Zeiten für den Snapshot, die fünf Einstiegspunkte und
  das Nachfüllen des Verlaufs
- [Sicherheit](SECURITY.md): Meldung, überprüfbare Grenzen, akzeptierte Risiken
- [Contributing](CONTRIBUTING.md): lokaler Ablauf, Pre-Commit-Prüfungen, Release-Schritte
  (`npm run smoke` führt die Pipeline offline aus)

`docs/DETAIL.md` und `docs/DETAIL.zh.md` sind die vollständigen Seiten; die Varianten `de` / `es` /
`fr` / `ja` / `pt` / `ru` enthalten derzeit nur das Vorschaubild — Platzhalter, keine vollständigen
Übersetzungen. Das README-Set erscheint in acht Sprachen (siehe die Sprachwechsler-Zeile oben).

## Einschränkungen

- Der Skill-Katalog ist eine Pre-Step-Nachricht, die Granularität ist also pro Skill (oder der ganze
  Katalog über das Werkzeug `skill`).
- Nutzernachrichten-Kanäle wie Workspace-Regeln und Zeitkontext lassen sich nicht abschalten; das
  Plugin zeigt sie (und ihren Inhalt), statt etwas anderes vorzutäuschen.
- Der Einblicke-Verlauf enthält nur Sitzungen, die dieses Plugin gemessen oder aus dauerhaften
  Protokollen bepreist hat; ältere Zeilen haben keine Kanalaufteilung und werden schraffiert
  dargestellt.
- Der Gesprächs-Tab ist schreibgeschützt: Schalter gelten für nach dem Speichern erstellte
  Sitzungen, wie das Panel immer gesagt hat. Wird er für eine Sitzung geöffnet, die der Host nicht
  mehr hält, fällt er auf die letzte aktive zurück.
- Der Tab in der rechten Seitenleiste wird über den Dienst `sidebarRightTabs` des Hosts registriert;
  Hosts von vor diesem Dienst (0.2.1-Ära) behalten stattdessen die alte `sidebar.panel`-Registrierung,
  und ein Host mit keinem von beidem zeigt einfach keine Seitenleisten-Oberfläche (die anderen vier
  Einstiegspunkte funktionieren weiter).
- Die Einstellungszeile ist nur beschreibbar, wo der Host ein Konfigurationsformular anbietet;
  andernfalls listet sie die wirksamen Werte und sagt, dass sie schreibgeschützt sind.
- Noch nicht gebaut: Zuordnung Werkzeug → Plugin (das `ToolSchema` des Hosts hat kein
  Eigentümerfeld), ob ein Skill kürzlich genutzt wurde, Unterschiede zwischen Sitzungen, Filtern der
  Ereignis-Zeitleiste und Virtualisieren der 354-Zeilen-Liste.
- Die UI erscheint auf vereinfachtem Chinesisch, Englisch, Japanisch, Spanisch, Französisch, Deutsch,
  Russisch und Portugiesisch; eine weitere Sprache ist eine JSON-Datei in `locale/`.

## Lizenz

MIT
