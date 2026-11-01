// A logo image becomes a 512×512 PNG, fitted whole on a transparent square, so the cards can draw it as a square.
import { FILE_MAX_BYTES } from "../studio/room";

const SIDE = 512;

export async function squareLogo(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Use an image");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This image can't be read");
  });
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.min(SIDE / bitmap.width, SIDE / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
  bitmap.close();
  for (const type of ["image/png", "image/webp"]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92));
    if (blob && blob.size <= FILE_MAX_BYTES) return blob;
  }
  throw new Error("This image is too large");
}
