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
  Shield,
  Globe,
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
  {
    icon: Globe,
    title: "Multi-Distro Support",
    description:
      "Support for Ubuntu, Debian, Fedora, CentOS, RHEL, Oracle, Rocky, and AlmaLinux.",
  },
  {
    icon: Shield,
    title: "Banner Parsing",
    description:
      "Paste a Volatility kernel banner and auto-detect distro and version.",
  },
];

const stats = [
  { label: "Distributions", value: "8" },
  { label: "Distro Versions", value: "20+" },
  { label: "Avg. Generation", value: "~5 min" },
];

const supportedDistros = [
  { name: "Ubuntu", versions: "20.04, 22.04, 24.04" },
  { name: "Debian", versions: "10, 11, 12" },
  { name: "Fedora", versions: "38, 39, 40" },
  { name: "CentOS", versions: "7, 8, 9" },
  { name: "RHEL", versions: "8, 9" },
  { name: "Oracle", versions: "8, 9" },
  { name: "Rocky", versions: "8, 9" },
  { name: "Alma", versions: "8, 9" },
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
      aria-hidden="true"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  symgen: () => <Terminal className="size-6" aria-hidden="true" />,
  ubuntu: () => (
    <svg width="24" height="24" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="128" cy="128" r="120" fill="#E95420" />
      <circle cx="128" cy="128" r="44" fill="none" stroke="#FFF" strokeWidth="18" />
      <circle cx="128" cy="44" r="22" fill="#FFF" />
      <circle cx="55" cy="172" r="22" fill="#FFF" />
      <circle cx="201" cy="172" r="22" fill="#FFF" />
      <path d="M150 128h56" stroke="#FFF" strokeWidth="18" strokeLinecap="round" />
      <path d="M104 91l-28-48" stroke="#FFF" strokeWidth="18" strokeLinecap="round" />
      <path d="M104 165l-28 48" stroke="#FFF" strokeWidth="18" strokeLinecap="round" />
    </svg>
  ),
  debian: () => (
    <svg width="24" height="24" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="128" cy="128" r="120" fill="#A80030" />
      <path
        d="M148 68c-8-2-16-2-24 0-32 8-54 38-54 72 0 42 34 76 76 76 8 0 16-2 24-4-36 8-72-16-80-52-8-36 16-72 52-80 4-2 8-2 6-12z"
        fill="#FFF"
      />
      <path
        d="M156 84c20 12 32 34 32 58 0 12-4 24-10 34 8-12 12-26 12-40 0-22-14-42-34-52z"
        fill="#FFF"
        opacity="0.6"
      />
    </svg>
  ),
  fedora: () => (
    <svg width="24" height="24" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="128" cy="128" r="120" fill="#51A2DA" />
      <path
        d="M80 96h48c18 0 32 14 32 32v48h-32v-48h-48v-32z"
        fill="#FFF"
      />
      <path
        d="M128 128v48h32v-48c0-18-14-32-32-32h-48v32h48z"
        fill="#294172"
      />
      <circle cx="128" cy="128" r="16" fill="#FFF" />
    </svg>
  ),
  centos: () => (
    <svg width="24" height="24" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <polygon points="128,8 248,128 128,248 8,128" fill="none" stroke="#262577" strokeWidth="16" />
      <polygon points="128,48 128,128 68,128 68,68" fill="#9CCD2A" />
      <polygon points="128,48 128,128 188,128 188,68" fill="#262577" />
      <polygon points="128,208 128,128 68,128 68,188" fill="#CF7C00" />
      <polygon points="128,208 128,128 188,128 188,188" fill="#932178" />
      <polygon points="128,68 168,128 128,188 88,128" fill="#FFF" />
    </svg>
  ),
  rocky: () => (
    <svg width="24" height="24" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="128" cy="128" r="120" fill="#10B981" />
      <path
        d="M80 180l-20-80 60 20 48-60 28 100-116 20z"
        fill="#FFF"
        opacity="0.9"
      />
      <path
        d="M100 140l20-40 30 10 18-30 12 50-80 10z"
        fill="#10B981"
      />
    </svg>
  ),
  oracle: () => (
    <svg width="24" height="24" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="128" cy="128" r="120" fill="#F80000" />
      <rect x="48" y="96" width="160" height="64" rx="32" fill="#FFF" />
      <rect x="72" y="112" width="112" height="32" rx="16" fill="#F80000" />
    </svg>
  ),
};

