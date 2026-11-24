# RutaVisita

Sistema personal de gestión de visitas y rutas de transporte público.
Funciona sin conexión (PWA) y guarda todo en el teléfono.

## Qué hace
- **Ruta del día**: paradas ordenables, siguiente parada, efectividad y planeación de otros días.
- **Orden automático**: por horario → prioridad → cercanía (si hay ubicación exacta) o zona.
- **Estados con historial** y deshacer; reprogramar y seguimientos con fecha.
- **Atrasadas** y **pendientes sin fecha** para no perder visitas.
- **Gastos**: sumar pasajes al día, resumen semanal/mensual y costo por visita.
- **Respaldo**: JSON (descargar/compartir/restaurar) y CSV para Excel.

## Archivos
`index.html`, `styles.css`, `logic.js` (lógica pura), `app.js` (interfaz), `service-worker.js`, `manifest.json`, íconos.

## Pruebas
`node tests.js`
