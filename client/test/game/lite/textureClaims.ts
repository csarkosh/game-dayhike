import { acquireTexture, releaseTexture, type Texture2D } from "@babylonjs/lite";

/** A texture as Lite's claims see one: something that is destroyed once, under a picture that names it. */
export type FakePicture = Texture2D & { readonly texture: GPUTexture & { destroyed: boolean } };

/** A picture of a texture of its own, not yet destroyed. */
export function picture(): FakePicture {
  const texture = {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  };
  return { texture, view: {} } as unknown as FakePicture;
}

/**
 * A material's binding as Lite's shader material makes one when the texture
 * it is given is another: the texture bound is claimed, then the one held
 * before is let go.
 */
export function binder(): (next: Texture2D) => void {
  let held: Texture2D | null = null;
  return (next) => {
    if (next === held) return;
    acquireTexture(next);
    if (held !== null) releaseTexture(held);
    held = next;
  };
}
