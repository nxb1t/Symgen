"use client";

import { useEffect, useState, useCallback } from "react";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/utils";
import {
  symgenApi,
  SymGenJob,
  SymGenStatus,
  LinuxDistro,
  UbuntuVersion,
  DebianVersion,
  UbuntuVersionOption,
  DebianVersionOption,
  DistroOption,
  MetricsResponse,
} from "@/lib/api";
import { useWebSocket, WebSocketMessage } from "@/lib/websocket";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Plus,
  RefreshCw,
  Download,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Wifi,
  WifiOff,
  Search,
  HardDrive,
  Timer,
} from "lucide-react";

const PAGE_SIZE = 10;

export default function SymGenPage() {
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [dockerAvailable, setDockerAvailable] = useState(false);
  const [dockerMessage, setDockerMessage] = useState("");
  
  // Jobs state
  const [jobs, setJobs] = useState<SymGenJob[]>([]);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsTotalPages, setJobsTotalPages] = useState(1);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Distros and versions
  const [distros, setDistros] = useState<DistroOption[]>([]);
  const [ubuntuVersions, setUbuntuVersions] = useState<UbuntuVersionOption[]>([]);
  const [debianVersions, setDebianVersions] = useState<DebianVersionOption[]>([]);
  
  // Metrics
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  
  // Dialogs
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [jobToCancel, setJobToCancel] = useState<SymGenJob | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<SymGenJob | null>(null);
  
  // Handler for when a new job is created
  const handleJobCreated = useCallback((job: SymGenJob) => {
    console.log("[SymGen] Job created:", job);
    setJobs(prev => {
      const newJobs = [job, ...prev.filter(j => j.id !== job.id)];
      return newJobs;
    });
    setJobsTotal(prev => prev + 1);
  }, []);
  
  // WebSocket message handler
  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === "job_update" && message.job) {
      const updatedJob = message.job as SymGenJob;
      console.log(`[SymGen WS] Received job update:`, updatedJob.id, updatedJob.status);
      setJobs(prev => {
        const index = prev.findIndex(j => j.id === updatedJob.id);
        if (index >= 0) {
          const newJobs = prev.map((job, i) => 
            i === index ? { ...updatedJob } : job
          );
          return newJobs;
        } else {
          return [{ ...updatedJob }, ...prev];
        }
      });
      
      // Show toast on completion/failure
      if (updatedJob.status === "completed") {
        toast.success("Symbol generated", {
          description: `${updatedJob.kernel_version} completed successfully`,
        });
      } else if (updatedJob.status === "failed") {
        toast.error("Symbol generation failed", {
          description: updatedJob.error_message || "Unknown error",
        });
      }
    }
  }, []);
  
  // Connect to WebSocket for real-time updates
  const { isConnected: wsConnected } = useWebSocket({
    path: "/api/symgen/ws",
    onMessage: handleWebSocketMessage,
    enabled: !isLoading,
  });
  
  // Track mount state to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetchInitialData();
    
    // Poll for job updates every 3 seconds
    const jobsInterval = setInterval(() => {
      fetchJobs(false);
    }, 3000);
    
    // Poll for metrics every 10 seconds
    const metricsInterval = setInterval(() => {
      fetchMetrics();
    }, 10000);
    
    return () => {
      clearInterval(jobsInterval);
      clearInterval(metricsInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoading) {
      fetchJobs(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsPage]);

  const fetchInitialData = async () => {
    try {
      setIsLoading(true);
      
      // Check Docker status
      const status = await symgenApi.getStatus();
      setDockerAvailable(status.available);
      setDockerMessage(status.message);
      
      // Get supported distros and versions
      const distrosData = await symgenApi.getDistros();
      setDistros(distrosData.distros);
      setUbuntuVersions(distrosData.ubuntu_versions);
      setDebianVersions(distrosData.debian_versions);
      
      // Fetch jobs and metrics
      await Promise.all([fetchJobs(true), fetchMetrics()]);
      
      setError("");
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setError(error.response?.data?.detail || "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const metricsData = await symgenApi.getMetrics();
      setMetrics(metricsData);
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    }
  };

  const fetchJobs = async (isInitialFetch: boolean = false) => {
    try {
      const response = await symgenApi.listJobs(jobsPage, PAGE_SIZE);
      
      if (isInitialFetch) {
        setJobs(response.items);
      } else {
        setJobs(prev => {
          const fetchedMap = new Map(response.items.map(j => [j.id, j]));
          const merged = prev.map(job => fetchedMap.get(job.id) || job);
          const existingIds = new Set(prev.map(j => j.id));
          const newJobs = response.items.filter(j => !existingIds.has(j.id));
          return [...newJobs, ...merged].slice(0, PAGE_SIZE);
        });
      }
      
      setJobsTotalPages(response.total_pages);
      setJobsTotal(response.total);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  };

  const handleCancelJob = async () => {
    if (!jobToCancel) return;
    const cancelledId = jobToCancel.id;
    try {
      await symgenApi.cancelJob(cancelledId);
      setJobs(prev => prev.map(j => 
        j.id === cancelledId 
          ? { ...j, status: "failed" as const, error_message: "Cancelled by user" }
          : j
      ));
      toast.success("Job cancelled");
      setError("");
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      toast.error("Failed to cancel job", {
        description: error.response?.data?.detail || "An error occurred",
      });
    } finally {
      setCancelDialogOpen(false);
      setJobToCancel(null);
    }
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete) return;
    const deletedId = jobToDelete.id;
    try {
      await symgenApi.deleteJob(deletedId);
      setJobs(prev => prev.filter(j => j.id !== deletedId));
      setJobsTotal(prev => Math.max(0, prev - 1));
      toast.success("Job deleted");
      setError("");
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      toast.error("Failed to delete job", {
        description: error.response?.data?.detail || "An error occurred",
      });
    } finally {
      setDeleteDialogOpen(false);
      setJobToDelete(null);
    }
  };

  const getStatusIcon = (status: SymGenStatus) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
      case "pulling_image":
      case "downloading_kernel":
      case "generating_symbol":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-amber-500" />;
    }
  };

  const getStatusColor = (status: SymGenStatus) => {
    switch (status) {
      case "completed":
        return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
      case "failed":
        return "bg-red-500/10 text-red-600 border-red-500/20";
      case "running":
      case "pulling_image":
      case "downloading_kernel":
      case "generating_symbol":
        return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      default:
        return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    }
  };

  const getStatusLabel = (status: SymGenStatus) => {
    switch (status) {
      case "pulling_image":
        return "Pulling Image";
      case "downloading_kernel":
        return "Downloading Kernel";
      case "generating_symbol":
        return "Generating Symbol";
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  const getProgressValue = (status: SymGenStatus) => {
    switch (status) {
      case "pending": return 0;
      case "pulling_image": return 20;
      case "running": return 30;
      case "downloading_kernel": return 50;
      case "generating_symbol": return 80;
      case "completed": return 100;
      case "failed": return 100;
      default: return 0;
    }
  };

  const isJobInProgress = (status: SymGenStatus) => {
    return ["pending", "pulling_image", "running", "downloading_kernel", "generating_symbol"].includes(status);
  };

  // Filter jobs by search query
  const filteredJobs = searchQuery
    ? jobs.filter(job => {
        const query = searchQuery.toLowerCase();
        const version = job.distro === "debian" ? job.debian_version : job.ubuntu_version;
        return (
          job.kernel_version.toLowerCase().includes(query) ||
          job.distro.toLowerCase().includes(query) ||
          (version && version.toLowerCase().includes(query))
        );
      })
    : jobs;

  // Stats
  const runningJobs = jobs.filter(j => isJobInProgress(j.status)).length;
  const completedJobs = jobs.filter(j => j.status === "completed").length;
  const failedJobs = jobs.filter(j => j.status === "failed").length;

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" richColors />

      <main className="mx-auto max-w-7xl px-4 pt-24 pb-8 sm:px-6 lg:px-8 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Database className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Symbol Generator</h1>
              <p className="text-sm text-muted-foreground">Volatility3 Linux Symbols</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={cn(
              "gap-1.5",
              wsConnected ? "border-green-500/50 text-green-600" : "border-muted text-muted-foreground"
            )}>
              {wsConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {wsConnected ? "Live" : "Polling"}
            </Badge>
            <Button
              onClick={() => setGenerateDialogOpen(true)}
              disabled={!dockerAvailable}
            >
              <Plus className="mr-2 h-4 w-4" />
              Generate Symbol
            </Button>
          </div>
        </div>
        {error && (
          <Card className="border-red-500/50 bg-red-500/10">
            <CardContent className="flex items-center gap-3 py-4">
              <XCircle className="h-5 w-5 text-red-500" />
              <p className="text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Docker Status Banner */}
        {!dockerAvailable && !isLoading && (
          <Card className="border-amber-500/50 bg-amber-500/10">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <h3 className="font-semibold text-amber-800 dark:text-amber-200">Docker Not Available</h3>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {dockerMessage || "Symbol generation requires Docker access."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5" />
                    Total Jobs
                  </CardDescription>
                  <CardTitle className="text-2xl">{metrics?.total_jobs ?? jobsTotal}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    In Progress
                  </CardDescription>
                  <CardTitle className="text-2xl text-blue-600">{metrics?.in_progress_jobs ?? runningJobs}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Completed
                  </CardDescription>
                  <CardTitle className="text-2xl text-emerald-600">{metrics?.completed_jobs ?? completedJobs}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5" />
                    Failed
                  </CardDescription>
                  <CardTitle className="text-2xl text-red-600">{metrics?.failed_jobs ?? failedJobs}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" />
                    Storage
                  </CardDescription>
                  <CardTitle className="text-2xl">{metrics?.total_storage_formatted ?? "0 B"}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Timer className="h-3.5 w-3.5" />
                    Avg. Time
                  </CardDescription>
                  <CardTitle className="text-2xl">{metrics?.avg_completion_time_formatted ?? "-"}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Jobs List */}
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <CardTitle>Generation Jobs</CardTitle>
                    <CardDescription>Track symbol generation progress</CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search kernels..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 w-64 rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchJobs(false)}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredJobs.length === 0 ? (
                  <div className="py-16 text-center">
                    <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
                    <p className="mt-4 text-muted-foreground">
                      {searchQuery ? "No matching jobs" : "No generation jobs yet"}
                    </p>
                    {!searchQuery && (
                      <Button
                        onClick={() => setGenerateDialogOpen(true)}
                        disabled={!dockerAvailable}
                        className="mt-4"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Generate Symbol
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredJobs.map((job) => (
                      <div key={job.id} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 flex-wrap">
                              <p className="font-semibold font-mono">{job.kernel_version}</p>
                              <Badge variant="secondary" className="capitalize">
                                {job.distro} {job.distro === "debian" ? job.debian_version : job.ubuntu_version}
                              </Badge>
                              <Badge variant="outline" className={cn(
                                "gap-1.5",
                                getStatusColor(job.status)
                              )}>
                                {getStatusIcon(job.status)}
                                {getStatusLabel(job.status)}
                              </Badge>
                            </div>
                            {job.status_message && isJobInProgress(job.status) && (
                              <p className="text-sm text-muted-foreground mt-1">{job.status_message}</p>
                            )}
                            {job.error_message && job.status === "failed" && (
                              <p className="text-sm text-red-500 mt-1 line-clamp-2">{job.error_message}</p>
                            )}
                            {job.symbol_filename && job.status === "completed" && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {job.symbol_filename}
                                {job.symbol_file_size && (
                                  <span className="text-muted-foreground/70 ml-2">
                                    ({(job.symbol_file_size / 1024 / 1024).toFixed(1)} MB)
                                  </span>
                                )}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-2">
                              Created {new Date(job.created_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isJobInProgress(job.status) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setJobToCancel(job);
                                  setCancelDialogOpen(true);
                                }}
                              >
                                <X className="mr-2 h-4 w-4" />
                                Cancel
                              </Button>
                            )}
                            {job.status === "completed" && job.symbol_filename && (
                              <Button
                                size="sm"
                                asChild
                              >
                                <a href={symgenApi.getDownloadUrl(job.id)} download>
                                  <Download className="mr-2 h-4 w-4" />
                                  Download
                                </a>
                              </Button>
                            )}
                            {(job.status === "completed" || job.status === "failed") && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setJobToDelete(job);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {isJobInProgress(job.status) && (
                          <div className="mt-3">
                            <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                              <div 
                                className="h-full bg-primary transition-all duration-500"
                                style={{ width: `${getProgressValue(job.status)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {jobsTotalPages > 1 && !searchQuery && (
                  <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {jobsPage} of {jobsTotalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setJobsPage(p => Math.max(1, p - 1))}
                        disabled={jobsPage === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setJobsPage(p => Math.min(jobsTotalPages, p + 1))}
                        disabled={jobsPage === jobsTotalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      {/* Generate Dialog */}
      {generateDialogOpen && (
        <GenerateDialog
          open={generateDialogOpen}
          onClose={() => setGenerateDialogOpen(false)}
          distros={distros}
          ubuntuVersions={ubuntuVersions}
          debianVersions={debianVersions}
          onJobCreated={handleJobCreated}
        />
      )}

      {/* Cancel Confirmation Dialog */}
      {cancelDialogOpen && jobToCancel && (
        <ConfirmDialog
          title="Cancel Generation"
          message={`Are you sure you want to cancel the symbol generation for kernel ${jobToCancel.kernel_version}?`}
          confirmLabel="Cancel Job"
          onConfirm={handleCancelJob}
          onCancel={() => {
            setCancelDialogOpen(false);
            setJobToCancel(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteDialogOpen && jobToDelete && (
        <ConfirmDialog
          title="Delete Job"
          message={`Are you sure you want to delete the job for kernel ${jobToDelete.kernel_version}?${jobToDelete.status === "completed" ? " This will also delete the generated symbol file." : ""}`}
          confirmLabel="Delete"
          onConfirm={handleDeleteJob}
          onCancel={() => {
            setDeleteDialogOpen(false);
            setJobToDelete(null);
          }}
        />
      )}
    </div>
  );
}

// Generate Dialog Component
function GenerateDialog({
  open,
  onClose,
  distros,
  ubuntuVersions,
  debianVersions,
  onJobCreated,
}: {
  open: boolean;
  onClose: () => void;
  distros: DistroOption[];
  ubuntuVersions: UbuntuVersionOption[];
  debianVersions: DebianVersionOption[];
  onJobCreated: (job: SymGenJob) => void;
}) {
  const [kernelVersion, setKernelVersion] = useState("");
  const [distro, setDistro] = useState<LinuxDistro | "">("");
  const [ubuntuVersion, setUbuntuVersion] = useState<UbuntuVersion | "">("");
  const [debianVersion, setDebianVersion] = useState<DebianVersion | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bannerInput, setBannerInput] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseMessage, setParseMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleDistroChange = (value: LinuxDistro) => {
    setDistro(value);
    setUbuntuVersion("");
    setDebianVersion("");
  };

  const handleBannerPaste = async (value: string) => {
    setBannerInput(value);
    setParseMessage(null);
    
    if (!value.trim()) return;
    
    // Auto-detect if it looks like a kernel banner
    if (value.includes("Linux version") || value.includes("ubuntu") || value.includes("debian") || value.includes("generic") || value.includes("amd64")) {
      setIsParsing(true);
      try {
        const result = await symgenApi.parseBanner(value);
        if (result.success && result.kernel_version) {
          setKernelVersion(result.kernel_version);
          if (result.distro) {
            setDistro(result.distro);
            if (result.distro === "ubuntu" && result.ubuntu_version) {
              setUbuntuVersion(result.ubuntu_version);
            } else if (result.distro === "debian" && result.debian_version) {
              setDebianVersion(result.debian_version);
            }
          }
          setParseMessage({ type: "success", text: `Detected: ${result.kernel_version} (${result.distro}${result.ubuntu_version ? ` ${result.ubuntu_version}` : ""}${result.debian_version ? ` ${result.debian_version}` : ""})` });
        } else {
          setParseMessage({ type: "error", text: result.message || "Could not parse banner" });
        }
      } catch {
        setParseMessage({ type: "error", text: "Failed to parse banner" });
      } finally {
        setIsParsing(false);
      }
    }
  };

  const isFormValid = () => {
    if (!kernelVersion.trim() || !distro) return false;
    if (distro === "ubuntu" && !ubuntuVersion) return false;
    if (distro === "debian" && !debianVersion) return false;
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid() || isSubmitting) return;

    setIsSubmitting(true);
    const kernel = kernelVersion.trim();
    const selectedDistro = distro as LinuxDistro;
    const ubuntu = distro === "ubuntu" ? (ubuntuVersion as UbuntuVersion) : undefined;
    const debian = distro === "debian" ? (debianVersion as DebianVersion) : undefined;
    
    try {
      const job = await symgenApi.generate(kernel, selectedDistro, ubuntu, debian);
      onJobCreated(job);
      
      // Check if this is an existing completed job (API returns it instead of creating new)
      if (job.status === "completed") {
        toast.success("Symbol already exists", {
          description: `${kernel} symbol is ready for download`,
        });
      } else {
        toast.success("Symbol generation started", {
          description: `Generating symbol for kernel ${kernel}`,
        });
      }
      
      onClose();
      setKernelVersion("");
      setDistro("");
      setUbuntuVersion("");
      setDebianVersion("");
      setBannerInput("");
      setParseMessage(null);
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { detail?: string } } };
      
      if (error.response?.status === 409) {
        // Job already in progress
        toast.error("Job already in progress", {
          description: error.response.data?.detail || "A job for this kernel is already running",
        });
      } else {
        toast.error("Failed to start generation", {
          description: error.response?.data?.detail || "An error occurred",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-md mx-4 shadow-2xl">
        <CardHeader>
          <CardTitle>Generate Linux Symbol</CardTitle>
          <CardDescription>
            Paste a Volatility banner or enter kernel details manually
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Banner paste area */}
            <div>
              <label className="text-sm font-medium">Kernel Banner (optional)</label>
              <textarea
                value={bannerInput}
                onChange={(e) => handleBannerPaste(e.target.value)}
                placeholder='Paste Volatility banner, e.g.:&#10;Linux version 5.15.0-91-generic (buildd@...) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) ...)'
                className="mt-1.5 h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              {isParsing && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Parsing banner...
                </p>
              )}
              {parseMessage && (
                <p className={cn(
                  "text-xs mt-1",
                  parseMessage.type === "success" ? "text-emerald-600" : "text-red-500"
                )}>
                  {parseMessage.text}
                </p>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or enter manually</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Kernel Version</label>
              <input
                type="text"
                value={kernelVersion}
                onChange={(e) => setKernelVersion(e.target.value)}
                placeholder="e.g., 5.15.0-91-generic"
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Linux Distribution</label>
              <select
                value={distro}
                onChange={(e) => handleDistroChange(e.target.value as LinuxDistro)}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select distribution</option>
                {distros.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            {distro === "ubuntu" && (
              <div>
                <label className="text-sm font-medium">Ubuntu Version</label>
                <select
                  value={ubuntuVersion}
                  onChange={(e) => setUbuntuVersion(e.target.value as UbuntuVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select Ubuntu version</option>
                  {ubuntuVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {distro === "debian" && (
              <div>
                <label className="text-sm font-medium">Debian Version</label>
                <select
                  value={debianVersion}
                  onChange={(e) => setDebianVersion(e.target.value as DebianVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select Debian version</option>
                  {debianVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!isFormValid() || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "Generate"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// Confirm Dialog Component
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <Card className="relative z-10 w-full max-w-md mx-4 shadow-2xl">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{message}</p>
        </CardContent>
        <div className="flex justify-end gap-3 px-6 pb-6">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
