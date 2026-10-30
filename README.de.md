<h1 align="center">aiFetchly</h1>

<p align="center">
  <strong>Desktop-KI-Agent für Geschäftsautomatisierung</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot;
  <a href="./README.zh.md">简体中文</a> &middot;
  <a href="./README.es.md">Español</a> &middot;
  <a href="./README.fr.md">Français</a> &middot;
  Deutsch &middot;
  <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="docs/images/readme/hero-ai-chat.png" alt="aiFetchly KI-Agent-Arbeitsbereich" width="900">
</p>

---

**aiFetchly** ist eine Open-Source-Desktop-Plattform für KI-Agenten im Geschäftsalltag. Sie verbindet lokales Wissen, Browser-Automatisierung, installierbare Skills, geplante Aufgaben, Plugins und spezialisierte Subagenten, damit Teams Recherche, Dokumentverarbeitung, Website-Datenerfassung, Kundenkommunikation und wiederkehrende Abläufe in einer Anwendung automatisieren können.

aiFetchly begann mit Marketing-Automatisierung wie Lead-Recherche, Kontaktextraktion und E-Mail-Outreach. Diese Workflows sind weiterhin enthalten, aber die Produktausrichtung ist breiter: aiFetchly wird zu einem local-first KI-Agenten-Arbeitsbereich für Business-Nutzer, die Tools, Gedächtnis, Dateien, Web-Automatisierung und kontrollierbare Ausführung benötigen.

## Was ist aiFetchly?

aiFetchly verwandelt geschäftliche Absichten in ausführbare Workflows:

