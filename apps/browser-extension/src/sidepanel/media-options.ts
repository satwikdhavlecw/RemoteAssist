export const tabDisplayMediaOptions = {
  video: { displaySurface: "window" },
  audio: false,
  // Let the employee share the complete Chrome window, including the
  // RemoteAssist surface when Chrome exposes it in the picker.
  preferCurrentTab: false,
  selfBrowserSurface: "include",
  surfaceSwitching: "include",
  monitorTypeSurfaces: "exclude",
  systemAudio: "exclude",
} as const;
