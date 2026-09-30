# Navaja & Filo

Landing page de barbería con **sistema de reservas en línea** y **panel de
agenda** para el negocio. Sitio estático construido con Astro, sin framework de
interfaz; la persistencia va contra Supabase desde el navegador.

> **Navaja & Filo es una marca ficticia.** Nombres, precios, dirección,
> teléfonos, testimonios y cifras son de muestra. Las fotos vienen de bancos
> con licencia de uso comercial (ver `CREDITOS-IMAGENES.md`). Lee
> [Antes de publicar](#antes-de-publicar) antes de subir esto a un dominio real.

## Arrancar

```bash
npm install
npm run dev      # servidor local
npm run build    # genera dist/
npm run preview  # sirve dist/ para revisarlo
npm run promo    # imágenes para portafolio y redes, en promo/
```

Requiere Node 22.12 o superior.

**Funciona sin configurar nada.** Si no hay credenciales de Supabase, el sitio
arranca en *modo demo*: las citas se guardan en `localStorage` y solo existen en
ese navegador. Sirve para enseñar el flujo completo —reservar, ver el hueco
desaparecer, entrar al panel y confirmar— sin crear cuenta en ningún lado.

## Cómo funcionan las reservas

Son dos piezas que hablan por un solo sitio, `src/lib/reservas.ts`:

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Reserva del cliente | `#reservar` en la portada | Elige servicio, barbero, día y hora; manda la cita |
| Agenda del negocio | `/panel` | Lista las citas, filtra y cambia su estado |

El cliente elige en cinco pasos: servicio → barbero → día → hora → sus datos.
El calendario no ofrece huecos inventados: al cargar la página se pide de una
sola vez la ocupación de los próximos 45 días y con eso se calcula, para cada
día y cada hora, si queda algún barbero libre que pueda meter ese servicio
entero antes de cerrar.

Elegir **"El que esté libre"** no crea una cita sin dueño: el servidor asigna al
primer barbero disponible en ese momento. Tiene que ser así, porque cuatro
barberos pueden atender a cuatro personas a la misma hora y una cita "genérica"
haría imposible controlar los traslapes.

### Añadir la cita al calendario

Al confirmar, el botón **Añadir a mi calendario** abre un menú con tres salidas:

| Opción | Qué hace |
| --- | --- |
| Google Calendar | Abre una pestaña con el evento ya cargado. Solo hay que guardar |
| Outlook | Igual, contra `outlook.live.com` |
| Apple Calendar y otros | Descarga un archivo `.ics` |

Google y Outlook admiten el evento dentro de la propia URL, así que desde una
computadora no hay nada que descargar ni que buscar después en la carpeta de
descargas. El `.ics` queda como tercera salida para quien use Apple Calendar,
Thunderbird o cualquier otro cliente de escritorio.

Las tres llevan la misma hora, escrita como instante absoluto en UTC
(`DTSTART:20260925T170000Z`) y no como hora suelta. Si alguien reserva desde
otro huso, su calendario la convierte a su hora local en lugar de ponerla a las
once de *su* zona. El archivo `.ics` además pliega las líneas de más de 75
octetos, como pide el RFC 5545, porque la dirección del local se pasa y sin eso
algunas importaciones de Outlook la truncan.

### Cuándo se bloquea y cuándo se libera un hueco

| Estado de la cita | ¿Bloquea el hueco de ese barbero? |
| --- | --- |
| Sin confirmar (`pendiente`) | **Sí**, desde el instante en que se reserva |
| Confirmada | Sí |
| Atendida (`completada`) | Sí |
| Cancelada | **No**, el hueco vuelve a ofrecerse |

No hace falta que la barbería confirme nada para que el hueco quede apartado:
reservar ya lo aparta. Lo único que lo libera es **cancelar la cita desde el
panel**. Marcarla como atendida no la libera.

Las horas ocupadas **se muestran, tachadas y sin poder pulsarse**, en vez de
desaparecer. Una lista con tres horas sueltas no dice si la barbería abre poco
o si está llena; la rejilla completa con la mitad tachada sí, y evita que
alguien crea que la página se equivocó. Debajo va la cuenta: "17 de 19 horas
libres".

Con "el que esté libre", una hora solo se tacha cuando los cuatro barberos
están tomados. El día entero se tacha en el calendario únicamente si no le
queda ninguna hora libre.

### Tope de citas por teléfono

Como una cita sin confirmar ya aparta el hueco, sin un freno cualquiera podría
vaciar la agenda del mes en dos minutos con datos inventados. Un mismo teléfono
no puede tener más de **tres citas futuras vivas** a la vez (`pendiente` o
`confirmada`). Las pasadas y las canceladas no cuentan.

El tope está en `reservar_cita`, no en el navegador, así que no se salta
llamando a la API a mano. El número se normaliza a dígitos, de modo que
`55 9999 8888` y `5599998888` cuentan como el mismo teléfono.

Para cambiarlo, `c_tope_por_telefono` en `supabase/schema.sql`. Si lo tocas,
ajusta también `TOPE_POR_TELEFONO` en `src/lib/reservas.ts`, que es el que
aplica el modo demo.

La agenda se pide al cargar la página. Si alguien deja la pestaña abierta y
vuelve más de un minuto después, se vuelve a pedir al recuperar el foco, y si
el día o la hora que tenía elegidos se ocuparon entretanto, se limpian y se le
avisa. Así no escribe sus datos para que el servidor se lo rechace al final.

### Por qué no se puede reservar dos veces el mismo hueco

Tres capas, de fuera hacia dentro:

1. **El calendario** no muestra los huecos ocupados.
2. **La función `reservar_cita`** revalida todo en el servidor: horario de
   atención, cierres, antelación mínima, y que el barbero siga libre. No se fía
   de lo que diga el navegador.
3. **Una restricción de exclusión de PostgreSQL** (`citas_sin_traslape`) impide
   físicamente que dos citas del mismo barbero compartan un minuto. Se evalúa
   dentro de la transacción, así que gana incluso si dos personas confirman el
   mismo hueco en el mismo instante. Cuando eso pasa, la función devuelve
   `HORA_OCUPADA`, el sitio lo traduce a "alguien apartó ese hueco hace un
   momento" y recarga la agenda.

## Conectar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (el plan gratuito
   sobra para una barbería).
