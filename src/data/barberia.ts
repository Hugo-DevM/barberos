/* ==========================================================================
   CONTENIDO DE LA BARBERÍA
   --------------------------------------------------------------------------
   AVISO: "Navaja & Filo" es una marca ficticia creada como demostración.
   Todos los datos de este archivo (nombres, precios, dirección, teléfonos,
   testimonios y cifras) son de muestra y deben reemplazarse por los datos
   reales del negocio antes de publicar.

   Este es el único archivo que hay que tocar para cambiar textos, precios,
   servicios, equipo, horarios y datos de contacto. Los componentes leen de
   aquí y no llevan texto propio.

   OJO con los horarios: los de este archivo son los que se MUESTRAN. Los que
   el sistema usa para VALIDAR una reserva viven en la tabla `horarios` de
   Supabase (ver supabase/schema.sql). Si cambias unos, cambia los otros.
   ========================================================================== */

/* Zona horaria del negocio. Decide qué día es "hoy" y qué huecos ya pasaron,
   sin importar dónde esté el visitante. Tiene que coincidir con la que
   devuelve `zona_barberia()` en supabase/schema.sql. */
export const ZONA_HORARIA = 'America/Mexico_City';

export const marca = {
  nombre: 'Navaja & Filo',
  nombreCorto: 'Navaja',
  descriptor: 'Barbería',
  dominio: 'navajayfilo.mx',
  fundada: 2012,
  claim: 'Barbería de oficio en la Condesa, Ciudad de México.',
} as const;

export const contacto = {
  telefono: '+52 55 3927 4460',
  telefonoHref: '+525539274460',
  whatsapp: '525539274460',
  correo: 'hola@navajayfilo.mx',
  calle: 'Av. Tamaulipas 88, local 3',
  colonia: 'Hipódromo Condesa, Cuauhtémoc',
  cp: '06100 Ciudad de México',
  mapa: 'https://maps.google.com/?q=Av.+Tamaulipas+88,+Condesa,+CDMX',
  horarios: [
    { dias: 'Martes a viernes', horas: '11:00 – 20:30' },
    { dias: 'Sábado', horas: '10:00 – 19:00' },
    { dias: 'Domingo', horas: '11:00 – 16:00' },
    { dias: 'Lunes', horas: 'Cerrado' },
  ],
  redes: [
    { nombre: 'Instagram', icono: 'ph:instagram-logo', url: 'https://instagram.com/' },
    { nombre: 'Facebook', icono: 'ph:facebook-logo', url: 'https://facebook.com/' },
    { nombre: 'TikTok', icono: 'ph:tiktok-logo', url: 'https://tiktok.com/' },
  ],
} as const;

/* Etiqueta única para la acción principal. No usar sinónimos en otras
   secciones: una sola intención, una sola etiqueta en toda la página. */
export const CTA_PRINCIPAL = 'Reservar cita';

export const navegacion = [
  { etiqueta: 'Servicios', href: '#servicios' },
  { etiqueta: 'Barberos', href: '#barberos' },
  { etiqueta: 'Trabajo', href: '#galeria' },
  { etiqueta: 'El local', href: '#local' },
] as const;

export const hero = {
  eyebrow: 'Condesa, CDMX · desde 2012',
  titulo: 'El corte que',
  tituloAcento: 'ya traías puesto',
  entrada:
    'Cuarenta minutos, una silla y un barbero que se acuerda de cómo te gusta. Reservas en línea, sin llamadas ni esperas de pie.',
  imagenes: [
    { src: '/img/hero-principal.jpg', alt: 'Barbero perfilando un corte con máquina y peine', w: 1400, h: 1750 },
    { src: '/img/hero-local.jpg', alt: 'Varias sillas ocupadas en el salón de la barbería', w: 1200, h: 900 },
    { src: '/img/hero-detalle.jpg', alt: 'Navaja perfilando el contorno de una barba', w: 1200, h: 900 },
  ],
} as const;

/* Cinta en movimiento bajo el hero. Palabras cortas: se leen de reojo. */
export const cinta = [
  'Corte clásico',
  'Perfilado a navaja',
  'Barba caliente',
  'Fade a máquina',
  'Ritual completo',
  'Sin esperas',
] as const;

export const cifras = [
  { valor: '13', sufijo: 'años', texto: 'en la misma esquina de la Condesa' },
  { valor: '4', sufijo: 'barberos', texto: 'de planta, no rotamos sillas' },
  { valor: '40', sufijo: 'min', texto: 'es lo que dura un corte, sin prisas' },
  { valor: '4.9', sufijo: '/ 5', texto: 'promedio de 1,240 reseñas' },
] as const;

