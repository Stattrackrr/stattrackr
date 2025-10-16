import Navigation from "@/components/navigation";
import Link from "next/link";

export default function Research() {
  return (
    <div>
      <Navigation />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Research</h1>
        </header>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link href="/nba/research/dashboard" target="_blank">
            <div className="bg-white/5 rounded-lg p-6 hover:bg-white/10 transition-colors cursor-pointer">
              <h2 className="text-xl font-semibold mb-2">NBA</h2>
            </div>
          </Link>
          
          <div className="bg-white/5 rounded-lg p-6 hover:bg-white/10 transition-colors cursor-pointer">
            <h2 className="text-xl font-semibold mb-2">NFL</h2>
          </div>
          
          <div className="bg-white/5 rounded-lg p-6 hover:bg-white/10 transition-colors cursor-pointer">
            <h2 className="text-xl font-semibold mb-2">NBL</h2>
          </div>
          
          <div className="bg-white/5 rounded-lg p-6 hover:bg-white/10 transition-colors cursor-pointer">
            <h2 className="text-xl font-semibold mb-2">SOCCER</h2>
          </div>
          
          <div className="bg-white/5 rounded-lg p-6 hover:bg-white/10 transition-colors cursor-pointer">
            <h2 className="text-xl font-semibold mb-2">TENNIS</h2>
          </div>
        </div>
      </div>
    </div>
  );
}