2. Abre **SQL Editor**, pega entero `supabase/schema.sql` y ejecútalo. Crea las
   tablas, las políticas de seguridad, las dos funciones y siembra horarios y
   barberos. Es idempotente: puedes volver a correrlo.
3. Copia `.env.example` a `.env` y rellena las dos variables con lo que aparece
   en **Settings → API**.
4. Da de alta al personal en **Authentication → Users**, con correo y
   contraseña. Esas son las cuentas que entran a `/panel`.
5. `npm run build`. El sitio deja de usar el modo demo solo.

### Qué ve cada quien

| Tabla | Anónimo | Personal autenticado |
| --- | --- | --- |
| `horarios`, `barberos`, `bloqueos` | Lectura | Todo |
| `citas` | **Nada** | Todo |

Los datos del cliente —nombre, teléfono, correo— no son legibles por el rol
anónimo. Para pintar el calendario se usa la función `disponibilidad`, que
devuelve solo qué barbero está ocupado, cuándo y cuánto: ni un dato personal.

La clave `anon` viaja al navegador y eso es correcto: es una clave pública. Lo
que protege la agenda son las políticas de fila, no el secreto de esa clave.
**Nunca pongas la clave `service_role` en este proyecto.**

### El panel

`/panel` está marcado `noindex` y no aparece enlazado más que en el pie.

- Filtros por rango: hoy, mañana, próximos 7 días, todas las próximas, últimos
  30 días. Más una casilla para ver solo las que faltan por confirmar.
