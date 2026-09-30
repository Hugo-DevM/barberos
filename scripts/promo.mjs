/**
 * Genera imágenes de presentación de un sitio web: capturas limpias más
 * piezas compuestas con marcos de portátil y teléfono, listas para redes.
 *
 *   node scripts/promo.mjs                      → usa ./dist
 *   node scripts/promo.mjs ./build              → otra carpeta compilada
 *   node scripts/promo.mjs https://sitio.com    → un sitio ya publicado
 *   node scripts/promo.mjs ../otro-proyecto/dist --out ../otro-proyecto/promo
 *
 * Opciones:
 *   --out <carpeta>      dónde escribir (por defecto ./promo)
 *   --config <archivo>   JSON de configuración (por defecto promo.config.json)
 *   --guias              marca el borde de la zona segura (para revisar)
 *
 * No depende de ningún framework: si le das una carpeta, la sirve; si le das
 * una URL, la visita. Funciona igual con Astro, Next exportado, WordPress,
 * Webflow o HTML a mano.
 *
 * Requiere Node 18+, `puppeteer-core` y un Chromium instalado (busca Edge y
 * Chrome en las rutas habituales; si tienes otro, pásalo con
 * NAVEGADOR="ruta/al/binario").
 */

import { createServer } from 'node:http';
import { readFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, isAbsolute, dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

// ---------------------------------------------------------------------------
// Valores por defecto. Todo esto se puede sobrescribir en promo.config.json.
// ---------------------------------------------------------------------------

const POR_DEFECTO = {
  /** Insignia de la pieza. '' la quita. */
  insignia: 'Proyecto de demostración',
  /** Titular. null = usa el <title> de la página. \n parte la línea. */
  titular: null,
  /** Pie. Describe lo que el cliente ve, no el stack.
   *  No metas cifras que no puedas sostener: es lo primero que te piden demostrar. */
  pie: '',
  /** Dos colores; el resto de la paleta se deriva de ellos. */
  fondo: '#14201b',
  texto: '#ede9e1',
  /** Tipografía de las piezas. null = la del sistema.
   *  Acepta la ruta de un .woff2 variable:
   *      "fuente": "public/fonts/mi-variable.woff2"
   *  o varios pesos estáticos:
   *      "fuente": [
   *        { "archivo": "public/fonts/sans-400.woff2", "peso": 400 },
   *        { "archivo": "public/fonts/sans-600.woff2", "peso": 600 }
   *      ]
   *  Las rutas se resuelven contra el promo.config.json. */
  fuente: null,
  familia: 'system-ui, -apple-system, Segoe UI, sans-serif',
  /** Selector + clase que tu sitio usa para revelar al hacer scroll.
   *  Si no usas ninguno, déjalo; no hace daño que no encuentre nada. */
  revelado: { selector: '.reveal', clase: 'dentro' },
  /** Secciones sueltas para carrusel. null = detecta las primeras con id.
   *  Si una sección lleva `titular` (y opcionalmente `pie`), además se le hace
   *  su propia pieza compuesta en los lienzos marcados con `porSeccion`. */
  secciones: null,
  /** Tamaños de las capturas crudas. */
  escritorio: { w: 1440, h: 900 },
  movil: { w: 390, h: 844 },
  /** Piezas compuestas.
   *  `seguro` encierra el contenido en una caja centrada de esa proporción,
   *  para que el recorte de la red social sólo se coma fondo.
   *  `escala` multiplica los píxeles del archivo (2 por defecto); pon 1 si
   *  quieres exactamente w×h.
   *  `porSeccion` repite el lienzo para cada sección con titular propio. */
  lienzos: [
    { nombre: 'ig-vertical', formato: 'vertical', w: 1080, h: 1350, porSeccion: true },
    {
      nombre: 'ig-cuadricula',
      formato: 'vertical',
      w: 1080,
      h: 1440,
      seguro: '4 / 5',
      porSeccion: true,
    },
    { nombre: 'fb-cuadrado', formato: 'cuadrado', w: 1080, h: 1080 },
    { nombre: 'fb-horizontal', formato: 'horizontal', w: 1200, h: 630 },
  ],
  /** Dibuja el borde de la zona segura. Para revisar, no para publicar. */
  guias: false,
};

const CARPETAS_COMUNES = ['dist', 'build', 'out', '_site', 'public', '.'];
const PUERTO = 4399;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------

function leerArgumentos(argv) {
  const libres = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) {
      libres.push(argv[i]);
      continue;
    }
    // Sin valor detrás (o con otra bandera detrás) es una bandera de sí/no.
    const siguiente = argv[i + 1];
    const suelta = siguiente === undefined || siguiente.startsWith('--');
    flags[argv[i].slice(2)] = suelta ? true : argv[++i];
  }
  return { objetivo: libres[0], ...flags };
}

