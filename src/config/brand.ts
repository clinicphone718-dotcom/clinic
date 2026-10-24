function envValue(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

export const APP_NAME = envValue(import.meta.env.VITE_APP_NAME, 'Phone Clinic');
export const APP_SHORT_NAME = envValue(import.meta.env.VITE_APP_SHORT_NAME, 'Phone Clinic');
export const APP_TAGLINE = envValue(import.meta.env.VITE_APP_TAGLINE, 'Caisse & Réparation');
export const APP_PRIMARY_COLOR = envValue(import.meta.env.VITE_APP_PRIMARY_COLOR, '#4f46e5');
export const APP_LOGO_URL = envValue(import.meta.env.VITE_APP_LOGO, '');
