import { Uploader } from "@/components/add/uploader";

export default function AddPage() {
  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 pb-24 pt-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Add a Garment</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Photograph or upload pieces to add them to your wardrobe. Each photo
          is analyzed and its garments catalogued automatically.
        </p>
      </div>
      <Uploader />
    </section>
  );
}
