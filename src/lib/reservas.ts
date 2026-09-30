/* ==========================================================================
   Capa de reservas
   --------------------------------------------------------------------------
   Único punto por el que pasan los datos de citas. Tiene dos implementaciones
   detrás de la misma interfaz:

     - Supabase, cuando hay credenciales. Es el modo real.
     - localStorage, cuando no las hay. Es el modo demo: el sitio se puede
       enseñar y probar de punta a punta sin crear cuenta en ningún lado,
       pero las citas solo existen en ese navegador.

   Sobre el tiempo: toda la aritmética de horarios se hace con enteros de
   minutos desde medianoche y fechas en texto 'AAAA-MM-DD'. Los objetos Date
   solo aparecen para preguntar qué día y qué hora es AHORA en la zona de la
   barbería. Mezclar husos horarios en el cálculo de huecos es la forma más
   rápida de ofrecer una hora que en realidad ya pasó.

   Sobre el dinero: el precio, la duración y el anticipo NO se mandan al
   servidor. `reservar()` manda el slug del servicio y la base decide cuánto
   cuesta leyendo su propia tabla `servicios`. Lo que se devuelve es lo que
   quedó guardado, no lo que el navegador creía.
   ========================================================================== */

import { obtenerSupabase, HAY_SUPABASE } from './supabase';
import { ZONA_HORARIA, equipo, reserva, pago, servicios as catalogo } from '../data/barberia';

export { HAY_SUPABASE };

/* Cada cuántos minutos se ofrece un hueco. 30 da una rejilla legible; 15
   llenaría la sección de fichas que nadie compara. */
export const PASO_MINUTOS = 30;

const CLAVE_DEMO = 'navaja-filo:citas-demo';
const BUCKET_COMPROBANTES = 'comprobantes';

/* Lo que se le escribe en las notas a un apartado que se soltó solo. Se repite
   igual en `liberar_vencidas()` de supabase/schema.sql. */
const NOTA_LIBERADA =
  'Apartado liberado automáticamente: no llegó el anticipo dentro del plazo.';

export type EstadoCita = 'pendiente' | 'confirmada' | 'completada' | 'cancelada';

/* Ciclo de vida del anticipo:

     no_requiere  el servicio se paga completo en el local
     esperando    se reservó y falta la transferencia (el reloj corre)
     en_revision  el cliente subió el comprobante, la barbería no lo ha visto
     verificado   la barbería lo dio por bueno; la cita pasa a confirmada
     rechazado    no cuadró; se le abre otro plazo para mandarlo bien */
export type EstadoPago =
  | 'no_requiere'
  | 'esperando'
  | 'en_revision'
  | 'verificado'
  | 'rechazado';

export type DiaHorario = {
  dia_semana: number;
  abre: string | null;
  cierra: string | null;
  cerrado: boolean;
};

export type BarberoAgenda = {
  slug: string;
  nombre: string;
  activo: boolean;
  orden: number;
};

export type Ocupado = {
  barbero_slug: string;
  fecha: string;
  hora: string;
  duracion_min: number;
};

export type Bloqueo = {
  barbero_slug: string | null;
  fecha: string;
  hora_inicio: string | null;
  hora_fin: string | null;
};

export type Agenda = {
  horarios: DiaHorario[];
  barberos: BarberoAgenda[];
  ocupados: Ocupado[];
  bloqueos: Bloqueo[];
};

export type Cita = {
  id: string;
  folio: string;
  creada_en: string;
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_correo: string | null;
  servicio_slug: string;
  servicio_nombre: string;
  precio: number;
  duracion_min: number;
  barbero_slug: string;
  barbero_nombre: string;
  fecha: string;
  hora: string;
  notas: string | null;
  estado: EstadoCita;
  anticipo: number;
  pago_estado: EstadoPago;
  pago_comprobante: string | null;
  pago_subido_en: string | null;
  pago_resuelto_en: string | null;
  pago_nota: string | null;
  /* ISO. Hasta cuándo se aparta el hueco sin anticipo. Nulo = no caduca. */
  vence_en: string | null;
};

/* Lo único que viaja al servidor. El precio y la duración no están aquí a
   propósito: los pone la base. */
export type SolicitudReserva = {
  nombre: string;
  telefono: string;
  correo?: string | null;
  servicioSlug: string;
  /* null = "el que esté libre". El servidor elige. */
  barberoSlug: string | null;
  fecha: string;
  hora: string;
  notas?: string | null;
};

export type ReservaHecha = {
  id: string;
  folio: string;
  barberoSlug: string;
  barberoNombre: string;
  /* Devueltos por la base, no por el formulario. */
  servicioNombre: string;
  precio: number;
  duracionMin: number;
  anticipo: number;
  pagoEstado: EstadoPago;
  venceEn: string | null;
};

