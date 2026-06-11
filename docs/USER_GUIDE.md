# PSAP Control Center — User Guide

## Accessing the Application

Open the Control Center in your browser:

**Production (OCP)**: https://control-center.apps.psap-automation.ibm.rhperfscale.org

**Local development**: http://localhost:3000

You can browse everything without signing in. To make changes (add clusters, create reservations, etc.), click **Sign In** in the top-right corner.

## Signing In

1. Click the **Sign In** button in the header
2. Enter the admin username and password
3. Click **Sign In**

Once authenticated, the header shows your username and a **Sign Out** button. Your session lasts until you close the browser tab.

## Dashboard

The Dashboard gives you an overview of:

- **Cluster stats** — total clusters, healthy count, total GPUs, active reservations
- **Active Reservations** — currently in-use clusters with user details, reservation type, and time window
- **Upcoming Reservations** — scheduled for the next 7 days
- **Past Reservations** — completed and cancelled from the last 30 days
- **Hearth GPU Inventory** — GPU types and counts from connected Hearth clusters (if configured)

## Managing Clusters

### Adding a Cluster

1. Go to **Clusters** in the sidebar
2. Click **Add Cluster**
3. Enter a **name** and optional **description**
4. Choose one of two connection methods:

**Kubeconfig Upload:**
- Select the **Kubeconfig File** tab
- Drag and drop your kubeconfig file or click to browse
- The file is validated before saving

**Kubeadmin Credentials:**
- Select the **Kubeadmin Login** tab
- Enter the **API server URL** (e.g., `https://api.cluster.example.com:6443`)
- Enter the **username** (usually `kubeadmin`) and **password**
- The system authenticates via OAuth and creates a service account for persistent access

5. Click **Add Cluster**

The cluster appears in the grid with a health status check running automatically.

### Viewing Cluster Details

Click any cluster card to see:

- **Topology** — visual map of control plane, worker, and infrastructure nodes with GPU details
- **OCP Details** — OpenShift version, platform, network type, ingress domain, available updates
- **Operators** — installed OLM operators and their status
- **Workloads** — running pods and deployments across all namespaces
- **Currently Reserved** — list of active reservations with user, type, GPU count, enforcement namespace, and status

Click any node in the topology view to see detailed specs (CPU, memory, GPU type, OS, kubelet version, IPs).

### Refreshing Cluster Status

On the cluster detail page, click **Refresh** to pull live data from the Kubernetes API. Status also auto-refreshes every 60 seconds.

### Removing a Cluster

1. Go to **Clusters**
2. Click the trash icon on the cluster card
3. Confirm the deletion

This does **not** affect the actual cluster — it only removes it from the Control Center. Any active or scheduled reservations for that cluster are automatically cancelled with a note.

## Managing Reservations

### Reservation Types

You can reserve resources in two ways:

| Type | Description |
| ---- | ----------- |
| **Full Cluster** | Exclusive access to the entire cluster. No other reservations can overlap. |
| **Specific GPUs** | Reserve a number of GPUs on a cluster. Multiple GPU reservations can coexist as long as total demand doesn't exceed capacity. |

### Creating a Reservation

1. Go to **Reservations** in the sidebar
2. Click **New Reservation**
3. Fill in:
   - **Cluster** — select from the dropdown
   - **Reservation Type** — toggle between "Full Cluster" and "Specific GPUs"
   - If "Specific GPUs": enter the **Number of GPUs** you need. After selecting a cluster, the form shows live GPU availability (total, allocated, free) and per-type breakdowns.
   - **Title** — what you're doing (e.g., "vLLM benchmark run")
   - **Your Name**
   - **Team** (optional)
   - **Start Time** and **End Time**
   - **Purpose** (optional — testing, development, demo, etc.)
4. Click **Create Reservation**

Conflict detection is type-aware:
- A full-cluster reservation blocks all other reservations during that time.
- GPU reservations coexist unless the total GPU count exceeds the cluster's capacity.
- GPU reservations conflict with any overlapping full-cluster reservation.

### GPU Namespace Enforcement

> **Note:** Enforcement namespaces are created only for **GPU reservations**, not full-cluster reservations.

When a GPU reservation becomes active, the system automatically:

1. Creates an isolated Kubernetes namespace (e.g., `psap-res-a1b2c3d4`)
2. Applies a `ResourceQuota` limiting GPU usage to the reserved count
3. If the cluster supports DRA (Dynamic Resource Allocation), creates a `ResourceClaimTemplate` for the reserved GPUs