- **Einem KI-Agenten Arbeit geben**: Recherche, Dateianalyse, Datenauszug, Nachrichtenentwürfe, Zusammenfassungen und Tool-Nutzung aus einer Chat-Oberfläche.
- **Eigenes Geschäftswissen nutzen**: Dokumente in eine lokale Wissensbibliothek hochladen und Antworten oder Entwürfe auf Basis eigener Dateien erzeugen.
- **Browser- und Datenaufgaben automatisieren**: Informationen von Websites sammeln, strukturierte Daten erfassen, URL-Listen verarbeiten und Ergebnisse exportieren.
- **Den Agenten einen echten Browser steuern lassen**: Öffnen Sie ein sichtbares Chrome-Fenster, das die KI beobachtet und bedient. Sie sehen jeden Schritt, geben wichtige Aktionen frei und übernehmen selbst, wenn eine Anmeldung oder Prüfung nötig ist. Siehe [Automatisierung mit verwaltetem Browser](#automatisierung-mit-verwaltetem-browser).
- **An spezialisierte Subagenten delegieren**: Hintergrundagenten mit eigenem Prompt, Tool-Rechten, Ressourcenlimits und strukturierten Ausgaben starten.
- **Arbeitsbereich erweitern**: Skills und Plugins installieren, um Tools, Geschäftsworkflows und Integrationen hinzuzufügen.
- **Kontrolle behalten**: Daten lokal in SQLite speichern, Tool-Aktivität prüfen, Berechtigungen steuern und auf dem eigenen Desktop ausführen.

## Screenshots

### KI-Agent-Arbeitsbereich

![aiFetchly KI-Agent-Arbeitsbereich](docs/images/readme/hero-ai-chat.png)

### Wissensbibliothek

![aiFetchly Wissensbibliothek](docs/images/readme/knowledge-library.png)

### Skill- und Plugin-Verwaltung

![aiFetchly Plugin-Verwaltung](docs/images/readme/plugin-manager.png)

### AI-Provider-Einstellungen

![aiFetchly AI-Provider-Einstellungen](docs/images/readme/ai-provider-settings.png)

## Agent-Funktionen

### KI-Agent-Arbeitsbereich

| Funktion | Beschreibung |
|----------|--------------|
| **KI-Chat mit Tools** | Arbeiten Sie mit einem Assistenten, der freigegebene Tools aufrufen, Geschäftskontext nutzen und mehrstufige Aufgaben erledigen kann. |
| **Eigene AI Provider** | Nutzen Sie OpenAI-kompatible Anbieter wie Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI oder eigene Endpunkte. |
| **Ausführung von Business-Aufgaben** | Recherche, Extraktion, Dateiverarbeitung, Nachrichtenerstellung, Planung und Automatisierung ohne Wechsel zwischen mehreren SaaS-Tools. |
| **KI-Assistent für Kunden-E-Mails** | Entwerfen, senden und beantworten Sie Kunden-E-Mails mit Kontext aus Dokumenten und Workflow-Daten. |
| **Spezialisierte Subagenten** | Starten Sie autonome Subagenten mit eigenem Systemprompt, Tool-Allowlist, Ressourcenlimits und strukturierter Ausgabe. |
| **Berechtigungsgesteuerte Automatisierung** | Kontrollieren Sie, welche Tools, Plugins, Hooks und Subagenten ausgeführt werden dürfen. |

### Geschäftswissen und RAG

| Funktion | Beschreibung |
|----------|--------------|
| **Wissensbibliothek** | Laden Sie PDF, TXT, DOC/DOCX, Markdown, HTML, CSV und Excel in eine lokale Wissensbasis für Retrieval-Augmented Generation. |
| **Dokumentverarbeitung** | Erkennen Sie doppelte Uploads, verfolgen Sie Fortschritt, chunking von Dokumenten und speichern Sie Vektor-Embeddings. |
| **Embedding-Modell-Einstellungen** | Wählen und aktualisieren Sie das Embedding-Modell mit sichtbaren Metadaten wie Dimensionen und Verfügbarkeit. |
| **Fundierte Business-Antworten** | Erstellen Sie Zusammenfassungen, Pläne, E-Mails, Berichte und Handlungsanleitungen mit eigenen Dokumenten als Kontext. |

### Skills, Plugins und Erweiterbarkeit

| Funktion | Beschreibung |
|----------|--------------|
| **Installierbare Skills** | Erweitern Sie den Agenten mit wiederverwendbaren Paketen für Dateiverarbeitung, Analyse, Automatisierung und Fachdomänen. |
| **Skill-Verwaltung** | Importieren Sie Skills aus ZIPs, listen Sie eingebaute, installierte und pluginbasierte Skills und aktivieren oder entfernen Sie sie. |
| **Plugin-Verwaltung** | Importieren Sie Plugins aus ZIPs oder Quellordnern und verwalten Sie Status, Gesundheit, Format, Skills und MCP-Server. |
| **Kompatibilität mit Claude-Style-Plugins** | Unterstützt aiFetchly-Plugins und Claude-Style-Pakete, die Skills und MCP-Serverdefinitionen bereitstellen. |
| **Hook-Verwaltung** | Erstellen Sie Command-Hooks für AI/chat-Ereignisse wie Sitzungsstart, Prompt-Abgabe, Tool-Nutzung, Berechtigungsanfragen und Stop. |

### Web-, Daten- und Workflow-Automatisierung

| Funktion | Beschreibung |
|----------|--------------|
| **KI-gesteuerter verwalteter Browser** | Übergeben Sie dem Agenten ein echtes, sichtbares Chrome-Fenster: Seiten öffnen, lesen, klicken, tippen, navigieren, Daten extrahieren und für menschliche Übernahme pausieren. Funktioniert auf öffentlichen Websites ohne gespeichertes Konto und nutzt bei Bedarf die Anmeldung eines Tool Accounts. |
| **Automatisierte Web-Recherche** | Suchen Sie über Suchmaschinen, sammeln Sie Geschäftsinformationen, verarbeiten Sie URL-Listen und erholen Sie sich von Task-Fehlern. |
| **Strukturierte Datenextraktion** | Extrahieren Sie E-Mails, Telefonnummern, Adressen, Social-Profile, Firmendaten und Verzeichniseinträge. |
| **Aufgabenplanung** | Planen Sie Tasks mit cron, verketten Sie abhängige Jobs, erstellen Sie wiederkehrende Workflows und überwachen Sie Historie. |
| **Ein-Klick-Export** | Laden Sie Datensätze als CSV herunter und erzeugen Sie Berichte. |
| **Proxy-Verwaltung** | Verwalten Sie HTTP-, HTTPS- und SOCKS5-Proxies mit Massenimport, Validierung und Tests. |

### Enthaltene Growth-Workflows

| Workflow | Beschreibung |
|----------|--------------|
| **Unternehmens- und Lead-Recherche** | Finden Sie Unternehmen über Suchmaschinen, Google Maps, Yandex Maps, Yellow Pages und ähnliche Verzeichnisse. |
| **Kontaktextraktion** | Verarbeiten Sie URL-Listen und extrahieren Sie E-Mails, Telefonnummern, Adressen und Social-Profile mit Live-Fortschritt. |
| **KI-E-Mail-Entwürfe** | Erzeugen Sie personalisierte Business-E-Mails mit RAG und hochgeladenen Dokumenten. |
| **Kunden-E-Mails senden und beantworten** | Unterstützt Versand und kontextbezogene Antworten auf Basis von Wissensbasis, Kundendaten und Workflow-Ergebnissen. |
| **Social-Platform-Operationen** | Verwalten Sie Social Accounts und automatisieren Sie unterstützte Social-Media-Workflows. |

## Erste Schritte

### Voraussetzungen

- **Betriebssystem**: Windows 10+, macOS 10.15+ oder Linux (Ubuntu 20.04+)
- **RAM**: mindestens 4 GB, empfohlen 8 GB

### Erstkonfiguration

1. Öffnen Sie aiFetchly und melden Sie sich an.
2. Importieren Sie Dokumente in die Wissensbibliothek, wenn Antworten auf eigenen Dateien basieren sollen.
3. Installieren oder aktivieren Sie Skills und Plugins für die gewünschten Workflows.
4. Konfigurieren Sie einen eigenen Provider unter System Settings -> AI Provider, wenn AI Chat Ihr eigenes Modell verwenden soll.
5. Konfigurieren Sie Proxies, Social Accounts oder SMTP nur für Web-, Social- oder E-Mail-Workflows.

## Entwicklung

### Voraussetzungen

- **Node.js** 18+
- **Yarn** 1.x classic

```bash
yarn install
cp .env.example .env
yarn init
yarn dev
yarn tsc
yarn vue-check
yarn build
yarn make
```

### Tests

```bash
yarn test
yarn testmain
yarn vitest-googlescraper
yarn testhttpclient
yarn testyoutubeupload
yarn testdownload
```

### Architektur

aiFetchly folgt einer Drei-Schichten-Architektur:

```text
IPC Handler  ->  Module (Geschäftslogik)  ->  Model (Datenzugriff)
```

- **Models** (`src/model/`) behandeln TypeORM-Operationen und SQL-Abfragen.
- **Modules** (`src/modules/`) enthalten Geschäftslogik, Validierung und Koordination zwischen Models.
- **IPC Handlers** (`src/main-process/`) sind nur für Kommunikation zuständig und greifen nie direkt auf die Datenbank zu.

Worker in `src/childprocess/` führen rechenintensive Aufgaben wie Scraping und KI-Verarbeitung aus. Sie senden Ergebnisse per IPC an den Hauptprozess.

## AI-Provider-Konfiguration

AI Chat kann die gehostete aiFetchly-KI oder einen vom Nutzer konfigurierten OpenAI-kompatiblen Provider verwenden. Öffnen Sie **System Settings -> AI Provider**, um den Modus zu wechseln und einen lokalen oder eigenen Provider zu speichern.

## Automatisierung mit verwaltetem Browser

aiFetchly enthält einen Browser, den der KI-Agent tatsächlich steuern kann. Der Agent öffnet ein normales, sichtbares Chrome-/Chromium-Fenster auf Ihrem Desktop, beobachtet die Seite und führt die gewünschten Schritte aus, während die Anwendung Sitzungsstatus, Freigaben, Fortschritt und Ergebnisse anzeigt.

Die Funktion ist für Websites und Konten gedacht, die Ihnen gehören oder die Sie betreiben dürfen. Sie umgeht weder MFA noch Anmelde- oder Sicherheitsprüfungen, Plattform-Sicherheitskontrollen oder Zugriffsbeschränkungen.

### Sitzung starten

- **AI Chat**: Beschreiben Sie eine Aufgabe, die einen Browser braucht – der Agent lädt die Browser-Tools selbst.
- **Tool Account → Open managed browser**: Nutzt die gespeicherte Anmeldung eines Kontos für seine Plattform.
- **Sitzungskarte im Arbeitsbereich**: Laufenden Browser ansehen, steuern oder stoppen.

Öffentliches Surfen braucht kein Konto. Jede Website – auch soziale Netzwerke und Seiten mit Anmeldepflicht – lässt sich ohne gespeicherten Tool Account öffnen; ist eine Anmeldung nötig, übergibt aiFetchly dasselbe Fenster an Sie, statt das Öffnen zu verweigern oder auf einen HTTP-Abruf auszuweichen. Mit einem gespeicherten Konto wird stattdessen die verschlüsselte Cookie-Sitzung wiederverwendet.

### Verfügbare Browser-Tools

| Tool | Zweck |
|------|-------|
| `browser_start_session` | Sitzung für eine URL oder einen gespeicherten Tool Account starten |
| `browser_get_status` | Sitzungsstatus und bereinigte aktuelle URL lesen |
| `browser_observe` | Begrenzten semantischen Snapshot der Seite und ihrer Elemente holen |
| `browser_navigate` | Zu einer erlaubten `http(s)`-URL navigieren |
| `browser_run_actions` | Begrenztes strukturiertes Programm ausführen (Klick, Eingabe, Scrollen, Warten, Extrahieren, Schleife) |
| `browser_screenshot` | Vorschaubild der Seite für die Unterhaltung aufnehmen |
| `browser_request_handoff` | Pausieren und Sie um Übernahme bitten |
| `browser_resume_after_handoff` | Nach Ihrer Bestätigung fortsetzen |
| `browser_evaluate_script` | Geprüftes JavaScript im Seitenkontext ausführen (mit Freigabe) |
| `browser_clear_cache` | Cache des aktuellen Kontos nach Bestätigung leeren |
| `browser_stop_session` | Browser stoppen und schließen |

`browser_observe` liefert Referenzen wie `@e1 [button] "Search"` zusammen mit einer Seitenrevision; veraltete Referenzen werden nach Navigation oder Neuladen abgelehnt, damit nicht das falsche Element angeklickt wird.

### Freigaben und Sicherheit

| Risiko | Beispiele | Verhalten |
|--------|-----------|-----------|
| Beobachten | Text lesen, Elemente prüfen, Screenshot | Freigabe auf Sitzungsebene |
| Umkehrbare Interaktion | Suchen, Filtern, Blättern, Entwerfen | Freigabe auf Sitzungsebene |
| Sensible Eingabe | E-Mail, Telefon, private Nachricht, Upload | Vorschau und ausdrückliche Freigabe |
| Folgenreich | Senden, Veröffentlichen, Kommentieren, Folgen, Hochladen, Löschen, Kaufen, Einstellungen ändern | Freigabe im Einzelfall mit Konto, Ziel und Wirkung |
| Privilegiertes Skript | Jedes JavaScript in der Seite | Skript, Origin, Zweck, Timeout und erwartete Ausgabe vor der Freigabe |
| Authentifizierung | Passwort, MFA, Passkey, Sicherheits-CAPTCHA | Immer manuell durch Sie |

Seiteninhalte gelten als nicht vertrauenswürdige Daten: Eine Website kann den Agenten nicht zu einer übersprungenen Freigabe überreden, das Modell kann seine eigene Aktion nicht als sicher markieren, und eine ausdrückliche Ablehnung bleibt bestehen. Cookies gelangen nie in Renderer, Modell, Tool-Ergebnisse, Logs oder Analytics – nur der Hauptprozess entschlüsselt sie, nur der Browser-Worker wendet sie an. Nach erfolgreicher Anmeldung wird die erneuerte Sitzung wieder verschlüsselt gespeichert.

### Einstellungen und Cache

**System Settings → Managed Browser** bietet:

| Einstellung | Standard | Wirkung |
|-------------|----------|---------|
| **Use built-in managed browser** | An | Erlaubt neue KI-gesteuerte Browsersitzungen |
| **Use managed browser cache** | An | Wiederverwendet kontoisolierte statische Ressourcen |
| **Maximum managed-browser cache** | 500 MB | Begrenzt den Speicherplatz (100–2048 MB) |
| **Clear cache when aiFetchly closes** | Aus | Leert den Browser-Cache beim Beenden |

Das Panel zeigt außerdem die ungefähre Cache-Größe, die letzte Löschung sowie Aktionen zum Leeren des Caches eines Kontos oder aller verwalteten Browser. Das Leeren entfernt nie verschlüsselte Cookies, gespeicherte Anmeldungen, Konten oder Downloads.

Vollständige Anforderungen, Sicherheitsmodell, Fingerprint-Richtlinie und Rollout-Plan stehen in [`docs/prd/puppeteer-managed-social-browser-prd.md`](docs/prd/puppeteer-managed-social-browser-prd.md).

## Dokumentation

Die vollständige Dokumentation finden Sie unter [docs.aifetchly.com](https://docs.aifetchly.com).

KI-gesteuerter verwalteter Browser (sichtbare Chrome-Sitzungen, Browser-Tools, Freigaben, manuelle Übernahme, Fingerprint, Cache): [Produktanforderungen](docs/prd/puppeteer-managed-social-browser-prd.md).

Die offizielle Website der Anwendung ist [aifetchly.com](https://www.aifetchly.com).

## aiFetchly unterstützen

Wenn aiFetchly Ihnen Zeit spart oder bei Ihrer Arbeit hilft, können Sie die weitere Entwicklung über Ko-fi unterstützen.

<p>
  <a href="https://ko-fi.com/aifetchly">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="aiFetchly auf Ko-fi unterstützen">
  </a>
</p>

## Mitwirken

Beiträge sind willkommen: Bugfixes, neue Funktionen, Workflow-Verbesserungen, Skills, Plugins oder Übersetzungen. Lesen Sie vor dem Mitwirken [CLAUDE.md](./CLAUDE.md).

## Lizenz

Dieses Projekt steht unter der [Apache License Version 2.0](./LICENSE).