- Cada cita trae el teléfono como enlace de llamada y un enlace de WhatsApp con
  el mensaje de confirmación ya escrito.
- Estados: sin confirmar → confirmada → atendida, y cancelada desde cualquiera.
  Cancelar pide confirmación, porque libera el hueco.
- La franja de color a la izquierda de cada fila deja ver el estado de toda la
  agenda sin leer una sola insignia.

En modo demo la contraseña es `navaja2012` y está a la vista a propósito: no hay
nada que proteger cuando las citas viven en el navegador de quien mira. En
cuanto existen credenciales de Supabase, esa contraseña deja de funcionar y la
única entrada es una cuenta real.

## Dónde se edita cada cosa

| Qué quieres cambiar | Archivo |
| --- | --- |
| Textos, precios, servicios, equipo, horarios, contacto | `src/data/barberia.ts` |
| Colores, tipografía, radios, espaciado | `src/styles/global.css` (bloque `:root`) |
| Título, descripción, datos estructurados, Open Graph | `src/layouts/Base.astro` |
| Orden de las secciones | `src/pages/index.astro` |
| Tablas, políticas y reglas de reserva | `supabase/schema.sql` |
| Fotografías | `public/img/` |

Los componentes no llevan texto propio: todo sale de `src/data/barberia.ts`.

### Los dos sitios donde hay que cambiar lo mismo

Hay dos duplicaciones a propósito, y conviene conocerlas:

1. **Los horarios.** `contacto.horarios` en el archivo de datos es lo que se
   *muestra* ("Martes a viernes, 11:00 – 20:30"). La tabla `horarios` de
   Supabase es lo que se *valida*, día por día. Son representaciones distintas
   para usos distintos; si cambias el horario de atención, cambia las dos.
2. **Los barberos.** `equipo.barberos` lleva foto, biografía y antigüedad. La
   tabla `barberos` lleva solo lo que el motor de reservas necesita para
   repartir citas. Los `slug` tienen que coincidir, o la página ofrecerá un
   barbero que la base no conoce.

### Sistema de diseño

La página alterna bandas de vino oscuro y bandas de hueso. En vez de duplicar
cada componente para los dos fondos, cada banda declara un **lienzo**:

| Clase | Fondo | Cuándo |
| --- | --- | --- |
| `.lienzo--oscuro` | Vino `#2b1218` | Hero, equipo, galería, local, pie, panel |
| `.lienzo--claro` | Hueso `#f4ede7` | Servicios, reservas, testimonios |

El lienzo redefine `--ink`, `--linea`, `--sup`, `--acento` y los colores de
estado. Los componentes solo usan esas variables y funcionan en cualquiera de
los dos.

**Acento pareado.** No hay un color de acento, hay dos: la **arena**
(`#e8c9b0`) manda sobre el vino y el **vino vivo** (`#8e2b36`) manda sobre el
hueso. Ninguno de los dos es legible en el fondo del otro —la arena sobre hueso
da 1.3:1—, así que `--acento` cambia con el lienzo en vez de ser fijo. Por eso
el botón de reservar es color arena en el hero y color vino en el formulario:
es el mismo papel, resuelto con el color que funciona en cada fondo.

**Ningún componente escribe un color literal.** Lo que va siempre sobre oscuro
aunque viva en un lienzo claro —la cabecera flotante, el panel de resumen, un
rótulo encima de una foto— usa `--sobre-oscuro-*` y `--velo`. La única
excepción del proyecto es `<meta name="theme-color">` en `Base.astro`, porque
una etiqueta meta no puede leer una variable CSS; lleva comentario avisando de
que tiene que seguir a `--vino-900`.

Cambiar la paleta entera es editar el bloque `:root` y los dos lienzos de
`global.css`. Nada más.