function buscarNavegador() {
  if (process.env.NAVEGADOR) return process.env.NAVEGADOR;
  const candidatos = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
  const encontrado = candidatos.find((r) => existsSync(r));
  if (!encontrado) {
    throw new Error(
      'No encontré Chrome ni Edge. Pasa la ruta:  NAVEGADOR="C:\\ruta\\chrome.exe" node scripts/promo.mjs',
    );
  }
  return encontrado;
}

/** Servidor estático mínimo sobre una carpeta. */
function servir(raiz) {
  const s = createServer(async (pet, res) => {
    try {
      let ruta = decodeURIComponent(new URL(pet.url, 'http://x').pathname);
      if (ruta.endsWith('/')) ruta += 'index.html';
      let archivo = join(raiz, ruta);
      if (!archivo.startsWith(raiz)) throw new Error('fuera');

      /* Los generadores estáticos escriben /panel/index.html, pero el
         navegador pide /panel sin barra final, que apunta a la carpeta.
         Sin esto, cualquier página que no sea la portada da 404. */
      const info = await stat(archivo).catch(() => null);
      if (!info || info.isDirectory()) archivo = join(archivo, 'index.html');

      const cuerpo = await readFile(archivo);
      res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
      res.end(cuerpo);
    } catch {
      res.writeHead(404).end('no encontrado');
    }
  });
  return new Promise((r) => s.listen(PUERTO, () => r(s)));
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Recorre la página para que carguen las imágenes diferidas y se resuelva el revelado. */
async function asentar(pg, revelado) {
  await pg.evaluate(async (rev) => {
    if (rev?.selector && rev?.clase) {
      document.querySelectorAll(rev.selector).forEach((e) => e.classList.add(rev.clase));
    }
    await new Promise((r) => {
      let y = 0;
      const paso = () => {
        window.scrollTo(0, y);
        y += 700;
        if (y < document.body.scrollHeight) setTimeout(paso, 35);
        else {
          window.scrollTo(0, 0);
          setTimeout(r, 400);
        }
      };
      paso();
    });
  }, revelado);
  await esperar(700);
}

const aDataUri = async (ruta, tipo) =>
  `data:${tipo};base64,${(await readFile(ruta)).toString('base64')}`;

// ---------------------------------------------------------------------------

async function main() {
  const args = leerArgumentos(process.argv.slice(2));
  const cwd = process.cwd();
  const aqui = import.meta.dirname;

  // --- Resolver el objetivo: URL o carpeta ----------------------------------
  let objetivo = args.objetivo;
  let esUrl = false;

  if (objetivo && /^https?:\/\//i.test(objetivo)) {
    esUrl = true;
  } else {
    if (!objetivo) {
      objetivo = CARPETAS_COMUNES.map((c) => resolve(cwd, c)).find((c) =>
        existsSync(join(c, 'index.html')),
      );
      if (!objetivo) {
        console.error(
          'No encontré un index.html en dist/, build/, out/, _site/, public/ ni aquí.\n' +
            'Compila primero, o pasa la ruta:  node scripts/promo.mjs ./mi-carpeta\n' +
            'También acepta una URL:            node scripts/promo.mjs https://sitio.com',
        );
        process.exit(1);
      }
    } else {
      objetivo = isAbsolute(objetivo) ? objetivo : resolve(cwd, objetivo);
      if (!existsSync(join(objetivo, 'index.html'))) {
        console.error(`No hay index.html en ${objetivo}`);
        process.exit(1);
      }
    }
  }

  // --- Configuración ---------------------------------------------------------
  const rutaConfig = args.config
    ? resolve(cwd, args.config)
    : [
        !esUrl && join(objetivo, '..', 'promo.config.json'),
        join(cwd, 'promo.config.json'),
      ].find((p) => p && existsSync(p));

  const config = {
    ...POR_DEFECTO,
    ...(rutaConfig ? JSON.parse(await readFile(rutaConfig, 'utf8')) : {}),
  };

  const salida = resolve(cwd, args.out ?? 'promo');
  await mkdir(salida, { recursive: true });

  console.log(`objetivo:  ${esUrl ? objetivo : objetivo}`);
  console.log(`config:    ${rutaConfig ?? '(valores por defecto)'}`);
  console.log(`salida:    ${salida}\n`);

  // --- Arrancar -------------------------------------------------------------
  const servidor = esUrl ? null : await servir(objetivo);
  const url = esUrl ? objetivo : `http://localhost:${PUERTO}/`;
  const navegador = await puppeteer.launch({
    executablePath: buscarNavegador(),
    headless: 'shell',
    args: ['--hide-scrollbars', '--disable-gpu', '--force-prefers-reduced-motion'],
  });

  const pg = await navegador.newPage();
  const crudas = [
    { nombre: 'escritorio-hero', ...config.escritorio, completa: false },
    { nombre: 'escritorio-completa', ...config.escritorio, completa: true },
    { nombre: 'movil-hero', ...config.movil, completa: false },
    { nombre: 'movil-completa', ...config.movil, completa: true },
  ];

  let tituloPagina = '';
  for (const c of crudas) {
    await pg.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 2 });
    await pg.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await asentar(pg, config.revelado);
    tituloPagina ||= await pg.title();
    await pg.screenshot({ path: join(salida, `${c.nombre}.png`), fullPage: c.completa });
    console.log('·', `${c.nombre}.png`);
  }

  // --- Secciones sueltas ------------------------------------------------------
  // Cada sección se captura en los dos anchos: la de escritorio va al portátil
  // de las piezas compuestas y la de móvil al teléfono.
  let secciones = config.secciones;

  /** Captura todas las secciones en un ancho. Devuelve nombre → ruta del png. */
  async function capturarSecciones(vista, sufijo) {
    await pg.setViewport({ width: vista.w, height: vista.h, deviceScaleFactor: 2 });
    await pg.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await asentar(pg, config.revelado);

    secciones ??= await pg.evaluate(() =>
      [...document.querySelectorAll('section[id], [id][data-seccion]')]
        .slice(0, 3)
        .map((e) => ({ nombre: e.id, selector: `#${e.id}` })),
    );

    const hechas = {};
    let rutaActual = '/';

    for (const s of secciones) {
      /* Una sección puede vivir en otra página: un panel de administración,
         un área con sesión. Se navega solo cuando hace falta y se vuelve a la
         portada para la siguiente. */
      const destino = s.ruta ?? '/';
      if (destino !== rutaActual) {
        await pg.goto(new URL(destino, url).href, { waitUntil: 'networkidle0', timeout: 60000 });
        await asentar(pg, config.revelado);
        rutaActual = destino;
      }

      /* "preparar" son pasos que se ejecutan antes de la foto, para las
         secciones que solo enseñan algo cuando alguien ya interactuó: un
         calendario sin día elegido no muestra horarios, y un panel sin sesión
         no muestra la agenda. Sin esto la captura prometería algo que no se
         ve. Va antes de encuadrar, porque al abrirse el contenido la sección
         cambia de alto.

         Un paso es un selector suelto (se pulsa) o un objeto:
           { pulsar: sel }            pulsa
           { escribir: sel, texto }   escribe en un campo
           { ejecutar: archivo.js }   corre ese archivo en la página
           { esperar: ms }            espera                                */
      for (const paso of s.preparar ?? []) {
        const orden = typeof paso === 'string' ? { pulsar: paso } : paso;

        if (orden.esperar) {
          await esperar(orden.esperar);
          continue;
        }

        if (orden.ejecutar) {
          const ruta = isAbsolute(orden.ejecutar)
            ? orden.ejecutar
            : resolve(rutaConfig ? dirname(rutaConfig) : cwd, orden.ejecutar);
          if (!existsSync(ruta)) {
            console.log('·', `(no encontré ${ruta})`);
            continue;
          }
          await pg.evaluate(await readFile(ruta, 'utf8'));
          await esperar(120);
          continue;
        }

        const sel = orden.pulsar ?? orden.escribir;
        const hecho = await pg.evaluate(
          (sel, texto) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            if (texto == null) {
              el.click();
            } else {
              el.value = texto;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
          },
          sel,
          orden.escribir ? (orden.texto ?? '') : null,
        );
        if (!hecho) console.log('·', `(no encontré ${sel} para preparar ${s.nombre})`);
        await esperar(orden.escribir ? 120 : 350);
      }

      const ok = await pg.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;

        /* Si el sitio tiene cabecera pegajosa, colocar la sección a ras del
           borde superior la deja escondida debajo. Se mide lo que haya
           anclado arriba y se descuenta. */
        let techo = 0;
        for (const nodo of document.body.querySelectorAll('*')) {
          const e = getComputedStyle(nodo);
          if (e.position !== 'sticky' && e.position !== 'fixed') continue;
          if (e.visibility === 'hidden' || e.display === 'none') continue;
          const caja = nodo.getBoundingClientRect();
          if (caja.top > 4 || caja.height === 0 || caja.height > 200) continue;
          techo = Math.max(techo, caja.height);
        }

        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - techo - 14);
        return true;
      }, s.selector);
      if (!ok) {
        console.log('·', `(sin ${s.selector})`);
        continue;
      }
      await esperar(450);
      const archivo = `seccion-${s.nombre}${sufijo}.png`;
      await pg.screenshot({ path: join(salida, archivo) });
      console.log('·', archivo);
      hechas[s.nombre] = join(salida, archivo);
    }
    return hechas;
  }

  const seccionEscritorio = await capturarSecciones(config.escritorio, '');
  const seccionMovil = await capturarSecciones(config.movil, '-movil');

  // --- Piezas compuestas --------------------------------------------------------
  // Las rutas relativas del config se resuelven contra el propio config.
  const baseConfig = rutaConfig ? dirname(rutaConfig) : cwd;
  const caras = (
    config.fuente == null
      ? []
      : Array.isArray(config.fuente)
        ? config.fuente
        : [{ archivo: config.fuente, peso: '100 900' }]
  ).map((c) => ({
    peso: c.peso ?? 400,
    ruta: isAbsolute(c.archivo) ? c.archivo : resolve(baseConfig, c.archivo),
  }));

  let fuenteCss = '';
  let familia = config.familia;
  const presentes = caras.filter((c) => existsSync(c.ruta));
  for (const c of caras.filter((c) => !existsSync(c.ruta))) {
    console.log(`  (aviso: no encontré ${c.ruta})`);
  }
  if (presentes.length) {
    for (const c of presentes) {
      const datos = await aDataUri(c.ruta, 'font/woff2');
      fuenteCss += `@font-face{font-family:'PromoFuente';font-weight:${c.peso};font-style:normal;src:url('${datos}') format('woff2');}`;
    }
    familia = `'PromoFuente', ${config.familia}`;
  } else if (caras.length) {
    console.log('  (uso la tipografía del sistema)');
  }

  const titular = (config.titular ?? tituloPagina ?? '').trim();
  const plantilla = await readFile(join(aqui, 'promo-plantilla.html'), 'utf8');

  const html = plantilla
    .replaceAll('__FUENTE_CSS__', fuenteCss)
    .replaceAll('__FAMILIA__', familia)
    .replaceAll('__FONDO__', config.fondo)
    .replaceAll('__TEXTO__', config.texto)
    .replaceAll('__CLASES__', '')
    .replaceAll('__ESCRITORIO__', '')
    .replaceAll('__MOVIL__', '')
    .replaceAll('__INSIGNIA__', config.insignia)
    .replaceAll('__TITULAR__', '')
    .replaceAll('__PIE__', '');

  const pg2 = await navegador.newPage();
  await pg2.setContent(html, { waitUntil: 'load' });
  await pg2.evaluateHandle('document.fonts.ready');

  const guias = args.guias ?? config.guias;

  // Una pieza = un lienzo + un par de capturas + su texto. Cada lienzo da la
  // pieza de portada y, si lleva `porSeccion`, una más por cada sección que
  // tenga titular propio en el config.
  const piezas = [];
  for (const l of config.lienzos) {
    piezas.push({
      ...l,
      escritorio: join(salida, 'escritorio-hero.png'),
      movil: join(salida, 'movil-hero.png'),
      titular,
      pie: config.pie,
    });
    if (!l.porSeccion) continue;
    for (const s of secciones) {
      if (!s.titular || !seccionEscritorio[s.nombre]) continue;
      piezas.push({
        ...l,
        nombre: `${l.nombre}-${s.nombre}`,
        escritorio: seccionEscritorio[s.nombre],
        movil: seccionMovil[s.nombre] ?? null,
        titular: s.titular.trim(),
        pie: s.pie ?? '',
      });
    }
  }

  // Las capturas se reutilizan entre piezas: conviértelas a data: una sola vez.
  const uris = new Map();
  const comoUri = async (ruta) => {
    if (ruta && !uris.has(ruta)) uris.set(ruta, await aDataUri(ruta, 'image/png'));
    return ruta ? uris.get(ruta) : null;
  };

  for (const p of piezas) {
    const escala = p.escala ?? 2;
    await pg2.setViewport({ width: p.w, height: p.h, deviceScaleFactor: escala });
    await pg2.evaluate(
      (p, guias) => {
        const raiz = document.documentElement;
        raiz.setAttribute('data-formato', p.formato);
        raiz.toggleAttribute('data-seguro', Boolean(p.seguro));
        raiz.toggleAttribute('data-guias', Boolean(p.seguro && guias));
        raiz.style.setProperty('--seguro', p.seguro ?? 'auto');

        document.querySelector('.titular').innerHTML = p.titular;
        document.querySelector('.pie').textContent = p.pie;
        document.querySelector('.laptop__pantalla').src = p.escritorio;
        // Sin captura de móvil la plantilla esconde el teléfono.
        document.body.classList.toggle('sin-movil', !p.movil);
        if (p.movil) document.querySelector('.telefono__pantalla').src = p.movil;
      },
      {
        ...p,
        titular: p.titular.replace(/\n/g, '<br>'),
        escritorio: await comoUri(p.escritorio),
        movil: await comoUri(p.movil),
      },
      guias,
    );
    // Esperar a que las capturas nuevas estén decodificadas, no sólo cargadas.
    await pg2.evaluate(() =>
      Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
    );
    await esperar(250);
    await pg2.screenshot({ path: join(salida, `${p.nombre}.png`) });
    console.log(
      '·',
      `${p.nombre}.png`.padEnd(30),
      `${p.w * escala}×${p.h * escala}`,
      p.seguro ? `· zona segura ${p.seguro}` : '',
    );
  }

  await navegador.close();
  servidor?.close();

  const archivos = (await readdir(salida)).filter((a) => a.endsWith('.png')).sort();
  console.log(`\n${archivos.length} imágenes en ${salida}\n`);
  for (const a of archivos) {
    const { size } = await stat(join(salida, a));
    console.log(`  ${a.padEnd(28)} ${(size / 1024).toFixed(0)} KB`);
  }
}

main().catch((e) => {
  console.error('\n' + e.message);
  process.exit(1);
});
