const captionGlyphs = {
  minimize: '\uE921',
  maximize: '\uE922',
  close: '\uE8BB',
} as const

export function WindowCaptionIcon({ action }: { action: keyof typeof captionGlyphs }) {
  return (
    <span aria-hidden className="caption-icon">
      {captionGlyphs[action]}
    </span>
  )
}
