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
   ========================================================================== */

import { obtenerSupabase, HAY_SUPABASE } from './supabase';
import { ZONA_HORARIA, equipo, reserva } from '../data/barberia';

export { HAY_SUPABASE };

/* Cada cuántos minutos se ofrece un hueco. 30 da una rejilla legible; 15
   llenaría la sección de fichas que nadie compara. */
export const PASO_MINUTOS = 30;

const CLAVE_DEMO = 'navaja-filo:citas-demo';

export type EstadoCita = 'pendiente' | 'confirmada' | 'completada' | 'cancelada';

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
};

export type SolicitudReserva = {
  nombre: string;
  telefono: string;
  correo?: string | null;
  servicioSlug: string;
  servicioNombre: string;
  precio: number;
  duracionMin: number;
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

function escribirDemo(citas: Cita[]) {
  try {
    localStorage.setItem(CLAVE_DEMO, JSON.stringify(citas));
  } catch {
    /* Navegación privada con la cuota llena: la reserva se pierde al
       recargar, pero la demo sigue respondiendo. */
  }
}

function folioDemo(id: string): string {
  return `NF-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/* --------------------------------------------------------------------------
   Interfaz pública
   -------------------------------------------------------------------------- */

export async function cargarAgenda(desde: string, hasta: string): Promise<Agenda> {
  const sb = obtenerSupabase();

  if (!sb) {
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
  DURACION_INVALIDA: 'Ese servicio no es válido. Vuelve a elegirlo.',
  FUERA_DE_PLAZO: 'Esa hora ya pasó o queda demasiado lejos. Elige otra.',
  DIA_CERRADO: 'Ese día la barbería no abre.',
  FUERA_DE_HORARIO: 'A esa hora ya estamos cerrando. Elige una más temprano.',
  HORA_OCUPADA: 'Alguien apartó ese hueco hace un momento. Elige otro, por favor.',
  DEMASIADAS_CITAS:
    'Ya tienes tres citas apartadas con este teléfono. Cancela alguna o llámanos y te ayudamos.',
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

export async function reservar(solicitud: SolicitudReserva): Promise<ReservaHecha> {
  const sb = obtenerSupabase();

  if (!sb) return reservarDemo(solicitud);

  const { data, error } = await sb.rpc('reservar_cita', {
    p_nombre: solicitud.nombre,
    p_telefono: solicitud.telefono,
    p_correo: solicitud.correo ?? null,
    p_servicio_slug: solicitud.servicioSlug,
    p_servicio_nombre: solicitud.servicioNombre,
    p_precio: solicitud.precio,
    p_duracion_min: solicitud.duracionMin,
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
  };
}

/* El modo demo repite las mismas reglas que la función del servidor. Si no
   lo hiciera, la demo aceptaría citas que el sistema real rechaza y estaría
   enseñando algo que no es. */
async function reservarDemo(solicitud: SolicitudReserva): Promise<ReservaHecha> {
  const agenda = await cargarAgenda(solicitud.fecha, solicitud.fecha);
  const inicio = aMinutos(solicitud.hora);

  const horario = agenda.horarios.find((h) => h.dia_semana === diaSemana(solicitud.fecha));
  if (!horario || horario.cerrado || !horario.abre || !horario.cierra) {
    throw new ErrorReserva('DIA_CERRADO', MENSAJES.DIA_CERRADO);
  }
  if (inicio < aMinutos(horario.abre) || inicio + solicitud.duracionMin > aMinutos(horario.cierra)) {
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
    solicitud.duracionMin,
    solicitud.barberoSlug
  );
  if (libres.length === 0) throw new ErrorReserva('HORA_OCUPADA', MENSAJES.HORA_OCUPADA);

  const elegido = libres[0];
  const id = crypto.randomUUID();

  const cita: Cita = {
    id,
    folio: folioDemo(id),
    creada_en: new Date().toISOString(),
    cliente_nombre: solicitud.nombre.trim(),
    cliente_telefono: solicitud.telefono.trim(),
    cliente_correo: solicitud.correo?.trim() || null,
    servicio_slug: solicitud.servicioSlug,
    servicio_nombre: solicitud.servicioNombre,
    precio: solicitud.precio,
    duracion_min: solicitud.duracionMin,
    barbero_slug: elegido.slug,
    barbero_nombre: elegido.nombre,
    fecha: solicitud.fecha,
    hora: solicitud.hora,
    notas: solicitud.notas?.trim() || null,
    estado: 'pendiente',
  };

  escribirDemo([...leerDemo(), cita]);

  return {
    id: cita.id,
    folio: cita.folio,
    barberoSlug: elegido.slug,
    barberoNombre: elegido.nombre,
  };
}

/* --------------------------------------------------------------------------
   Panel de la barbería
   -------------------------------------------------------------------------- */

export async function listarCitas(desde: string, hasta: string): Promise<Cita[]> {
  const sb = obtenerSupabase();

  if (!sb) {
    return leerDemo()
      .filter((c) => c.fecha >= desde && c.fecha <= hasta)
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  }

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
