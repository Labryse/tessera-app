// Store marks (Simple Icons, CC0) drawn in the current text colour, so they sit
// quietly in every theme. Xbox is no longer in Simple Icons; it gets a plain
// drawn sphere mark instead.
import { siBattledotnet, siEa, siEpicgames, siGogdotcom, siRetroachievements, siSteam, siUbisoft } from 'simple-icons';
import { Gamepad2, Monitor } from 'lucide-react';

const PATHS: Record<string, string> = {
  steam: siSteam.path,
  battlenet: siBattledotnet.path,
  ubisoft: siUbisoft.path,
  ea: siEa.path,
  epic: siEpicgames.path,
  gog: siGogdotcom.path,
  ra: siRetroachievements.path,
};

export function PlatformLogo({ id, size = 16, className = '' }: { id: string; size?: number; className?: string }) {
  if (id === 'xbox') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={`plogo ${className}`} aria-hidden="true">
        <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M6.6 6.9C8.9 8 10.6 9.9 12 12.2c1.4-2.3 3.1-4.2 5.4-5.3M6.4 17.4c1.5-2.7 3.4-4.5 5.6-5.2 2.2.7 4.1 2.5 5.6 5.2"
          fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'local') return <Monitor size={size} strokeWidth={1.8} className={`plogo ${className}`} aria-hidden="true" />;
  const d = PATHS[id];
  if (!d) return <Gamepad2 size={size} strokeWidth={1.7} className={`plogo ${className}`} aria-hidden="true" />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`plogo ${className}`} aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
