// RMC mobile-aligned theme — matches the white/green palette of the main app
export const T = {
  // Backgrounds
  bg:       '#F5F7F5',
  surface:  '#FFFFFF',
  surfaceAlt: '#F0F4F0',

  // Brand green (matches RMC mobile primary)
  primary:  '#0D4E35',
  primaryLight: '#E8F2EC',
  primaryMid: '#15803D',

  // Text
  textPrimary:  '#10221A',
  textSecondary: '#5C6B61',
  textMuted:    '#9CA3AF',
  textOnPrimary: '#FFFFFF',

  // Borders / dividers
  border:   '#E5E7EB',
  borderAlt: '#D1D5DB',

  // Semantic
  danger:   '#DC2626',
  dangerBg: '#FEF2F2',
  success:  '#15803D',
  successBg: '#DCFCE7',
  warning:  '#D97706',
  warningBg: '#FFFBEB',
  info:     '#1D4ED8',
  infoBg:   '#EFF6FF',

  // Status badge colours
  statusLive:       '#DC2626',
  statusScheduled:  '#1D4ED8',
  statusPractice:   '#7C3AED',
  statusClosed:     '#6B7280',
  statusReleased:   '#15803D',
  statusDraft:      '#9CA3AF',

  // Card shadow (Android elevation equivalent)
  shadowColor: '#0C4E36',

  // Radius
  radius: 12,
  radiusSm: 8,
  radiusXl: 20,
} as const;