/* --------------------------------------------------------------------------
   Utilidades de fecha y hora
   -------------------------------------------------------------------------- */

export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':');
  return Number(h) * 60 + Number(m);
}

export function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* '2026-03-08' -> { anio, mes (1-12), dia } sin pasar por Date, que
   interpretaría la cadena como UTC y podría restar un día. */
export function partesFecha(fecha: string) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return { anio, mes, dia };
}

export function aFecha(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/* Día de la semana (0 = domingo) por el algoritmo de Sakamoto, para no
   construir un Date y arriesgar un desfase de zona horaria. */
export function diaSemana(fecha: string): number {
  const { anio, mes, dia } = partesFecha(fecha);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const a = mes < 3 ? anio - 1 : anio;
  return (a + Math.floor(a / 4) - Math.floor(a / 100) + Math.floor(a / 400) + t[mes - 1] + dia) % 7;
}

export function diasEnMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/* Suma días a una fecha en texto, vía UTC para que no haya horario de verano
   de por medio. */
export function sumarDias(fecha: string, dias: number): string {
  const { anio, mes, dia } = partesFecha(fecha);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return aFecha(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/* Qué día y qué hora es ahora mismo en la barbería, sin importar dónde esté
   el visitante ni cómo tenga configurado el reloj. */
export function ahoraEnBarberia(): { fecha: string; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const leer = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
  // Algunos motores devuelven "24" para la medianoche en hourCycle h23.
  const hora = leer('hour') === '24' ? '00' : leer('hour');

  return {
    fecha: `${leer('year')}-${leer('month')}-${leer('day')}`,
    minutos: Number(hora) * 60 + Number(leer('minute')),
  };
}

/* Convierte una fecha y una hora de la barbería al instante exacto que les
   corresponde en UTC.

   Lo necesita el archivo de calendario: si el evento se escribiera con la hora
   "suelta" (sin zona), el calendario de quien reserva desde otro huso la
   pondría a las 11:00 de SU zona, no de la nuestra. Con el instante en UTC,
   cada quien la ve en su hora local y todos hablan del mismo momento. */
export function instanteUtc(fecha: string, hora: string, minutosExtra = 0): Date {
  const { anio, mes, dia } = partesFecha(fecha);
  const supuesto = Date.UTC(anio, mes - 1, dia, 0, aMinutos(hora) + minutosExtra);

  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const desfase = (marca: number) => {
    const partes = formato.formatToParts(new Date(marca));
    const leer = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
    const h = leer('hour') === 24 ? 0 : leer('hour');
    return Date.UTC(leer('year'), leer('month') - 1, leer('day'), h, leer('minute')) - marca;
  };

  // Dos pasadas: la primera basta salvo en los saltos de horario de verano,
  // donde el desfase del instante supuesto no coincide con el del real.
  let instante = supuesto - desfase(supuesto);
  instante = supuesto - desfase(instante);
  return new Date(instante);
}

const FORMATO_DIA_LARGO = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

export function fechaLegible(fecha: string): string {
  const { anio, mes, dia } = partesFecha(fecha);
  return FORMATO_DIA_LARGO.format(new Date(Date.UTC(anio, mes - 1, dia)));
}

export function horaLegible(hora: string): string {
  const minutos = aMinutos(hora);
  const h24 = Math.floor(minutos / 60);
  const m = minutos % 60;
  const sufijo = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`;
}

/* Cuánto falta para que se suelte un apartado, en palabras. Se usa en la
   pantalla del anticipo, donde "vence a las 20:14" dice menos que "te quedan
   2 horas": lo segundo se entiende sin hacer la resta. */
export function tiempoRestante(venceEn: string | null): string | null {
  if (!venceEn) return null;
  const faltan = Date.parse(venceEn) - Date.now();
  if (Number.isNaN(faltan) || faltan <= 0) return null;

  const minutos = Math.floor(faltan / 60000);
  if (minutos < 60) return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;

  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (resto === 0) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  return `${horas} h ${resto} min`;
}

/* --------------------------------------------------------------------------
   Catálogo de servicios
   --------------------------------------------------------------------------
   Para PINTAR se usa este archivo de datos; para VALIDAR manda la tabla
   `servicios` de Supabase. Ver el comentario en src/data/barberia.ts. */

export type ServicioLocal = {
  slug: string;
  nombre: string;
  precio: number;
  duracionMin: number;
  anticipo: number;
};

export function servicioPorSlug(slug: string): ServicioLocal | null {
  const s = catalogo.find((x) => x.slug === slug);
  return s
    ? {
        slug: s.slug,
        nombre: s.nombre,
        precio: s.precio,
        duracionMin: s.duracionMin,
        anticipo: s.anticipo,
      }
    : null;
}

/* --------------------------------------------------------------------------
   Horario por defecto del modo demo
   --------------------------------------------------------------------------
   Copia de lo que sembramos en la tabla `horarios`. Solo se usa cuando no hay
   Supabase configurado. */
const HORARIOS_DEMO: DiaHorario[] = [
  { dia_semana: 0, abre: '11:00', cierra: '16:00', cerrado: false },
  { dia_semana: 1, abre: null, cierra: null, cerrado: true },
  { dia_semana: 2, abre: '11:00', cierra: '20:30', cerrado: false },
  { dia_semana: 3, abre: '11:00', cierra: '20:30', cerrado: false },
  { dia_semana: 4, abre: '11:00', cierra: '20:30', cerrado: false },
  { dia_semana: 5, abre: '11:00', cierra: '20:30', cerrado: false },
  { dia_semana: 6, abre: '10:00', cierra: '19:00', cerrado: false },
];

const BARBEROS_DEMO: BarberoAgenda[] = equipo.barberos.map((b, i) => ({
  slug: b.slug,
  nombre: b.nombre,
  activo: true,
  orden: i + 1,
}));

/* --------------------------------------------------------------------------
   Cálculo de huecos
   -------------------------------------------------------------------------- */

function seTraslapan(aIni: number, aFin: number, bIni: number, bFin: number): boolean {
  return aIni < bFin && bIni < aFin;
}

function barberoBloqueado(
  bloqueos: Bloqueo[],
  slug: string,
  fecha: string,
  inicio: number,
  fin: number
): boolean {
  return bloqueos.some((bl) => {
    if (bl.fecha !== fecha) return false;
    if (bl.barbero_slug !== null && bl.barbero_slug !== slug) return false;
    if (!bl.hora_inicio || !bl.hora_fin) return true; // día completo
    return seTraslapan(inicio, fin, aMinutos(bl.hora_inicio), aMinutos(bl.hora_fin));
  });
}

function barberoOcupado(
  ocupados: Ocupado[],
  slug: string,
  fecha: string,
  inicio: number,
  fin: number
): boolean {
  return ocupados.some((o) => {
    if (o.fecha !== fecha || o.barbero_slug !== slug) return false;
    const oIni = aMinutos(o.hora);
    return seTraslapan(inicio, fin, oIni, oIni + o.duracion_min);
  });
}

/* Barberos que pueden tomar una franja concreta. Si se pidió uno en
   particular, la lista es él o nadie. */
export function barberosLibres(
  agenda: Agenda,
  fecha: string,
  inicio: number,
  duracionMin: number,
  barberoSlug: string | null
): BarberoAgenda[] {
  const fin = inicio + duracionMin;
  return agenda.barberos
    .filter((b) => b.activo)
    .filter((b) => (barberoSlug ? b.slug === barberoSlug : true))
    .filter((b) => !barberoOcupado(agenda.ocupados, b.slug, fecha, inicio, fin))
    .filter((b) => !barberoBloqueado(agenda.bloqueos, b.slug, fecha, inicio, fin))
    .sort((a, b) => a.orden - b.orden);
}

export type Hueco = {
  hora: string;
  minutos: number;
  /* Cuántos barberos pueden tomarlo. Cero = ocupado. */
  libres: number;
};

/* Todas las horas de un día para un servicio y un barbero dados, libres y
   ocupadas por igual.

   Se devuelven también las ocupadas a propósito: la página las pinta en gris
   y tachadas en vez de esconderlas. Una lista con tres horas sueltas no dice
   si la barbería abre poco o si está llena; una rejilla completa con la mitad
   tachada sí, y además evita que alguien crea que la página se equivocó.

   Una hora entra en la lista si cabe entera dentro del horario de atención y
   respeta el margen mínimo de antelación. Las que ya pasaron no entran: no
   están ocupadas, simplemente dejaron de existir. */
export function huecosDelDia(
  agenda: Agenda,
  fecha: string,
  duracionMin: number,
  barberoSlug: string | null
): Hueco[] {
  const horario = agenda.horarios.find((h) => h.dia_semana === diaSemana(fecha));
  if (!horario || horario.cerrado || !horario.abre || !horario.cierra) return [];

  const abre = aMinutos(horario.abre);
  const cierra = aMinutos(horario.cierra);
  const ahora = ahoraEnBarberia();
  const esHoy = fecha === ahora.fecha;
  const minimoHoy = ahora.minutos + reserva.margenMinutos;

  const huecos: Hueco[] = [];

  for (let inicio = abre; inicio + duracionMin <= cierra; inicio += PASO_MINUTOS) {
    if (esHoy && inicio < minimoHoy) continue;
    huecos.push({
      hora: aHora(inicio),
      minutos: inicio,
      libres: barberosLibres(agenda, fecha, inicio, duracionMin, barberoSlug).length,
    });
  }

  return huecos;
}

/* Si a un día le queda al menos una hora libre. Lo usa el calendario para
   apagar los días llenos en vez de dejar que se descubran tocándolos. */
export function diaTieneHuecos(
  agenda: Agenda,
  fecha: string,
  duracionMin: number,
  barberoSlug: string | null
): boolean {
  return huecosDelDia(agenda, fecha, duracionMin, barberoSlug).some((h) => h.libres > 0);
}

/* --------------------------------------------------------------------------
   Modo demo: las citas viven en este navegador
   -------------------------------------------------------------------------- */

function leerDemo(): Cita[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const crudo = localStorage.getItem(CLAVE_DEMO);
    return crudo ? (JSON.parse(crudo) as Cita[]) : [];
  } catch {
    return [];
  }
}

function escribirDemo(citas: Cita[]): boolean {
  try {
    localStorage.setItem(CLAVE_DEMO, JSON.stringify(citas));
    return true;
  } catch {
    /* Navegación privada con la cuota llena: la reserva se pierde al
       recargar, pero la demo sigue respondiendo. */
    return false;
  }
}

function folioDemo(id: string): string {
  return `NF-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/* Réplica de `liberar_vencidas()` para el modo demo. Si el demo no soltara los
   apartados vencidos, enseñaría un comportamiento que el sistema real no
   tiene: huecos bloqueados para siempre por alguien que nunca transfirió. */
function liberarVencidasDemo(): void {
  const ahora = Date.now();
  const citas = leerDemo();
  let cambio = false;

  const siguientes = citas.map((c) => {
    const vencida =
      c.estado === 'pendiente' &&
      (c.pago_estado === 'esperando' || c.pago_estado === 'rechazado') &&
      c.vence_en !== null &&
      Date.parse(c.vence_en) < ahora;

    if (!vencida) return c;
    cambio = true;
    return { ...c, estado: 'cancelada' as EstadoCita, pago_nota: c.pago_nota ?? NOTA_LIBERADA };
  });

  if (cambio) escribirDemo(siguientes);
}

/* --------------------------------------------------------------------------
   Interfaz pública
   -------------------------------------------------------------------------- */

export async function cargarAgenda(desde: string, hasta: string): Promise<Agenda> {
  const sb = obtenerSupabase();

  if (!sb) {
    liberarVencidasDemo();
    const citas = leerDemo().filter(
      (c) => c.estado !== 'cancelada' && c.fecha >= desde && c.fecha <= hasta
    );
    return {
      horarios: HORARIOS_DEMO,
      barberos: BARBEROS_DEMO,
      bloqueos: [],
      ocupados: citas.map((c) => ({
        barbero_slug: c.barbero_slug,
        fecha: c.fecha,
        hora: c.hora,
        duracion_min: c.duracion_min,
      })),
    };
  }

  const [horarios, barberos, bloqueos, ocupados] = await Promise.all([
    sb.from('horarios').select('dia_semana, abre, cierra, cerrado'),
    sb.from('barberos').select('slug, nombre, activo, orden').order('orden'),
    sb
      .from('bloqueos')
      .select('barbero_slug, fecha, hora_inicio, hora_fin')
      .gte('fecha', desde)
      .lte('fecha', hasta),
    sb.rpc('disponibilidad', { p_desde: desde, p_hasta: hasta }),
  ]);

  const fallo = horarios.error ?? barberos.error ?? bloqueos.error ?? ocupados.error;
  if (fallo) throw new Error(fallo.message);

  return {
    horarios: (horarios.data ?? []) as DiaHorario[],
    barberos: (barberos.data ?? []) as BarberoAgenda[],
    bloqueos: (bloqueos.data ?? []) as Bloqueo[],
    ocupados: (ocupados.data ?? []) as Ocupado[],
  };
}

/* Mensajes para los errores que levanta `reservar_cita`. La función del
   servidor es la que manda: si dice que el hueco ya no está, se lo decimos
   al cliente tal cual y refrescamos la agenda. */
const MENSAJES: Record<string, string> = {
  NOMBRE_INVALIDO: 'Revisa el nombre: hacen falta al menos tres letras.',
  TELEFONO_INVALIDO: 'Revisa el teléfono: tienen que ser diez dígitos.',
  CORREO_INVALIDO: 'Revisa el correo, algo no cuadra.',
  SERVICIO_INVALIDO: 'Ese servicio ya no está disponible. Vuelve a elegirlo.',
  FUERA_DE_PLAZO: 'Esa hora ya pasó o queda demasiado lejos. Elige otra.',
  DIA_CERRADO: 'Ese día la barbería no abre.',
  FUERA_DE_HORARIO: 'A esa hora ya estamos cerrando. Elige una más temprano.',
  HORA_OCUPADA: 'Alguien apartó ese hueco hace un momento. Elige otro, por favor.',
  DEMASIADAS_CITAS:
    'Ya tienes tres citas apartadas con este teléfono. Cancela alguna o llámanos y te ayudamos.',
};

/* Errores propios de la subida del comprobante. */
const MENSAJES_PAGO: Record<string, string> = {
  CITA_NO_ENCONTRADA:
    'No encontramos esa cita. Revisa que el folio y el teléfono sean los de tu reserva.',
  PAGO_NO_APLICA:
    'Esa cita ya no está esperando el anticipo. Si crees que es un error, llámanos.',
  RUTA_INVALIDA: 'No pudimos guardar el archivo. Vuelve a intentarlo.',
  ARCHIVO_GRANDE: `El archivo pesa más de ${pago.pesoMaximoMb} MB. Manda una captura más ligera.`,
  ARCHIVO_INVALIDO: 'Sube una imagen (JPG, PNG, WEBP o HEIC) o un PDF.',
  SUBIDA_FALLIDA: 'No pudimos subir el comprobante. Revisa tu conexión y vuelve a intentarlo.',
};

/* Tiene que coincidir con `c_tope_por_telefono` de supabase/schema.sql. */
export const TOPE_POR_TELEFONO = 3;

export class ErrorReserva extends Error {
  codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.codigo = codigo;
    this.name = 'ErrorReserva';
  }
}

function traducirError(bruto: string): ErrorReserva {
  const codigo = Object.keys(MENSAJES).find((c) => bruto.includes(c));
  if (codigo) return new ErrorReserva(codigo, MENSAJES[codigo]);
  return new ErrorReserva(
    'DESCONOCIDO',
    'No pudimos guardar la cita. Vuelve a intentarlo en un momento.'
  );
}

function traducirErrorPago(bruto: string): ErrorReserva {
  const codigo = Object.keys(MENSAJES_PAGO).find((c) => bruto.includes(c));
  if (codigo) return new ErrorReserva(codigo, MENSAJES_PAGO[codigo]);
  return new ErrorReserva('DESCONOCIDO', MENSAJES_PAGO.SUBIDA_FALLIDA);
}

export async function reservar(solicitud: SolicitudReserva): Promise<ReservaHecha> {
  const sb = obtenerSupabase();

  if (!sb) return reservarDemo(solicitud);

  const { data, error } = await sb.rpc('reservar_cita', {
    p_nombre: solicitud.nombre,
    p_telefono: solicitud.telefono,
    p_correo: solicitud.correo ?? null,
    p_servicio_slug: solicitud.servicioSlug,
    p_barbero_slug: solicitud.barberoSlug,
    p_fecha: solicitud.fecha,
    p_hora: solicitud.hora,
    p_notas: solicitud.notas ?? null,
  });

  if (error) throw traducirError(error.message);

  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw traducirError('DESCONOCIDO');

  return {
    id: fila.id,
    folio: fila.folio,
    barberoSlug: fila.barbero_slug,
    barberoNombre: fila.barbero_nombre,
    servicioNombre: fila.servicio_nombre,
    precio: fila.precio,
    duracionMin: fila.duracion_min,
    anticipo: fila.anticipo,
    pagoEstado: fila.pago_estado as EstadoPago,
    venceEn: fila.vence_en,
  };
}

/* El modo demo repite las mismas reglas que la función del servidor. Si no
   lo hiciera, la demo aceptaría citas que el sistema real rechaza y estaría
   enseñando algo que no es. Igual que el servidor, el precio y el anticipo
   salen del catálogo, no de lo que traiga la solicitud. */
async function reservarDemo(solicitud: SolicitudReserva): Promise<ReservaHecha> {
  liberarVencidasDemo();

  const servicio = servicioPorSlug(solicitud.servicioSlug);
  if (!servicio) throw new ErrorReserva('SERVICIO_INVALIDO', MENSAJES.SERVICIO_INVALIDO);

  const agenda = await cargarAgenda(solicitud.fecha, solicitud.fecha);
  const inicio = aMinutos(solicitud.hora);

  const horario = agenda.horarios.find((h) => h.dia_semana === diaSemana(solicitud.fecha));
  if (!horario || horario.cerrado || !horario.abre || !horario.cierra) {
    throw new ErrorReserva('DIA_CERRADO', MENSAJES.DIA_CERRADO);
  }
  if (inicio < aMinutos(horario.abre) || inicio + servicio.duracionMin > aMinutos(horario.cierra)) {
    throw new ErrorReserva('FUERA_DE_HORARIO', MENSAJES.FUERA_DE_HORARIO);
  }

  const ahora = ahoraEnBarberia();
  if (
    solicitud.fecha < ahora.fecha ||
    (solicitud.fecha === ahora.fecha && inicio < ahora.minutos + 30)
  ) {
    throw new ErrorReserva('FUERA_DE_PLAZO', MENSAJES.FUERA_DE_PLAZO);
  }

  // El mismo tope que aplica el servidor. Si el modo demo no lo repitiera,
  // estaría enseñando un comportamiento que el sistema real no tiene.
  const digitos = solicitud.telefono.replace(/\D/g, '');
  const activas = leerDemo().filter(
    (c) =>
      c.cliente_telefono.replace(/\D/g, '') === digitos &&
      (c.estado === 'pendiente' || c.estado === 'confirmada') &&
      (c.fecha > ahora.fecha || (c.fecha === ahora.fecha && aMinutos(c.hora) >= ahora.minutos))
  );
  if (activas.length >= TOPE_POR_TELEFONO) {
    throw new ErrorReserva('DEMASIADAS_CITAS', MENSAJES.DEMASIADAS_CITAS);
  }

  const libres = barberosLibres(
    agenda,
    solicitud.fecha,
    inicio,
    servicio.duracionMin,
    solicitud.barberoSlug
  );
  if (libres.length === 0) throw new ErrorReserva('HORA_OCUPADA', MENSAJES.HORA_OCUPADA);

  const elegido = libres[0];
  const id = crypto.randomUUID();

  // El plazo no puede pasarse de la hora de la cita, igual que en el servidor.
  const pagoEstado: EstadoPago = servicio.anticipo > 0 ? 'esperando' : 'no_requiere';
  let venceEn: string | null = null;
  if (servicio.anticipo > 0) {
    const limite = Date.now() + pago.plazoHoras * 3600_000;
    const arranque = instanteUtc(solicitud.fecha, solicitud.hora).getTime();
    venceEn = new Date(Math.min(limite, arranque)).toISOString();
  }

  const cita: Cita = {
    id,
    folio: folioDemo(id),
    creada_en: new Date().toISOString(),
    cliente_nombre: solicitud.nombre.trim(),
    cliente_telefono: solicitud.telefono.trim(),
    cliente_correo: solicitud.correo?.trim() || null,
    servicio_slug: servicio.slug,
    servicio_nombre: servicio.nombre,
    precio: servicio.precio,
    duracion_min: servicio.duracionMin,
    barbero_slug: elegido.slug,
    barbero_nombre: elegido.nombre,
    fecha: solicitud.fecha,
    hora: solicitud.hora,
    notas: solicitud.notas?.trim() || null,
    estado: 'pendiente',
    anticipo: servicio.anticipo,
    pago_estado: pagoEstado,
    pago_comprobante: null,
    pago_subido_en: null,
    pago_resuelto_en: null,
    pago_nota: null,
    vence_en: venceEn,
  };

  escribirDemo([...leerDemo(), cita]);

  return {
    id: cita.id,
    folio: cita.folio,
    barberoSlug: elegido.slug,
    barberoNombre: elegido.nombre,
    servicioNombre: servicio.nombre,
    precio: servicio.precio,
    duracionMin: servicio.duracionMin,
    anticipo: servicio.anticipo,
    pagoEstado,
    venceEn,
  };
}

/* --------------------------------------------------------------------------
   Comprobante del anticipo
   -------------------------------------------------------------------------- */

/* Tamaño por debajo del cual el modo demo guarda la imagen entera en
   localStorage para poder enseñarla en el panel. Por encima solo se guarda el
   nombre: meter una foto de 4 MB en base64 revienta la cuota del navegador y
   se perdería la cita completa, no solo el comprobante. */
const TOPE_DEMO_BYTES = 400 * 1024;

function extensionDe(archivo: File): string {
  const delNombre = archivo.name.includes('.') ? archivo.name.split('.').pop() : null;
  if (delNombre && /^[a-zA-Z0-9]{1,5}$/.test(delNombre)) return delNombre.toLowerCase();
  const delTipo = archivo.type.split('/')[1];
  return delTipo && /^[a-zA-Z0-9]{1,5}$/.test(delTipo) ? delTipo.toLowerCase() : 'bin';
}

function validarArchivo(archivo: File): void {
  if (archivo.size > pago.pesoMaximoMb * 1024 * 1024) {
    throw new ErrorReserva('ARCHIVO_GRANDE', MENSAJES_PAGO.ARCHIVO_GRANDE);
  }
  // El tipo puede venir vacío en algunos navegadores móviles; en ese caso se
  // deja pasar y que el bucket decida, en vez de rechazar una captura buena.
  if (archivo.type && !(pago.formatos as readonly string[]).includes(archivo.type)) {
    throw new ErrorReserva('ARCHIVO_INVALIDO', MENSAJES_PAGO.ARCHIVO_INVALIDO);
  }
}

function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(new Error('lectura'));
    lector.readAsDataURL(archivo);
  });
}

