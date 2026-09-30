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
  credenciales de Supabase, cae solo a un modo demo con `localStorage`.
- El esquema de la base vive en `supabase/schema.sql` y se pega tal cual en el
  editor SQL de Supabase.
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
