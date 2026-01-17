# Symgen - Volatility3 Linux Symbol Generator

Automatically generate Volatility3 Linux kernel symbols using Docker containers. Available as both a web application and a native CLI tool.

![Symgen Screenshot](screen.png)

![Symgen CLI](screen2.png)

## Why?

Creating Volatility3 Linux symbols traditionally requires spinning up a Linux VM, identifying the distro from kernel banners, installing matching debug symbols, and repeating the same tedious steps for each kernel. This project fully automates that process using Docker containers to fetch debug symbols and generate Volatility3 compatible JSON symbol files.

There is an excellent collection of pre-built symbols by [Abyss-W4tcher](https://github.com/Abyss-W4tcher/volatility3-symbols). For kernels not in that collection, Symgen can generate them on demand.

Reference: [HackTheBox - How to Create Linux Symbol Tables for Volatility](https://www.hackthebox.com/blog/how-to-create-linux-symbol-tables-volatility)

## Features

- **Multi-distro Support**: Ubuntu, Debian, Fedora, CentOS, RHEL, Oracle Linux, Rocky Linux, AlmaLinux
- **Banner Auto-detection**: Automatically parse kernel banners to detect distro and version
- **CLI Tool**: Native Rust CLI for command-line usage
- **Web Interface**: Browser-based UI with real-time job status updates
- **Docker-based**: Isolated container environments for symbol generation

## Supported Distributions

| Distribution | Versions |
|--------------|----------|
| Ubuntu | 20.04, 22.04, 24.04 |
| Debian | 10, 11, 12 |
| Fedora | 38, 39, 40 |
| CentOS | 7, 8, 9 |
| RHEL | 7, 8, 9 |
| Oracle Linux | 7, 8, 9 |
| Rocky Linux | 8, 9 |
| AlmaLinux | 8, 9 |

## CLI Usage

The CLI is the simplest way to generate symbols locally.

### Installation

```bash
cd cli
cargo build --release
# Binary: cli/target/release/symgen
```

### Generate from Kernel Banner

Pass the kernel banner string directly and Symgen will auto-detect the distribution and version:

```bash
symgen generate -b "Linux version 5.15.0-91-generic (buildd@lcy02-amd64-045) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0) #101-Ubuntu SMP"
```

The banner string can be obtained from:
- `/proc/version` on a live system
- Volatility's `banners.Banners` plugin output
- Memory dump analysis

### Generate with Explicit Parameters

```bash
symgen generate -k <kernel> -d <distro> -r <version> [-o <output-dir>]
```

Examples:

```bash
# Ubuntu 22.04
symgen generate -k 5.15.0-91-generic -d ubuntu -r 22.04

# Debian 12
symgen generate -k 6.1.0-18-amd64 -d debian -r 12

# Fedora 39
symgen generate -k 6.5.6-300.fc39.x86_64 -d fedora -r 39

# RHEL 8
symgen generate -k 4.18.0-513.el8.x86_64 -d rhel -r 8

# Custom output directory
symgen generate -k 5.15.0-91-generic -d ubuntu -r 22.04 -o ./symbols
```

### Output Location

Generated symbol files are saved to:
- **Current directory** by default
- **Custom directory** if `-o/--output-dir` is specified

Filename format: `{Distro}_{version}_{kernel}.json.xz`

Examples:
- `Ubuntu_jammy_5.15.0-91-generic.json.xz`
- `Debian_bookworm_6.1.0-18-amd64.json.xz`
- `Fedora_39_6.5.6-300.fc39.x86_64.json.xz`

### Other CLI Commands

```bash
# List supported distributions and versions
symgen list

# Check Docker availability
symgen check

# JSON output format
symgen --json generate -b "Linux version ..."

# Show help
symgen --help
symgen generate --help
```

## Web Application

### Quick Start with Docker Compose

```bash
git clone https://github.com/nxb1t/Symgen.git
cd Symgen
docker-compose up -d
```

Access the web interface at http://localhost

### Architecture

```
                    +-----------------+
                    |     Nginx       |
                    |   (Port 80)     |
                    +--------+--------+
                             |
            +----------------+----------------+
            |                                 |
   +--------v--------+              +--------v--------+
   |    Frontend     |              |     Backend     |
   |   (Next.js)     |              |   (FastAPI)     |
   |   Port 3000     |              |   Port 8000     |
   +-----------------+              +--------+--------+
                                             |
                              +--------------+---------------+
                              |                              |
                     +--------v--------+            +--------v--------+
                     |   PostgreSQL    |            |     Docker      |
                     |    Database     |            |     Socket      |
                     +-----------------+            +-----------------+
```

### Web Interface Usage

1. Open the web interface at http://localhost
2. Click "Generate Symbol"
3. Enter the kernel version (e.g., `5.15.0-91-generic`)
4. Select the Linux distribution and version
5. Click "Generate"
6. Download the symbol file once generation completes

### Development Setup

**Backend:**

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

## Using Generated Symbols

Copy the `.json.xz` file to your Volatility3 symbols directory:

```bash
cp Ubuntu_jammy_5.15.0-91-generic.json.xz /path/to/volatility3/volatility3/symbols/linux/
```

Then run Volatility3:

```bash
vol -f memory.raw linux.pslist
```

## How It Works

1. Symgen spins up a Docker container with the target Linux distribution
2. Inside the container:
   - Configures package repositories (ddebs, debuginfo, etc.)
   - Downloads kernel debug symbols
   - Downloads [dwarf2json](https://github.com/volatilityfoundation/dwarf2json) from Volatility Foundation
   - Extracts DWARF debug info and generates the JSON symbol file
   - Compresses output with xz
3. The symbol file is saved to the output directory

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/symgen/status` | Check Docker availability |
| GET | `/api/symgen/metrics` | System metrics |
| GET | `/api/symgen/distros` | List supported distros |
| POST | `/api/symgen/generate` | Start symbol generation |
| POST | `/api/symgen/parse-banner` | Parse kernel banner |
| GET | `/api/symgen/jobs` | List all jobs |
| GET | `/api/symgen/jobs/{id}` | Get job details |
| POST | `/api/symgen/jobs/{id}/cancel` | Cancel job |
| DELETE | `/api/symgen/jobs/{id}` | Delete job |
| GET | `/api/symgen/download/{id}` | Download symbol file |
| WS | `/api/symgen/ws` | Real-time job updates |

## Configuration

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/symgen_db` | Database connection |
| `UPLOAD_DIR` | `/app/uploads` | Symbol storage directory |
| `DOCKER_VOLUME_NAME` | `symgen_storage` | Docker volume name |

### Frontend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `` | API URL (empty for same-origin) |

## Troubleshooting

### Docker Not Available

Ensure Docker socket is accessible:

```bash
# Check Docker is running
docker info

# For web app, ensure socket is mounted in docker-compose.yml
```

### Debug Symbols Not Found

Not all kernel versions have debug symbols available in distribution repositories. Try:
- A different kernel version
- Check if the kernel is from backports or a third-party source

### Generation Timeout

Symbol generation typically takes 5-15 minutes. If jobs timeout:
- Check network connectivity (containers need internet access)
- Ensure sufficient disk space (debug symbols can be several GB)

### Volume Not Found Error

If you see "No such file or directory" for generate.sh:

```bash
docker volume create symgen_storage
docker-compose down && docker-compose up -d
```

## License

MIT License