/* Sube la captura de la transferencia y la engancha a la cita.

   Van dos pasos porque son dos sistemas: el archivo entra al bucket de Storage
   y después `registrar_comprobante` lo apunta en la cita. El orden importa —
   si se registrara primero, una subida fallida dejaría la cita apuntando a un
   archivo que no existe. */
export async function subirComprobante(datos: {
  folio: string;
  telefono: string;
  archivo: File;
}): Promise<EstadoPago> {
  validarArchivo(datos.archivo);

  const sb = obtenerSupabase();

  if (!sb) {
    liberarVencidasDemo();
    const citas = leerDemo();
    const cita = citas.find(
      (c) =>
        c.folio === datos.folio.trim().toUpperCase() &&
        c.cliente_telefono.replace(/\D/g, '') === datos.telefono.replace(/\D/g, '')
    );

    if (!cita) throw new ErrorReserva('CITA_NO_ENCONTRADA', MENSAJES_PAGO.CITA_NO_ENCONTRADA);
    if (cita.estado !== 'pendiente' || !['esperando', 'rechazado'].includes(cita.pago_estado)) {
      throw new ErrorReserva('PAGO_NO_APLICA', MENSAJES_PAGO.PAGO_NO_APLICA);
    }

    let guardado = `demo:${datos.archivo.name}`;
    if (datos.archivo.size <= TOPE_DEMO_BYTES) {
      try {
        guardado = await leerComoDataUrl(datos.archivo);
      } catch {
        /* Si no se puede leer, queda el nombre: la demo sigue de pie. */
      }
    }

    const siguientes = citas.map((c) =>
      c.id === cita.id
        ? {
            ...c,
            pago_comprobante: guardado,
            pago_subido_en: new Date().toISOString(),
            pago_estado: 'en_revision' as EstadoPago,
            pago_nota: null,
            vence_en: null,
          }
        : c
    );

    // Si la cuota no admite la imagen, se reintenta con solo el nombre antes
    // de darse por vencido: perder la demo entera por una captura grande sería
    // peor que enseñarla sin miniatura.
    if (!escribirDemo(siguientes)) {
      const sinImagen = siguientes.map((c) =>
        c.id === cita.id ? { ...c, pago_comprobante: `demo:${datos.archivo.name}` } : c
      );
      if (!escribirDemo(sinImagen)) {
        throw new ErrorReserva('SUBIDA_FALLIDA', MENSAJES_PAGO.SUBIDA_FALLIDA);
      }
    }

    return 'en_revision';
  }

  // Ruta con UUID propio: nadie puede sobrescribir el comprobante de otro,
  // ni siquiera adivinando el folio.
  const ruta = `${datos.folio.trim().toUpperCase()}/${crypto.randomUUID()}.${extensionDe(datos.archivo)}`;

  const subida = await sb.storage.from(BUCKET_COMPROBANTES).upload(ruta, datos.archivo, {
    contentType: datos.archivo.type || undefined,
    upsert: false,
  });

  if (subida.error) throw new ErrorReserva('SUBIDA_FALLIDA', MENSAJES_PAGO.SUBIDA_FALLIDA);

  const { data, error } = await sb.rpc('registrar_comprobante', {
    p_folio: datos.folio,
    p_telefono: datos.telefono,
    p_ruta: ruta,
  });

  if (error) {
    // La cita rechazó el comprobante: el archivo ya no le sirve a nadie y
    // dejarlo suelto en el bucket solo acumula basura.
    await sb.storage.from(BUCKET_COMPROBANTES).remove([ruta]);
    throw traducirErrorPago(error.message);
  }

  return (data as EstadoPago) ?? 'en_revision';
}

