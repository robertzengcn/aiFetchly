<h1 align="center">aiFetchly</h1>

<p align="center">
  <strong>Agente de IA de escritorio para automatización empresarial</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot;
  <a href="./README.zh.md">简体中文</a> &middot;
  Español &middot;
  <a href="./README.fr.md">Français</a> &middot;
  <a href="./README.de.md">Deutsch</a> &middot;
  <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="docs/images/readme/hero-ai-chat.png" alt="Espacio de trabajo del agente de IA de aiFetchly" width="900">
</p>

---

**aiFetchly** es una plataforma abierta de agentes de IA de escritorio para trabajo empresarial. Combina conocimiento local, automatización del navegador, habilidades instalables, tareas programadas, plugins y subagentes especializados para que los equipos automaticen investigación, procesamiento de documentos, recopilación de información web, comunicación con clientes y operaciones recurrentes desde una sola aplicación.

aiFetchly comenzó con funciones de automatización de marketing como descubrimiento de leads, extracción de contactos y email outreach. Esos flujos siguen incluidos, pero el producto apunta a algo más amplio: un espacio de trabajo local-first para usuarios de negocio que necesitan herramientas, memoria, archivos, automatización web y ejecución controlable.

## ¿Qué es aiFetchly?

aiFetchly convierte una intención de negocio en flujos ejecutables:

