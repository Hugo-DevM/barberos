## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Arquitectura de este proyecto

- `src/data/barberia.ts` es el único archivo de contenido. Textos, servicios,
  precios, equipo, horarios y datos de contacto salen de ahí. Los componentes
  no llevan texto propio.
- `src/styles/global.css` define los tokens. No inventar colores nuevos en los
  componentes: usar las variables.
- `src/lib/reservas.ts` es la única puerta a los datos de citas. Si no hay
  credenciales de Supabase, cae solo a un modo demo con `localStorage`. El modo
  demo tiene que repetir las MISMAS reglas que el servidor: si acepta algo que
  el sistema real rechaza, está enseñando algo que no existe.
- El esquema de la base vive en `supabase/schema.sql` y se pega tal cual en el
  editor SQL de Supabase.
- **El dinero no se le cree al navegador.** La tabla `servicios` es la autoridad
  sobre precio, duración y anticipo; `reservar_cita` los lee de ahí y solo acepta
  del cliente QUÉ servicio eligió. No volver a pasar precios por parámetro.
- Los iconos de Phosphor están en una **lista blanca** en `astro.config.mjs`. Un
  icono que no esté ahí rompe el build con "Unable to locate icon", aunque exista
  en el paquete. Al añadir uno nuevo, añadirlo también a esa lista.
- Las clases que crea el JavaScript del panel (`cita-fila`, `pago`, `insignia`…)
  necesitan ir en el bloque `<style is:global>`; en el `<style>` normal, Astro
  las descarta por no encontrarlas en el marcado.
- `src/components/Analitica.astro` es el único lugar donde vive Google
  Analytics. No añadir etiquetas de medición en otros componentes. Los eventos
  se mandan con `window.medirEvento?.('nombre', {…})`, siempre con `?.`: el
  ayudante solo existe si hay `PUBLIC_GA_ID`. Nunca pasar datos personales del
  cliente en los parámetros.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