/* URL para que el panel vea un comprobante.

   Devuelve null cuando no hay nada que abrir: en modo demo con archivos
   grandes solo se guardó el nombre. El bucket es privado, así que en el modo
   real hace falta una URL firmada; cinco minutos alcanzan para mirarla y
   decidir, y no deja un enlace vivo circulando. */
export async function urlComprobante(ruta: string | null): Promise<string | null> {
  if (!ruta) return null;
  if (ruta.startsWith('data:')) return ruta;
  if (ruta.startsWith('demo:')) return null;

  const sb = obtenerSupabase();
  if (!sb) return null;

  const { data, error } = await sb.storage
    .from(BUCKET_COMPROBANTES)
    .createSignedUrl(ruta, 300);

  if (error) return null;
  return data?.signedUrl ?? null;
}

/* Nombre legible de un comprobante, para cuando no hay imagen que enseñar. */
export function nombreComprobante(ruta: string | null): string | null {
  if (!ruta) return null;
  if (ruta.startsWith('demo:')) return ruta.slice(5);
  if (ruta.startsWith('data:')) return 'Comprobante subido';
  return ruta.split('/').pop() ?? ruta;
}

/* La barbería da por bueno o rechaza el anticipo. Aprobar mueve la cita a
   confirmada; rechazar le abre otro plazo al cliente. Las dos cosas pasan
   dentro de `resolver_pago` para que el estado del pago y el de la cita no
   puedan quedar en desacuerdo. */