- **Pide trabajo a un agente de IA**: investigación, análisis de archivos, extracción de datos, borradores de mensajes, resúmenes y uso de herramientas desde una interfaz de chat.
- **Usa tu conocimiento empresarial**: sube documentos a una biblioteca local y genera respuestas o borradores basados en tus propios archivos.
- **Automatiza navegador y datos**: recopila información de sitios web, extrae datos estructurados, procesa listas de URL y exporta resultados.
- **Deja que el agente conduzca un navegador real**: abre una ventana de Chrome visible que la IA observa y controla; mira cada paso, aprueba acciones relevantes y toma el control cuando aparezca un inicio de sesión o una verificación. Ver [Automatización con navegador gestionado](#automatización-con-navegador-gestionado).
- **Delega a subagentes especializados**: ejecuta agentes en segundo plano con su propio prompt, permisos de herramientas, límites de recursos y salida estructurada.
- **Extiende el espacio de trabajo**: instala habilidades y plugins para agregar herramientas, flujos de negocio e integraciones.
- **Mantén el control**: guarda los datos en SQLite local, revisa la actividad de herramientas, controla permisos y ejecuta todo en tu escritorio.

## Capturas

### Espacio de trabajo del agente de IA

![Espacio de trabajo del agente de IA de aiFetchly](docs/images/readme/hero-ai-chat.png)

### Biblioteca de conocimiento

![Biblioteca de conocimiento de aiFetchly](docs/images/readme/knowledge-library.png)

### Gestión de habilidades y plugins

![Gestor de plugins de aiFetchly](docs/images/readme/plugin-manager.png)

### Configuración de AI Provider

![Configuración de AI Provider en aiFetchly](docs/images/readme/ai-provider-settings.png)

### Gestión de memoria de IA

![Gestión de memoria de IA de aiFetchly](docs/images/readme/memory_edit.png)

## Capacidades del agente

### Espacio de trabajo de IA

| Capacidad | Descripción |
|-----------|-------------|
| **Chat de IA con herramientas** | Trabaja con un asistente que puede usar herramientas aprobadas, contexto empresarial y tareas de varios pasos. |
| **Gestión de memoria de IA** | Administre la memoria duradera de la IA en una interfaz dedicada: memoria de usuario (hechos y preferencias que la IA recuerda entre conversaciones) y memoria del espacio de trabajo (conocimiento a nivel de proyecto). Cree, edite, archive o elimine memorias, filtre por tipo/estado/fuente, busque y ejecute consolidación de memoria a partir de la actividad del chat y del agente. |
| **AI Providers personalizados** | Usa cualquier proveedor compatible con OpenAI, incluidos Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI o un endpoint personalizado. |
| **Ejecución de tareas empresariales** | Ejecuta investigación, extracción, procesamiento de archivos, borradores, programación y automatizaciones sin cambiar entre varias herramientas SaaS. |
| **Asistente de email para clientes** | Redacta, envía y responde emails con contexto de tus documentos y datos de trabajo. |
| **Subagentes especializados** | Ejecuta subagentes autónomos con prompt propio, lista de herramientas permitidas, límites de recursos y salida estructurada. |
| **Automatización con permisos** | Controla qué herramientas, plugins, hooks y subagentes pueden ejecutarse. |

### Conocimiento empresarial y RAG

| Capacidad | Descripción |
|-----------|-------------|
| **Biblioteca de conocimiento** | Sube PDF, TXT, DOC/DOCX, Markdown, HTML, CSV y Excel a una base local para generación aumentada por recuperación. |
| **Procesamiento de documentos** | Detecta duplicados, sigue el progreso, divide documentos y guarda embeddings vectoriales para búsqueda semántica. |
| **Configuración de embeddings** | Selecciona y actualiza el modelo de embeddings con metadatos visibles en la interfaz. |
| **Respuestas basadas en negocio** | Genera resúmenes, planes, emails, reportes y guías usando tus documentos como contexto. |

### Habilidades, plugins y extensibilidad

| Capacidad | Descripción |
|-----------|-------------|
| **Habilidades instalables** | Extiende el agente con paquetes reutilizables para archivos, análisis, automatización y dominios específicos. |
| **Gestión de habilidades** | Importa habilidades desde ZIP, lista habilidades integradas, instaladas o aportadas por plugins, y actívalas o desinstálalas. |
| **Gestión de plugins** | Importa plugins desde ZIP o carpetas fuente y administra estado, salud, formato, habilidades y servidores MCP. |
| **Compatibilidad con plugins estilo Claude** | Soporta el formato de aiFetchly y paquetes estilo Claude que aportan habilidades y servidores MCP. |
| **Gestión de hooks** | Crea hooks para eventos del ciclo de vida de AI/chat como inicio de sesión, envío de prompt, uso de herramientas y solicitudes de permiso. |

### Automatización web, datos y flujos

| Capacidad | Descripción |
|-----------|-------------|
| **Navegador gestionado controlado por IA** | Entrega una ventana real y visible de Chrome al agente: abrir sitios, leer la página, hacer clic, escribir, navegar, extraer datos y pausar para intervención humana. Funciona en sitios públicos sin cuenta guardada y reutiliza el inicio de sesión de una Tool Account cuando lo necesitas. |
| **Investigación web automatizada** | Busca en motores, recopila información empresarial, procesa URL y se recupera de errores de tarea. |
| **Extracción de datos estructurados** | Extrae emails, teléfonos, direcciones, perfiles sociales, datos de empresas y registros de directorios. |
| **Programación de tareas** | Programa tareas con cron, encadena trabajos dependientes, crea flujos recurrentes y revisa el historial. |
| **Exportación con un clic** | Descarga datasets como CSV y genera reportes desde datos recopilados o procesados. |
| **Gestión de proxies** | Administra proxies HTTP, HTTPS y SOCKS5, con importación masiva, validación y pruebas. |

### Flujos de crecimiento incluidos

| Flujo | Descripción |
|-------|-------------|
| **Investigación de empresas y leads** | Encuentra negocios en buscadores, Google Maps, Yandex Maps, Yellow Pages y directorios similares. |
| **Extracción de contactos** | Procesa listas de URL y extrae emails, teléfonos, direcciones y perfiles sociales con progreso en vivo. |
| **Redacción de emails con IA** | Genera emails personalizados usando RAG y tus documentos cargados. |
| **Envío y respuestas de emails** | Ayuda a enviar emails y crear respuestas con contexto de la base de conocimiento y datos de clientes. |
| **Operaciones en redes sociales** | Gestiona cuentas sociales y automatiza flujos donde estén soportados. |

## Primeros pasos

### Requisitos

- **Sistema operativo**: Windows 10+, macOS 10.15+ o Linux (Ubuntu 20.04+)
- **RAM**: mínimo 4 GB, recomendado 8 GB

### Configuración inicial

1. Abre aiFetchly e inicia sesión.
2. Importa documentos a la Biblioteca de conocimiento si quieres respuestas basadas en tus archivos.
3. Instala o activa habilidades y plugins para los flujos que necesitas.
4. Configura un proveedor personalizado en System Settings -> AI Provider si quieres usar tu propio modelo.
5. Configura proxies, cuentas sociales o SMTP solo si usarás flujos web, sociales o de email.

## Desarrollo

### Requisitos

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

### Pruebas

```bash
yarn test
yarn testmain
yarn vitest-googlescraper
yarn testhttpclient
yarn testyoutubeupload
yarn testdownload
```

### Arquitectura

aiFetchly usa una arquitectura de tres capas con separación estricta:

```text
IPC Handler  ->  Module (lógica de negocio)  ->  Model (acceso a datos)
```

- **Models** (`src/model/`) gestionan TypeORM y consultas SQL.
- **Modules** (`src/modules/`) contienen lógica de negocio, validación y coordinación entre modelos.
- **IPC Handlers** (`src/main-process/`) solo comunican con el renderer y no acceden directamente a la base de datos.

Los workers en `src/childprocess/` ejecutan tareas intensivas como scraping y procesamiento de IA. Envían resultados al proceso principal por IPC y nunca acceden directamente a la base de datos.

## Configuración de AI Provider

AI Chat puede usar la IA alojada de aiFetchly o un proveedor compatible con OpenAI configurado por el usuario. Abre **System Settings -> AI Provider** para cambiar de modo y guardar un proveedor local o personalizado.

## Automatización con navegador gestionado (Browser Use) <a id="automatización-con-navegador-gestionado"></a>

aiFetchly incluye un entorno de ejecución autónomo de navegador (Browser Use) que el agente de IA puede conducir directamente. El agente abre una ventana normal de Chrome/Chromium visible en tu escritorio, observa semánticamente la página y ejecuta los pasos requeridos mientras la aplicación muestra en tiempo real el estado, las aprobaciones, el progreso y los resultados.

Está diseñado para automatización web y en redes sociales en sitios y cuentas que posees o estás autorizado a operar, respetando estrictamente los límites de seguridad: no evita MFA, desafíos de acceso/seguridad, políticas de la plataforma ni restricciones de acceso.

### Aislamiento arquitectónico de procesos

El entorno de Browser Use sigue un modelo estricto de aislamiento en tres capas:

```text
Renderer de Electron (UI Vue 3)
  Tarjetas de sesión, estado en vivo, diálogos de aprobación, interfaz de control manual
  NUNCA accede a cookies en crudo, sockets CDP ni credenciales internas
             │
             │ contextBridge + IPC validado con Zod
             ▼
Proceso principal de Electron
  ManagedBrowserSupervisor, ManagedBrowserLeaseService, ManagedBrowserAiToolService
  Bloqueos de cuenta, descifrado/cifrado AES-256 de cookies, políticas de riesgo, auditoría
             │
             │ IPC privado utilityProcess (desechable por sesión)
             ▼
src/childprocess/managed-browser/
  ManagedBrowserRuntime, BrowserFingerprintPolicy, BrowserObservationService,
  PageReferenceRegistry, BrowserActionExecutor, ChallengeDetector
             │
             │ Puppeteer 25.x
             ▼
Chrome / Chromium visible
  Perfil temporal aislado + caché de recursos acotada por cuenta
```

- **Proceso principal**: Supervisa el ciclo de vida, los bloqueos exclusivos por cuenta, la seguridad de cookies, las aprobaciones y el registro de auditoría.
- **Proceso Utility dedicado (`src/childprocess/managed-browser/`)**: Un proceso utility desechable por sesión controla Chrome mediante Puppeteer. Todos los identificadores volátiles de navegador, sesiones CDP y nodos DOM permanecen aislados en el worker.
- **Proceso Renderer**: Completamente aislado de cookies, tokens de red e interfaces CDP.

### Cómo iniciar una sesión

Hay tres formas de iniciar una sesión de navegador gestionado:

- **AI Chat**: describe una tarea que necesite navegador (ej. "abre YouTube y busca comentarios no respondidos de la última semana") y el agente activará las herramientas automáticamente.
- **Tool Account → Open managed browser**: reutiliza la sesión guardada de una cuenta para conectar directamente a su plataforma.
- **Tarjeta de sesión en el espacio de trabajo**: inspeccionar, controlar interactivamente, tomar el control o detener el navegador.

**La navegación pública no requiere cuenta.** Cualquier sitio web (incluidas redes sociales y páginas que exigen iniciar sesión) se puede abrir sin Tool Account guardada, utilizando un perfil temporal desechable y conexión directa. Si el sitio necesita login, aiFetchly te transfiere el control de esa misma ventana para completarlo manualmente, en vez de rechazar la apertura o cambiar a una descarga HTTP simple. Si se abre con una cuenta guardada, las cookies cifradas se descifran e inyectan antes de navegar.

### Herramientas de navegador disponibles

| Herramienta | Uso |
|-------------|-----|
| `browser_start_session` | Iniciar una sesión para una URL o una Tool Account guardada |
| `browser_get_status` | Leer el estado de la sesión y la URL saneada actual |
| `browser_observe` | Obtener una instantánea semántica acotada de la página y sus elementos interactivos |
| `browser_navigate` | Navegar a una URL `http(s)` permitida |
| `browser_run_actions` | Ejecutar un programa estructurado acotado (clic, escribir, atajos, scroll, esperar, extraer, bucles) |
| `browser_screenshot` | Capturar una miniatura de la página visible para la conversación |
| `browser_request_handoff` | Pausar la automatización y pedirte que tomes el control |
| `browser_resume_after_handoff` | Reanudar la automatización tras tu confirmación |
| `browser_evaluate_script` | Ejecutar JavaScript revisado dentro del contexto de la página (con aprobación) |
| `browser_clear_cache` | Limpiar la caché de la cuenta actual tras confirmarlo |
| `browser_stop_session` | Detener Chrome, cerrar el worker y liberar el bloqueo de la cuenta |

`browser_observe` devuelve referencias semánticas compactas como `@e1 [button] "Search"` vinculadas a un número de revisión de página. Si una navegación o cambio en el DOM altera la página, las referencias obsoletas se rechazan inmediatamente para evitar pulsar elementos incorrectos.

La herramienta `browser_run_actions` admite un DSL de acciones estructuradas que permite ejecutar secuencias multietapa en una única llamada atómica, registrada en `ToolJobRegistry` para seguimiento de progreso en vivo y cancelación instantánea. Las manipulaciones avanzadas del DOM se ejecutan con `browser_evaluate_script`, estrictamente dentro del contexto de la página web — nunca con permisos de Node.js, Electron o del sistema de archivos.

### Estados de sesión y controles

Una sesión en ejecución reporta en tiempo real su estado (`starting`, `checking browser`, `applying login session`, `verifying login`, `login required`, `ready`, `working`, `awaiting approval`, `verification challenge`, `you have control`, `stopping`, `stopped`, `failed`) junto con la cuenta, plataforma, origen saneado, estado de proxy y tiempo transcurrido.

Controles interactivos disponibles:

- **Pausar IA**: impide que el agente envíe nuevas acciones;
- **Tomar el control**: interactúa (haz clic o escribe) directamente en la ventana de Chrome visible;
- **He terminado de iniciar sesión / Continuar tarea**: verifica la autenticación, guarda la sesión renovada y devuelve el control al agente;
- **Extender tiempo**: prolonga la duración del control manual;
- **Detener navegador**: cancela la acción activa, persiste de forma segura las cookies renovadas, cierra Chrome y el worker, y libera la cuenta.

### Aprobaciones y seguridad

| Riesgo | Ejemplos | Comportamiento |
|--------|----------|----------------|
| Observar | Leer texto, inspeccionar elementos, captura | Aprobación por sesión |
| Interacción reversible | Buscar, filtrar, paginar, redactar | Aprobación por sesión |
| Entrada sensible | Correo, teléfono, mensaje privado, subida | Vista previa y aprobación explícita |
| Consecuente | Enviar, publicar, comentar, seguir, subir, borrar, comprar, cambiar ajustes | Aprobación puntual con cuenta, objetivo y efecto |
| Script privilegiado | Cualquier JavaScript en la página | Se muestran script, origen, fin, timeout y salida esperada antes de aprobar |
| Autenticación | Contraseña, MFA, passkey, CAPTCHA de seguridad | Siempre la completas tú |

Garantías de seguridad:

- El contenido web se trata como datos no confiables: los intentos de inyección de instrucciones en la página no pueden eludir las políticas del sistema.
- El modelo no puede marcar sus propias acciones como seguras y los rechazos del usuario son definitivos.
- La política de fingerprint utiliza las propiedades nativas de la versión real de Chrome, evitando discrepancias que activan bloqueos antibot.
- Las cookies se almacenan cifradas con `safeStorage` (AES-256-GCM) y filtros por dominio; nunca entran al renderer, al prompt de la IA, a los resultados de herramientas ni a los logs.
- Al completar un inicio de sesión o tarea, se captura y cifra de nuevo la sesión actualizada automáticamente.

### Ajustes y caché

**System Settings → Managed Browser** permite configurar:

| Ajuste | Valor por defecto | Efecto |
|--------|-------------------|--------|
| **Use built-in managed browser** | Activado | Permite nuevas sesiones controladas por IA |
| **Use managed browser cache** | Activado | Reutiliza recursos estáticos aislados por cuenta |
| **Maximum managed-browser cache** | 500 MB | Limita el uso de disco (100–2048 MB) |
| **Clear cache when aiFetchly closes** | Desactivado | Limpia la caché al cerrar la aplicación |

El panel muestra el tamaño aproximado de la caché, la última limpieza y las opciones para limpiar la caché de una cuenta o de todas. Limpiar la caché nunca borra cookies cifradas, inicios de sesión guardados, cuentas ni descargas.

### Referencias de implementación

- `src/service/ManagedBrowserSupervisor.ts`, `ManagedBrowserLeaseService.ts`, `ManagedBrowserAiToolService.ts` — supervisor del proceso principal, gestión de exclusividad, despacho de herramientas, clasificación de riesgo y aprobaciones.
- `src/modules/ManagedBrowserModule.ts`, `ManagedBrowserSettingsModule.ts`, `ManagedBrowserCacheModule.ts` — lógica de negocio, cookies de cuenta y persistencia de ajustes.
- `src/childprocess/managed-browser/` — worker dedicado por sesión: runtime de Puppeteer, política de navegación y fingerprint, observación semántica, ejecución de acciones, detección de retos e inyección de cookies.
- `src/childprocess/managed-browser-cache/` — worker en segundo plano para cálculo, desalojo y borrado de caché.
- `src/views/components/aiChatV2/ManagedBrowserSessionCard.vue`, `ManagedBrowserHandoffDialog.vue`, `src/views/components/settings/ManagedBrowserSettingsPanel.vue` — tarjetas de sesión, modales de control y panel de ajustes.

Para consultar los requisitos completos y los contratos técnicos:
- Requisitos de producto: [`docs/prd/puppeteer-managed-social-browser-prd.md`](docs/prd/puppeteer-managed-social-browser-prd.md)
- Diseño técnico: [`docs/prd/puppeteer-managed-social-browser-technical-design.md`](docs/prd/puppeteer-managed-social-browser-technical-design.md)

## Documentación

La documentación completa está en [docs.aifetchly.com](https://docs.aifetchly.com).

Navegador gestionado controlado por IA / Browser Use (sesiones visibles de Chrome, herramientas de navegador, programas de acción, aprobaciones, intervención humana, fingerprint, caché): [requisitos de producto](docs/prd/puppeteer-managed-social-browser-prd.md) y [diseño técnico](docs/prd/puppeteer-managed-social-browser-technical-design.md).

El sitio web oficial de la aplicación es [aifetchly.com](https://www.aifetchly.com).

## Apoya aiFetchly

Si aiFetchly te ahorra tiempo o te ayuda en tu trabajo, puedes apoyar su desarrollo continuo en Ko-fi.

<p>
  <a href="https://ko-fi.com/aifetchly">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Apoya aiFetchly en Ko-fi">
  </a>
</p>

## Contribuir

Las contribuciones son bienvenidas: correcciones, nuevas funciones, mejoras de flujo, habilidades, plugins o traducciones. Lee [CLAUDE.md](./CLAUDE.md) antes de contribuir.

## Licencia

Este proyecto está licenciado bajo [Apache License Version 2.0](./LICENSE).
