-- ===========================================================================
-- Navaja & Filo — esquema de reservas y anticipos
-- ---------------------------------------------------------------------------
-- Cómo se usa: entra a tu proyecto de Supabase, abre el SQL Editor, pega este
-- archivo entero y ejecútalo. Es idempotente: puedes volver a correrlo.
--
-- Idea de fondo: el cliente nunca escribe en `citas` directamente. Inserta a
-- través de la función `reservar_cita`, que revalida todo en el servidor. Y
-- aunque alguien se saltara la función, una restricción de exclusión impide
-- físicamente que dos citas del mismo barbero se traslapen.
--
-- El dinero tampoco se le cree al navegador. El precio, la duración y el
-- anticipo de cada servicio viven en la tabla `servicios` y la función los lee
-- de ahí: lo único que manda el cliente es QUÉ servicio eligió. Si el precio
-- viajara en la petición, cualquiera podría abrir la consola y reservar el
-- ritual completo con un anticipo de un peso.
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

-- Cuánto tiempo se le aparta el hueco a quien todavía no manda el anticipo.
-- Tres horas alcanzan para hacer una transferencia sin prisas y son poco
-- suficiente para que un apartado falso no bloquee la agenda toda la tarde.
-- Debe coincidir con `pago.plazoHoras` de src/data/barberia.ts.
create or replace function public.plazo_anticipo() returns interval
language sql immutable as $$ select interval '3 hours' $$;


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

