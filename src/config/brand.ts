function envValue(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

export const APP_NAME = envValue(import.meta.env.VITE_APP_NAME, 'PHONE CLINIC');
export const APP_SHORT_NAME = envValue(import.meta.env.VITE_APP_SHORT_NAME, 'PHONE CLINIC');
export const APP_TAGLINE = envValue(import.meta.env.VITE_APP_TAGLINE, 'REPAIR • SALES • ACCESSORIES');
export const APP_PRIMARY_COLOR = envValue(import.meta.env.VITE_APP_PRIMARY_COLOR, '#4F46E5');
export const APP_LOGO_URL = envValue(import.meta.env.VITE_APP_LOGO, '');

export const APP_BRAND_COLORS = {
  primary: APP_PRIMARY_COLOR,
  secondary: '#4385F5',
  background: '#F8F9FD',
  surface: '#FFFFFF',
  text: '#1E293B',
  secondaryText: '#64748B',
  border: '#E2E8F0',
  success: '#059669',
  warning: '#D98A22',
  error: '#D94B55',
} as const;
