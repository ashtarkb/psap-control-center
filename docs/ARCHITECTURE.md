# PSAP Control Center — Architecture

## Overview

PSAP Control Center is a full-stack cluster management and reservation platform for OpenShift/Kubernetes GPU clusters, built for the Performance and Scale for AI Platforms (PSAP) team.

It provides:

- A **cluster registry** with live health, topology, and workload visibility
- A **reservation system** with full-cluster and partial GPU reservations, type-aware conflict detection, and namespace-level enforcement
- **Dynamic Resource Allocation (DRA)** integration for GPU inventory and allocation tracking
- **Hearth integration** for GPU discovery via FournosCluster CRDs
- A **view-only public mode** and **admin-authenticated write mode**

---

## Hearth vs Control Center — Responsibility Boundary

| Concern | **Hearth** | **PSAP Control Center** |
|---|---|---|
| GPU cluster discovery | Manages `FournosCluster` CRDs on a central management cluster | Reads CRDs via `/api/v1/hearth/clusters` for parallel GPU inventory (clusters must still be added to Control Center manually) |
| Cluster lifecycle | Provisions and decommissions bare-metal/cloud GPU nodes | No lifecycle control — read-only consumer of cluster metadata |
| Hardware inventory | Source of truth for node count, GPU model, driver version | Caches the data locally; refreshes on demand or periodic poll |
| Reservation / scheduling | No concept of reservations | Full ownership: conflict detection, calendar, enforcement |
| Namespace enforcement | N/A | Creates/deletes enforcement namespaces, ResourceQuotas, and ResourceClaimTemplates on managed clusters |
| DRA / GPU allocation | May install DRA drivers as part of provisioning | Reads DRA ResourceSlices/Claims to compute live allocation |
| Authentication | Owns the Hearth API token | Stores the token; uses it for Hearth API calls |

