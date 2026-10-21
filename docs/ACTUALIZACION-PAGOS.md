# Actualización 0.3.1 · Pagos y papelera de ventas

## Actualizar tu copia

1. Detén el servidor con Ctrl+C.
2. Sustituye los archivos de código por los de este ZIP en la misma carpeta. Conserva tu .env y tus carpetas de datos y adjuntos, incluida .local. No reemplaces ni reinicies PostgreSQL.
3. Ejecuta npm run dev y recarga el navegador. Si es una instalación nueva, sigue el README (npm ci y configuración de la base).

Esta actualización no añade tablas ni requiere resetear o volver a migrar los datos existentes. Mantiene el diseño y el stack Next.js, React, TypeScript, Prisma y PostgreSQL.

## Pagos desde Facturas y Envíos

Abre una venta y entra en la pestaña Pagos. Allí aparecen todos sus abonos, con importe, fecha y estado. Pulsa Editar estado / pago para modificar el abono existente; al guardar, vuelves a la misma factura y se actualiza su saldo.

- Pendiente: el pago todavía no está recibido; no descuenta saldo.
- Completado (Realizado): el dinero fue recibido; descuenta saldo.
- Anulado: el abono no cuenta; si antes estaba realizado, se restituye ese importe al saldo.

Ejemplo: una venta de Q500 con un abono realizado de Q200 tiene Q300 de saldo pendiente. Si anulas ese abono, vuelve a Q500. Registrar un abono no aumenta la deuda: registra el dinero recibido y por eso la reduce.

Estado del cobro se calcula automáticamente: Pendiente, Parcial o Completado. No sustituye el estado fiscal del documento ni la casilla Entregada. Los pagos históricos migrados ya incluidos en el saldo inicial no se descuentan de nuevo y siguen protegidos en consulta.

## Eliminar y recuperar

Abre una venta no fiscal y pulsa Eliminar registro en el pie de la ficha. Se mueve a la papelera; conserva archivos, comentarios e historial. En la lista de Facturas y Envíos selecciona Archivados, abre el registro y pulsa Restaurar registro.

Si existen pagos pendientes o realizados, la aplicación pide anularlos primero desde la pestaña Pagos. Los documentos fiscales y los históricos migrados siguen protegidos. Eliminar un registro comercial no anula una factura FEL.

## Comprobación

21 pruebas automáticas aprobadas: 10 de dominio y 11 de integración Prisma/PostgreSQL aislado. Se probó el paso Pendiente → Realizado → Anulado, el cambio del saldo, eliminación/restauración, protección de documentos fiscales y bloqueo de abonos en ventas eliminadas. La revisión de tipos del código de interfaz y servidor pasó sin errores. El build completo de Next sigue pendiente en un entorno con acceso a las dependencias, como se indica en README.
