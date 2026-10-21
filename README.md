# Gift · Next.js + Prisma + PostgreSQL

La aplicación conserva las pantallas, el CSS, los módulos y las reglas comerciales de la versión anterior. La persistencia ahora usa Prisma ORM y PostgreSQL; el servidor y el deploy usan Next.js convencional, sin Vinext, Cloudflare D1 ni Drizzle.

## Stack

- Next.js 16 + React 19 + TypeScript.
- Prisma ORM 6.19.0 + PostgreSQL.
- CSS personalizado, modo oscuro/claro y datos reales exclusivamente.
- Usuarios Admin/Ventas, scrypt, sesiones HttpOnly y permisos comprobados en el servidor.
- Adjuntos en una carpeta persistente definida por UPLOAD_DIR.

## Arranque local

Requiere Node.js 22.13 o superior (recomendado 24), PostgreSQL y acceso al registro npm.

1. Copia .env.example a .env y configura DATABASE_URL y APP_URL.
2. Ejecuta `npm ci`.
3. Ejecuta `npm run db:deploy` para aplicar las migraciones de Prisma.
4. Ejecuta `npm run dev` y abre http://127.0.0.1:3000/.
5. Crea el primer administrador en el navegador. Desde Usuarios puedes crear Admin y Ventas.

`INICIAR-GIFT.cmd` abre el servidor de desarrollo después de instalar y configurar lo anterior. No incluye cuentas ni contraseñas predeterminadas.

## Deploy Node

Configura DATABASE_URL, APP_URL con la dirección HTTPS pública y UPLOAD_DIR con una carpeta persistente. Después:

```sh
npm ci
npm run build
npm run db:deploy
npm start
```

Las migraciones se ejecutan como paso de lanzamiento, no durante la compilación. El servidor utiliza el puerto PORT de Next.js (3000 por defecto). El proyecto incluye Dockerfile y compose.yaml como alternativa. Más detalles en docs/DEPLOY-PRISMA.md.

La primera configuración de un administrador en producción requiere ALLOW_INITIAL_SETUP=true y acceso al servicio restringido durante ese paso. Después de crearlo, vuelve a false y reinicia. Si importas los usuarios anteriores, ya puedes entrar con sus mismas credenciales.

Los adjuntos necesitan almacenamiento persistente. Un alojamiento con disco efímero, como una función serverless sin volumen, necesita adaptar lib/storage.ts a un almacenamiento de objetos antes de usar archivos en producción. El Docker Compose incluido utiliza volúmenes para PostgreSQL y adjuntos.

## Conservar la base de la versión local

La adaptación no modifica ni elimina .local/gift.sqlite ni sus archivos. Para transferirla a un PostgreSQL nuevo y vacío:

1. Detén la versión anterior y toma una copia completa de .local.
2. Configura DATABASE_URL del destino y ejecuta `npm run db:deploy`.
3. Ejecuta primero la vista previa, que no escribe:

```sh
npm run db:import-sqlite -- --source "ruta/copia/gift.sqlite"
```

4. Tras revisar los recuentos, ejecuta:

```sh
npm run db:import-sqlite -- --source "ruta/copia/gift.sqlite" --files "ruta/copia/files" --commit
```

El importador conserva registros reales, IDs, versiones, datos históricos originales, lotes, correlativos, preferencias, auditoría, comentarios, cuentas y hashes de contraseñas. Comprueba los hashes de los adjuntos. No importa demostraciones ni sesiones; hay que iniciar sesión de nuevo. Rechaza un destino con registros existentes y nunca abre SQLite con permiso de escritura. La importación de datos es transaccional; si falla después de copiar archivos, estos pueden quedar sin referencias y reutilizarse al reintentar con la misma copia.

Este importador corresponde a la base de la versión local de Gift que construimos. La migración desde el CRM antiguo continúa en el centro de migración CSV y mantiene las mismas limitaciones anteriores.

## Estructura

- app/workspace.tsx, app/accounts.tsx y app/globals.css: interfaz existente.
- app/auth-shell.tsx: mismo inicio de sesión dentro de Next.js.
- app/api: rutas HTTP de operaciones, sesión y usuarios.
- lib/workspace-service.ts: reglas comerciales y operaciones Prisma.
- lib/auth.ts: cuentas, contraseñas y sesiones persistentes.
- lib/prisma.ts: instancia compartida de Prisma Client.
- prisma/schema.prisma y prisma/migrations: modelos y migraciones PostgreSQL.
- lib/sqlite-import.ts: traslado de la versión local anterior.

Los registros comerciales mantienen sus campos dinámicos y sus importes como texto serializado para preservar exactamente los datos existentes. Las consultas y transacciones usan Prisma; la reserva concurrente de correlativos utiliza una consulta PostgreSQL parametrizada a través de Prisma.

## Verificación y límites de esta adaptación

Se validó el esquema con Prisma 6.19.0 y se generó el cliente. Pasaron 10 pruebas de dominio y 9 de integración con Prisma sobre un motor PostgreSQL aislado (PGlite), incluyendo el traslado desde SQLite. La revisión de tipos del código de interfaz, autenticación, persistencia e importador no mostró errores. El archivo package-lock se comprobó con `npm ci --dry-run`.

El entorno bloquea las descargas npm y de los motores nativos de Prisma. Por eso no se pudo instalar Next.js ni ejecutar su build completo aquí. Las pruebas de integración usaron un cliente de pruebas sin motor nativo con un adaptador PostgreSQL temporal; esas herramientas no se incluyen en el código del producto. Antes del deploy definitivo, ejecuta npm ci, npm run typecheck, npm run build y las pruebas contra un PostgreSQL de ensayo.

Para las pruebas PostgreSQL configura una base VACÍA y exclusiva de pruebas, DATABASE_URL y GIFT_TEST_DATABASE=1; ejecuta `npm run test:integration`. La suite comprueba que el destino inicial esté vacío y modifica solo la base de pruebas indicada. `npm test` incluye las pruebas de dominio y omite la integración si no se habilita esa base.

La adaptación de stack no añade ni cambia funciones de negocio. FEL, inventario automático, correo, diseños fiscales exactos, conciliación y las demás equivalencias pendientes de la entrega anterior siguen pendientes. No se ha desplegado ni modificado el CRM original.

## Actualización 0.3.1

Facturas y Envíos permite eliminar ventas no fiscales mediante una papelera recuperable, consultar los abonos en una pestaña Pagos y modificar sus estados desde allí. Los pagos admiten Pendiente, Realizado (completado) y Anulado; solo Realizado reduce el saldo. Los pagos activos bloquean la eliminación de la venta. No cambia el esquema de PostgreSQL ni requiere resetear datos. Detalles en docs/ACTUALIZACION-PAGOS.md. Las restricciones anteriores sobre archivo de documentos se sustituyen por estas reglas para ventas; compras y pagos continúan conservándose.
