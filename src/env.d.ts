/// <reference types="astro/client" />

/* El ayudante que publica src/components/Analitica.astro. Es opcional a
   propósito: sin PUBLIC_GA_ID el componente no pinta nada y la función no
   existe, así que todos los llamadores usan `window.medirEvento?.(...)`. */
declare global {
  interface Window {
    medirEvento?: (nombre: string, datos?: Record<string, unknown>) => void;
  }
}

export {};