/* Los `slug` y `duracionMin` viajan a la base de datos cuando alguien
   reserva. Si cambias un slug, las citas viejas conservan el anterior. */
export const servicios = [
  {
    slug: 'corte-clasico',
    nombre: 'Corte clásico',
    precio: 320,
    duracionMin: 45,
    texto:
      'Tijera y máquina, lavado con agua tibia y peinado final. Si llegas con una foto la miramos juntos y te decimos si tu pelo da para eso antes de empezar.',
    incluye: ['Consulta de forma', 'Lavado y masaje', 'Peinado con producto'],
    imagen: '/img/servicio-corte.jpg',
    alt: 'Barbero recortando el cabello con máquina sobre peine',
  },
  {
    slug: 'barba-completa',
    nombre: 'Barba completa',
    precio: 260,
    duracionMin: 30,
    texto:
      'Recorte, perfilado y aceite. Trabajamos la forma según tu mandíbula, no según lo que se ve bien en el maniquí del catálogo.',
    incluye: ['Toalla caliente', 'Perfilado a navaja', 'Aceite y bálsamo'],
    imagen: '/img/servicio-barba.jpg',
    alt: 'Detalle del contorno de una barba recortado con máquina',
  },
  {
    slug: 'afeitado-navaja',
    nombre: 'Afeitado a navaja',
    precio: 340,
    duracionMin: 40,
    texto:
      'El de toda la vida: dos pasadas, espuma batida en bol y toalla caliente antes y después. Sales con la cara pidiendo salir a la calle.',
    incluye: ['Espuma batida a mano', 'Dos pasadas de navaja', 'Cierre con bálsamo frío'],
    imagen: '/img/servicio-afeitado.jpg',
    alt: 'Afeitado con navaja recta sobre espuma',
  },
  {
    slug: 'ritual-completo',
    nombre: 'Ritual completo',
    precio: 520,
    duracionMin: 75,
    texto:
      'Corte, barba y afeitado de cuello en una sola sesión. Es la cita que agenda la gente antes de una boda o de una foto que va a durar años colgada.',
    incluye: ['Corte completo', 'Barba trabajada', 'Cerveza o café de la casa'],
    imagen: '/img/servicio-ritual.jpg',
    alt: 'Navaja, brocha y bol de afeitar sobre una superficie de madera',
  },
] as const;

export const equipo = {
  titulo: 'Quien te corta el pelo',
  tituloAcento: 'lleva años haciéndolo',
  texto:
    'Nadie aquí lleva menos de cinco años en la silla. Puedes pedir barbero al reservar o dejar que te toque quien esté libre; los cuatro cortan igual de bien, solo cambian las mañas.',
  barberos: [
    {
      slug: 'ruben-salcedo',
      nombre: 'Rubén Salcedo',
      puesto: 'Maestro barbero',
      detalle: 'Fundador. Clásicos, tijera y navaja.',
      desde: 2012,
      imagen: '/img/barbero-1.jpg',
      alt: 'Barbero de barba larga trabajando un corte',
    },
    {
      slug: 'iker-mondragon',
      nombre: 'Iker Mondragón',
      puesto: 'Barbero',
      detalle: 'Fades, degradados y diseño a máquina.',
      desde: 2016,
      imagen: '/img/barbero-2.jpg',
      alt: 'Barbero concentrado revisando un corte',
    },
    {
      slug: 'tadeo-briseno',
      nombre: 'Tadeo Briseño',
      puesto: 'Barbero',
      detalle: 'Barba y afeitado tradicional.',
      desde: 2018,
      imagen: '/img/barbero-3.jpg',
      alt: 'Barbero perfilando la barba de un cliente',
    },
    {
      slug: 'nicolas-arriaga',
      nombre: 'Nicolás Arriaga',
      puesto: 'Barbero',
      detalle: 'Texturas largas y trabajo de tijera.',
      desde: 2019,
      imagen: '/img/barbero-4.jpg',
      alt: 'Barbero veterano atendiendo a un cliente en el sillón',
    },
  ],
} as const;

/* Opción que aparece primero en el selector de barbero. */
export const BARBERO_INDIFERENTE = {
  slug: 'sin-preferencia',
  nombre: 'El que esté libre',
} as const;

export const reserva = {
  eyebrow: 'Agenda en línea',
  titulo: 'Elige día, hora y quién',
  tituloAcento: 'te va a atender',
  texto:
    'Los huecos que ves son los que quedan de verdad: se apartan en cuanto alguien reserva. Tarda menos de un minuto y no hace falta crear cuenta.',
  /* Cuántos días hacia adelante se puede reservar. */
  diasDeAntelacion: 45,
  /* El calendario no ofrece huecos que empiecen antes de este margen. */
  margenMinutos: 60,
} as const;

