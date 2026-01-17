"use client";

import Link from "next/link";
import React, { forwardRef, useRef } from "react";
import { motion } from "motion/react";
import {
  Terminal,
  Cpu,
  Download,
  Zap,
  ArrowRight,
  Box,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { cn } from "@/lib/utils";

const fadeIn = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

const features = [
  {
    icon: Cpu,
    title: "Automated Generation",
    description:
      "Extract DWARF symbols and generate Volatility3-compatible JSON profiles automatically.",
  },
  {
    icon: Box,
    title: "Docker Isolation",
    description:
      "Safely process kernel debug packages in isolated Docker containers.",
  },
  {
    icon: Zap,
    title: "Real-time Updates",
    description:
      "Track generation progress with live WebSocket status updates.",
  },
  {
    icon: Download,
    title: "Easy Downloads",
    description:
      "Download compressed XZ symbol files instantly after generation.",
  },
];

const stats = [
  { label: "Distributions", value: "6+" },
  { label: "Kernel Versions", value: "100+" },
  { label: "Avg. Generation", value: "~5 min" },
];

const Circle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode }
>(({ className, children }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "z-10 flex size-12 items-center justify-center rounded-full border-2 bg-background p-3 shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)]",
        className
      )}
    >
      {children}
    </div>
  );
});

Circle.displayName = "Circle";

const Icons = {
  user: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  symgen: () => (
    <Terminal className="size-6" />
  ),
  ubuntu: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" stroke="#E95420" strokeWidth="2" />
      <circle cx="12" cy="5" r="2" fill="#E95420" />
      <circle cx="5.5" cy="15.5" r="2" fill="#E95420" />
      <circle cx="18.5" cy="15.5" r="2" fill="#E95420" />
      <circle cx="12" cy="12" r="3" stroke="#E95420" strokeWidth="1.5" />
    </svg>
  ),
  debian: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
        fill="#A80030"
      />
      <path
        d="M13.5 7c-1.5 0-3 .8-3.8 2.2-.5.9-.7 1.9-.7 2.8 0 2.8 2.2 5 5 5 .5 0 1-.1 1.5-.2-.3.1-.7.2-1 .2-2.2 0-4-1.8-4-4 0-.7.2-1.4.5-2 .6-1.1 1.8-1.8 3-1.8.3 0 .5 0 .8.1-.4-.2-.9-.3-1.3-.3z"
        fill="#A80030"
      />
    </svg>
  ),
};

function PlatformFlow({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const symgenRef = useRef<HTMLDivElement>(null);
  const ubuntuRef = useRef<HTMLDivElement>(null);
  const debianRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn(
        "relative flex h-[350px] w-full items-center justify-center overflow-hidden rounded-lg border bg-background p-10",
        className
      )}
      ref={containerRef}
    >
      <div className="flex size-full max-w-lg flex-row items-stretch justify-between gap-10">
        {/* Left - User */}
        <div className="flex flex-col items-center justify-center gap-2">
          <Circle ref={userRef}>
            <Icons.user />
          </Circle>
          <span className="text-sm font-medium">User</span>
        </div>

        {/* Center - Symgen */}
        <div className="flex flex-col items-center justify-center gap-2">
          <Circle ref={symgenRef} className="size-16">
            <Icons.symgen />
          </Circle>
          <span className="text-sm font-medium">Symgen</span>
        </div>

        {/* Right - Distributions */}
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Circle ref={ubuntuRef}>
              <Icons.ubuntu />
            </Circle>
            <span className="text-xs text-muted-foreground">Ubuntu</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Circle ref={debianRef}>
              <Icons.debian />
            </Circle>
            <span className="text-xs text-muted-foreground">Debian</span>
          </div>
        </div>
      </div>

      {/* AnimatedBeams */}
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={userRef}
        toRef={symgenRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={symgenRef}
        toRef={ubuntuRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={symgenRef}
        toRef={debianRef}
        duration={3}
      />
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-28 pb-24 text-center">
        <motion.h1
          className="text-4xl font-bold tracking-tight sm:text-5xl"
          initial="hidden"
          animate="visible"
          variants={fadeIn}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          Volatility3 Symbol Generator
        </motion.h1>

        <motion.p
          className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
          initial="hidden"
          animate="visible"
          variants={fadeIn}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          Generate kernel symbol files for memory forensics. Enter a kernel
          version, and Symgen handles the rest.
        </motion.p>

        <motion.div
          className="mt-10 flex items-center justify-center gap-4"
          initial="hidden"
          animate="visible"
          variants={fadeIn}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Button size="lg" asChild>
            <Link href="/generator">
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a href="#features">Learn More</a>
          </Button>
        </motion.div>

        {/* Stats */}
        <motion.div
          className="mt-16 flex items-center justify-center gap-12"
          initial="hidden"
          animate="visible"
          variants={fadeIn}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </section>

      {/* Platform Flow Animation */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
        >
          <PlatformFlow />
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="border-t bg-muted/30 py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Features
            </h2>
            <p className="mt-3 text-muted-foreground">
              Everything you need for Linux memory forensics.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                className="rounded-lg border bg-card p-6"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <feature.icon className="h-5 w-5 text-muted-foreground" />
                <h3 className="mt-4 font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
