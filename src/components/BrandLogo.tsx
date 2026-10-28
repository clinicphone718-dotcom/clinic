import { APP_LOGO_URL, APP_NAME, APP_TAGLINE } from '../config/brand';
import { cn } from '../lib/utils';

type BrandLogoProps = {
  variant?: 'full' | 'icon' | 'mono';
  logoUrl?: string;
  className?: string;
};

function BrandMark({ logoUrl, monochrome = false }: { logoUrl: string; monochrome?: boolean }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className="h-full w-full object-contain" />;
  }

  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="h-full w-full">
      <rect x="11.5" y="5.5" width="25" height="37" rx="6.5" stroke="currentColor" strokeWidth="2.8" />
      <path d="M19 11h10" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="24" cy="36.5" r="1.5" fill="currentColor" />
      <path d="m31 28 7.5-7.5 2 2L33 30l-4 1 1-3Z" fill={monochrome ? 'currentColor' : '#4385F5'} />
      <path d="m36.5 22.5 2 2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export default function BrandLogo({ variant = 'full', logoUrl = APP_LOGO_URL, className }: BrandLogoProps) {
  if (variant === 'icon' || variant === 'mono') {
    const monochrome = variant === 'mono';
    return (
      <span
        className={cn(
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] p-2.5',
          monochrome
            ? 'border border-[#E6E9F2] bg-white text-[#20263A]'
            : 'bg-[#4F46E5] text-white shadow-sm shadow-indigo-600/20',
          className,
        )}
      >
        <BrandMark logoUrl={logoUrl} monochrome={monochrome} />
      </span>
    );
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-3', className)}>
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#4F46E5] p-2.5 text-white shadow-sm shadow-indigo-600/20">
        <BrandMark logoUrl={logoUrl} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate bg-gradient-to-r from-indigo-600 to-cyan-500 bg-clip-text font-display text-[18px] font-extrabold leading-tight tracking-[-0.04em] text-transparent">{APP_NAME}</span>
        <span className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.12em] text-[#5F667A]">{APP_TAGLINE}</span>
      </span>
    </span>
  );
}