**Por qué vino y no verde.** La primera versión era crema + verde muy oscuro +
dorado, que resultó ser casi la misma paleta que el proyecto del despacho de
abogados (`../abogados`: papel `#ede9e1`, tinta `#14201b`, latón `#a9803f`).
Puestos uno al lado del otro en un portafolio se leían como el mismo trabajo
dos veces. El vino viene del poste de barbería, así que sigue siendo del
oficio, y se separa tanto del verde del despacho como del azul clínico del
proyecto de dentista.

**Los estados no son rojo y verde.** En una paleta de vino, un rojo de error se
confunde con la marca: el error usa naranja quemado (`--alerta`, `#c2410c`) y
su variante clara para fondos oscuros. Cada lienzo expone `--estado-alerta` y
`--estado-ok` ya resueltos.

Escala de radios:

- Interactivo (botones, chips): `--r-pill`
- Tarjetas e imágenes: `--r-card`
- Campos de formulario y celdas del calendario: `--r-inner`
- Arco: `--r-arco`

El **arco** es la firma visual del sitio: repite el remate de los espejos de
barbería. Aparece solo en el hero y en las fichas del equipo. Si se usa en más
sitios deja de significar algo.

### Tipografía

Fraunces (serif, corte display) para titulares; Archivo (sans) para todo lo
demás. Ambas auto-alojadas en `public/fonts`, sin peticiones a terceros.

Las **cifras operativas** —precios, horas, contadores del panel— van en Archivo
con numerales tabulares, no en Fraunces. El "3" del corte display de Fraunces se
confunde con un "5" a tamaños pequeños, y un precio mal leído es el peor sitio
donde ahorrarse una ambigüedad.

### Estilos de elementos que crea el JavaScript

Los días del calendario, las fichas de hora y las filas del panel nacen en el
navegador. Astro añade su atributo de ámbito solo a los nodos que están en la
plantilla, así que el CSS con ámbito nunca los alcanzaría. Esas reglas viven en
un bloque `<style is:global>` aparte, anclado al identificador del contenedor
(`#calendario-rejilla`, `#horarios`, `#lista`) para que no se escapen. Está
comentado en cada archivo; si añades elementos dinámicos, ponlos ahí.

## Zona horaria

`ZONA_HORARIA` en el archivo de datos y `zona_barberia()` en el esquema SQL
tienen que decir lo mismo. Supabase corre en UTC: sin fijarla, "hoy" cambiaría
de día a las seis de la tarde hora de Ciudad de México.

Toda la aritmética de horarios se hace con enteros de minutos y fechas en texto
`AAAA-MM-DD`. Los objetos `Date` solo aparecen para preguntar qué hora es *ahora*
en la barbería.

## Accesibilidad

- Servicio y barbero son `input[type=radio]` de verdad, ocultos a la vista pero
  no al teclado ni al lector de pantalla.
- El calendario anuncia por región viva cuántos horarios quedan al elegir día.
- Los días sin hueco se marcan con tachado y con el punto ausente, no solo con
  color.
- La animación de la cinta y el revelado al hacer scroll respetan
  `prefers-reduced-motion`.
- Sin JavaScript el contenido se ve completo; lo único que deja de funcionar es
  la reserva en línea, y para eso están el teléfono y el WhatsApp en la barra
  fija de móvil.

## Analítica

Google Analytics 4 vive en un solo archivo, `src/components/Analitica.astro`,
que el layout mete en el `<head>`. Se enciende con una variable de entorno:

```
# .env
PUBLIC_GA_ID=G-XXXXXXXXXX
```

El ID sale de analytics.google.com → Administrar → Flujos de datos → el flujo
web del sitio → «ID de medición». Si la variable está vacía el componente no
pinta nada: el sitio no carga un solo byte de Google y no pone cookies. El
valor se congela en el HTML al construir, así que cambiarlo pide otro
`npm run build`.

El panel (`/panel`) queda fuera con `analitica={false}`: las visitas del dueño
revisando su agenda falsearían el informe de captación.

### Qué se mide

Además de las vistas de página, los gestos que aquí valen como lead:

