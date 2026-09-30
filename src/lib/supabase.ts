/* ==========================================================================
   Cliente de Supabase
   --------------------------------------------------------------------------
   Las dos variables viven en `.env` (copia `.env.example`). Llevan el prefijo
   PUBLIC_ porque Astro solo expone al navegador las que lo tienen, y ambas
   tienen que llegar al navegador: el sitio es estático y habla con Supabase
   desde el cliente.

   Que la clave `anon` viaje al navegador es lo normal y lo previsto: es una
   clave pública. Lo que protege los datos es la seguridad a nivel de fila
   definida en supabase/schema.sql, no el secreto de esta clave. La clave
   `service_role` NUNCA debe aparecer en este proyecto.

   Si faltan las variables, `obtenerSupabase()` devuelve null y la capa de
   reservas cae al modo demo con localStorage.
   ========================================================================== */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL_SUPABASE = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const CLAVE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export const HAY_SUPABASE = Boolean(URL_SUPABASE && CLAVE_ANON);

let cliente: SupabaseClient | null = null;

export function obtenerSupabase(): SupabaseClient | null {
  if (!HAY_SUPABASE) return null;
  if (!cliente) {
    cliente = createClient(URL_SUPABASE!, CLAVE_ANON!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // El panel es la única parte con sesión y vive en una ruta propia;
        // no hace falta rastrear tokens en la URL del sitio público.
        detectSessionInUrl: false,
      },
    });
  }
  return cliente;
}
