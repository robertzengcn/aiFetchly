<h1 align="center">aiFetchly</h1>

<p align="center">
  <strong>Agent IA de bureau pour l'automatisation métier</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot;
  <a href="./README.zh.md">简体中文</a> &middot;
  <a href="./README.es.md">Español</a> &middot;
  Français &middot;
  <a href="./README.de.md">Deutsch</a> &middot;
  <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="docs/images/readme/hero-ai-chat.png" alt="Espace de travail agent IA aiFetchly" width="900">
</p>

---

**aiFetchly** est une plateforme open source d'agents IA de bureau pour le travail métier. Elle réunit connaissance locale, automatisation du navigateur, compétences installables, tâches planifiées, plugins et sous-agents spécialisés afin d'automatiser la recherche, le traitement de documents, la collecte d'informations web, la communication client et les opérations récurrentes depuis une seule application.

aiFetchly a commencé avec des fonctions d'automatisation marketing comme la recherche de leads, l'extraction de contacts et la prospection par email. Ces workflows sont toujours inclus, mais le produit va plus loin : aiFetchly devient un espace de travail IA local-first pour les utilisateurs métier qui ont besoin d'outils, de mémoire, de fichiers, d'automatisation web et d'une exécution contrôlable.

## Qu'est-ce qu'aiFetchly ?

aiFetchly transforme une intention métier en workflows exécutables :

- **Demander du travail à un agent IA** : recherche, analyse de fichiers, extraction de données, rédaction de messages, résumés et usage d'outils depuis une interface de chat.
- **Utiliser vos connaissances métier** : importer des documents dans une bibliothèque locale et produire des réponses ou brouillons fondés sur vos propres fichiers.
- **Automatiser le navigateur et les données** : collecter des informations sur des sites web, extraire des données structurées, traiter des listes d'URL et exporter les résultats.
- **Déléguer à des sous-agents spécialisés** : lancer des agents en arrière-plan avec leur propre prompt, permissions d'outils, limites de ressources et sortie structurée.
- **Étendre l'espace de travail** : installer des compétences et plugins pour ajouter outils, workflows métier et intégrations.
- **Garder le contrôle** : stocker les données dans SQLite en local, vérifier l'activité des outils, gérer les permissions et exécuter sur votre poste.

## Captures d'écran

### Espace de travail agent IA

![Espace de travail agent IA aiFetchly](docs/images/readme/hero-ai-chat.png)

### Bibliothèque de connaissances

![Bibliothèque de connaissances aiFetchly](docs/images/readme/knowledge-library.png)

### Gestion des compétences et plugins

![Gestionnaire de plugins aiFetchly](docs/images/readme/plugin-manager.png)

### Paramètres AI Provider

![Paramètres AI Provider aiFetchly](docs/images/readme/ai-provider-settings.png)

## Capacités de l'agent

### Espace de travail IA

| Capacité | Description |
|----------|-------------|
| **Chat IA avec outils** | Travaillez avec un assistant qui peut appeler des outils approuvés, utiliser le contexte métier et mener des tâches en plusieurs étapes. |
| **AI Providers personnalisés** | Alimentez AI Chat avec un fournisseur compatible OpenAI : Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI ou endpoint personnalisé. |
| **Exécution de tâches métier** | Lancez recherche, extraction, traitement de fichiers, rédaction, planification et automatisation sans jongler entre plusieurs SaaS. |
| **Assistant email client IA** | Rédigez, envoyez et répondez aux emails clients avec le contexte de vos documents et données de workflow. |
| **Sous-agents spécialisés** | Déployez des sous-agents autonomes avec prompt, liste d'outils autorisés, limites de ressources et sortie structurée. |
| **Automatisation contrôlée par permissions** | Contrôlez les outils, plugins, hooks et sous-agents autorisés à s'exécuter. |

### Connaissance métier et RAG

| Capacité | Description |
|----------|-------------|
| **Bibliothèque de connaissances** | Importez PDF, TXT, DOC/DOCX, Markdown, HTML, CSV et Excel dans une base locale pour la génération augmentée par recherche. |
| **Traitement de documents** | Détectez les doublons, suivez la progression, découpez les documents et stockez des embeddings pour la recherche sémantique. |
| **Paramètres d'embedding** | Choisissez et mettez à jour le modèle d'embedding utilisé par la bibliothèque avec ses métadonnées. |
| **Réponses fondées sur vos données** | Générez résumés, plans, emails, rapports et consignes à partir de vos propres documents. |

