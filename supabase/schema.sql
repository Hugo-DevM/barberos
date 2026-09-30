-- ===========================================================================
-- Navaja & Filo — esquema de reservas
-- ---------------------------------------------------------------------------
-- Cómo se usa: entra a tu proyecto de Supabase, abre el SQL Editor, pega este
-- archivo entero y ejecútalo. Es idempotente: puedes volver a correrlo.
--
-- Idea de fondo: el cliente nunca escribe en `citas` directamente. Inserta a
-- través de la función `reservar_cita`, que revalida todo en el servidor. Y
-- aunque alguien se saltara la función, una restricción de exclusión impide
-- físicamente que dos citas del mismo barbero se traslapen.
--
-- Datos personales: `citas` guarda nombre, teléfono y correo. El rol anónimo
-- NO puede leer esa tabla. Para pintar el calendario se usa `disponibilidad`,
-- que devuelve solo huecos ocupados, sin un solo dato del cliente.
-- ===========================================================================

-- Necesaria para combinar igualdad de texto y solapamiento de rangos dentro
-- de un mismo índice GiST.
create extension if not exists btree_gist;

-- Zona horaria del negocio. Supabase corre en UTC; si no se fija, "hoy"
-- cambia de día a las 18:00 hora de Ciudad de México.
-- Si la barbería está en otro huso, cámbialo aquí y en src/data/barberia.ts.
create or replace function public.zona_barberia() returns text
language sql immutable as $$ select 'America/Mexico_City' $$;

create or replace function public.ahora_local() returns timestamp
language sql stable as $$ select (now() at time zone public.zona_barberia()) $$;


-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

-- Horario de atención. Un renglón por día de la semana (0 = domingo).
-- Esta tabla es la que MANDA para validar una reserva. Los horarios que se
-- muestran en la página viven en src/data/barberia.ts; si cambias uno,
-- cambia el otro.
create table if not exists public.horarios (
  dia_semana smallint primary key check (dia_semana between 0 and 6),
  abre time,
  cierra time,
  cerrado boolean not null default false,
  constraint horarios_coherentes check (
    cerrado or (abre is not null and cierra is not null and cierra > abre)
  )
);

-- Catálogo de barberos. Solo lo que el motor de reservas necesita para
-- repartir las citas; las fotos y las biografías están en el archivo de datos.
create table if not exists public.barberos (
  slug text primary key,
  nombre text not null,
  activo boolean not null default true,
  orden smallint not null default 0
);

-- Cierres puntuales: vacaciones, un día de capacitación, una tarde suelta.
-- barbero_slug nulo = cierra la barbería entera.
-- hora_inicio nula  = el día completo.
create table if not exists public.bloqueos (
  id uuid primary key default gen_random_uuid(),
  barbero_slug text references public.barberos (slug) on delete cascade,
  fecha date not null,
  hora_inicio time,
  hora_fin time,
  motivo text,
  constraint bloqueos_coherentes check (
    (hora_inicio is null and hora_fin is null)
    or (hora_inicio is not null and hora_fin is not null and hora_fin > hora_inicio)
  )
);

create index if not exists bloqueos_por_fecha on public.bloqueos (fecha);

-- Citas. El nombre del servicio y el precio se guardan copiados, no por
-- referencia: si mañana sube el precio, la cita de ayer conserva lo que se
-- le cotizó al cliente.
create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  creada_en timestamptz not null default now(),

  cliente_nombre text not null,
  cliente_telefono text not null,
  cliente_correo text,

  servicio_slug text not null,
  servicio_nombre text not null,
  precio integer not null default 0,
  duracion_min integer not null check (duracion_min between 5 and 480),

  barbero_slug text not null references public.barberos (slug),
  barbero_nombre text not null,

  fecha date not null,
  hora time not null,
  notas text,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'completada', 'cancelada')),

  -- Referencia corta y legible para decírsela al cliente por teléfono.
  folio text generated always as
    ('NF-' || upper(substr(replace(id::text, '-', ''), 1, 6))) stored,

  -- El intervalo que ocupa la cita, calculado por la base. Es lo que usa la
  -- restricción de exclusión.
  franja tsrange generated always as (
    tsrange(
      (fecha + hora),
      (fecha + hora) + make_interval(mins => duracion_min),
      '[)'
    )
  ) stored
);

