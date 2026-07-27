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

## Capacidades del agente

### Espacio de trabajo de IA

| Capacidad | Descripción |
|-----------|-------------|
| **Chat de IA con herramientas** | Trabaja con un asistente que puede usar herramientas aprobadas, contexto empresarial y tareas de varios pasos. |
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

## Documentación

La documentación completa está en [aifetchly.com](https://aifetchly.com).

## Contribuir

Las contribuciones son bienvenidas: correcciones, nuevas funciones, mejoras de flujo, habilidades, plugins o traducciones. Lee [CLAUDE.md](./CLAUDE.md) antes de contribuir.

## Licencia

Este proyecto está licenciado bajo [Apache License Version 2.0](./LICENSE).