If a GPU reservation's start time is already in the past at creation, the namespace is provisioned immediately. For future reservations, the background task provisions the namespace when the reservation transitions to active (within ~30 seconds of the start time).

The assigned namespace and its enforcement status (`provisioned`, `error`, `cleaned`) appear in the reservation details. Users should deploy their workloads to this namespace to use their reserved GPUs. When the reservation completes, is cancelled, or is deleted, the namespace is automatically cleaned up.

**Important:** The GPU availability shown in the reservation form reflects *live cluster utilization* (actual pods/claims using GPUs). Conflict detection at booking time uses *scheduled reservation totals*. These values may differ — a cluster can show free GPUs while being fully reserved for a future window.

### GPU Allocation Display

Clusters that have GPUs show allocation details in several places:
- **Cluster Detail page** — GPU Allocation card with total/allocated/free breakdown per GPU type, DRA status
- **Dashboard** — fleet-level GPU reservation summary
- **Reservation form** — live availability when creating GPU reservations
- **Reservation tables** — type badge (Cluster/GPU) with GPU count on active and upcoming reservations

### Editing a Reservation

> **Planned feature** — inline editing of reservation details (time, GPU count,
> type) is not yet available in the UI. To change a reservation, cancel the
> existing one and create a new reservation with the updated parameters.

### Cancelling vs Deleting a Reservation

| Action | Available on | Behaviour |
|--------|-------------|-----------|
| **Cancel** | Upcoming/scheduled reservations | Sets status to "Cancelled" with a timestamp and preserves the record for history. Enforcement namespaces are cleaned up immediately. |
| **Delete** | Active, upcoming, and past reservations | Permanently removes the reservation record. Also cleans up any enforcement namespace immediately. |

> **Note:** Active reservations can only be removed via **Delete** (the Cancel button is not shown for active reservations). Delete removes the record entirely. If you need to end an active reservation early while preserving history, you can use the API directly: `POST /api/v1/reservations/{id}/cancel`.

To cancel or delete:
1. Find the reservation in the appropriate list
2. Click the **Cancel** or **Delete** button
3. Confirm the action

### Reservation Statuses

| Status    | Meaning |
| --------- | ------- |
| Scheduled | Reserved for a future time |
| Active    | Currently in use (start time has passed, end time hasn't) |
| Completed | End time has passed |
| Cancelled | Manually cancelled or auto-cancelled (cluster removed) |

Status transitions happen automatically in the background every 30 seconds. The enforcement reconciler also runs on the same cycle to provision namespaces for newly active GPU reservations and clean up completed ones.

## Calendar

### Reservations Page Calendar

The mini weekly calendar at the top of the Reservations page shows hourly slots from 6 AM to 10 PM. Each cluster's reservations are color-coded. Overlapping reservations on different clusters show split views with count badges.

### Full Calendar Page

Go to **Calendar** in the sidebar for month, week, or day views. Use the **cluster filter** dropdown to show reservations for specific clusters.

Reservation colors match their cluster's assigned color for easy identification.

## Hearth Integration

Hearth provides GPU inventory discovery from a management cluster running the Hearth operator.

### Connecting Hearth

1. Click the **Hearth** indicator in the sidebar (or the connect prompt on the Dashboard)
2. Upload the kubeconfig for the Hearth management cluster
3. Once connected, GPU inventory appears on the Dashboard and cluster detail pages

### What Hearth Shows

- **Dashboard** — table of all Hearth-discovered clusters with GPU types and counts
- **Cluster Detail** — if a cluster name matches a Hearth cluster, you'll see its lock status, GPU hardware, and kubeconfig validity

### Disconnecting Hearth

Click the Hearth indicator in the sidebar and choose **Disconnect**. This removes the management cluster kubeconfig. Cluster data in the Control Center is not affected.

## Tips

- **Colors are automatic** — each cluster gets a unique color from a palette. Reservations inherit their cluster's color.
- **Bookmarks** — cluster detail pages have stable URLs (`/clusters/{id}`), so you can bookmark frequently used clusters.
- **API docs** — developers can access the full API at `/docs` (Swagger UI) for scripting or automation.
- **View-only by default** — share the URL with anyone on the team. They can browse without needing credentials.
