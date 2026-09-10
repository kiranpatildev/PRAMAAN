import { GlobalSearch } from "@/components/global-search";

export default function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-xl font-bold">Global search</h1>
      <GlobalSearch initial={searchParams.q ?? ""} />
    </div>
  );
}
