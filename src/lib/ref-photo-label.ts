/** The Fit dialog's main button. "Add photo" until a photo can actually be shown. */
export function refPhotoLabel(opts: { busy: boolean; shown: string | null | undefined }): string {
  if (opts.busy) return "Saving…";
  return opts.shown ? "Replace photo" : "Add photo";
}
