const envInviteCode = import.meta.env.VITE_DEFAULT_LEAGUE_INVITE_CODE
const envLeagueName = import.meta.env.VITE_DEFAULT_LEAGUE_NAME
const envViewerName = import.meta.env.VITE_DEFAULT_VIEWER_NAME

export const defaultRuntimeConfig = {
  inviteCode: envInviteCode || 'START123',
  leagueName: envLeagueName || 'Dorm World Cup League',
  viewerName: envViewerName || 'Akash',
}
