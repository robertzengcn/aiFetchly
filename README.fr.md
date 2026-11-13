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
- **Laisser l'agent piloter un vrai navigateur** : ouvrez une fenêtre Chrome visible que l'IA observe et contrôle ; suivez chaque étape, approuvez les actions importantes et reprenez la main lors d'une connexion ou d'une vérification. Voir [Automatisation avec navigateur géré](#automatisation-avec-navigateur-géré).
- **Déléguer à des sous-agents spécialisés** : lancer des agents en arrière-plan avec leur propre prompt, permissions d'outils, limites de ressources et sortie structurée.
- **Étendre l'espace de travail** : installer des compétences et plugins pour ajouter outils, workflows métier et intégrations.
- **Garder le contrôle** : stocker les données dans SQLite en local, vérifier l'activité des outils, gérer les permissions et exécuter sur votre poste.

## Captures d'écran

### Espace de travail agent IA

![Espace de travail agent IA aiFetchly](docs/images/readme/hero-ai-chat.png)

### Navigateur géré (Browser Use)

![aiFetchly Browser Use](docs/images/readme/browseruse.png)

### Bibliothèque de connaissances

![Bibliothèque de connaissances aiFetchly](docs/images/readme/knowledge-library.png)

### Gestion des compétences et plugins

![Gestionnaire de plugins aiFetchly](docs/images/readme/plugin-manager.png)

### Paramètres AI Provider

![Paramètres AI Provider aiFetchly](docs/images/readme/ai-provider-settings.png)

### Gestion de la mémoire IA

![Gestion de la mémoire IA aiFetchly](docs/images/readme/memory_edit.png)

## Capacités de l'agent

### Espace de travail IA

| Capacité | Description |
|----------|-------------|
| **Chat IA avec outils** | Travaillez avec un assistant qui peut appeler des outils approuvés, utiliser le contexte métier et mener des tâches en plusieurs étapes. |
| **Gestion de la mémoire IA** | Gérez la mémoire IA durable dans une interface dédiée : mémoire utilisateur (faits et préférences mémorisés d'une conversation à l'autre) et mémoire d'espace de travail (connaissances propres au projet). Créez, modifiez, archivez ou supprimez des mémoires, filtrez par type/statut/source, recherchez et consolidez la mémoire issue du chat et des agents. |
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
| **Navigateur géré piloté par l'IA** | Confiez une vraie fenêtre Chrome visible à l'agent : ouvrir un site, lire la page, cliquer, saisir, naviguer, extraire des données et mettre en pause pour une prise en main humaine. Fonctionne sur les sites publics sans compte enregistré et réutilise la connexion d'un Tool Account quand vous le souhaitez. |
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

## Automatisation avec navigateur géré (Browser Use) <a id="automatisation-avec-navigateur-géré"></a>

aiFetchly embarque un environnement d'exécution autonome de navigateur (Browser Use) que l'agent IA peut directement piloter. L'agent ouvre une fenêtre Chrome/Chromium avec interface visible sur votre bureau, observe la page sémantiquement et exécute les étapes demandées, tandis que l'application affiche en temps réel l'état de la session, les approbations, la progression et les résultats.

![aiFetchly Browser Use](docs/images/readme/browseruse.png)

Cette fonctionnalité est conçue pour l'automatisation web et des réseaux sociaux sur les sites et comptes que vous possédez ou êtes autorisé à exploiter, dans le respect strict des limites de sécurité : elle ne contourne ni le MFA, ni les défis d'accès ou de sécurité, ni les stratégies de la plateforme.

### Isolation architecturale des processus

L'environnement Browser Use s'appuie sur une stricte séparation des processus en trois couches :

```text
Renderer Electron (UI Vue 3)
  Cartes de session, statut en direct, dialogues d'approbation, interface de reprise manuelle
  N'accède JAMAIS aux cookies bruts, sockets CDP ou identifiants internes
             │
             │ contextBridge + IPC validé avec Zod
             ▼
Processus principal Electron
  ManagedBrowserSupervisor, ManagedBrowserLeaseService, ManagedBrowserAiToolService
  Verrous de compte, déchiffrement/chiffrement AES-256 des cookies, politique de risque, audit
             │
             │ IPC privé utilityProcess (jetable par session)
             ▼
src/childprocess/managed-browser/
  ManagedBrowserRuntime, BrowserFingerprintPolicy, BrowserObservationService,
  PageReferenceRegistry, BrowserActionExecutor, ChallengeDetector
             │
             │ Puppeteer 25.x
             ▼
Chrome / Chromium visible
  Profil temporaire isolé + cache de ressources restreint par compte
```

- **Processus principal** : Supervise le cycle de vie, les baux exclusifs par compte, la sécurité des cookies, les approbations et le journal d'audit.
- **Processus Utility dédié (`src/childprocess/managed-browser/`)** : Un processus utility jetable par session pilote Chrome via Puppeteer. Les descripteurs volatils de navigateur, sessions CDP et nœuds DOM restent strictement confinés au worker.
- **Processus Renderer** : Complètement isolé des cookies, jetons réseau et interfaces CDP.

### Démarrer une session

Il existe trois façons d'initialiser une session de navigateur géré :

- **AI Chat** : décrivez une tâche nécessitant un navigateur (ex. « ouvre YouTube et cherche les commentaires sans réponse de la semaine passée »), l'agent active automatiquement les outils de navigation.
- **Tool Account → Open managed browser** : réutilisez la session authentifiée d'un compte enregistré pour accéder directement à sa plateforme.
- **Carte de session dans l'espace de travail** : inspectez, contrôlez, reprenez en main ou arrêtez un navigateur en cours d'exécution.

**La navigation publique ne nécessite aucun compte.** Tout site web (y compris les réseaux sociaux et pages exigeant une authentification) peut être ouvert sans compte enregistré, avec un profil temporaire jetable et une connexion réseau directe. Si le site requiert une connexion, aiFetchly vous transmet la fenêtre pour finaliser l'opération vous-même, au lieu de refuser l'ouverture ou d'utiliser une requête HTTP brute. En cas d'ouverture avec un compte enregistré, les cookies chiffrés sont déchiffrés et appliqués avant la navigation.

### Outils de navigateur disponibles

| Outil | Usage |
|-------|-------|
| `browser_start_session` | Démarrer une session pour une URL ou un Tool Account enregistré |
| `browser_get_status` | Lire l'état de la session et l'URL assainie courante |
| `browser_observe` | Obtenir un instantané sémantique borné de la page et de ses éléments interactifs |
| `browser_navigate` | Naviguer vers une URL `http(s)` autorisée |
| `browser_run_actions` | Exécuter un programme structuré borné (clics, saisie, raccourcis, défilement, attente, extraction, boucles) |
| `browser_screenshot` | Capturer une vignette de la page visible pour la conversation |
| `browser_request_handoff` | Mettre en pause l'automatisation et demander une reprise manuelle |
| `browser_resume_after_handoff` | Reprendre l'automatisation après confirmation manuelle |
| `browser_evaluate_script` | Exécuter du JavaScript vérifié dans la page (avec approbation) |
| `browser_clear_cache` | Vider le cache du compte courant après confirmation |
| `browser_stop_session` | Arrêter Chrome, fermer le worker et libérer le bail du compte |

`browser_observe` fournit des références sémantiques compactes comme `@e1 [button] "Search"`, associées à un numéro de révision de page. Si une navigation ou mutation du DOM modifie la page, les références obsolètes sont immédiatement invalidées pour éviter d'interagir avec le mauvais élément.

L'outil `browser_run_actions` prend en charge un DSL de programme d'actions structurées permettant d'enchaîner plusieurs étapes en un appel atomique unique, enregistré auprès de `ToolJobRegistry` pour le suivi en direct et l'annulation immédiate. Les interactions DOM complexes sont confiées à `browser_evaluate_script`, qui s'exécute strictement dans le contexte web — jamais avec les droits de Node.js, Electron ou du système de fichiers.

### États de session et commandes

Une session active transmet en direct son état (`starting`, `checking browser`, `applying login session`, `verifying login`, `login required`, `ready`, `working`, `awaiting approval`, `verification challenge`, `you have control`, `stopping`, `stopped`, `failed`), ainsi que le compte, la plateforme, l'origine assainie, le proxy et le temps écoulé.

Commandes interactives disponibles :

- **Mettre en pause l'IA** : empêcher l'agent d'émettre de nouvelles actions ;
- **Prendre le contrôle** : interagir (cliquer ou taper) directement dans la fenêtre Chrome visible ;
- **Connexion terminée / Poursuivre la tâche** : vérifier la session, sauvegarder les cookies renouvelés et rendre la main à l'agent ;
- **Prolonger le délai** : accorder plus de temps pour la manipulation manuelle ;
- **Arrêter le navigateur** : interrompre l'action en cours, enregistrer de façon sécurisée les nouveaux cookies, fermer Chrome et le worker, et libérer le compte.

### Approbations et sécurité

| Risque | Exemples | Comportement |
|--------|----------|--------------|
| Observation | Lire du texte, inspecter, capture | Approbation au niveau de la session |
| Interaction réversible | Rechercher, filtrer, paginer, rédiger | Approbation au niveau de la session |
| Saisie sensible | Email, téléphone, message privé, upload | Aperçu et approbation explicite |
| Conséquent | Envoyer, publier, commenter, suivre, uploader, supprimer, acheter, modifier les paramètres | Approbation ponctuelle avec compte, cible et effet |
| Script privilégié | Tout JavaScript dans la page | Script, origine, but, timeout et sortie attendue affichés avant approbation |
| Authentification | Mot de passe, MFA, passkey, CAPTCHA de sécurité | Toujours réalisée par vous |

Garanties de sécurité :

- Le contenu web est traité comme non fiable : aucune injection de prompt dans la page ne peut contourner les règles d'approbation.
- Le modèle ne peut pas déclarer sa propre action sûre et un refus utilisateur est souverain.
- La stratégie d'empreinte (fingerprint) s'aligne sur la version réelle du binaire Chrome, éliminant les anomalies qui alertent les mécanismes anti-bot.
- Les cookies sont chiffrés via `safeStorage` (AES-256-GCM) et filtrés par domaine : ils ne transitent jamais vers le renderer, les prompts de l'IA, les résultats d'outils ou les logs.
- À l'issue d'une connexion manuelle ou d'une tâche, les cookies actualisés sont capturés et ré-enregistrés de manière chiffrée.

### Réglages et cache

**System Settings → Managed Browser** propose :

| Réglage | Valeur par défaut | Effet |
|---------|-------------------|-------|
| **Use built-in managed browser** | Activé | Autorise de nouvelles sessions pilotées par l'IA |
| **Use managed browser cache** | Activé | Réutilise des ressources statiques isolées par compte |
| **Maximum managed-browser cache** | 500 Mo | Limite l'usage disque (100–2048 Mo) |
| **Clear cache when aiFetchly closes** | Désactivé | Vide le cache du navigateur à la fermeture |

Le panneau affiche la taille approximative du cache, la dernière suppression et les actions pour vider le cache d'un compte ou de tous les navigateurs gérés. Vider le cache ne supprime jamais les cookies chiffrés, les comptes ni les téléchargements.

### Références d'implémentation

- `src/service/ManagedBrowserSupervisor.ts`, `ManagedBrowserLeaseService.ts`, `ManagedBrowserAiToolService.ts` — superviseur du processus principal, baux de comptes, répartition des outils, classification des risques et approbations.
- `src/modules/ManagedBrowserModule.ts`, `ManagedBrowserSettingsModule.ts`, `ManagedBrowserCacheModule.ts` — logique métier, cookies de comptes et persistance des réglages.
- `src/childprocess/managed-browser/` — worker jetable par session : runtime Puppeteer, politique de navigation et de fingerprint, observation sémantique, exécution d'actions, détection de défis et injection de cookies.
- `src/childprocess/managed-browser-cache/` — worker d'arrière-plan pour le calcul, l'éviction et le nettoyage du cache.
- `src/views/components/aiChatV2/ManagedBrowserSessionCard.vue`, `ManagedBrowserHandoffDialog.vue`, `src/views/components/settings/ManagedBrowserSettingsPanel.vue` — cartes de session, fenêtres d'approbation et panneau de configuration.

Pour consulter l'intégralité des spécifications et contrats d'architecture :
- Exigences produit : [`docs/prd/puppeteer-managed-social-browser-prd.md`](docs/prd/puppeteer-managed-social-browser-prd.md)
- Conception technique : [`docs/prd/puppeteer-managed-social-browser-technical-design.md`](docs/prd/puppeteer-managed-social-browser-technical-design.md)

## Documentation

La documentation complète est disponible sur [docs.aifetchly.com](https://docs.aifetchly.com).

Navigateur géré piloté par l'IA / Browser Use (sessions Chrome visibles, outils de navigateur, programmes d'action, approbations, reprise en main, fingerprint, cache) : [exigences produit](docs/prd/puppeteer-managed-social-browser-prd.md) et [conception technique](docs/prd/puppeteer-managed-social-browser-technical-design.md).

Le site officiel de l'application est [aifetchly.com](https://www.aifetchly.com).

## Soutenir aiFetchly

Si aiFetchly vous fait gagner du temps ou vous aide dans votre travail, vous pouvez soutenir son développement continu sur Ko-fi.

<p>
  <a href="https://ko-fi.com/aifetchly">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Soutenir aiFetchly sur Ko-fi">
  </a>
</p>

## Contribuer

Les contributions sont bienvenues : corrections, fonctionnalités, workflows, compétences, plugins ou traductions. Lisez [CLAUDE.md](./CLAUDE.md) avant de contribuer.

## Licence

Ce projet est sous licence [Apache License Version 2.0](./LICENSE).