> **Rule of thumb**: Hearth tells Control Center *what exists*; Control Center
> decides *who can use it and when*.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User's Browser                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                     OpenShift Route (TLS)                    │
│     control-center.apps.psap-automation.ibm.rhperfscale.org  │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              psap-control-center-frontend (Pod)              │
│                                                              │
│    nginx-unprivileged:alpine — port 8080                     │
│    ┌────────────────────────────────────────────────────┐    │
│    │  /             → React SPA (static files)          │    │
│    │  /api/*        → reverse proxy                     │    │
│    └──────────────────────────┬─────────────────────────┘    │
└──────────────────────────────┼───────────────────────────────┘
                               │
                     OCP Service (port 8000)
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              psap-control-center-backend (Pod)               │
│                                                              │
│    Python 3.11 / FastAPI / Uvicorn — port 8000               │
│    ┌────────────────────────────────────────────────────┐    │
│    │  /api/v1/health         Health check               │    │
│    │  /api/v1/auth/*         Credential verification    │    │
│    │  /api/v1/clusters/*     Cluster management         │    │
│    │  /api/v1/reservations/* Reservation management     │    │
│    │  /api/v1/hearth/*       Hearth integration         │    │
│    └───────┬──────────────────┬────────────────┬────────┘    │
│            │                  │                │             │
│            ▼                  ▼                ▼             │
│     ┌──────────┐    ┌──────────────┐   ┌────────────┐       │
│     │  SQLite  │    │  Kubeconfigs │   │ Kubernetes │       │
│     │   (PVC)  │    │    (PVC)     │   │  API calls │       │
│     └──────────┘    └──────────────┘   └─────┬──────┘       │
└──────────────────────────────────────────────┼───────────────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                   ┌────────────┐      ┌────────────┐      ┌────────────┐
                   │  OCP       │      │  OCP       │      │  Hearth    │
                   │  Cluster 1 │      │  Cluster 2 │      │  Mgmt      │
                   │  (managed) │      │  (managed) │      │  Cluster   │
                   └────────────┘      └────────────┘      └────────────┘
```

---

## Backend Architecture

### Technology Stack

| Component   | Technology                            |
| ----------- | ------------------------------------- |
| Framework   | FastAPI 0.109                         |
| Server      | Uvicorn (ASGI)                        |
| ORM         | SQLAlchemy 2.0 (async)                |
| Database    | SQLite (dev) / PostgreSQL (prod)      |
| K8s Client  | kubernetes-python 29.0                |
| HTTP Client | httpx 0.26 (for OCP OAuth flows)      |
| Auth        | HTTP Basic Auth                       |
| Logging     | Custom structured logger              |

### Project Structure

```
backend/app/
├── main.py                  # FastAPI app, lifespan, background tasks
├── core/
│   ├── config.py            # Settings (env vars / .env)
│   ├── database.py          # Async engine, session factory, init_db
│   └── auth.py              # require_auth dependency (Basic Auth)
├── models/
│   ├── cluster.py           # Cluster ORM model
│   ├── reservation.py       # Reservation ORM model + status enum
│   └── user.py              # User ORM model (reserved for future use)
├── schemas/
│   ├── cluster.py           # Cluster request/response DTOs
│   ├── reservation.py       # Reservation DTOs with validation
│   └── hearth.py            # Hearth/FournosCluster DTOs
├── services/
│   ├── cluster_service.py      # Cluster CRUD, status refresh
│   ├── reservation_service.py  # Reservations, type-aware conflicts, calendar
│   ├── enforcement_service.py  # Namespace lifecycle, ResourceQuota, DRA templates
│   ├── kubernetes_service.py   # K8s/OCP API wrapper (DRA, GPU allocation, namespace mgmt)
│   └── hearth_service.py       # FournosCluster CRD reader
├── api/
│   ├── __init__.py          # Router aggregation
│   ├── health.py            # GET /health
│   ├── auth.py              # GET /auth/check
│   ├── clusters.py          # Cluster endpoints
│   ├── reservations.py      # Reservation endpoints
│   └── hearth.py            # Hearth endpoints
└── utils/
    └── logger.py            # Structured logging utility
```

### API Surface

All endpoints live under `/api/v1`. OpenAPI docs available at `/docs`.

**Authentication model**: GET endpoints are public (view-only). Most POST, PUT, DELETE endpoints require HTTP Basic Auth (exception: `POST /clusters/{id}/refresh` is public).

#### Cluster Endpoints (`/api/v1/clusters`)

| Method | Path                         | Auth | Description                          |
| ------ | ---------------------------- | ---- | ------------------------------------ |
| GET    | `/`                          | No   | List all clusters                    |
| POST   | `/`                          | Yes  | Create cluster                       |
| GET    | `/{id}`                      | No   | Get cluster detail                   |
| PUT    | `/{id}`                      | Yes  | Update cluster                       |
| DELETE | `/{id}`                      | Yes  | Delete cluster (cascades to reservations) |
| GET    | `/{id}/status`               | No   | Cached status                        |
| POST   | `/{id}/refresh`              | No   | Live refresh from K8s API            |
| POST   | `/{id}/kubeconfig`           | Yes  | Upload kubeconfig file               |
| POST   | `/{id}/login`                | Yes  | Login with OCP credentials           |
| POST   | `/{id}/reauthenticate`       | Yes  | Re-auth expired token                |
| GET    | `/{id}/topology`             | No   | Node topology with GPU details       |
| GET    | `/{id}/gpu-status`           | No   | Live GPU allocation (DRA + legacy)   |
| GET    | `/{id}/ocp-details`          | No   | OpenShift CRs (version, infra, network) |
| GET    | `/{id}/operators`            | No   | Installed OLM operators              |
| GET    | `/{id}/workloads`            | No   | Pods and deployments                 |
| POST   | `/validate-kubeconfig`       | Yes  | Validate kubeconfig without saving   |
| POST   | `/test-credentials`          | Yes  | Test OCP login without saving        |

#### Reservation Endpoints (`/api/v1/reservations`)

| Method | Path                         | Auth | Description                          |
| ------ | ---------------------------- | ---- | ------------------------------------ |
| GET    | `/`                          | No   | List reservations (filterable)       |
| POST   | `/`                          | Yes  | Create reservation (conflict-checked)|
| GET    | `/calendar`                  | No   | Calendar events for date range       |
| GET    | `/cluster/{id}/current`      | No   | Current occupants of a cluster (multi-occupant) |
| GET    | `/{id}`                      | No   | Get reservation detail               |
| PUT    | `/{id}`                      | Yes  | Update reservation                   |
| DELETE | `/{id}`                      | Yes  | Delete reservation                   |
| POST   | `/{id}/cancel`               | Yes  | Cancel reservation                   |

#### Hearth Endpoints (`/api/v1/hearth`)

| Method | Path                         | Auth | Description                          |
| ------ | ---------------------------- | ---- | ------------------------------------ |
| GET    | `/status`                    | No   | Hearth connection status             |
| POST   | `/connect`                   | Yes  | Upload management cluster kubeconfig |
| POST   | `/disconnect`                | Yes  | Remove Hearth connection             |
| GET    | `/clusters`                  | No   | List FournosCluster CRDs             |
| GET    | `/clusters/{name}`           | No   | Get specific FournosCluster          |

### Data Model

```
┌─────────────────────────────────┐
│           clusters              │
├─────────────────────────────────┤
│ id            VARCHAR(36) PK    │
│ name          VARCHAR(255) UQ   │
│ description   TEXT              │
│ kubeconfig_path VARCHAR(500)    │
│ api_server_url  VARCHAR(500)    │
│ status        VARCHAR(50)       │
│ node_count    VARCHAR(50)       │
│ gpu_count     VARCHAR(50)       │
│ gpu_type      VARCHAR(255)     │  ← dominant GPU product name
│ gpu_allocation_mode VARCHAR(20) │  ← "dra" or "legacy"
│ cluster_version VARCHAR(50)     │
│ color         VARCHAR(7)        │
│ tags          JSON              │
│ is_active     BOOLEAN           │
│ last_health_check DATETIME      │
│ created_at    DATETIME          │
│ updated_at    DATETIME          │
├─────────────────┬───────────────┘
│ 1               │
│                 │
│ *               ▼
├─────────────────────────────────┐
│         reservations            │
├─────────────────────────────────┤
│ id            VARCHAR(36) PK    │
│ cluster_id    VARCHAR(36) FK    │  ← nullable (preserved on delete)
│ cluster_name  VARCHAR(255)      │  ← denormalized for history
│ title         VARCHAR(255)      │
│ description   TEXT              │
│ user_name     VARCHAR(255)      │
│ user_email    VARCHAR(255)      │
│ team          VARCHAR(255)      │
│ start_time    DATETIME          │
│ end_time      DATETIME          │
│ reservation_type VARCHAR(20)   │  ← "cluster" or "gpu"
│ gpu_count     INTEGER           │  ← number of GPUs (when type=gpu)
│ enforcement_namespace VARCHAR(255) │ ← K8s namespace name
│ enforcement_status VARCHAR(50) │  ← null/provisioned/error/cleaned
│ purpose       VARCHAR(255)      │
│ notes         TEXT              │
│ color         VARCHAR(7)        │  ← inherited from cluster
│ status        ENUM              │  ← scheduled/active/completed/cancelled
│ created_at    DATETIME          │
│ updated_at    DATETIME          │
└─────────────────────────────────┘
```

**Cascade behavior on cluster delete**: Enforcement namespaces are cleaned up first, then `cluster_id` is set to NULL, `cluster_name` is preserved, and any scheduled/active reservations are cancelled with an auto-generated note.

**Background task**: Every 30 seconds, the backend:
1. Transitions reservation statuses:
   - `scheduled → active` when `start_time` has passed
   - `scheduled/active → completed` when `end_time` has passed
2. Runs the enforcement reconciler:
   - Provisions namespaces + ResourceQuotas for newly active GPU reservations
   - Retries errored provisions
   - Cleans up namespaces for completed/cancelled reservations

### GPU Allocation & DRA

The `KubernetesService.get_gpu_allocation()` method probes GPU availability using a dual-mode strategy:

1. **DRA mode** (preferred): Queries `resource.k8s.io` API for `ResourceSlice` objects (GPU capacity) and `ResourceClaim` objects (allocations). Supports `v1`, `v1beta2`, `v1beta1`.
2. **Legacy mode** (fallback): Counts `nvidia.com/gpu` from node capacity and sums pod resource requests for allocated count.

Both modes support a `gpu-fleet-viewer-config` ConfigMap for vendor abstraction (customizable GPU resource name, product label, memory label, driver version label).

### Namespace Enforcement

When a GPU reservation becomes active:

```text
Reservation ACTIVE (type=gpu)
        │
        ▼
Create namespace: psap-res-{reservation_id[:8]}
        │
        ├── Labels: managed-by, reservation-id, user
        │
        ▼
Apply ResourceQuota: requests.nvidia.com/gpu = {gpu_count}
        │
        ▼
(If DRA available) Create ResourceClaimTemplate with DeviceClass
        │
        ▼
Set enforcement_status = "provisioned"
```

On completion/cancellation, the namespace is deleted (cascading all resources within it).

### Cluster Connectivity

Each managed cluster is accessed via a stored kubeconfig file. Clusters can be added in two ways:

1. **Kubeconfig upload** — a kubeconfig YAML file is parsed, validated, and stored on disk
2. **Credential login** — OCP kubeadmin username/password triggers an OAuth flow that obtains a token, creates a long-lived ServiceAccount (`pasp-control-center` in namespace `pasp-system` with `cluster-admin` role), and generates a kubeconfig

The `KubernetesService` uses isolated `client.Configuration` instances per cluster to prevent race conditions during concurrent access.

### Logging

All backend modules use a standardized structured logger:

```
<datetime> <context>: <level> - <message>
```

Example:
```
2026-05-27 09:04:44.769 Main: INFO - Starting up PSAP Control Center...
2026-05-27 09:04:44.772 KubernetesService: ERROR - Connection timeout
```

Log level is configurable via the `LOG_LEVEL` environment variable (ERROR, WARN, INFO, DEBUG).

---

## Frontend Architecture

### Technology Stack

| Component    | Technology                              |
| ------------ | --------------------------------------- |
| Framework    | React 18                                |
| Language     | TypeScript (strict)                     |
| Build Tool   | Vite 5                                  |
| Routing      | React Router 6                          |
| Data Fetching| TanStack Query (React Query)            |
| HTTP Client  | Axios                                   |
| Styling      | Tailwind CSS                            |
| UI Kit       | Headless UI + Heroicons                 |
| Calendar     | react-big-calendar                      |
| Toasts       | react-hot-toast                         |

### Project Structure

```
frontend/src/
├── main.tsx                 # Entry point, providers, logger init
├── App.tsx                  # Route definitions
├── components/
│   ├── Layout.tsx           # App shell: sidebar, header, auth UI
│   ├── LoginModal.tsx       # Sign-in dialog
│   └── HearthConnectModal.tsx  # Hearth kubeconfig upload
├── pages/
│   ├── Dashboard.tsx        # Stats, reservations, Hearth GPUs
│   ├── Clusters.tsx         # Cluster grid + add modal
│   ├── ClusterDetail.tsx    # Deep cluster view with tabs
│   ├── Reservations.tsx     # Reservation management + mini calendar
│   ├── Calendar.tsx         # Full calendar (month/week/day)
│   ├── Testing.tsx          # Placeholder
│   └── Results.tsx          # Placeholder
├── hooks/
│   ├── useClusters.ts       # Cluster queries + mutations
│   ├── useReservations.ts   # Reservation queries + mutations
│   ├── useGpuStatus.ts      # Live GPU allocation query (per-cluster)
│   └── useHearth.ts         # Hearth queries + mutations
├── services/
│   └── api.ts               # Axios instance + API functions
├── stores/
│   └── authStore.ts         # Credential management (sessionStorage)
├── types/
│   └── index.ts             # Shared TypeScript interfaces
└── utils/
    └── logger.ts            # Structured console logger
```

### Authentication Flow

```
User clicks "Sign In"
        │
        ▼
   LoginModal opens
        │
        ▼
User enters username/password
        │
        ▼
GET /api/v1/auth/check (with Basic Auth header)
        │
   ┌────┴────┐
   │         │
 200 OK    401 Unauthorized
   │         │
   ▼         ▼
Credentials  Toast error
stored in    "Invalid credentials"
sessionStorage
   │
   ▼
auth-change event dispatched
   │
   ▼
Layout re-renders:
  - Header shows username + "Sign Out"
  - Axios interceptor attaches Basic Auth
    header on all non-GET requests
```

Credentials persist for the browser session only (sessionStorage). Closing the tab clears them.

### Data Flow

All data fetching uses TanStack Query with automatic caching, refetching, and cache invalidation on mutations:

- **Cluster status**: polls every 60 seconds
- **Cluster occupancy**: polls every 30 seconds
- **Topology/OCP/operators**: 60-second stale time
- **Workloads**: 30-second stale time

Mutations (create, update, delete) automatically invalidate related query caches and show success/error toasts.

---

## Hearth Integration

Hearth is an external system that manages GPU cluster inventory via Kubernetes Custom Resources.

The integration works by connecting to a **management cluster** that runs the Hearth operator. The backend reads `FournosCluster` CRDs (group `fournos.dev`, version `v1`) from the configured namespace (default: `hearth`).

```
PSAP Control Center Backend
        │
        │ kubernetes-python client
        ▼
Hearth Management Cluster
        │
        ▼
FournosCluster CRDs (namespace: hearth)
  ├── cluster-1: {hardware: {gpus: [...]}, status: {conditions: [...]}}
  ├── cluster-2: ...
  └── cluster-N: ...
```

Hearth data is surfaced in:
- **Dashboard**: GPU summary table
- **Cluster Detail**: matched by cluster name, shows lock status and GPU inventory
- **Layout sidebar**: connection status indicator

---

## Deployment Architecture (OpenShift)

### Target Environment

| Property  | Value                                                          |
| --------- | -------------------------------------------------------------- |
| Cluster   | `psap-automation.ibm.rhperfscale.org`                          |
| Namespace | `psap-control-center`                                          |
| URL       | `https://control-center.apps.psap-automation.ibm.rhperfscale.org` |

### Resource Inventory

| Kind        | Name                               | Purpose                         |
| ----------- | ---------------------------------- | ------------------------------- |
| Secret      | `psap-control-center-admin`        | ADMIN_USERNAME, ADMIN_PASSWORD  |
| Secret      | `psap-control-center-config`       | SECRET_KEY, DATABASE_URL, LOG_LEVEL |
| PVC         | `psap-control-center-data`         | SQLite database (1Gi)           |
| PVC         | `psap-control-center-kubeconfigs`  | Kubeconfig files (100Mi)        |
| BuildConfig | `psap-control-center-backend`      | Binary build from ./backend     |
| BuildConfig | `psap-control-center-frontend`     | Binary build from ./frontend    |
| Deployment  | `psap-control-center-backend`      | FastAPI (port 8000), 1 replica  |
| Deployment  | `psap-control-center-frontend`     | Nginx (port 8080), 1 replica    |
| Service     | `psap-control-center-backend`      | ClusterIP, port 8000            |
| Service     | `psap-control-center-frontend`     | ClusterIP, port 8080            |
| Route       | `psap-control-center`              | Edge TLS termination            |

### Container Images

**Backend**: `python:3.11-slim` with FastAPI/Uvicorn. Built via `oc start-build --from-dir=./backend`. Image stored in the OCP internal registry.

**Frontend**: Multi-stage build — `node:20-alpine` compiles the React app, then `nginxinc/nginx-unprivileged:alpine` serves static files and proxies `/api` to the backend service. Runs as non-root (OCP security requirement).

### Traffic Flow

```
Internet / VPN
      │
      ▼
OCP Router (edge TLS)
      │
      ▼
psap-control-center-frontend (nginx:8080)
      │
      ├── Static files (React SPA)
      │
      └── /api/* → psap-control-center-backend:8000 (reverse proxy)
                      │
                      ├── SQLite DB (PVC: psap-control-center-data)
                      ├── Kubeconfigs (PVC: psap-control-center-kubeconfigs)
                      └── K8s API calls → managed clusters
```

### Rebuilding

After code changes, rebuild and deploy without downtime:

```bash
oc start-build psap-control-center-backend --from-dir=./backend --follow
oc start-build psap-control-center-frontend --from-dir=./frontend --follow
```

Pods restart automatically when new images are pushed to the internal registry.

---

## Configuration

All configuration is via environment variables, loaded by Pydantic Settings:

| Variable                 | Default                           | Description                        |
| ------------------------ | --------------------------------- | ---------------------------------- |
| `SECRET_KEY`             | (change in production)            | Application secret key             |
| `DATABASE_URL`           | `sqlite+aiosqlite:///./psap...db` | Async database URL                 |
| `KUBECONFIG_STORAGE_PATH`| `./kubeconfigs`                   | Directory for kubeconfig files     |
| `ADMIN_USERNAME`         | `admin`                           | Basic Auth username for writes     |
| `ADMIN_PASSWORD`         | `admin`                           | Basic Auth password for writes     |
| `LOG_LEVEL`              | `INFO`                            | Logging level (ERROR/WARN/INFO/DEBUG) |
| `MLFLOW_BASE_URL`        | (optional)                        | MLFlow server for results page     |
| `HEARTH_ENABLED`         | (optional)                        | Enable Hearth integration          |
| `HEARTH_NAMESPACE`       | `hearth`                          | Namespace for FournosCluster CRDs  |
| `HEARTH_KUBECONFIG_PATH` | (optional)                        | Path to management cluster kubeconfig |
| `VITE_LOG_LEVEL`         | `INFO`                            | Frontend log level                 |

On OCP, sensitive values are stored in Kubernetes Secrets and injected as environment variables via `envFrom`.

---

## Local Development

### Prerequisites

- Python 3.9+ with virtualenv
- Node.js 20+
- npm

### Running Locally

```bash
# Backend
cd backend
source venv/bin/activate
LOG_LEVEL=INFO ADMIN_USERNAME=admin ADMIN_PASSWORD=admin \
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Frontend (separate terminal)
cd frontend
npm run dev
```

- Backend: http://localhost:8000 (API docs at /docs)
- Frontend: http://localhost:3000 (Vite proxies /api to :8000)

### Docker Compose

```bash
docker-compose up          # Production build
docker-compose -f docker-compose.dev.yml up  # Dev with hot reload
```

---

## Future / Planned

- **Per-user RBAC**: Fine-grained access control for namespaces and reservations
- **Testing page**: Automated test execution (TOPSAIL, vLLM benchmarks, MLPerf)
- **Results page**: MLFlow integration for test results visualization
- **User model**: Per-user accounts with JWT auth (model and deps exist but are not wired up)
- **PostgreSQL**: Supported by the codebase for multi-replica production deployments
- **Alembic migrations**: Currently using manual ALTER TABLE; planned migration to Alembic for production
