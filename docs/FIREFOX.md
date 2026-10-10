# Cerebro local en Firefox

Firefox ejecuta el mismo núcleo que Chromium y escritorio. El popup sirve para
iniciar, detener y consultar la mosca; no sostiene la simulación. **Abrir el jardín**
abre `https://moscas.lol` en una pestaña normal. No hay mosca de escritorio, tienda,
panel de eventos ni login de cuenta en la extensión.

## Modelo de ejecución

Se utiliza **Manifest V2 con una página de fondo persistente** y Firefox de escritorio
142 o posterior. Mozilla mantiene MV2 junto a MV3. La documentación de `background`
especifica que `persistent: true` conserva la página desde la carga hasta deshabilitar,
descargar o cerrar Firefox; MV3 no admite ese valor. Firefox no implementa el service
worker de extensiones de Chromium. No se utilizan documentos offscreen, pestañas
ocultas, audio, puertos artificiales ni alarmas para mantener una página de eventos viva.

La página de fondo dispone de APIs DOM y crea Web Workers locales mediante el
adaptador web existente. Un único `MoskaRunner` posee la sesión principal y las
voluntarias; ningún popup crea runners. Los assets `brain/` se copian en el paquete
con los avisos FlyWire, CC BY 4.0 y MIT. El kernel y el conectoma no cambian.

Cerrar el popup o minimizar Firefox permite continuar mientras Firefox esté vivo y
el sistema permita ejecutar sus procesos. Una página persistente **no evita dormir
el equipo**, cerrar la tapa, la terminación del navegador ni la suspensión impuesta
por el sistema. No se solicita un bloqueo de energía. Firefox para Android queda
fuera del alcance: su sistema puede terminar procesos en segundo plano.

No hay eventos WebExtension equivalentes a `powerMonitor` de Electron. El cliente
detecta intervalos de reloj superiores a 15 segundos y retrocesos de reloj. Antes del
siguiente callback de simulación libera la sesión y restaura mediante una consulta de
control, ticket nuevo y baseline nueva. No intenta simular el tiempo dormido. Un
cerebro cargado sin avance de ticks durante 15 segundos recibe el mismo tratamiento.
La carga inicial conserva su propio límite de 30 segundos. Una suspensión física o
un cambio de interfaz de red todavía requieren comprobación manual.

## Activación, control y limpieza

- **Iniciar cerebro** valida un token `fly_device_…`, guarda token y activación y abre
  la sesión. Un campo vacío reutiliza la credencial guardada. Dos popups simultáneos
  comparten la misma autoridad y no generan sesiones competidoras.
- **Detener** libera inmediatamente el runner, workers, timers, HTTP y WebSocket;
  persiste `enabled: false`. Invalida también restauraciones y escrituras de inicio
  pendientes. Abrir el popup o reiniciar Firefox no vuelve a activarlo.
- **Olvidar dispositivo** detiene y elimina el token local.
- Cerrar Firefox o deshabilitar la extensión libera el contexto y sus recursos,
  conservando la activación elegida. Habilitarla de nuevo o restaurar el navegador
  reanuda solo si estaba activada y otra sesión no tiene el control.
- El evento `unload` intenta cerrar ordenadamente; ante una terminación abrupta,
  Firefox destruye los workers y sockets. El último checkpoint es de mejor esfuerzo.
- Una configuración ilegible no se sobrescribe ni se activa. Si falla la escritura
  de Detener, el cerebro queda detenido en memoria y se muestra el error, pero no
  puede garantizarse el estado del siguiente reinicio hasta reparar el almacenamiento.

La restauración automática utiliza `startWhenAvailable`, también cuando la red falla.
Se conservan las consultas ligeras `view=control`, la cesión 4001/4002 y la prioridad
del jardín web. Abrir el jardín con una sesión web autenticada puede cederle el control.
La extensión espera a que quede libre en vez de solicitar tickets continuamente.

