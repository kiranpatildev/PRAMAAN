"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { SearchInput } from "@/components/ui/Input";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Tag } from "@/components/ui/Tag";
import { Button } from "@/components/ui/Button";
import { unifiedSearch } from "@/lib/endpoints";
import type { SearchHit } from "@/lib/types";

const KIND_TONE = { case: "cyan", evidence: "amber", entity: "green" } as const;

function SearchBody() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits(null);
      setQuery("");
      return;
    }
    setLoading(true);
    setError("");
    const t = setTimeout(() => {
      unifiedSearch(needle)
        .then((d) => {
          setHits(d.results);
          setQuery(d.query);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Search failed"))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const open = (h: SearchHit) => {
    const cid = h.caseId ?? h.case_id;
    router.push(cid ? `/cases/${cid}` : "/cases");
  };

  return (
    <div>
      <PageHeader eyebrow="Retrieval" title="Search" sub="One query across case titles, FIR numbers, evidence filenames and entity labels." />
      <div className="max-w-[560px]">
        <SearchInput
          ref={inputRef}
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="mt-[18px]">
        {error && (
          <Notice variant="warn" action={<Button variant="ghost" small onClick={() => setQ((v) => `${v} `)}>Retry</Button>}>
            {error}
          </Notice>
        )}
        {hits === null && !loading && (
          <Empty
            icon={SearchIcon}
            title="Start typing"
            body="Searches case titles, FIR numbers, evidence filenames and extracted entity labels."
          />
        )}
        {loading && <TableSkeleton rows={6} />}
        {hits !== null && !loading && (
          <>
            <p className="micro mb-[10px]">
              Results for &lsquo;{query}&rsquo; · {hits.length}
            </p>
            <Table<SearchHit & { id: string }>
              columns={[
                {
                  key: "kind",
                  head: "Kind",
                  width: "110px",
                  render: (h) => <Tag tone={KIND_TONE[h.kind] ?? "muted"}>{h.kind}</Tag>,
                },
                {
                  key: "match",
                  head: "Match",
                  width: "36%",
                  render: (h) => <b className="text-[12.5px] font-medium text-fg">{h.label}</b>,
                },
                {
                  key: "context",
                  head: "Context",
                  render: (h) => <span className="text-[12.5px] text-fg-3">{h.sub ?? "—"}</span>,
                },
              ]}
              rows={hits.map((h, i) => ({ ...h, id: `${h.kind}-${i}` }))}
              onRowClick={open}
              actionFor={(h) => (
                <Button variant="ghost" small onClick={() => open(h)}>
                  Open <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
                </Button>
              )}
              empty={
                <div className="p-[14px]">
                  <Empty icon={SearchIcon} title="No matches" body={`Nothing found for '${query}'.`} />
                </div>
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchBody />
    </Suspense>
  );
}
