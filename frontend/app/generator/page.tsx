"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/utils";
import {
  symgenApi,
  SymGenJob,
  SymGenStatus,
  LinuxDistro,
  UbuntuVersion,
  DebianVersion,
  FedoraVersion,
  CentOSVersion,
  RHELVersion,
  OracleVersion,
  RockyVersion,
  AlmaVersion,
  UbuntuVersionOption,
  DebianVersionOption,
  FedoraVersionOption,
  CentOSVersionOption,
  RHELVersionOption,
  OracleVersionOption,
  RockyVersionOption,
  AlmaVersionOption,
  DistroOption,
  MetricsResponse,
  QueueStatus,
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
  ListOrdered,
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
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "completed" | "failed">("all");
  
  // Distros and versions
  const [distros, setDistros] = useState<DistroOption[]>([]);
  const [ubuntuVersions, setUbuntuVersions] = useState<UbuntuVersionOption[]>([]);
  const [debianVersions, setDebianVersions] = useState<DebianVersionOption[]>([]);
  const [fedoraVersions, setFedoraVersions] = useState<FedoraVersionOption[]>([]);
  const [centosVersions, setCentosVersions] = useState<CentOSVersionOption[]>([]);
  const [rhelVersions, setRhelVersions] = useState<RHELVersionOption[]>([]);
  const [oracleVersions, setOracleVersions] = useState<OracleVersionOption[]>([]);
  const [rockyVersions, setRockyVersions] = useState<RockyVersionOption[]>([]);
  const [almaVersions, setAlmaVersions] = useState<AlmaVersionOption[]>([]);
  
  // Metrics
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  
  // Queue status
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  
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
  
  // Ref to fetchMetrics for use in WebSocket handler without causing re-renders
  const fetchMetricsRef = useRef<(() => Promise<void>) | null>(null);

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === "job_update" && message.job) {
      const updatedJob = message.job as SymGenJob;
      console.log(`[SymGen WS] Received job update:`, updatedJob.id, updatedJob.status);
      setJobs(prev => {
        // Use Map for O(1) lookup instead of findIndex O(n)
        const jobMap = new Map(prev.map((job, i) => [job.id, i]));
        const index = jobMap.get(updatedJob.id);
        if (index !== undefined) {
          const newJobs = [...prev];
          newJobs[index] = { ...updatedJob };
          return newJobs;
        }
        return [{ ...updatedJob }, ...prev];
      });
      
      // Refresh metrics on every job update to keep queue stats current
      fetchMetricsRef.current?.();
      
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

  // Use refs to track current filter and page for polling (avoids stale closure)
  const statusFilterRef = useRef(statusFilter);
  const jobsPageRef = useRef(jobsPage);
  
  useEffect(() => {
    statusFilterRef.current = statusFilter;
  }, [statusFilter]);
  
  useEffect(() => {
    jobsPageRef.current = jobsPage;
  }, [jobsPage]);

  useEffect(() => {
    fetchInitialData();
    
    // Poll for job updates every 3 seconds
    const jobsInterval = setInterval(() => {
      fetchJobs(false, statusFilterRef.current, jobsPageRef.current);
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
      // When page changes, do a full fetch (not merge) to get the new page's data
      // Use statusFilterRef to get current filter value
      fetchJobs(true, statusFilterRef.current, jobsPage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsPage]);

  useEffect(() => {
    if (!isLoading) {
      // When status filter changes, reset to page 1 and fetch with the new filter
      setJobsPage(1);
      // Pass page 1 explicitly since setJobsPage is async
      fetchJobs(true, statusFilter, 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const fetchInitialData = async () => {
    try {
      setIsLoading(true);
      
      // Check Docker status
      const status = await symgenApi.getStatus();
      setDockerAvailable(status.available);
      setDockerMessage(status.message);
      if (status.queue) {
        setQueueStatus(status.queue);
      }
      
      // Get supported distros and versions
      const distrosData = await symgenApi.getDistros();
      setDistros(distrosData.distros);
      setUbuntuVersions(distrosData.ubuntu_versions);
      setDebianVersions(distrosData.debian_versions);
      setFedoraVersions(distrosData.fedora_versions);
      setCentosVersions(distrosData.centos_versions);
      setRhelVersions(distrosData.rhel_versions);
      setOracleVersions(distrosData.oracle_versions);
      setRockyVersions(distrosData.rocky_versions);
      setAlmaVersions(distrosData.alma_versions);
      
      // Fetch jobs and metrics - explicitly pass "all" filter and page 1
      await Promise.all([fetchJobs(true, "all", 1), fetchMetrics()]);
      
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
      const [metricsData, statusData] = await Promise.all([
        symgenApi.getMetrics(),
        symgenApi.getStatus(),
      ]);
      setMetrics(metricsData);
      if (statusData.queue) {
        setQueueStatus(statusData.queue);
      }
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    }
  };

  // Keep ref updated so WebSocket handler can call latest fetchMetrics
  useEffect(() => {
    fetchMetricsRef.current = fetchMetrics;
  });

  const fetchJobs = async (
    isInitialFetch: boolean = false, 
    filterOverride?: "all" | "in_progress" | "completed" | "failed",
    pageOverride?: number
  ) => {
    try {
      // Pass status filter to API (undefined for "all")
      const currentFilter = filterOverride ?? statusFilter;
      const currentPage = pageOverride ?? jobsPageRef.current;
      const apiStatusFilter = currentFilter === "all" ? undefined : currentFilter;
      const response = await symgenApi.listJobs(currentPage, PAGE_SIZE, apiStatusFilter);
      
      if (isInitialFetch) {
        // Full fetch: replace all jobs with fetched data
        setJobs(response.items);
      } else {
        // Polling update: only update status of jobs already displayed on this page
        // Don't add new jobs or change the list - just update existing job statuses
        setJobs(prev => {
          const fetchedMap = new Map(response.items.map(j => [j.id, j]));
          return prev.map(job => fetchedMap.get(job.id) || job);
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
      // Refresh metrics to update stats cards
      fetchMetrics();
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
      // Refresh metrics to update stats cards
      fetchMetrics();
      // Refetch jobs to update pagination if needed
      fetchJobs(true);
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
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" />;
      case "running":
      case "pulling_image":
      case "downloading_kernel":
      case "generating_symbol":
        return <Loader2 className="h-4 w-4 text-blue-500 motion-safe:animate-spin" aria-hidden="true" />;
      default:
        return <Clock className="h-4 w-4 text-amber-500" aria-hidden="true" />;
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

  // Get the version string for a job based on its distro
  const getJobVersion = (job: SymGenJob): string | null => {
    switch (job.distro) {
      case "ubuntu": return job.ubuntu_version ?? null;
      case "debian": return job.debian_version ?? null;
      case "fedora": return job.fedora_version ?? null;
      case "centos": return job.centos_version ?? null;
      case "rhel": return job.rhel_version ?? null;
      case "oracle": return job.oracle_version ?? null;
      case "rocky": return job.rocky_version ?? null;
      case "alma": return job.alma_version ?? null;
      default: return null;
    }
  };

  // Filter jobs by search query only (status filter is done server-side)
  const filteredJobs = searchQuery
    ? jobs.filter(job => {
        const query = searchQuery.toLowerCase();
        const version = getJobVersion(job);
        return (
          job.kernel_version.toLowerCase().includes(query) ||
          job.distro.toLowerCase().includes(query) ||
          (version && version.toLowerCase().includes(query))
        );
      })
    : jobs;

  // Stats - use metrics from API for accurate counts across all pages
  const runningJobs = metrics?.in_progress_jobs ?? jobs.filter(j => isJobInProgress(j.status)).length;
  const completedJobs = metrics?.completed_jobs ?? jobs.filter(j => j.status === "completed").length;
  const failedJobs = metrics?.failed_jobs ?? jobs.filter(j => j.status === "failed").length;

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" richColors />

      <main className="mx-auto max-w-7xl px-4 pt-24 pb-8 sm:px-6 lg:px-8 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary" aria-hidden="true">
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
              {wsConnected ? <Wifi className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}
              {wsConnected ? "Live" : "Polling"}
            </Badge>
            <Button
              onClick={() => setGenerateDialogOpen(true)}
              disabled={!dockerAvailable}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Generate Symbol
            </Button>
          </div>
        </div>
        {error && (
          <Card className="border-red-500/50 bg-red-500/10" role="alert">
            <CardContent className="flex items-center gap-3 py-4">
              <XCircle className="h-5 w-5 text-red-500 shrink-0" aria-hidden="true" />
              <p className="text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Docker Status Banner */}
        {!dockerAvailable && !isLoading && (
          <Card className="border-amber-500/50 bg-amber-500/10" role="alert">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
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
          <div className="flex items-center justify-center py-20" aria-label="Loading…">
            <Loader2 className="h-8 w-8 motion-safe:animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5" aria-hidden="true" />
                    Total Jobs
                  </CardDescription>
                  <CardTitle className="text-2xl font-variant-numeric:tabular-nums">{metrics?.total_jobs ?? jobsTotal}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
                    In Progress
                  </CardDescription>
                  <CardTitle className="text-2xl text-blue-600 tabular-nums">{metrics?.in_progress_jobs ?? runningJobs}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Completed
                  </CardDescription>
                  <CardTitle className="text-2xl text-emerald-600 tabular-nums">{metrics?.completed_jobs ?? completedJobs}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Failed
                  </CardDescription>
                  <CardTitle className="text-2xl text-red-600 tabular-nums">{metrics?.failed_jobs ?? failedJobs}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                    Storage
                  </CardDescription>
                  <CardTitle className="text-2xl">{metrics?.total_storage_formatted ?? "0 B"}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
                    Queue
                  </CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {queueStatus ? (
                      <span className={cn(
                        queueStatus.running >= queueStatus.max_concurrent ? "text-amber-600" : "text-emerald-600"
                      )}>
                        {queueStatus.running}/{queueStatus.max_concurrent}
                      </span>
                    ) : "-"}
                    {queueStatus && queueStatus.queued > 0 && (
                      <span className="text-sm text-muted-foreground ml-1">
                        (+{queueStatus.queued})
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Jobs List */}
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <CardTitle>Generation Jobs</CardTitle>
                      <CardDescription>Track symbol generation progress</CardDescription>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <label htmlFor="search-kernels" className="sr-only">Search kernels</label>
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
                        <input
                          id="search-kernels"
                          type="search"
                          placeholder="Search kernels…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          className="h-9 w-64 rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchJobs(true)}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Refresh
                      </Button>
                    </div>
                  </div>
                  {/* Status Filter Tabs */}
                  <div className="flex items-center gap-2" role="group" aria-label="Filter jobs by status">
                    <Button
                      variant={statusFilter === "all" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setStatusFilter("all")}
                      className="h-8"
                      aria-pressed={statusFilter === "all"}
                    >
                      All
                    </Button>
                    <Button
                      variant={statusFilter === "in_progress" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setStatusFilter("in_progress")}
                      className={cn(
                        "h-8 gap-1.5",
                        statusFilter === "in_progress" && "bg-blue-600 hover:bg-blue-700"
                      )}
                      aria-pressed={statusFilter === "in_progress"}
                    >
                      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
                      In Progress
                      {runningJobs > 0 ? (
                        <span className={cn(
                          "ml-1 rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                          statusFilter === "in_progress" ? "bg-blue-500" : "bg-blue-100 text-blue-700"
                        )}>
                          {runningJobs}
                        </span>
                      ) : null}
                    </Button>
                    <Button
                      variant={statusFilter === "completed" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setStatusFilter("completed")}
                      className={cn(
                        "h-8 gap-1.5",
                        statusFilter === "completed" && "bg-emerald-600 hover:bg-emerald-700"
                      )}
                      aria-pressed={statusFilter === "completed"}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Completed
                      {completedJobs > 0 ? (
                        <span className={cn(
                          "ml-1 rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                          statusFilter === "completed" ? "bg-emerald-500" : "bg-emerald-100 text-emerald-700"
                        )}>
                          {completedJobs}
                        </span>
                      ) : null}
                    </Button>
                    <Button
                      variant={statusFilter === "failed" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setStatusFilter("failed")}
                      className={cn(
                        "h-8 gap-1.5",
                        statusFilter === "failed" && "bg-red-600 hover:bg-red-700"
                      )}
                      aria-pressed={statusFilter === "failed"}
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Failed
                      {failedJobs > 0 ? (
                        <span className={cn(
                          "ml-1 rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                          statusFilter === "failed" ? "bg-red-500" : "bg-red-100 text-red-700"
                        )}>
                          {failedJobs}
                        </span>
                      ) : null}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredJobs.length === 0 ? (
                  <div className="py-16 text-center">
                    <Database className="mx-auto h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
                    <p className="mt-4 text-muted-foreground">
                      {searchQuery || statusFilter !== "all" ? "No matching jobs" : "No generation jobs yet"}
                    </p>
                    {!searchQuery && statusFilter === "all" && (
                      <Button
                        onClick={() => setGenerateDialogOpen(true)}
                        disabled={!dockerAvailable}
                        className="mt-4"
                      >
                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
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
                              <p className="font-semibold font-mono truncate">{job.kernel_version}</p>
                              <Badge variant="secondary" className="capitalize">
                                {job.distro} {getJobVersion(job)}
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
                                {job.symbol_file_size ? (
                                  <span className="text-muted-foreground/70 ml-2">
                                    ({(job.symbol_file_size / 1024 / 1024).toFixed(1)}&nbsp;MB)
                                  </span>
                                ) : null}
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
                                <X className="mr-2 h-4 w-4" aria-hidden="true" />
                                Cancel
                              </Button>
                            )}
                            {job.status === "completed" && job.symbol_filename && (
                              <Button
                                size="sm"
                                asChild
                              >
                                <a href={symgenApi.getDownloadUrl(job.id)} download>
                                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
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
                                aria-label={`Delete job for ${job.kernel_version}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
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

                {/* Pagination - show for server-side filtered results, hide for client-side search */}
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
          fedoraVersions={fedoraVersions}
          centosVersions={centosVersions}
          rhelVersions={rhelVersions}
          oracleVersions={oracleVersions}
          rockyVersions={rockyVersions}
          almaVersions={almaVersions}
          onJobCreated={handleJobCreated}
          queueStatus={queueStatus}
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
  fedoraVersions,
  centosVersions,
  rhelVersions,
  oracleVersions,
  rockyVersions,
  almaVersions,
  onJobCreated,
  queueStatus,
}: {
  open: boolean;
  onClose: () => void;
  distros: DistroOption[];
  ubuntuVersions: UbuntuVersionOption[];
  debianVersions: DebianVersionOption[];
  fedoraVersions: FedoraVersionOption[];
  centosVersions: CentOSVersionOption[];
  rhelVersions: RHELVersionOption[];
  oracleVersions: OracleVersionOption[];
  rockyVersions: RockyVersionOption[];
  almaVersions: AlmaVersionOption[];
  onJobCreated: (job: SymGenJob) => void;
  queueStatus: QueueStatus | null;
}) {
  const [kernelVersion, setKernelVersion] = useState("");
  const [distro, setDistro] = useState<LinuxDistro | "">("");
  const [ubuntuVersion, setUbuntuVersion] = useState<UbuntuVersion | "">("");
  const [debianVersion, setDebianVersion] = useState<DebianVersion | "">("");
  const [fedoraVersion, setFedoraVersion] = useState<FedoraVersion | "">("");
  const [centosVersion, setCentosVersion] = useState<CentOSVersion | "">("");
  const [rhelVersion, setRhelVersion] = useState<RHELVersion | "">("");
  const [oracleVersion, setOracleVersion] = useState<OracleVersion | "">("");
  const [rockyVersion, setRockyVersion] = useState<RockyVersion | "">("");
  const [almaVersion, setAlmaVersion] = useState<AlmaVersion | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bannerInput, setBannerInput] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseMessage, setParseMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const resetVersions = () => {
    setUbuntuVersion("");
    setDebianVersion("");
    setFedoraVersion("");
    setCentosVersion("");
    setRhelVersion("");
    setOracleVersion("");
    setRockyVersion("");
    setAlmaVersion("");
  };

  const handleDistroChange = (value: LinuxDistro) => {
    setDistro(value);
    resetVersions();
  };

  const getSelectedVersion = (): string | null => {
    switch (distro) {
      case "ubuntu": return ubuntuVersion || null;
      case "debian": return debianVersion || null;
      case "fedora": return fedoraVersion || null;
      case "centos": return centosVersion || null;
      case "rhel": return rhelVersion || null;
      case "oracle": return oracleVersion || null;
      case "rocky": return rockyVersion || null;
      case "alma": return almaVersion || null;
      default: return null;
    }
  };

  const handleBannerPaste = async (value: string) => {
    setBannerInput(value);
    setParseMessage(null);
    
    if (!value.trim()) return;
    
    // Auto-detect if it looks like a kernel banner
    const bannerIndicators = ["Linux version", "ubuntu", "debian", "fedora", "centos", "red hat", "rocky", "alma", "oracle", "generic", "amd64", ".fc", ".el"];
    if (bannerIndicators.some(ind => value.toLowerCase().includes(ind.toLowerCase()))) {
      setIsParsing(true);
      try {
        const result = await symgenApi.parseBanner(value);
        if (result.success && result.kernel_version) {
          setKernelVersion(result.kernel_version);
          resetVersions();
          if (result.distro) {
            setDistro(result.distro);
            if (result.ubuntu_version) setUbuntuVersion(result.ubuntu_version);
            if (result.debian_version) setDebianVersion(result.debian_version);
            if (result.fedora_version) setFedoraVersion(result.fedora_version);
            if (result.centos_version) setCentosVersion(result.centos_version);
            if (result.rhel_version) setRhelVersion(result.rhel_version);
            if (result.oracle_version) setOracleVersion(result.oracle_version);
            if (result.rocky_version) setRockyVersion(result.rocky_version);
            if (result.alma_version) setAlmaVersion(result.alma_version);
          }
          const version = result.ubuntu_version || result.debian_version || result.fedora_version || 
                         result.centos_version || result.rhel_version || result.oracle_version ||
                         result.rocky_version || result.alma_version;
          setParseMessage({ 
            type: "success", 
            text: `Detected: ${result.kernel_version} (${result.distro}${version ? ` ${version}` : ""})` 
          });
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
    const version = getSelectedVersion();
    return version !== null && version !== "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid() || isSubmitting) return;

    setIsSubmitting(true);
    const kernel = kernelVersion.trim();
    const selectedDistro = distro as LinuxDistro;
    
    try {
      const job = await symgenApi.generate(kernel, selectedDistro, {
        ubuntuVersion: distro === "ubuntu" ? (ubuntuVersion as UbuntuVersion) : undefined,
        debianVersion: distro === "debian" ? (debianVersion as DebianVersion) : undefined,
        fedoraVersion: distro === "fedora" ? (fedoraVersion as FedoraVersion) : undefined,
        centosVersion: distro === "centos" ? (centosVersion as CentOSVersion) : undefined,
        rhelVersion: distro === "rhel" ? (rhelVersion as RHELVersion) : undefined,
        oracleVersion: distro === "oracle" ? (oracleVersion as OracleVersion) : undefined,
        rockyVersion: distro === "rocky" ? (rockyVersion as RockyVersion) : undefined,
        almaVersion: distro === "alma" ? (almaVersion as AlmaVersion) : undefined,
      });
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
      resetVersions();
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
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-dialog-title"
    >
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
        onClick={onClose}
        aria-hidden="true"
      />
      <Card className="relative z-10 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto overscroll-contain">
        <CardHeader>
          <CardTitle id="generate-dialog-title">Generate Linux Symbol</CardTitle>
          <CardDescription>
            Paste a Volatility banner or enter kernel details manually
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Banner paste area */}
            <div>
              <label htmlFor="kernel-banner" className="text-sm font-medium">Kernel Banner (optional)</label>
              <textarea
                id="kernel-banner"
                value={bannerInput}
                onChange={(e) => handleBannerPaste(e.target.value)}
                placeholder="Paste Volatility banner, e.g.:
Linux version 5.15.0-91-generic (buildd@…) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) …)"
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
              {isParsing && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1" aria-live="polite">
                  <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
                  Parsing banner…
                </p>
              )}
              {parseMessage && (
                <p 
                  className={cn(
                    "text-xs mt-1",
                    parseMessage.type === "success" ? "text-emerald-600" : "text-red-500"
                  )}
                  aria-live="polite"
                >
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
              <label htmlFor="kernel-version" className="text-sm font-medium">Kernel Version</label>
              <input
                id="kernel-version"
                type="text"
                name="kernel_version"
                value={kernelVersion}
                onChange={(e) => setKernelVersion(e.target.value)}
                placeholder="e.g., 5.15.0-91-generic"
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div>
              <label htmlFor="linux-distro" className="text-sm font-medium">Linux Distribution</label>
              <select
                id="linux-distro"
                name="distro"
                value={distro}
                onChange={(e) => handleDistroChange(e.target.value as LinuxDistro)}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select distribution…</option>
                {distros.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            {distro === "ubuntu" && (
              <div>
                <label htmlFor="ubuntu-version" className="text-sm font-medium">Ubuntu Version</label>
                <select
                  id="ubuntu-version"
                  name="ubuntu_version"
                  value={ubuntuVersion}
                  onChange={(e) => setUbuntuVersion(e.target.value as UbuntuVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select Ubuntu version…</option>
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
                <label htmlFor="debian-version" className="text-sm font-medium">Debian Version</label>
                <select
                  id="debian-version"
                  name="debian_version"
                  value={debianVersion}
                  onChange={(e) => setDebianVersion(e.target.value as DebianVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select Debian version…</option>
                  {debianVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {distro === "fedora" && (
              <div>
                <label htmlFor="fedora-version" className="text-sm font-medium">Fedora Version</label>
                <select
                  id="fedora-version"
                  name="fedora_version"
                  value={fedoraVersion}
                  onChange={(e) => setFedoraVersion(e.target.value as FedoraVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select Fedora version…</option>
                  {fedoraVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {distro === "centos" && (
              <div>
                <label htmlFor="centos-version" className="text-sm font-medium">CentOS Version</label>
                <select
                  id="centos-version"
                  name="centos_version"
                  value={centosVersion}
                  onChange={(e) => setCentosVersion(e.target.value as CentOSVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select CentOS version…</option>
                  {centosVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {distro === "rhel" && (
              <div>
                <label htmlFor="rhel-version" className="text-sm font-medium">RHEL Version</label>
                <select
                  id="rhel-version"
                  name="rhel_version"
                  value={rhelVersion}
                  onChange={(e) => setRhelVersion(e.target.value as RHELVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select RHEL version…</option>
                  {rhelVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {distro === "oracle" && (
              <div>
                <label htmlFor="oracle-version" className="text-sm font-medium">Oracle Linux Version</label>
                <select
                  id="oracle-version"
                  name="oracle_version"
                  value={oracleVersion}
                  onChange={(e) => setOracleVersion(e.target.value as OracleVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select Oracle Linux version…</option>
                  {oracleVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {distro === "rocky" && (
              <div>
                <label htmlFor="rocky-version" className="text-sm font-medium">Rocky Linux Version</label>
                <select
                  id="rocky-version"
                  name="rocky_version"
                  value={rockyVersion}
                  onChange={(e) => setRockyVersion(e.target.value as RockyVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select Rocky Linux version…</option>
                  {rockyVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {distro === "alma" && (
              <div>
                <label htmlFor="alma-version" className="text-sm font-medium">AlmaLinux Version</label>
                <select
                  id="alma-version"
                  name="alma_version"
                  value={almaVersion}
                  onChange={(e) => setAlmaVersion(e.target.value as AlmaVersion)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select AlmaLinux version…</option>
                  {almaVersions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Queue status warning */}
            {queueStatus && queueStatus.running >= queueStatus.max_concurrent && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-sm">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Queue is full ({queueStatus.running}/{queueStatus.max_concurrent} running
                  {queueStatus.queued > 0 && `, ${queueStatus.queued} waiting`}).
                  Your job will be queued.
                </span>
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
                    <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                    Starting…
                  </>
                ) : queueStatus && queueStatus.running >= queueStatus.max_concurrent ? (
                  "Add to Queue"
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
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
        onClick={onCancel}
        aria-hidden="true"
      />
      <Card className="relative z-10 w-full max-w-md mx-4 shadow-2xl overscroll-contain">
        <CardHeader>
          <CardTitle id="confirm-dialog-title">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p id="confirm-dialog-description" className="text-muted-foreground">{message}</p>
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
