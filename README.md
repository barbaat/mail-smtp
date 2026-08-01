# SMTP

Aplicación web local para enviar el mismo correo a varias direcciones mediante SMTP. Ejecuta un
`sendMail()` independiente por destinatario: el campo **Para** contiene solo una dirección y nunca
se utilizan CC ni CCO.

## Requisitos

- Node.js 18.18 o superior.
- npm.
- Una cuenta SMTP válida o un servidor SMTP local de pruebas.

## Instalación y ejecución

```bash
npm install
npm start
```

Abre [http://localhost:3000](http://localhost:3000).

Para desarrollo con reinicio automático:

```bash
npm run dev
```

## Configuración

Copia el ejemplo si quieres cambiar los límites:

```bash
cp .env.example .env
```

| Variable           | Valor inicial | Descripción                                                         |
| ------------------ | ------------: | ------------------------------------------------------------------- |
| `HOST`             |   `127.0.0.1` | Interfaz de red; usa `0.0.0.0` solo detrás de una red/proxy seguro. |
| `PORT`             |        `3000` | Puerto HTTP local.                                                  |
| `MAX_RECIPIENTS`   |         `100` | Máximo de destinatarios por operación.                              |
| `SEND_DELAY_MS`    |         `500` | Pausa predeterminada entre envíos.                                  |
| `MAX_FILE_SIZE_MB` |          `10` | Tamaño máximo por archivo adjunto.                                  |
| `SMTP_PASSWORD`    |             — | Contraseña o clave de aplicación SMTP; solo existe en el servidor.  |
| `WEB_PASSWORD`     |             — | Contraseña necesaria para acceder a la aplicación.                  |

`SMTP_PASSWORD` y `WEB_PASSWORD` son obligatorias. En producción, añádelas como variables cifradas
en Vercel y vuelve a desplegar. No uses el prefijo `NEXT_PUBLIC_` ni confirmes archivos `.env` con
valores reales. La contraseña SMTP nunca se envía al navegador.

### Configuraciones rápidas

- **Gmail:** `smtp.gmail.com`, puerto `465`, SSL/TLS. También suele funcionar el puerto `587` con
  STARTTLS.
- **Outlook / Microsoft 365:** `smtp.office365.com`, puerto `587`, STARTTLS.
- **Personalizado:** usa los valores proporcionados por tu proveedor.
- **Servidor local sin cifrado:** selecciona esta opción únicamente en un entorno local controlado.

## Ejemplo de uso

1. Inicia sesión con `WEB_PASSWORD`.
2. Introduce servidor, puerto, seguridad y usuario SMTP. La contraseña se toma de `SMTP_PASSWORD`.
3. Añade el nombre y correo del remitente.
4. Pulsa **Probar conexión SMTP**.
5. Añade cada destinatario con **Añadir correo** o pega una lista separada por comas, punto y coma,
   espacios o saltos de línea. Se creará un campo por dirección y se eliminarán los duplicados al
   enviar.
6. Completa asunto, mensaje, formato y adjuntos.
7. Confirma el número de destinatarios y comienza el envío.
8. Revisa el manifiesto o descarga el resultado en CSV.

Haz primero una prueba con una sola dirección que controles.

## Gmail y contraseñas de aplicación

Google normalmente no permite autenticar SMTP con la contraseña habitual cuando la cuenta tiene
medidas de seguridad modernas. Activa la verificación en dos pasos y crea una **contraseña de
aplicación** si la opción está disponible; usa esa clave en la aplicación. En cuentas de empresa o
centro educativo, el administrador puede bloquear las contraseñas de aplicación o el acceso SMTP.

Otros proveedores también pueden bloquear la contraseña normal, exigir una clave específica para
SMTP, OAuth o la activación previa de “SMTP autenticado”. Consulta la configuración de seguridad de
tu proveedor.

## Límites SMTP habituales

Los proveedores aplican límites diarios, por minuto, por tamaño y por reputación. También pueden
rechazar destinatarios, limitar temporalmente la conexión o bloquear envíos repetitivos. El intervalo
entre mensajes reduce la frecuencia, pero no evita los límites del proveedor. Esta herramienta no es
un servicio de campañas ni sustituye a una plataforma de correo transaccional.

Usa la aplicación solo con destinatarios autorizados y respeta la normativa aplicable.

## API

### `POST /api/test-smtp`

Acepta JSON con `smtpConfig` y ejecuta `transporter.verify()`. La contraseña siempre se obtiene de
`SMTP_PASSWORD` en el servidor.

### `POST /api/send`

Acepta `multipart/form-data` con:

- `smtpConfig`: JSON con `host`, `port`, `security` y `username`.
- `sender`: JSON con `name` y `email`.
- `recipients`: lista separada por saltos, comas o punto y coma.
- `subject`, `content`, `contentType` (`text` o `html`) y `delayMs`.
- `operationId`: identificador único generado por el cliente.
- `attachments`: cero o varios archivos.

La respuesta usa NDJSON: emite estados `started`, `sending`, `result` y `complete`. Cada resultado
incluye destinatario, estado, fecha y un error seguro cuando corresponde.

### `POST /api/send/:operationId/cancel`

Marca como cancelados los destinatarios todavía pendientes. El correo que ya se está transmitiendo
termina antes de detener la operación.

## Seguridad y despliegue

La aplicación incluye acceso mediante cookie `HttpOnly` con caducidad de 12 horas, limitación de
intentos de inicio de sesión, Helmet, CSP, límites de petición y archivos, saneado de HTML,
validación servidor, rate limiting y mensajes de error reducidos. Los adjuntos se mantienen en
memoria durante la petición y no se guardan en disco.

Si se publica en Internet:

1. Usa exclusivamente HTTPS detrás de un proxy inverso actualizado.
2. Añade autenticación fuerte y restringe el acceso por red, VPN o lista de IP.
3. No expongas el servicio directamente a Internet ni lo conviertas en un relay abierto.
4. Configura límites equivalentes de tamaño y frecuencia en el proxy.
5. Usa un gestor de procesos, un usuario del sistema sin privilegios y dependencias actualizadas.
6. Revisa la política CSP y registra solo métricas operativas sin cuerpos, destinatarios ni secretos.

## Comprobaciones

```bash
npm run check
npm test
```

Las pruebas validan que se invoque `transporter.verify()`, comprueban direcciones válidas,
inválidas y duplicadas, simulan rechazos SMTP y confirman que cada entrega contiene un único
destinatario.