export const galeria = {
  eyebrow: 'El trabajo',
  titulo: 'Lo que sale de esta silla',
  texto: 'Cortes de las últimas semanas, sin filtro y sin retoque.',
  fotos: [
    { src: '/img/galeria-1.jpg', alt: 'Barbero recortando el cabello de un cliente joven' },
    { src: '/img/galeria-2.jpg', alt: 'Mano sosteniendo un mechón de cabello antes de cortarlo' },
    { src: '/img/galeria-3.jpg', alt: 'Corte a máquina visto de perfil' },
    { src: '/img/galeria-4.jpg', alt: 'Tijeras y peine de barbería sobre fondo claro' },
    { src: '/img/galeria-5.jpg', alt: 'Retrato en blanco y negro de un corte en proceso' },
    { src: '/img/galeria-6.jpg', alt: 'Barbero trabajando la parte superior de un corte' },
    { src: '/img/galeria-7.jpg', alt: 'Tijera cortando cabello cano a contraluz' },
    { src: '/img/galeria-8.jpg', alt: 'Retrato de perfil de un hombre con barba cana' },
  ],
} as const;

export const testimonios = [
  {
    texto:
      'Llevo cuatro años yendo con Rubén y nunca he tenido que explicarle otra vez cómo lo quiero. Reservo el domingo desde el celular y el martes ya está.',
    nombre: 'Emiliano Cuevas',
    detalle: 'Cliente desde 2021',
    servicio: 'Corte clásico',
  },
  {
    texto:
      'Pedí el ritual completo dos días antes de casarme. Me atendieron a la hora exacta que aparté, cosa que en esta ciudad no pasa nunca.',
    nombre: 'Santiago Ferrer',
    detalle: 'Ritual antes de su boda',
    servicio: 'Ritual completo',
  },
  {
    texto:
      'El afeitado a navaja con toalla caliente vale cada peso. Salí de ahí con la piel mejor que cuando entré, y eso que llegué con la cara hecha un desastre.',
    nombre: 'Rodrigo Palomares',
    detalle: 'Primera visita',
    servicio: 'Afeitado a navaja',
  },
  {
    texto:
      'Me gusta que la agenda diga la verdad. Si el hueco aparece libre, está libre. No es la típica página que te manda un WhatsApp y a ver si contestan.',
    nombre: 'Andrés Lugo',
    detalle: 'Cliente desde 2023',
    servicio: 'Barba completa',
  },
] as const;

export const local = {
  eyebrow: 'El local',
  titulo: 'Cuatro sillas, nada de prisas',
  texto:
    'Abrimos en 2012 en un local que antes fue tlapalería. Conservamos el piso original y los espejos, que compramos en un remate de una barbería de la Roma que cerró. Hay café, cerveza fría y un perro que se llama Tuerca.',
  puntos: [
    'A dos calles del metro Patriotismo',
    'Estacionamiento con pensión en la misma cuadra',
    'Pago con tarjeta y transferencia',
  ],
  imagen: '/img/local.jpg',
  alt: 'Sillones de barbería antiguos en un local de madera',
  historia: {
    imagen: '/img/historia.jpg',
    alt: 'Interior de una barbería antigua en blanco y negro',
    pie: 'La barbería en 2012, el mes que abrimos.',
  },
} as const;

export const pieEnlaces = [
  {
    titulo: 'La barbería',
    enlaces: [
      { etiqueta: 'Servicios', href: '#servicios' },
      { etiqueta: 'Barberos', href: '#barberos' },
      { etiqueta: 'El trabajo', href: '#galeria' },
      { etiqueta: 'El local', href: '#local' },
    ],
  },
  {
    titulo: 'Servicios',
    enlaces: [
      { etiqueta: 'Corte clásico', href: '#servicios' },
      { etiqueta: 'Barba completa', href: '#servicios' },
      { etiqueta: 'Afeitado a navaja', href: '#servicios' },
      { etiqueta: 'Ritual completo', href: '#servicios' },
    ],
  },
  {
    titulo: 'Legal',
    enlaces: [
      { etiqueta: 'Aviso de privacidad', href: '/aviso-de-privacidad' },
      { etiqueta: 'Panel de la barbería', href: '/panel' },
    ],
  },
] as const;

export type Servicio = (typeof servicios)[number];
export type Barbero = (typeof equipo.barberos)[number];