Se reutilizan sin duplicación `protocol=3`, frames/deltas compactos, `GardenStream`,
recuperación por secuencias perdidas, `ObservationCadence`, voluntariado y backpressure
(512 kB). HTTP conserva cancelación y deadline de 15 s, bienvenida 20 s, silencio
45 s y backoff máximo 30 s. No se sustituye ningún timeout de producción en las pruebas.

## Credenciales y permisos

Solo se acepta el servicio fijo `https://moscas.lol` y un token de dispositivo. No hay
campos de usuario o contraseña, permisos de cookies, content scripts ni acceso al
historial. El HTTP autenticado omite cookies explícitamente. El WebSocket usa el
origen real de Firefox `moz-extension://…`, sin falsificar un origen Chromium.

`browser.storage.local` conserva la credencial dentro del perfil, sin sincronizarla
ni añadir cifrado propio. No equivale a Keychain/DPAPI de escritorio. El popup nunca
recibe el token guardado; el campo se vacía tras el comando y al cerrar. El estado
visible no contiene tickets, cabeceras ni cuerpos de error remotos. Los mensajes solo
se aceptan del popup local de esta extensión. La CSP limita scripts y workers al
paquete y las conexiones al servicio público.

El manifiesto declara `authenticationInfo`, `websiteContent` y `websiteActivity`:
se transmite el token y el estado/acciones del jardín vinculados a la cuenta. No se
recogen páginas visitadas ni datos de otras webs. Firefox 142+ permite el consentimiento
integrado. No hay telemetría de uso de la extensión ni informes de fallos enviados.

## Desarrollo y build

Instalar Firefox de escritorio y Node.js 22 o posterior:

```bash
npm ci
npm run build:firefox
npm run lint:firefox
npm run dev:firefox
```

El build independiente genera `dist-firefox/`, incluyendo manifiesto, popup, background,
workers, conectoma y licencias. Chromium conserva `dist/`; escritorio, `dist-desktop/`.
El comando de desarrollo usa Selenium y geckodriver 0.37.0, descargado de Mozilla en
la primera ejecución y guardado en el directorio temporal del sistema. Carga la extensión
real en un perfil temporal. Ctrl+C cierra Firefox y elimina ese perfil. No modifica el
perfil personal ni recarga automáticamente al editar: recompilar y relanzar.

`FIREFOX_BINARY` permite indicar el ejecutable. En macOS el valor predeterminado es
`/Applications/Firefox.app/Contents/MacOS/firefox`; en Windows/Linux Selenium busca la
instalación. No se usa el Firefox modificado de Playwright. La primera descarga de
geckodriver necesita acceso a GitHub.

También se puede cargar `dist-firefox/manifest.json` desde `about:debugging` → Este
Firefox → Cargar complemento temporal. **Firefox elimina las instalaciones temporales
al reiniciar**: la activación persistida no instala de nuevo el addon. Las pruebas
reinstalan el mismo addon temporal con el mismo ID en el perfil conservado. Para una
instalación permanente en Firefox estable se necesita firma de Mozilla. Este trabajo
no firma, publica ni instala nada en la tienda.

## Verificación automatizada

```bash
npm run check
npm run test:firefox
# Con MOSCAS_DEVICE_TOKEN en el entorno, sin archivos .env:
npm run test:firefox:live
```

`check` conserva las suites Chromium/Electron y añade unitarias Firefox. La suite
Firefox está separada para no exigir Firefox a quien solo desarrolla los otros clientes.
`lint:firefox` valida el paquete con el linter oficial de Mozilla.

Playwright se utiliza únicamente como lanzador de aserciones. **Selenium/geckodriver
instala el addon real** y consulta el contexto privilegiado de Firefox para comprobar
la página de fondo, habilitar y deshabilitar. `--allow-system-access` se aplica solo a
estos perfiles temporales de prueba. No se desactivan políticas de throttling ni la
validación TLS. El popup se abre mediante su URL `moz-extension://…/popup.html`; el clic
en el botón de la barra sigue siendo una comprobación manual.

Sin token: carga real del manifiesto, controles, token inválido, persistencia de
Detener, descarga/habilitación y background sin popup con ventana minimizada.