-- Teléfono reducido a dígitos, para poder contar las citas de una misma
-- persona escriba "55 1234 5678" o "5512345678". Se añade por separado para
-- que volver a correr este archivo lo agregue a una tabla que ya existía.
alter table public.citas
  add column if not exists telefono_digitos text
  generated always as (regexp_replace(cliente_telefono, '\D', '', 'g')) stored;

create index if not exists citas_por_fecha on public.citas (fecha);
create index if not exists citas_por_estado on public.citas (estado, fecha);
create index if not exists citas_por_telefono on public.citas (telefono_digitos);

-- El seguro de verdad contra la doble reserva. Dos citas del mismo barbero
-- no pueden compartir ni un minuto, salvo que una esté cancelada.
-- Se ejecuta dentro de la transacción, así que gana aunque dos personas
-- confirmen el mismo hueco en el mismo instante.
do $$
begin
  alter table public.citas
    add constraint citas_sin_traslape
    exclude using gist (
      barbero_slug with =,
      franja with &&
    ) where (estado <> 'cancelada');
exception
  when duplicate_table then null;
  when duplicate_object then null;
end
$$;


-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------------

alter table public.horarios enable row level security;
alter table public.barberos enable row level security;
alter table public.bloqueos enable row level security;
alter table public.citas    enable row level security;

-- Catálogos: cualquiera puede leerlos, nadie anónimo puede tocarlos.
drop policy if exists horarios_lectura on public.horarios;
create policy horarios_lectura on public.horarios
  for select to anon, authenticated using (true);

drop policy if exists barberos_lectura on public.barberos;
create policy barberos_lectura on public.barberos
  for select to anon, authenticated using (activo);

drop policy if exists bloqueos_lectura on public.bloqueos;
create policy bloqueos_lectura on public.bloqueos
  for select to anon, authenticated using (true);

-- Citas: el público no las ve ni las escribe. Sin política de INSERT para
-- `anon`, la única vía de entrada es la función `reservar_cita`.
drop policy if exists citas_panel_lectura on public.citas;
create policy citas_panel_lectura on public.citas
  for select to authenticated using (true);

drop policy if exists citas_panel_escritura on public.citas;
create policy citas_panel_escritura on public.citas
  for update to authenticated using (true) with check (true);

drop policy if exists citas_panel_borrado on public.citas;
create policy citas_panel_borrado on public.citas
  for delete to authenticated using (true);

-- El personal autenticado también administra catálogos y bloqueos.
drop policy if exists bloqueos_panel on public.bloqueos;
create policy bloqueos_panel on public.bloqueos
  for all to authenticated using (true) with check (true);

drop policy if exists horarios_panel on public.horarios;
create policy horarios_panel on public.horarios
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- Disponibilidad pública
-- ---------------------------------------------------------------------------

