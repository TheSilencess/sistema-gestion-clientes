# Deploy con Prisma y PostgreSQL

## Variables

| Variable | Uso |
| --- | --- |
| DATABASE_URL | Conexión PostgreSQL; usa sslmode=require cuando lo pida el proveedor. Codifica caracteres reservados del usuario/contraseña en la URL. |
| APP_URL | Origen público exacto, por ejemplo https://gestion.tudominio.com. Se usa para comprobar solicitudes y proteger las cookies. |
| UPLOAD_DIR | Carpeta persistente de los adjuntos. El servicio Node necesita escritura. |
| PORT | Puerto del servidor Next, 3000 por defecto. |
| ALLOW_INITIAL_SETUP | false habitualmente. true solo durante la creación inicial del administrador, con acceso restringido. |
| POSTGRES_PASSWORD | Solo en compose.yaml: contraseña del contenedor PostgreSQL. |

No compartas contraseñas por chat ni las subas al repositorio. Configúralas en el alojamiento o en un .env privado.

## Servidor Node o plataforma con disco persistente

1. Sube el código sin node_modules, .env, .local ni copias de bases.
2. Configura las variables y crea PostgreSQL.
3. Instala con npm ci; compila con npm run build.
4. En la fase de lanzamiento ejecuta npm run db:deploy; inicia con npm start.
5. Conecta HTTPS y el dominio a ese servicio.
6. Importa una copia de la base local si vas a conservar sus registros, antes de crear nuevas cuentas/registros en el destino.
7. Verifica usuarios Admin y Ventas, lectura/edición, archivos, informes y acceso tras reiniciar.

No uses prisma migrate dev ni prisma db push para actualizar producción. Utiliza las migraciones versionadas y prisma migrate deploy.

## Docker Compose

El Dockerfile utiliza Node 24, npm ci, prisma generate y next build. Al arrancar aplica prisma migrate deploy y ejecuta next start.

En un .env privado define POSTGRES_PASSWORD, APP_URL y DATABASE_URL. Para Compose, la conexión debe apuntar al host db, no localhost:

```dotenv
POSTGRES_PASSWORD=CAMBIAR_POR_UNA_CONTRASENA_PRIVADA
DATABASE_URL=postgresql://gift:CONTRASENA_CODIFICADA_PARA_URL@db:5432/gift?schema=public
APP_URL=https://gestion.tudominio.com
ALLOW_INITIAL_SETUP=false
```

Ejecuta `docker compose up --build -d`. El servicio escucha en 127.0.0.1:3000 del servidor para colocarlo detrás de tu proxy HTTPS. PostgreSQL no publica un puerto externo. Las bases y los archivos se guardan en volúmenes separados. Mantén los volúmenes al actualizar el código.

Si necesitas el primer administrador, habilita temporalmente ALLOW_INITIAL_SETUP=true mientras solo tú tengas acceso al servicio; crea la cuenta y vuelve a false. Si la cuenta viene de una importación SQLite, ese paso no es necesario.

## Respaldo

Respalda PostgreSQL y UPLOAD_DIR juntos. CSV/JSON comerciales no contienen los archivos ni las cuentas. La carpeta SQLite anterior se conserva como copia histórica; nunca se borra automáticamente. Ensaya la restauración en otro entorno antes del cambio definitivo.

## Alcance verificado

La capa Prisma y la migración de datos se probaron en PostgreSQL aislado. La instalación completa, el build de Next y el arranque del contenedor requieren un entorno con acceso a npm y a los motores nativos de Prisma; aquí quedaron bloqueados por las restricciones de red. No se ha realizado publicación ni migración de datos privados.
