"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Terminal, Github, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const isGenerator = pathname === "/generator";
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <div className="fixed top-4 left-1/2 z-50 w-full max-w-3xl -translate-x-1/2 px-4">
      <nav className="flex h-14 items-center justify-between rounded-full border bg-background/80 px-6 shadow-lg backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          <span className="font-semibold">Symgen</span>
        </Link>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" aria-hidden="true" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" asChild>
            <a
              href="https://github.com/nxb1t/Symgen"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
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