-- Devuelve los huecos ya tomados en un rango de fechas. Ni nombres, ni
-- teléfonos, ni correos: solo qué barbero está ocupado, cuándo y cuánto.
-- Con eso el navegador puede pintar el calendario entero de una sola vez.
create or replace function public.disponibilidad(p_desde date, p_hasta date)
returns table (barbero_slug text, fecha date, hora time, duracion_min integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.barbero_slug, c.fecha, c.hora, c.duracion_min
  from public.citas c
  where c.estado <> 'cancelada'
    and c.fecha between p_desde and p_hasta
    and p_hasta >= p_desde
    and p_hasta - p_desde <= 120;
$$;

revoke all on function public.disponibilidad(date, date) from public;
grant execute on function public.disponibilidad(date, date) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Alta de cita
-- ---------------------------------------------------------------------------

-- Única puerta de entrada para el público. Revalida todo en el servidor: no
-- se fía de lo que el navegador diga que estaba libre.
--
-- Si p_barbero_slug viene nulo ("el que esté libre"), la función elige al
-- primero disponible por orden. Eso importa: dejar la cita con un barbero
-- genérico rompería el control de traslapes, porque cuatro barberos pueden
-- atender a cuatro personas a la misma hora.
--
-- Errores que puede levantar, para que el front los traduzca:
--   NOMBRE_INVALIDO, TELEFONO_INVALIDO, CORREO_INVALIDO, DURACION_INVALIDA,
--   FUERA_DE_PLAZO, DIA_CERRADO, FUERA_DE_HORARIO, HORA_OCUPADA,
--   DEMASIADAS_CITAS
create or replace function public.reservar_cita(
  p_nombre           text,
  p_telefono         text,
  p_correo           text,
  p_servicio_slug    text,
  p_servicio_nombre  text,
  p_precio           integer,
  p_duracion_min     integer,
  p_barbero_slug     text,
  p_fecha            date,
  p_hora             time,
  p_notas            text
)
returns table (id uuid, folio text, barbero_slug text, barbero_nombre text)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Cuántas citas futuras sin atender puede tener un mismo teléfono a la vez.
  -- Tres deja pasar a quien aparta para su familia y corta al que quiere
  -- vaciar la agenda del mes con datos inventados.
  c_tope_por_telefono constant integer := 3;

  v_inicio   timestamp;
  v_fin      timestamp;
  v_digitos  text;
  v_horario  public.horarios%rowtype;
  v_barbero  public.barberos%rowtype;
  v_id       uuid;
  v_folio    text;
begin
  p_nombre   := btrim(coalesce(p_nombre, ''));
  p_telefono := btrim(coalesce(p_telefono, ''));
  p_correo   := nullif(btrim(coalesce(p_correo, '')), '');
  p_notas    := nullif(btrim(coalesce(p_notas, '')), '');

  if char_length(p_nombre) < 3 or char_length(p_nombre) > 80 then
    raise exception 'NOMBRE_INVALIDO';
  end if;

  v_digitos := regexp_replace(p_telefono, '\D', '', 'g');

  if char_length(v_digitos) not between 10 and 13 then
    raise exception 'TELEFONO_INVALIDO';
  end if;

  -- Tope por teléfono. Como una cita sin confirmar ya aparta el hueco, sin
  -- esto cualquiera podría bloquear la agenda entera en dos minutos. Solo
  -- cuentan las citas futuras que siguen vivas: las pasadas y las canceladas
  -- no le quitan sitio a nadie.
  if (
    select count(*)
    from public.citas c
    where c.telefono_digitos = v_digitos
      and c.estado in ('pendiente', 'confirmada')
      and (c.fecha + c.hora) >= public.ahora_local()
  ) >= c_tope_por_telefono then
    raise exception 'DEMASIADAS_CITAS';
  end if;

  if p_correo is not null and p_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'CORREO_INVALIDO';
  end if;

  if p_duracion_min is null or p_duracion_min not between 5 and 480 then
    raise exception 'DURACION_INVALIDA';
  end if;

  v_inicio := p_fecha + p_hora;
  v_fin    := v_inicio + make_interval(mins => p_duracion_min);

  -- Ni en el pasado, ni tan encima que no dé tiempo de prepararse, ni tan
  -- lejos que la agenda deje de tener sentido.
  if v_inicio < public.ahora_local() + interval '30 minutes' then
    raise exception 'FUERA_DE_PLAZO';
  end if;

  if p_fecha > (public.ahora_local()::date + 90) then
    raise exception 'FUERA_DE_PLAZO';
  end if;

  select * into v_horario
  from public.horarios
  where dia_semana = extract(dow from p_fecha)::smallint;

  if not found or v_horario.cerrado then
    raise exception 'DIA_CERRADO';
  end if;

  if p_hora < v_horario.abre or v_fin > (p_fecha + v_horario.cierra) then
    raise exception 'FUERA_DE_HORARIO';
  end if;

  -- Primer barbero activo que esté libre a esa hora y sin bloqueo encima.
  select b.* into v_barbero
  from public.barberos b
  where b.activo
    and (p_barbero_slug is null or b.slug = p_barbero_slug)
    and not exists (
      select 1
      from public.citas c
      where c.barbero_slug = b.slug
        and c.estado <> 'cancelada'
        and c.franja && tsrange(v_inicio, v_fin, '[)')
    )
    and not exists (
      select 1
      from public.bloqueos bl
      where bl.fecha = p_fecha
        and (bl.barbero_slug is null or bl.barbero_slug = b.slug)
        and (
          bl.hora_inicio is null
          or tsrange(p_fecha + bl.hora_inicio, p_fecha + bl.hora_fin, '[)')
             && tsrange(v_inicio, v_fin, '[)')
        )
    )
  order by b.orden, b.slug
  limit 1;

  if not found then
    raise exception 'HORA_OCUPADA';
  end if;

  begin
    insert into public.citas (
      cliente_nombre, cliente_telefono, cliente_correo,
      servicio_slug, servicio_nombre, precio, duracion_min,
      barbero_slug, barbero_nombre,
      fecha, hora, notas
    )
    values (
      p_nombre, p_telefono, p_correo,
      p_servicio_slug, p_servicio_nombre, coalesce(p_precio, 0), p_duracion_min,
      v_barbero.slug, v_barbero.nombre,
      p_fecha, p_hora, p_notas
    )
    returning citas.id, citas.folio into v_id, v_folio;
  exception
    -- Dos personas confirmando el mismo hueco en el mismo instante: la
    -- consulta de arriba vio libre, la restricción de exclusión no.
    when exclusion_violation then
      raise exception 'HORA_OCUPADA';
  end;

  return query select v_id, v_folio, v_barbero.slug, v_barbero.nombre;
end;
$$;

revoke all on function public.reservar_cita(
  text, text, text, text, text, integer, integer, text, date, time, text
) from public;
grant execute on function public.reservar_cita(
  text, text, text, text, text, integer, integer, text, date, time, text
) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------------------

-- Horario. Lunes (1) cerrado. Debe coincidir con `contacto.horarios`
-- de src/data/barberia.ts.
insert into public.horarios (dia_semana, abre, cierra, cerrado) values
  (0, '11:00', '16:00', false),  -- domingo
  (1, null,    null,    true),   -- lunes, cerrado
  (2, '11:00', '20:30', false),
  (3, '11:00', '20:30', false),
  (4, '11:00', '20:30', false),
  (5, '11:00', '20:30', false),
  (6, '10:00', '19:00', false)   -- sábado
on conflict (dia_semana) do update
  set abre = excluded.abre,
      cierra = excluded.cierra,
      cerrado = excluded.cerrado;

-- Barberos. Los slugs deben coincidir con `equipo.barberos` del archivo de
-- datos, o la página ofrecerá un barbero que la base no conoce.
insert into public.barberos (slug, nombre, activo, orden) values
  ('ruben-salcedo',    'Rubén Salcedo',    true, 1),
  ('iker-mondragon',   'Iker Mondragón',   true, 2),
  ('tadeo-briseno',    'Tadeo Briseño',    true, 3),
  ('nicolas-arriaga',  'Nicolás Arriaga',  true, 4)
on conflict (slug) do update
  set nombre = excluded.nombre,
      activo = excluded.activo,
      orden = excluded.orden;


-- La API de Supabase guarda en caché la forma del esquema. Sin esto, las dos
-- funciones nuevas pueden tardar en aparecer y el sitio respondería
-- "no pudimos guardar la cita" sin motivo aparente.
notify pgrst, 'reload schema';
