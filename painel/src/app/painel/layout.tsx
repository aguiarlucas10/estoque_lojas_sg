import { TopNav } from "@/components/TopNav";

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className="flex-1">{children}</main>
    </>
  );
}
