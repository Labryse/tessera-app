// English lines, keyed by the Turkish text in the code (see src/lib/i18n.ts).
// Names (games, stores, people in the demo) are not listed: they stay as they are.
import type { Line } from '../lib/i18n';
import { accounts } from './en-accounts';
import { game } from './en-game';
import { app } from './en-app';
import { more } from './en-more';
import { studio } from './en-studio';
import { demo } from './en-demo';

export const en: Record<string, Line> = { ...accounts, ...game, ...app, ...more, ...studio, ...demo };
