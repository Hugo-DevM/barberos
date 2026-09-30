// @ts-check
import { defineConfig } from 'astro/config';
import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.navajayfilo.mx',
  integrations: [
    icon({
      include: {
        // Phosphor. Solo los glifos que realmente se usan entran al bundle.
        ph: [
          'scissors', 'calendar-blank', 'calendar-check', 'clock',
          'map-pin', 'phone', 'whatsapp-logo', 'instagram-logo',
          'facebook-logo', 'tiktok-logo', 'star', 'quotes',
          'caret-left', 'caret-right', 'caret-down', 'caret-up',
          'star-fill', 'arrow-right', 'arrow-up-right', 'check', 'check-circle',
          'x', 'x-circle', 'warning-circle', 'circle-notch', 'list',
          'user', 'users-three', 'envelope-simple', 'lock-simple',
          'sign-out', 'sparkle', 'drop', 'crown-simple', 'medal',
          'hourglass', 'arrows-clockwise', 'money',
          'google-logo', 'microsoft-outlook-logo', 'apple-logo',
        ],
      },
    }),
  ],
});
