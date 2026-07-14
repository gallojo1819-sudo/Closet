-- 004_image_source_and_rejected.sql
--
-- Segmentation-first sourcing + a fidelity-rejection status.
--
--  * image_source records how each garment's display image is produced:
--      'segmented' — background stripped from the real photo (my pixels)
--      'cutout'    — Gemini reconstruction that passed the fidelity gate
--      'photo'     — honest fallback: real cropped photo (no verified cutout)
--      'official'  — reserved for later product-catalog lookups
--  * 'cutout_rejected' is a new garment status: a generation that failed the
--    fidelity gate. It is a FULLY VALID closet item that displays its photo.

alter table garments
  add column if not exists image_source text not null default 'photo'
  check (image_source in ('segmented', 'cutout', 'photo', 'official'));

-- Existing generated cutouts predate segmentation and were never fidelity-
-- checked; label them 'cutout' so the re-verify audit can find them.
update garments
  set image_source = 'cutout'
  where status = 'cutout_ready' and image_source = 'photo';

-- Extend the status vocabulary with 'cutout_rejected'.
alter table garments drop constraint if exists garments_status_check;
alter table garments add constraint garments_status_check
  check (status in (
    'pending', 'tagged', 'cutout_ready', 'cutout_failed', 'hold', 'cutout_rejected'
  ));
