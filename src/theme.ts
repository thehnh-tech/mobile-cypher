export type ThemeName = 'cyan' | 'magenta' | 'amber' | 'lime';

export interface Theme {
  name: ThemeName;
  bg: string;
  surface1: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accent2: string;
  accentGlow: string;
  error: string;
  accentBg: string;
  accentBorder: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  cyan: {
    name: 'cyan',
    bg: '#05070d',
    surface1: '#0a0f1a',
    surface2: '#121827',
    border: 'rgba(90,230,255,0.12)',
    text: '#e7ecf5',
    textDim: '#6b7a94',
    accent: '#22d3ee',
    accent2: '#818cf8',
    accentGlow: 'rgba(34,211,238,0.25)',
    error: '#f87171',
    accentBg: 'rgba(34,211,238,0.08)',
    accentBorder: 'rgba(34,211,238,0.3)',
  },
  magenta: {
    name: 'magenta',
    bg: '#0a0511',
    surface1: '#15091f',
    surface2: '#1e0d2e',
    border: 'rgba(255,90,200,0.14)',
    text: '#f5e7ef',
    textDim: '#8a6b8a',
    accent: '#f472b6',
    accent2: '#a78bfa',
    accentGlow: 'rgba(244,114,182,0.25)',
    error: '#f87171',
    accentBg: 'rgba(244,114,182,0.08)',
    accentBorder: 'rgba(244,114,182,0.3)',
  },
  amber: {
    name: 'amber',
    bg: '#0d0a05',
    surface1: '#17110a',
    surface2: '#22190d',
    border: 'rgba(255,180,50,0.14)',
    text: '#f5eee0',
    textDim: '#8a7a5a',
    accent: '#fbbf24',
    accent2: '#fb923c',
    accentGlow: 'rgba(251,191,36,0.25)',
    error: '#f87171',
    accentBg: 'rgba(251,191,36,0.08)',
    accentBorder: 'rgba(251,191,36,0.3)',
  },
  lime: {
    name: 'lime',
    bg: '#050d08',
    surface1: '#091510',
    surface2: '#0d2218',
    border: 'rgba(120,255,170,0.14)',
    text: '#e7f5ee',
    textDim: '#6b8a7a',
    accent: '#4ade80',
    accent2: '#2dd4bf',
    accentGlow: 'rgba(74,222,128,0.25)',
    error: '#f87171',
    accentBg: 'rgba(74,222,128,0.08)',
    accentBorder: 'rgba(74,222,128,0.3)',
  },
};

export const FONTS = {
  mono: 'JetBrainsMono-Regular',
  monoMedium: 'JetBrainsMono-Medium',
  monoBold: 'JetBrainsMono-Bold',
  body: 'SpaceGrotesk-Regular',
  bodyMedium: 'SpaceGrotesk-Medium',
  bodySemiBold: 'SpaceGrotesk-SemiBold',
  bodyBold: 'SpaceGrotesk-Bold',
};