function PlatformFlow({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const symgenRef = useRef<HTMLDivElement>(null);
  const ubuntuRef = useRef<HTMLDivElement>(null);
  const debianRef = useRef<HTMLDivElement>(null);
  const fedoraRef = useRef<HTMLDivElement>(null);
  const centosRef = useRef<HTMLDivElement>(null);
  const rockyRef = useRef<HTMLDivElement>(null);
  const oracleRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn(
        "relative flex h-[500px] w-full items-center justify-center overflow-hidden rounded-lg border bg-background p-10",
        className
      )}
      ref={containerRef}
    >
      <div className="flex size-full max-w-lg flex-row items-stretch justify-between gap-10">
        {/* Left - User */}
        <div className="flex flex-col justify-center">
          <Circle ref={userRef}>
            <Icons.user />
          </Circle>
        </div>

        {/* Center - Symgen */}
        <div className="flex flex-col justify-center">
          <Circle ref={symgenRef} className="size-16">
            <Icons.symgen />
          </Circle>
        </div>

        {/* Right - Distributions (vertical stack like the example) */}
        <div className="flex flex-col justify-center gap-2">
          <Circle ref={ubuntuRef}>
            <Icons.ubuntu />
          </Circle>
          <Circle ref={debianRef}>
            <Icons.debian />
          </Circle>
          <Circle ref={fedoraRef}>
            <Icons.fedora />
          </Circle>
          <Circle ref={centosRef}>
            <Icons.centos />
          </Circle>
          <Circle ref={rockyRef}>
            <Icons.rocky />
          </Circle>
          <Circle ref={oracleRef}>
            <Icons.oracle />
          </Circle>
        </div>
      </div>

      {/* AnimatedBeams - from distros to symgen, then symgen to user */}
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={ubuntuRef}
        toRef={symgenRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={debianRef}
        toRef={symgenRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={fedoraRef}
        toRef={symgenRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={centosRef}
        toRef={symgenRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={rockyRef}
        toRef={symgenRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={oracleRef}
        toRef={symgenRef}
        duration={3}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={symgenRef}
        toRef={userRef}
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
          className="text-4xl font-bold tracking-tight sm:text-5xl text-balance"
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
          Generate kernel symbol files for Linux memory forensics. Enter a kernel
          version or paste a Volatility banner, and Symgen handles the rest.
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
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
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

      {/* Supported Distributions */}
      <section className="border-t bg-muted/30 py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-balance">
              Supported Distributions
            </h2>
            <p className="mt-3 text-muted-foreground">
              Generate symbols for all major Linux distributions.
            </p>
          </div>

          <motion.div
            className="mt-12 grid gap-4 sm:grid-cols-3"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            {supportedDistros.map((distro, index) => (
              <motion.div
                key={distro.name}
                className="flex items-center gap-4 rounded-lg border bg-card p-4"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                viewport={{ once: true }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
                  <Terminal className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="font-medium">{distro.name}</div>
                  <div className="text-sm text-muted-foreground">{distro.versions}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-balance">
              Features
            </h2>
            <p className="mt-3 text-muted-foreground">
              Everything you need for Linux memory forensics.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                className="rounded-lg border bg-card p-6"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <feature.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-muted/30 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <motion.h2
            className="text-2xl font-bold tracking-tight sm:text-3xl text-balance"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            Ready to Generate Symbols?
          </motion.h2>
          <motion.p
            className="mt-4 text-muted-foreground"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            viewport={{ once: true }}
          >
            Start generating Volatility3 symbol files for your forensic investigations.
          </motion.p>
          <motion.div
            className="mt-8"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            viewport={{ once: true }}
          >
            <Button size="lg" asChild>
              <Link href="/generator">
                Go to Generator
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
