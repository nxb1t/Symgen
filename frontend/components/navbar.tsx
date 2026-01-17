"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Terminal, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const isGenerator = pathname === "/generator";

  return (
    <div className="fixed top-4 left-1/2 z-50 w-full max-w-3xl -translate-x-1/2 px-4">
      <nav className="flex h-14 items-center justify-between rounded-full border bg-background/80 px-6 shadow-lg backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          <span className="font-semibold">Symgen</span>
        </Link>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="rounded-full" asChild>
            <a
              href="https://github.com/nxb1t/Symgen"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" />
            </a>
          </Button>
          <Button
            size="sm"
            className={cn("rounded-full", isGenerator && "hidden")}
            asChild
          >
            <Link href="/generator">Open App</Link>
          </Button>
        </div>
      </nav>
    </div>
  );
}