| Evento                | Cuándo se dispara                               | Parámetros propios          |
| --------------------- | ----------------------------------------------- | --------------------------- |
| `clic_telefono`       | Clic en cualquier enlace `tel:`                 | `seccion`                   |
| `clic_whatsapp`       | Clic en cualquier enlace de WhatsApp            | `seccion`                   |
| `clic_correo`         | Clic en cualquier enlace `mailto:`              | `seccion`                   |
| `cta_reservar`        | Clic en el botón de reservar (hero, cabecera, barra móvil) | `seccion`        |
| `inicio_reserva`      | Primera interacción real con el formulario      | `servicio`                  |
| `reserva_completada`  | La cita quedó guardada                          | `servicio`, `barbero`, `value`, `currency` |

`seccion` es el `id` del bloque donde estaba el enlace, así que distingue el
WhatsApp de la barra móvil del que está en el pie.

Dos cosas hay que hacer una vez dentro de GA4, que no se pueden configurar
desde el código:

1. Marcar `reserva_completada` como **evento clave** (Administrar → Eventos).
   Es la conversión; sin eso GA4 lo trata como un evento cualquiera.
2. Declarar los parámetros propios (`servicio`, `categoria`, `barbero`,
   `seccion`) como **dimensiones personalizadas**. Hasta que no estén
   declaradas los informes no permiten segmentar por ellas.

La diferencia entre `inicio_reserva` y `reserva_completada` es lo que importa:
dice si la barbería pierde clientes porque llega poca gente o porque la gente
se atora a medio formulario. Son dos problemas con soluciones opuestas.

No se manda nunca nombre, teléfono ni correo del cliente a GA4. Solo el
servicio, quién atiende y el importe.

### Consentimiento

El componente arranca con el modo de consentimiento de Google en
`analytics_storage: granted` y toda la parte publicitaria en `denied`. Para un
sitio de captación en México con su aviso de privacidad publicado eso alcanza.
Si algún día se conecta Google Ads y hace falta `ad_storage`, entonces sí hay
que montar un banner de cookies antes de concederlo.

## Antes de publicar

- [ ] Sustituir **todo** el contenido de `src/data/barberia.ts` por los datos
      reales: nombre, dirección, teléfonos, precios, equipo, testimonios.
- [ ] Crear la propiedad de GA4 del negocio y poner su `PUBLIC_GA_ID` en el
      `.env` del servidor de compilación. Una propiedad por landing: si dos
      comparten ID, los informes se mezclan.
- [ ] Cambiar `site` en `astro.config.mjs` al dominio real.
- [ ] Sustituir las fotos de `public/img/` por fotos propias de la barbería.
      Las actuales son de banco y se notan (ver `CREDITOS-IMAGENES.md`).
- [ ] Ajustar el favicon y el logotipo si la marca tiene uno propio.
- [ ] Revisar `src/pages/aviso-de-privacidad.astro`: es una plantilla, no
      asesoría legal. Que lo vea quien corresponda.
- [ ] Sembrar en Supabase los horarios y los barberos reales, y dar de alta las
      cuentas del personal.
- [ ] Comprobar los datos estructurados de `src/layouts/Base.astro` con la
      [prueba de resultados enriquecidos](https://search.google.com/test/rich-results).
- [ ] Reservar una cita de prueba de punta a punta y confirmarla desde el panel.

## Estructura

```
src/
  components/    Secciones de la portada
  data/
    barberia.ts  Todo el contenido editable
  layouts/
    Base.astro   <head>, datos estructurados, revelado al hacer scroll
  lib/
    supabase.ts  Cliente, o null si no hay credenciales
    reservas.ts  Única puerta a los datos de citas (Supabase o modo demo)
  pages/
    index.astro               Portada
    panel.astro               Agenda del negocio
    aviso-de-privacidad.astro Plantilla legal
  styles/
    global.css   Tokens, lienzos, utilidades
supabase/
  schema.sql     Tablas, políticas y funciones. Se pega en el SQL Editor
scripts/
  promo.mjs      Capturas para portafolio
```
