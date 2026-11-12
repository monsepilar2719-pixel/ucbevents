# Prototipo · UCB Events

Funciona como **página web** y también se puede **instalar como app** desde el navegador (PWA). No hace falta pasar por ninguna tienda de aplicaciones.

## Probar en la computadora
- Doble clic en `index.html`. Funciona todo, excepto la instalación como app y el modo sin señal.
- Versión completa: en esta carpeta ejecutar `python -m http.server 8000` y abrir `http://localhost:8000`.

## Publicar (GitHub Pages, 2 min)
1. Crear un repositorio público y subir todos los archivos.
2. Settings → Pages → Branch `main` / root → Save.
3. Con la URL `https://USUARIO.github.io/REPO/` se puede instalar en el celular:
   - Android/Chrome: aparece el botón "Instalar como app".
   - iPhone/Safari: Compartir → "Agregar a inicio".

## Enlaces para QR y demo
- `?desde=entrada-principal&hasta=coliseo`
- `?evento=mecagala&modo=accesible`
- `?desde=D-P0&hasta=C-P2&modo=accesible` (muestra "sin ruta sin gradas")

## Roles ("Entrar como", arriba a la derecha)
| Rol | Puede |
|---|---|
| Visitante | Mapa, rutas, baños, eventos, compartir, + Calendar |
| Estudiante | Lo del visitante, más seguir eventos, recibir avisos y cargar su horario de clases |
| Organizador | Publicar eventos (quedan pendientes), actualizar el % de aforo, enviar avisos a los seguidores y **registrar asistencia con QR** (ver, agregar a mano, retirar, descargar CSV) en **sus** eventos (Mecacentro UCB en la demo) |
| Administrador | Aprobar o rechazar eventos, gestionar todos, marcar ascensores, rampas o caminos **fuera de servicio** |

## Guion de demo
1. Visitante: Meca Gala → Cómo llegar. Activar ♿ Sin gradas: la ruta pasa por la plaza y el ascensor.
2. 🚻 Baño más cercano, con y sin modo accesible.
3. Administrador → Admin → marcar "Ascensor Bloque D" fuera de servicio. El Paraninfo queda sin ruta accesible y la app lo avisa.
4. Estudiante → Eventos → 🔔 Seguir TECH MECH. Mi horario → subir `horario_ejemplo.ics` → aparece "Próxima clase · Sal a las …".
5. Organizador → aforo al 30 % → plantilla "Quedan lugares" → 📣 Enviar aviso.
6. Estudiante → pestaña Avisos (llega la notificación al celular si se dieron los permisos).
7. Organizador publica un evento → Administrador lo aprueba → aparece para todos.
8. Organizador → TECH MECH → activar "Registrar asistencia con QR" → Mostrar QR. El participante lo escanea con la cámara (o escribe el código de 4 dígitos en Eventos → Registrar asistencia), ingresa su nombre y código, y queda anotado. El organizador ve la lista, puede retirar participantes y el aforo se calcula solo. El QR cambia cada 30 s para que una foto reenviada no sirva.

## Cargar datos reales: solo se edita `datos.js`
- Nodos: `lat`/`lng` reales, `piso`, `altura_m`, `alias` (cómo aparece el aula en los horarios), baños con `tipo: "bano"` y `accesible`.
- Aristas: `tipo` (camino/rampa/escalera/ascensor), `metros`, `techado`, `accesible: false` (empedrado, bordillo, puerta angosta…), `nombre` (para que el administrador pueda cerrarla, por ejemplo "Ascensor Bloque D").
- Ascensor: unir todos los pares de pisos que atiende, con el mismo `nombre`.

## Límites del prototipo (se explican en la presentación)
- La ruta minimiza la **distancia** (metros). El tiempo se muestra como estimación.
- Sin servidor: los datos se guardan en cada navegador. Los avisos, el aforo y las aprobaciones se ven en el mismo dispositivo. En producción todo pasa por un servidor con base de datos y notificaciones push.
- El horario se importa como archivo `.ics`. En producción, la sincronización es automática con el enlace iCal privado o con el permiso de Google Calendar.
- Los QR de los eventos usan un servicio público (api.qrserver.com) solo para la demo.
