import axios from "axios";

// Use relative URLs when in browser (same origin via nginx), or use env var, or default
const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? "" : "http://localhost:8000");

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export type SymGenStatus = "pending" | "pulling_image" | "running" | "downloading_kernel" | "generating_symbol" | "completed" | "failed";
export type LinuxDistro = "ubuntu" | "debian";
export type UbuntuVersion = "20.04" | "22.04" | "24.04";
export type DebianVersion = "10" | "11" | "12";

// Symbol Generation Types
export interface SymGenJob {
  id: number;
  kernel_version: string;
  distro: LinuxDistro;
  ubuntu_version?: UbuntuVersion | null;
  debian_version?: DebianVersion | null;
  status: SymGenStatus;
  status_message?: string | null;
  error_message?: string | null;
  symbol_filename?: string | null;
  symbol_file_size?: number | null;
  download_count: number;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

export interface SymGenListResponse {
  items: SymGenJob[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface GeneratedSymbol {
  id: number;
  kernel_version: string;
  distro: LinuxDistro;
  ubuntu_version?: UbuntuVersion | null;
  debian_version?: DebianVersion | null;
  symbol_filename: string;
  symbol_file_size: number;
  download_count: number;
  created_at: string;
}

export interface SymbolPortalResponse {
  items: GeneratedSymbol[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface KernelParseResponse {
  kernel_version?: string | null;
  distro?: LinuxDistro | null;
  ubuntu_version?: UbuntuVersion | null;
  debian_version?: DebianVersion | null;
  success: boolean;
  message: string;
}

export interface UbuntuVersionOption {
  value: UbuntuVersion;
  label: string;
}

export interface DebianVersionOption {
  value: DebianVersion;
  label: string;
}

export interface DistroOption {
  value: LinuxDistro;
  label: string;
}

export interface DistrosResponse {
  distros: DistroOption[];
  ubuntu_versions: UbuntuVersionOption[];
  debian_versions: DebianVersionOption[];
}

export interface MetricsResponse {
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  in_progress_jobs: number;
  total_symbols: number;
  total_storage_bytes: number;
  total_storage_formatted: string;
  total_downloads: number;
  avg_completion_time_seconds: number | null;
  avg_completion_time_formatted: string | null;
  fastest_job_seconds: number | null;
  slowest_job_seconds: number | null;
}

// Symbol Generation API
export const symgenApi = {
  // Check if Docker/symgen is available
  getStatus: async (): Promise<{ available: boolean; message: string }> => {
    const response = await api.get<{ available: boolean; message: string }>("/api/symgen/status");
    return response.data;
  },

  // Get supported distros and versions
  getDistros: async (): Promise<DistrosResponse> => {
    const response = await api.get<DistrosResponse>("/api/symgen/distros");
    return response.data;
  },

  // Get system metrics
  getMetrics: async (): Promise<MetricsResponse> => {
    const response = await api.get<MetricsResponse>("/api/symgen/metrics");
    return response.data;
  },

  // Get supported Ubuntu versions (legacy)
  getUbuntuVersions: async (): Promise<{ versions: UbuntuVersionOption[] }> => {
    const response = await api.get<{ versions: UbuntuVersionOption[] }>("/api/symgen/ubuntu-versions");
    return response.data;
  },

  // Parse kernel banner
  parseBanner: async (banner: string): Promise<KernelParseResponse> => {
    const response = await api.post<KernelParseResponse>(`/api/symgen/parse-banner?banner=${encodeURIComponent(banner)}`);
    return response.data;
  },

  // Start symbol generation
  generate: async (
    kernelVersion: string,
    distro: LinuxDistro,
    ubuntuVersion?: UbuntuVersion,
    debianVersion?: DebianVersion
  ): Promise<SymGenJob> => {
    const response = await api.post<SymGenJob>("/api/symgen/generate", {
      kernel_version: kernelVersion,
      distro: distro,
      ubuntu_version: ubuntuVersion || null,
      debian_version: debianVersion || null,
    });
    return response.data;
  },

  // List generation jobs
  listJobs: async (page: number = 1, pageSize: number = 10, statusFilter?: SymGenStatus): Promise<SymGenListResponse> => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    if (statusFilter) {
      params.append("status_filter", statusFilter);
    }
    const response = await api.get<SymGenListResponse>(`/api/symgen/jobs?${params.toString()}`);
    return response.data;
  },

  // Get single job
  getJob: async (jobId: number): Promise<SymGenJob> => {
    const response = await api.get<SymGenJob>(`/api/symgen/jobs/${jobId}`);
    return response.data;
  },

  // Cancel job
  cancelJob: async (jobId: number): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<{ success: boolean; message: string }>(`/api/symgen/jobs/${jobId}/cancel`);
    return response.data;
  },

  // Delete job and associated files
  deleteJob: async (jobId: number): Promise<{ success: boolean; message: string }> => {
    const response = await api.delete<{ success: boolean; message: string }>(`/api/symgen/jobs/${jobId}`);
    return response.data;
  },

  // Symbol Portal - List available symbols (public)
  listSymbols: async (
    page: number = 1,
    pageSize: number = 20,
    distro?: LinuxDistro,
    ubuntuVersion?: UbuntuVersion,
    debianVersion?: DebianVersion,
    search?: string
  ): Promise<SymbolPortalResponse> => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    if (distro) {
      params.append("distro", distro);
    }
    if (ubuntuVersion) {
      params.append("ubuntu_version", ubuntuVersion);
    }
    if (debianVersion) {
      params.append("debian_version", debianVersion);
    }
    if (search) {
      params.append("search", search);
    }
    const response = await api.get<SymbolPortalResponse>(`/api/symgen/portal?${params.toString()}`);
    return response.data;
  },

  // Get download URL for symbol
  getDownloadUrl: (jobId: number): string => {
    return `${API_URL}/api/symgen/download/${jobId}`;
  },
};

export default api;
