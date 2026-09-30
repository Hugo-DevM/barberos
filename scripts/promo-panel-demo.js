/* ==========================================================================
   Agenda de muestra para la captura del panel
   --------------------------------------------------------------------------
   Lo ejecuta scripts/promo.mjs dentro de la página, justo antes de entrar al
   panel, mediante el paso { "ejecutar": "scripts/promo-panel-demo.js" } de
   promo.config.json.

   Por qué hace falta: un panel vacío no enseña nada. Y por qué no se meten
   las fechas a mano: una captura con citas de septiembre de 2026 se ve vieja
   en diciembre. Aquí las fechas se calculan desde el día en que se genera la
   imagen, así que la pieza envejece bien.

   Solo tiene efecto en modo demostración, donde las citas viven en este
   navegador. Con Supabase configurado, el panel lee de la base y esto se
   ignora.
   ========================================================================== */

(() => {
  const CLAVE = 'navaja-filo:citas-demo';

  /* Fecha de hoy en la zona de la barbería, en texto AAAA-MM-DD. */
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  /* Suma días saltándose los lunes, que la barbería cierra. */
  function dia(saltos) {
    const [a, m, d] = hoy.split('-').map(Number);
    const fecha = new Date(Date.UTC(a, m - 1, d));
    let dados = 0;
    while (dados < saltos) {
      fecha.setUTCDate(fecha.getUTCDate() + 1);
      if (fecha.getUTCDay() !== 1) dados++;
    }
    // Si el propio día de partida cae en lunes, se corre al martes.
    while (fecha.getUTCDay() === 1) fecha.setUTCDate(fecha.getUTCDate() + 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${fecha.getUTCFullYear()}-${p(fecha.getUTCMonth() + 1)}-${p(fecha.getUTCDate())}`;
  }

  const SERVICIOS = {
    corte: ['corte-clasico', 'Corte clásico', 320, 45],
    barba: ['barba-completa', 'Barba completa', 260, 30],
    navaja: ['afeitado-navaja', 'Afeitado a navaja', 340, 40],
    ritual: ['ritual-completo', 'Ritual completo', 520, 75],
  };

  const BARBEROS = {
    ruben: ['ruben-salcedo', 'Rubén Salcedo'],
    iker: ['iker-mondragon', 'Iker Mondragón'],
    tadeo: ['tadeo-briseno', 'Tadeo Briseño'],
    nicolas: ['nicolas-arriaga', 'Nicolás Arriaga'],
  };

  const GUION = [
    [0, '11:30', 'corte', 'iker', 'Emiliano Cuevas', '55 2841 7733', 'confirmada', null],
    [0, '12:30', 'ritual', 'ruben', 'Santiago Ferrer', '55 6017 2298', 'confirmada',
      'Viene por lo de la boda del sábado.'],
    [0, '16:00', 'barba', 'tadeo', 'Rodrigo Palomares', '55 3390 5514', 'pendiente', null],
    [0, '18:30', 'corte', 'nicolas', 'Andrés Lugo', '55 7725 1180', 'pendiente',
      'Los lados más cortos que la vez pasada.'],
    [1, '11:00', 'navaja', 'tadeo', 'Mauricio Beltrán', '55 4402 6671', 'confirmada', null],
    [1, '13:00', 'corte', 'iker', 'Joaquín Rentería', '55 9184 3027', 'pendiente', null],
    [1, '17:30', 'ritual', 'ruben', 'Diego Sandoval', '55 5563 8840', 'pendiente',
      'Primera vez. Preguntó si hay estacionamiento.'],
    [2, '12:00', 'barba', 'nicolas', 'Ximena Portillo', '55 2278 9106', 'confirmada',
      'Aparta para su hijo, 9 años.'],
    [2, '15:30', 'corte', 'tadeo', 'Iván Madrigal', '55 8831 4492', 'pendiente', null],
  ];

  const citas = GUION.map(([salto, hora, srv, brb, nombre, telefono, estado, notas], i) => {
    const [servicio_slug, servicio_nombre, precio, duracion_min] = SERVICIOS[srv];
    const [barbero_slug, barbero_nombre] = BARBEROS[brb];
    const id = `demo-${String(i + 1).padStart(4, '0')}-0000-0000-000000000000`;

    return {
      id,
      folio: `NF-${(0x1a2b3c + i * 0x4d7f).toString(16).toUpperCase().slice(0, 6)}`,
      creada_en: new Date(Date.now() - (GUION.length - i) * 5400000).toISOString(),
      cliente_nombre: nombre,
      cliente_telefono: telefono,
      cliente_correo: i % 3 === 0 ? `${nombre.split(' ')[0].toLowerCase()}@correo.com` : null,
      servicio_slug,
      servicio_nombre,
      precio,
      duracion_min,
      barbero_slug,
      barbero_nombre,
      fecha: dia(salto),
      hora,
      notas,
      estado,
    };
  });

  localStorage.setItem(CLAVE, JSON.stringify(citas));
})();