-- Catálogo de servicios. Esta tabla es la AUTORIDAD sobre precio, duración y
-- anticipo: `reservar_cita` los lee de aquí y descarta lo que venga del
-- navegador. Los textos, fotos y descripciones viven en src/data/barberia.ts;
-- si cambias un precio o una duración, cámbialo en los dos lados.
--
-- `anticipo` en 0 significa que el servicio no pide nada por adelantado.
-- No hay una columna "requiere_anticipo" aparte a propósito: dos columnas que
-- pueden contradecirse son una fuente de error, y `anticipo > 0` ya lo dice.
create table if not exists public.servicios (
  slug text primary key,
  nombre text not null,
  precio integer not null check (precio >= 0),
  duracion_min integer not null check (duracion_min between 5 and 480),
  anticipo integer not null default 0 check (anticipo >= 0),
  activo boolean not null default true,
  orden smallint not null default 0,
  constraint servicios_anticipo_coherente check (anticipo <= precio)
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

  -- Referencia corta y legible para decírsela al cliente por teléfono. Es
  -- también la referencia que el cliente pone en el concepto de la
  -- transferencia, y con la que la barbería empareja el depósito.
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

-- Anticipo. Se añaden por separado para que volver a correr este archivo los
-- agregue a una tabla `citas` que ya existía sin anticipos.
--
--   anticipo          cuánto se pidió por adelantado. 0 = no se pidió nada.
--   pago_estado       en qué punto va el anticipo.
--   pago_comprobante  ruta del archivo en el bucket `comprobantes`.
--   vence_en          hasta cuándo se le aparta el hueco sin haber pagado.
--                     Nulo = no caduca (no pide anticipo, o ya lo mandó).
alter table public.citas
  add column if not exists anticipo integer not null default 0,
  add column if not exists pago_estado text not null default 'no_requiere',
  add column if not exists pago_comprobante text,
  add column if not exists pago_subido_en timestamptz,
  add column if not exists pago_resuelto_en timestamptz,
  add column if not exists pago_nota text,
  add column if not exists vence_en timestamptz;

-- `add constraint` no admite `if not exists`, así que se envuelve para que el
-- archivo siga siendo idempotente.
do $$
begin
  alter table public.citas
    add constraint citas_pago_estado_valido
    check (pago_estado in ('no_requiere', 'esperando', 'en_revision', 'verificado', 'rechazado'));
exception
  when duplicate_object then null;
end
$$;

create index if not exists citas_por_fecha on public.citas (fecha);
create index if not exists citas_por_estado on public.citas (estado, fecha);
create index if not exists citas_por_telefono on public.citas (telefono_digitos);

-- Para que liberar los apartados caducados no recorra la tabla entera.
create index if not exists citas_por_vencimiento on public.citas (vence_en)
  where vence_en is not null;

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

alter table public.horarios  enable row level security;
alter table public.barberos  enable row level security;
alter table public.servicios enable row level security;
alter table public.bloqueos  enable row level security;
alter table public.citas     enable row level security;

-- Catálogos: cualquiera puede leerlos, nadie anónimo puede tocarlos.
drop policy if exists horarios_lectura on public.horarios;
create policy horarios_lectura on public.horarios
  for select to anon, authenticated using (true);

drop policy if exists barberos_lectura on public.barberos;
create policy barberos_lectura on public.barberos
  for select to anon, authenticated using (activo);

drop policy if exists servicios_lectura on public.servicios;
create policy servicios_lectura on public.servicios
  for select to anon, authenticated using (activo);

drop policy if exists bloqueos_lectura on public.bloqueos;
create policy bloqueos_lectura on public.bloqueos
  for select to anon, authenticated using (true);

-- Citas: el público no las ve ni las escribe. Sin política de INSERT para
-- `anon`, la única vía de entrada es la función `reservar_cita`; y sin política
-- de UPDATE, la única forma de adjuntar un comprobante es
-- `registrar_comprobante`.
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

drop policy if exists servicios_panel on public.servicios;
create policy servicios_panel on public.servicios
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- Comprobantes de transferencia (Supabase Storage)
-- ---------------------------------------------------------------------------
-- Bucket PRIVADO. `anon` puede subir pero no leer: si pudiera leer, cualquiera
-- vería los comprobantes bancarios de los demás clientes. El panel, que sí
-- está autenticado, los abre con una URL firmada de duración corta.
--
-- Tampoco puede sobrescribir: no hay política de UPDATE para `anon`, y cada
-- archivo se guarda en una ruta con un UUID nuevo, así que nadie puede tapar
-- el comprobante de otro.
--
-- Se envuelve en un bloque por si este archivo se corre contra un Postgres
-- pelón, sin el esquema `storage` que añade Supabase.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'comprobantes',
    'comprobantes',
    false,
    5242880, -- 5 MB: una captura de pantalla de un banco no pesa más
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists comprobantes_subida on storage.objects;
  create policy comprobantes_subida on storage.objects
    for insert to anon, authenticated
    with check (bucket_id = 'comprobantes');

  drop policy if exists comprobantes_lectura on storage.objects;
  create policy comprobantes_lectura on storage.objects
    for select to authenticated
    using (bucket_id = 'comprobantes');

  drop policy if exists comprobantes_borrado on storage.objects;
  create policy comprobantes_borrado on storage.objects
    for delete to authenticated
    using (bucket_id = 'comprobantes');
exception
  when undefined_table or invalid_schema_name then
    raise notice 'Sin esquema storage: los anticipos por transferencia no podrán guardar comprobante.';
end
$$;


-- ---------------------------------------------------------------------------
-- Apartados caducados
-- ---------------------------------------------------------------------------

-- Una cita que pide anticipo aparta el hueco desde el momento en que se
-- reserva. Si no se libera sola, quien reserve y no transfiera deja un hueco
-- muerto: en dos semanas la agenda se llena de apartados falsos y la barbería
-- se queda sin horas que ofrecer.
--
-- Se resuelve sin cron ni servidor: esta función cancela los apartados
-- vencidos y se llama desde `reservar_cita` (antes de buscar hueco) y desde el
-- panel al refrescar. La restricción de exclusión solo ignora las citas
-- canceladas, así que NO alcanza con filtrarlos al leer: hay que cancelarlos
-- de verdad o el INSERT seguiría chocando con un apartado que ya no vale.
create or replace function public.liberar_vencidas()
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with liberadas as (
    update public.citas
       set estado = 'cancelada',
           pago_nota = coalesce(
             pago_nota,
             'Apartado liberado automáticamente: no llegó el anticipo dentro del plazo.'
           )
     where estado = 'pendiente'
       and pago_estado in ('esperando', 'rechazado')
       and vence_en is not null
       and vence_en < now()
    returning 1
  )
  select count(*)::integer from liberadas;
$$;

revoke all on function public.liberar_vencidas() from public;
grant execute on function public.liberar_vencidas() to authenticated;


-- ---------------------------------------------------------------------------
-- Disponibilidad pública
-- ---------------------------------------------------------------------------

-- Devuelve los huecos ya tomados en un rango de fechas. Ni nombres, ni
-- teléfonos, ni correos: solo qué barbero está ocupado, cuándo y cuánto.
-- Con eso el navegador puede pintar el calendario entero de una sola vez.
--
-- Los apartados con anticipo vencido se descartan aquí aunque todavía sigan
-- marcados como pendientes: así el calendario dice la verdad desde el primer
-- segundo, sin esperar a que alguien dispare `liberar_vencidas`.
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
    and p_hasta - p_desde <= 120
    and not (
      c.estado = 'pendiente'
      and c.pago_estado in ('esperando', 'rechazado')
      and c.vence_en is not null
      and c.vence_en < now()
    );
$$;

revoke all on function public.disponibilidad(date, date) from public;
grant execute on function public.disponibilidad(date, date) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Alta de cita
-- ---------------------------------------------------------------------------

-- La versión anterior recibía el nombre del servicio, el precio y la duración
-- desde el navegador. Se elimina explícitamente: dejarla viva sería dejar
-- abierta la puerta que `servicios` vino a cerrar, porque PostgreSQL trata dos
-- firmas distintas como dos funciones distintas.
drop function if exists public.reservar_cita(
  text, text, text, text, text, integer, integer, text, date, time, text
);

-- Única puerta de entrada para el público. Revalida todo en el servidor: no
-- se fía de lo que el navegador diga que estaba libre ni de lo que diga que
-- cuesta.
--
-- Si p_barbero_slug viene nulo ("el que esté libre"), la función elige al
-- primero disponible por orden. Eso importa: dejar la cita con un barbero
-- genérico rompería el control de traslapes, porque cuatro barberos pueden
-- atender a cuatro personas a la misma hora.
--
-- Errores que puede levantar, para que el front los traduzca:
--   NOMBRE_INVALIDO, TELEFONO_INVALIDO, CORREO_INVALIDO, SERVICIO_INVALIDO,
--   FUERA_DE_PLAZO, DIA_CERRADO, FUERA_DE_HORARIO, HORA_OCUPADA,
--   DEMASIADAS_CITAS
create or replace function public.reservar_cita(
  p_nombre        text,
  p_telefono      text,
  p_correo        text,
  p_servicio_slug text,
  p_barbero_slug  text,
  p_fecha         date,
  p_hora          time,
  p_notas         text
)
returns table (
  id              uuid,
  folio           text,
  barbero_slug    text,
  barbero_nombre  text,
  servicio_nombre text,
  precio          integer,
  duracion_min    integer,
  anticipo        integer,
  pago_estado     text,
  vence_en        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Cuántas citas futuras sin atender puede tener un mismo teléfono a la vez.
  -- Tres deja pasar a quien aparta para su familia y corta al que quiere
  -- vaciar la agenda del mes con datos inventados.
  c_tope_por_telefono constant integer := 3;

  v_inicio      timestamp;
  v_fin         timestamp;
  v_digitos     text;
  v_horario     public.horarios%rowtype;
  v_barbero     public.barberos%rowtype;
  v_servicio    public.servicios%rowtype;
  v_pago_estado text;
  v_vence       timestamptz;
  v_id          uuid;
  v_folio       text;
begin
  -- Antes de mirar si hay hueco, se sueltan los apartados que ya vencieron:
  -- puede que el hueco que se está pidiendo sea justo uno de ellos.
  perform public.liberar_vencidas();

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

  -- El precio, la duración y el anticipo salen de aquí, NO de la petición.
  select * into v_servicio
  from public.servicios s
  where s.slug = p_servicio_slug
    and s.activo;

  if not found then
    raise exception 'SERVICIO_INVALIDO';
  end if;

  v_inicio := p_fecha + p_hora;
  v_fin    := v_inicio + make_interval(mins => v_servicio.duracion_min);

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

  -- El plazo del anticipo nunca puede pasarse de la hora de la cita: apartar
  -- hasta las 8 de la noche un hueco que era a las 6 no tiene sentido.
  if v_servicio.anticipo > 0 then
    v_pago_estado := 'esperando';
    v_vence := least(
      now() + public.plazo_anticipo(),
      v_inicio at time zone public.zona_barberia()
    );
  else
    v_pago_estado := 'no_requiere';
    v_vence := null;
  end if;

  begin
    insert into public.citas (
      cliente_nombre, cliente_telefono, cliente_correo,
      servicio_slug, servicio_nombre, precio, duracion_min,
      barbero_slug, barbero_nombre,
      fecha, hora, notas,
      anticipo, pago_estado, vence_en
    )
    values (
      p_nombre, p_telefono, p_correo,
      v_servicio.slug, v_servicio.nombre, v_servicio.precio, v_servicio.duracion_min,
      v_barbero.slug, v_barbero.nombre,
      p_fecha, p_hora, p_notas,
      v_servicio.anticipo, v_pago_estado, v_vence
    )
    returning citas.id, citas.folio into v_id, v_folio;
  exception
    -- Dos personas confirmando el mismo hueco en el mismo instante: la
    -- consulta de arriba vio libre, la restricción de exclusión no.
    when exclusion_violation then
      raise exception 'HORA_OCUPADA';
  end;

  return query select
    v_id, v_folio,
    v_barbero.slug, v_barbero.nombre,
    v_servicio.nombre, v_servicio.precio, v_servicio.duracion_min,
    v_servicio.anticipo, v_pago_estado, v_vence;
end;
$$;

revoke all on function public.reservar_cita(
  text, text, text, text, text, date, time, text
) from public;
grant execute on function public.reservar_cita(
  text, text, text, text, text, date, time, text
) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Comprobante del anticipo
-- ---------------------------------------------------------------------------

-- El cliente sube la captura de su transferencia al bucket y luego llama aquí
-- para engancharla a su cita. Como `anon` no tiene permiso de UPDATE sobre
-- `citas`, esta función es la única vía.
--
-- Pide folio Y teléfono: el folio va impreso en la pantalla de confirmación y
-- se manda por WhatsApp, así que por sí solo no basta para autorizar un cambio.
-- Con los dos, quien adjunta el comprobante es quien hizo la reserva.
--
-- Al adjuntar se detiene el reloj (`vence_en` a nulo): el cliente ya hizo su
-- parte y el hueco no debe soltarse mientras la barbería revisa.
--
-- Errores: CITA_NO_ENCONTRADA, PAGO_NO_APLICA, RUTA_INVALIDA
create or replace function public.registrar_comprobante(
  p_folio    text,
  p_telefono text,
  p_ruta     text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cita    public.citas%rowtype;
  v_digitos text;
begin
  perform public.liberar_vencidas();

  p_ruta := btrim(coalesce(p_ruta, ''));
  if char_length(p_ruta) < 3 or char_length(p_ruta) > 400 then
    raise exception 'RUTA_INVALIDA';
  end if;

  v_digitos := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');

  select * into v_cita
  from public.citas c
  where c.folio = upper(btrim(coalesce(p_folio, '')))
    and c.telefono_digitos = v_digitos;

  if not found then
    raise exception 'CITA_NO_ENCONTRADA';
  end if;

  -- Solo tiene sentido adjuntar mientras el anticipo sigue esperándose. Una
  -- cita ya verificada, cancelada o que no pide anticipo no se toca.
  if v_cita.estado <> 'pendiente' or v_cita.pago_estado not in ('esperando', 'rechazado') then
    raise exception 'PAGO_NO_APLICA';
  end if;

  update public.citas
     set pago_comprobante = p_ruta,
         pago_subido_en   = now(),
         pago_estado      = 'en_revision',
         pago_nota        = null,
         vence_en         = null
   where citas.id = v_cita.id;

  return 'en_revision';
end;
$$;

revoke all on function public.registrar_comprobante(text, text, text) from public;
grant execute on function public.registrar_comprobante(text, text, text) to anon, authenticated;


-- Verificación por parte de la barbería. Mueve el estado del pago y el de la
-- cita a la vez: una cita con el anticipo verificado pero sin confirmar sería
-- una contradicción que tarde o temprano alguien atiende mal.
--
-- Al rechazar se vuelve a abrir el plazo, para que el cliente pueda mandar el
-- comprobante correcto en vez de perder el lugar por una captura borrosa.
create or replace function public.resolver_pago(
  p_id       uuid,
  p_aprobado boolean,
  p_nota     text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cita public.citas%rowtype;
begin
  select * into v_cita from public.citas c where c.id = p_id;

  if not found then
    raise exception 'CITA_NO_ENCONTRADA';
  end if;

  if v_cita.anticipo <= 0 then
    raise exception 'PAGO_NO_APLICA';
  end if;

  if p_aprobado then
    update public.citas
       set pago_estado      = 'verificado',
           pago_resuelto_en = now(),
           pago_nota        = nullif(btrim(coalesce(p_nota, '')), ''),
           vence_en         = null,
           estado           = 'confirmada'
     where citas.id = p_id;
  else
    update public.citas
       set pago_estado      = 'rechazado',
           pago_resuelto_en = now(),
           pago_nota        = coalesce(
             nullif(btrim(coalesce(p_nota, '')), ''),
             'No pudimos identificar la transferencia.'
           ),
           estado           = 'pendiente',
           vence_en = least(
             now() + public.plazo_anticipo(),
             (citas.fecha + citas.hora) at time zone public.zona_barberia()
           )
     where citas.id = p_id;
  end if;
end;
$$;

revoke all on function public.resolver_pago(uuid, boolean, text) from public;
grant execute on function public.resolver_pago(uuid, boolean, text) to authenticated;


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

-- Servicios. Precio, duración y anticipo TIENEN que coincidir con `servicios`
-- de src/data/barberia.ts: ese archivo es el que se pinta en la página, este
-- es el que valida. Si no cuadran, el cliente ve un precio y se le cobra otro.
--
-- Solo el ritual completo pide anticipo: son 75 minutos de silla, y es la cita
-- que más duele cuando no llega nadie. Los demás se pagan en el local.
insert into public.servicios (slug, nombre, precio, duracion_min, anticipo, activo, orden) values
  ('corte-clasico',   'Corte clásico',     320, 45,   0, true, 1),
  ('barba-completa',  'Barba completa',    260, 30,   0, true, 2),
  ('afeitado-navaja', 'Afeitado a navaja', 340, 40,   0, true, 3),
  ('ritual-completo', 'Ritual completo',   520, 75, 150, true, 4)
on conflict (slug) do update
  set nombre = excluded.nombre,
      precio = excluded.precio,
      duracion_min = excluded.duracion_min,
      anticipo = excluded.anticipo,
      activo = excluded.activo,
      orden = excluded.orden;


-- La API de Supabase guarda en caché la forma del esquema. Sin esto, las
-- funciones nuevas pueden tardar en aparecer y el sitio respondería
-- "no pudimos guardar la cita" sin motivo aparente.
notify pgrst, 'reload schema';