Con token: servicio real moscas.lol, cerebro y assets locales, avance de ticks con
popup cerrado y Firefox minimizado, persistencia activa, deshabilitación y silencio
de transporte tras liberar el background, Stop y Olvidar; cortes TCP repetidos,
reinicio durante corte, arranque sin red, watchdog de silencio, HTTP atascado y
cancelación; cesión a la extensión Chromium real y recuperación sin competir al reiniciar.
No hay servidores simulados. El proxy CONNECT existente corta o bloquea bytes cifrados
sin descifrar TLS, modificar respuestas ni instalar certificados.

No ejecutar simultáneamente suites autenticadas con la misma cuenta. Las pruebas
pueden mover y alimentar la mosca y acoger voluntarias. Las trazas, capturas y vídeos
están desactivados; no se registran cuerpos, tokens o tickets. Cada perfil temporal
`moscas-firefox-*` se elimina en teardown. Tras matar forzosamente los tests, comprobar
que Firefox terminó y eliminar los perfiles residuales antes de compartir el equipo.
`MOSCAS_FIREFOX_HEADLESS=1` sirve para entornos sin pantalla; no demuestra minimización
real y no sustituye una ejecución gráfica.

## Evidencia local del 10 de octubre de 2026

macOS arm64, Firefox 157.0 y geckodriver 0.37.0:

- Autenticación real con token de dispositivo y origen `moz-extension://…`, sin
  modificación del servidor ni cabecera de compatibilidad Chromium.
- Cuatro escenarios autenticados completos correctos contra moscas.lol. El cerebro
  cargó 139.255 neuronas y avanzó más de 300 ticks durante 65 s minimizado y sin popup,
  conservando la misma sesión. Deshabilitar eliminó el background y cesó el tráfico.
- Cortes TCP repetidos, arranque sin red, reinicio durante corte, silencio de 45 s,
  deadline HTTP, cancelación persistente y cesión a Chromium correctos.
- Tres smoke tests Firefox y linter Mozilla sin errores ni avisos.
- 69 unitarias en total, incluidos 14 controles Firefox de concurrencia, persistencia,
  almacenamiento ilegible, recuperación y descarte de timers cancelados al despertar.
- Regresión existente correcta: cinco smoke tests Chromium, ocho Electron, builds,
  tipos, arquitectura y auditoría pública. No se repitieron las suites autenticadas
  completas de escritorio/Chromium; Chromium sí participó en la cesión real.
- Worker, conectoma, lateralidad y NOTICE del build Firefox idénticos a los assets
  locales compartidos. Inspección visual del popup sin credenciales realizada.

La rama se creó desde `origin/main` (`d3a2c30`) tras comprobar que la PR #2 del fork
estaba integrada. `upstream/main` (`ef07825`) ya era ancestro de esa base; no había
novedades que incorporar. Se conserva escritorio y no se modifica el núcleo ni
ninguno de los clientes/adaptadores existentes.

## Límites y comprobaciones manuales pendientes

- Suspender físicamente el equipo, despertar, cambiar Wi-Fi y mantener sesiones largas.
- Ocultar la aplicación desde macOS (distinto de minimizar), ahorro de energía y presión
  de memoria; comprobar también Windows y Linux.
- Instalar un paquete firmado, reiniciar sin reinstalación temporal y actualizarlo.
- Abrir/cerrar el popup desde la barra; comprobar la experiencia visual y accesibilidad.
- Cesión a una sesión web con cookie. La prueba con Chromium es cesión entre dispositivos,
  no una prueba de login web; no se solicita contraseña ni se importan cookies.

## Fuentes oficiales consultadas

- [background y persistencia](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).
- [Entorno DOM, ciclo de vida y recuperación del proceso](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts).
- [Mozilla mantiene MV2 junto a MV3](https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/).
- [Workers locales y política de mismo origen](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker).
- [Timers y limitación en segundo plano](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout).
- [geckodriver y acceso al contexto de Firefox](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html).
- [Consentimiento de transmisión de datos](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
