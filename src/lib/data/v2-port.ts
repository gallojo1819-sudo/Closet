/** A look closet_meta just saved. The mirror copies this id; it does not invent one. */
export type V2LookWrite = {
  id: string;
  name: string;
  occasion: string;
  source: string;
  lookbook: boolean;
  garmentIds: string[];
};

/**
 * Side door for garments_v2 / outfits_v2.
 * Closet_meta is already saved before these run. A throw must not undo it.
 * Implementations must not write closet_meta.
 */
export type V2Port = {
  onGarmentRemoved: (id: string) => void | Promise<void>;
  onLookSaved: (look: V2LookWrite) => void | Promise<void>;
  onLookRemoved: (id: string) => void | Promise<void>;
};

let port: V2Port | null = null;

export function setV2Port(next: V2Port | null): void {
  port = next;
}

function fire(result: void | Promise<void>): void {
  if (result && typeof (result as Promise<void>).then === "function") {
    void (result as Promise<void>).catch(() => {});
  }
}

export function notifyGarmentRemoved(id: string): void {
  if (!port) return;
  try {
    fire(port.onGarmentRemoved(id));
  } catch {
    /* a failed mirror must not undo the closet_meta tombstone */
  }
}

export function notifyLookSaved(look: V2LookWrite): void {
  if (!port) return;
  try {
    fire(port.onLookSaved(look));
  } catch {
    /* a failed mirror must not undo the closet_meta save */
  }
}

export function notifyLookRemoved(id: string): void {
  if (!port) return;
  try {
    fire(port.onLookRemoved(id));
  } catch {
    /* a failed mirror must not undo the closet_meta delete */
  }
}
