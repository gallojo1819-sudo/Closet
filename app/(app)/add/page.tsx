import { Uploader } from "@/components/add/uploader";

export default function AddPage() {
  return (
    <section className="mx-auto w-full max-w-md space-y-8 px-5 pb-28 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div>
        <p className="font-ui text-[11px] uppercase tracking-[0.22em] text-neutral-500">
          Add
        </p>
        <h1 className="mt-2 font-display text-4xl leading-[1.05] text-neutral-100">
          Add a garment
        </h1>
        <p className="mt-3 font-ui text-[15px] leading-relaxed text-neutral-400">
          Photograph or upload pieces — one item or a whole outfit per photo.
          Each is analysed and catalogued automatically.
        </p>
      </div>
      <Uploader />
    </section>
  );
}
