/** The three sneakers that left the closet: no look may hold them. A leaf module, so every import order works. */
export const DELETED_SNEAKERS = ["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"] as const;
export const DELETED_SET: ReadonlySet<string> = new Set<string>(DELETED_SNEAKERS);
