import { TODAY } from '../data/library';

import { t, locale } from './i18n';
const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

/** 0 → "—", 45 → "45 dk", 130 → "2 sa 10 dk", 9000 → "150 sa" */
export function duration(min: number, opts: { compact?: boolean } = {}): string {
  if (!min) return t('0 dk');
  if (min < 60) return t('{0} dk', Math.round(min));
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h >= 100 || opts.compact) return t('{0} sa', nf0.format(h));
  return m ? t('{0} sa {1} dk', h, m) : t('{0} sa', h);
}

export const hours1 = (min: number) => nf1.format(min / 60);
export const int = (n: number) => nf0.format(n);
export const score = (n: number) => nf1.format(n).replace(/[.,]0$/, '');

const MONTHS = [t('Oca'), t('Şub'), t('Mar'), t('Nis'), t('May'), t('Haz'), t('Tem'), t('Ağu'), t('Eyl'), t('Eki'), t('Kas'), t('Ara')];
const MONTHS_LONG = [t('Ocak'), t('Şubat'), t('Mart'), t('Nisan'), t('Mayıs'), t('Haziran'), t('Temmuz'), t('Ağustos'), t('Eylül'), t('Ekim'), t('Kasım'), t('Aralık')];
const DAYS = [t('Pazar'), t('Pazartesi'), t('Salı'), t('Çarşamba'), t('Perşembe'), t('Cuma'), t('Cumartesi')];

export const monthShort = (i: number) => MONTHS[i];
export const monthLong = (i: number) => MONTHS_LONG[i];

export function shortDate(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  const same = x.getFullYear() === TODAY.getFullYear();
  return `${x.getDate()} ${MONTHS[x.getMonth()]}${same ? '' : ' ' + x.getFullYear()}`;
}

export function longDate(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getDate()} ${MONTHS_LONG[x.getMonth()]} ${x.getFullYear()}, ${DAYS[x.getDay()]}`;
}

export const clock = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

/** "bugün", "dün", "3 gün önce", "2 hafta önce", "4 ay önce" */
export function ago(d: Date | string | null): string {
  if (!d) return t('Hiç');
  const x = typeof d === 'string' ? new Date(d) : d;
  const startOf = (y: Date) => new Date(y.getFullYear(), y.getMonth(), y.getDate()).getTime();
  const days = Math.round((startOf(TODAY) - startOf(x)) / 86400000);
  if (days <= 0) return t('Bugün');
  if (days === 1) return t('Dün');
  if (days < 14) return t('{0} gün önce', days);
  if (days < 60) return t('{0} hafta önce', Math.round(days / 7));
  if (days < 365) return t('{0} ay önce', Math.round(days / 30));
  return t('{0} yıl önce', Math.round(days / 365));
}

export function bytes(b: number): string {
  if (b >= 1024 ** 3) return t('{0} GB', nf1.format(b / 1024 ** 3));
  if (b >= 1024 ** 2) return t('{0} MB', nf0.format(b / 1024 ** 2));
  return t('{0} KB', nf0.format(Math.max(1, b / 1024)));
}

export const gb = (n: number | null) => (n == null ? '—' : n < 1 ? t('{0} MB', nf0.format(n * 1024)) : t('{0} GB', nf1.format(n)));