export async function verificarPago(
  id: string,
  aprobado: boolean,
  nota?: string | null
): Promise<void> {
  const sb = obtenerSupabase();

  if (!sb) {
    const citas = leerDemo();
    const siguientes = citas.map((c) => {
      if (c.id !== id) return c;
      if (aprobado) {
        return {
          ...c,
          pago_estado: 'verificado' as EstadoPago,
          pago_resuelto_en: new Date().toISOString(),
          pago_nota: nota?.trim() || null,
          vence_en: null,
          estado: 'confirmada' as EstadoCita,
        };
      }
      const limite = Date.now() + pago.plazoHoras * 3600_000;
      const arranque = instanteUtc(c.fecha, c.hora).getTime();
      return {
        ...c,
        pago_estado: 'rechazado' as EstadoPago,
        pago_resuelto_en: new Date().toISOString(),
        pago_nota: nota?.trim() || 'No pudimos identificar la transferencia.',
        estado: 'pendiente' as EstadoCita,
        vence_en: new Date(Math.min(limite, arranque)).toISOString(),
      };
    });
    escribirDemo(siguientes);
    return;
  }

  const { error } = await sb.rpc('resolver_pago', {
    p_id: id,
    p_aprobado: aprobado,
    p_nota: nota ?? null,
  });

  if (error) throw new Error(error.message);
}