### Compétences, plugins et extensibilité

| Capacité | Description |
|----------|-------------|
| **Compétences installables** | Étendez l'agent avec des packages réutilisables pour fichiers, analyse, automatisation et domaines spécifiques. |
| **Gestion des compétences** | Importez des ZIP, listez les compétences intégrées, installées ou fournies par plugin, activez-les ou désinstallez-les. |
| **Gestion des plugins** | Importez des plugins depuis ZIP ou dossier source et gérez activation, santé, format, compétences et serveurs MCP. |
| **Compatibilité plugins style Claude** | Prend en charge le format aiFetchly et les packages style Claude qui fournissent compétences et serveurs MCP. |
| **Gestion des hooks** | Créez des hooks pour le cycle de vie AI/chat : début de session, soumission de prompt, usage d'outil, demandes de permission et arrêt. |

### Automatisation web, données et workflows

| Capacité | Description |
|----------|-------------|
| **Recherche web automatisée** | Recherchez sur plusieurs moteurs, collectez des informations métier, traitez des URL et récupérez les erreurs de tâche. |
| **Extraction de données structurées** | Extrayez emails, téléphones, adresses, profils sociaux, informations d'entreprise et enregistrements d'annuaires. |
| **Planification de tâches** | Planifiez avec cron, enchaînez des jobs dépendants, créez des workflows récurrents et suivez l'historique. |
| **Export en un clic** | Téléchargez les données en CSV et générez des rapports. |
| **Gestion des proxies** | Gérez des proxies HTTP, HTTPS et SOCKS5 avec import, validation et test en masse. |

### Workflows de croissance inclus

| Workflow | Description |
|----------|-------------|
| **Recherche d'entreprises et de leads** | Trouvez des entreprises via moteurs de recherche, Google Maps, Yandex Maps, Yellow Pages et annuaires. |
| **Extraction de contacts** | Fournissez une liste d'URL et extrayez emails, téléphones, adresses et profils sociaux avec suivi en direct. |
| **Rédaction d'emails IA** | Générez des emails personnalisés avec RAG et vos documents importés. |
| **Envoi et réponses client** | Aidez à envoyer des emails et générer des réponses contextuelles avec vos connaissances et données clients. |
| **Opérations sociales** | Gérez les comptes sociaux et automatisez certains workflows quand ils sont pris en charge. |

## Démarrage

### Prérequis

- **OS** : Windows 10+, macOS 10.15+ ou Linux (Ubuntu 20.04+)
- **RAM** : 4 Go minimum, 8 Go recommandés

### Première configuration

1. Ouvrez aiFetchly et connectez-vous.
2. Importez vos documents dans la Bibliothèque de connaissances si vous voulez des réponses fondées sur vos fichiers.
3. Installez ou activez les compétences et plugins nécessaires.
4. Configurez un fournisseur personnalisé dans System Settings -> AI Provider si vous voulez utiliser votre propre modèle.
5. Configurez proxies, comptes sociaux ou SMTP seulement pour les workflows web, sociaux ou email.

## Développement

### Prérequis

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

### Architecture

aiFetchly suit une architecture en trois couches :

```text
IPC Handler  ->  Module (logique métier)  ->  Model (accès aux données)
```

- **Models** (`src/model/`) gèrent TypeORM et les requêtes SQL.
- **Modules** (`src/modules/`) contiennent la logique métier, la validation et la coordination entre modèles.
- **IPC Handlers** (`src/main-process/`) gèrent uniquement la communication et n'accèdent jamais directement à la base.

Les workers dans `src/childprocess/` exécutent les tâches longues comme le scraping et le traitement IA. Ils renvoient les résultats au processus principal via IPC.

## Configuration AI Provider

AI Chat peut utiliser l'IA hébergée d'aiFetchly ou un fournisseur compatible OpenAI configuré par l'utilisateur. Ouvrez **System Settings -> AI Provider** pour changer de mode et enregistrer un fournisseur local ou personnalisé.

## Documentation

La documentation complète est disponible sur [docs.aifetchly.com](https://docs.aifetchly.com).

Le site officiel de l'application est [sellart-online.com](https://www.sellart-online.com).

## Contribuer

Les contributions sont bienvenues : corrections, fonctionnalités, workflows, compétences, plugins ou traductions. Lisez [CLAUDE.md](./CLAUDE.md) avant de contribuer.

## Licence

Ce projet est sous licence [Apache License Version 2.0](./LICENSE).