/* --------------------------------------------------------------------------
   Panel de la barbería
   -------------------------------------------------------------------------- */

export async function listarCitas(desde: string, hasta: string): Promise<Cita[]> {
  const sb = obtenerSupabase();

  if (!sb) {
    liberarVencidasDemo();
    return leerDemo()
      .filter((c) => c.fecha >= desde && c.fecha <= hasta)
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  }

  // Antes de leer se sueltan los apartados vencidos, para que el panel no
  // muestre como vivo un hueco que el calendario público ya está ofreciendo.
  // Si falla no se interrumpe la carga: la agenda importa más que la limpieza.
  await sb.rpc('liberar_vencidas').then(
    () => undefined,
    () => undefined
  );

  const { data, error } = await sb
    .from('citas')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Cita[];
}

export async function cambiarEstado(id: string, estado: EstadoCita): Promise<void> {
  const sb = obtenerSupabase();

  if (!sb) {
    escribirDemo(leerDemo().map((c) => (c.id === id ? { ...c, estado } : c)));
    return;
  }

  const { error } = await sb.from('citas').update({ estado }).eq('id', id);
  if (error) throw new Error(error.message);
}

/* Contraseña del panel en modo demo. Solo sirve cuando NO hay Supabase
   configurado: en cuanto existen credenciales, la única forma de entrar es
   con un usuario real de Supabase Auth. Está a la vista a propósito, porque
   en modo demo no hay nada que proteger: las citas viven en este navegador. */
export const CLAVE_DEMO_PANEL = 'navaja2012';
const SESION_DEMO = 'navaja-filo:panel-demo';

export type Sesion = { correo: string } | null;

export async function sesionActual(): Promise<Sesion> {
  const sb = obtenerSupabase();

  if (!sb) {
    const activa = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESION_DEMO);
    return activa ? { correo: 'demo@navajayfilo.mx' } : null;
  }

  const { data } = await sb.auth.getSession();
  const correo = data.session?.user?.email;
  return correo ? { correo } : null;
}

export async function entrar(correo: string, clave: string): Promise<void> {
  const sb = obtenerSupabase();

  if (!sb) {
    if (clave !== CLAVE_DEMO_PANEL) {
      throw new Error('Contraseña incorrecta. En modo demo es: ' + CLAVE_DEMO_PANEL);
    }
    sessionStorage.setItem(SESION_DEMO, '1');
    return;
  }

  const { error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
  if (error) throw new Error('No pudimos entrar. Revisa el correo y la contraseña.');
}

export async function salir(): Promise<void> {
  const sb = obtenerSupabase();
  if (!sb) {
    sessionStorage.removeItem(SESION_DEMO);
    return;
  }
  await sb.auth.signOut();
}
