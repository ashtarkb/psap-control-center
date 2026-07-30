import csv
import io
import os
import re
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings
from app.utils.logger import create_logger

logger = create_logger("BillingCsvService")

HEADER_SKIP_LINES = 3
_BILLING_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


class BillingCsvServiceError(Exception):
    pass


class ClusterCostResult:
    def __init__(
        self,
        currency: str,
        billing_month: str,
        total_cost: float,
        node_breakdown: List[Dict[str, Any]],
        unmatched_line_items: List[Dict[str, Any]],
    ):
        self.currency = currency
        self.billing_month = billing_month
        self.total_cost = total_cost
        self.node_breakdown = node_breakdown
        self.unmatched_line_items = unmatched_line_items


def parse_billing_csv(file_path: str) -> List[Dict[str, Any]]:
    """Parse an IBM Cloud billing CSV export, skipping the 3-line metadata header."""
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    if len(lines) <= HEADER_SKIP_LINES:
        return []

    reader = csv.DictReader(io.StringIO("".join(lines[HEADER_SKIP_LINES:])))
    return list(reader)


def extract_billing_month(file_path: str) -> Optional[str]:
    """Read the billing month from the CSV metadata header (line 2, column 3)."""
    with open(file_path, "r", encoding="utf-8") as f:
        lines = [f.readline() for _ in range(2)]

    if len(lines) < 2:
        return None

    reader = csv.reader(io.StringIO(lines[1]))
    row = next(reader, None)
    if row and len(row) >= 3 and _BILLING_MONTH_RE.match(row[2]):
        return row[2]
    return None


def _extract_billing_month_from_content(content: str) -> Optional[str]:
    """Read the billing month from CSV content string."""
    lines = content.split("\n", 2)
    if len(lines) < 2:
        return None
    reader = csv.reader(io.StringIO(lines[1]))
    row = next(reader, None)
    if row and len(row) >= 3 and _BILLING_MONTH_RE.match(row[2]):
        return row[2]
    return None


def get_cluster_cost_from_rows(
    infra_id: str,
    rows: List[Dict[str, Any]],
    billing_month: str,
) -> Tuple[float, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Filter and aggregate costs for a cluster by infra_id prefix match on Instance Name.
    Returns (total_cost, node_breakdown, unmatched_infra_items)."""
    instance_costs: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        instance_name = row.get("Instance Name") or ""
        idx = instance_name.find(infra_id)
        if idx == -1:
            continue
        end = idx + len(infra_id)
        if end < len(instance_name) and instance_name[end] not in ("-", "_"):
            continue

        try:
            cost = float(row.get("Cost") or 0)
        except (ValueError, TypeError):
            continue
        if cost == 0:
            continue

        service = row.get("Service Name") or ""
        if instance_name not in instance_costs:
            instance_costs[instance_name] = {
                "instance_name": instance_name,
                "service": service,
                "cost": 0.0,
            }
        instance_costs[instance_name]["cost"] += cost

    node_breakdown = []
    unmatched = []
    for entry in instance_costs.values():
        name = entry["instance_name"]
        is_node = any(
            pattern in name
            for pattern in ["master-", "worker-", "gpu-", "storage-"]
        )
        if is_node:
            node_breakdown.append({
                "node": name,
                "instance_name": name,
                "cost": round(entry["cost"], 2),
                "service": entry["service"],
            })
        else:
            unmatched.append({
                "instance_name": name,
                "cost": round(entry["cost"], 2),
                "service": entry["service"],
            })

    total_cost = sum(e["cost"] for e in node_breakdown) + sum(e["cost"] for e in unmatched)
    return round(total_cost, 2), node_breakdown, unmatched


def get_cluster_cost(
    infra_id: str,
    current_csv_path: str,
    rows: Optional[List[Dict[str, Any]]] = None,
) -> ClusterCostResult:
    """Extract cluster costs from a single billing CSV by matching infra_id.
    Pass pre-parsed rows to avoid re-reading the file."""
    current_rows = rows if rows is not None else parse_billing_csv(current_csv_path)
    billing_month = extract_billing_month(current_csv_path)
    if not billing_month:
        raise BillingCsvServiceError(f"Could not extract billing month from {current_csv_path}")

    total_cost, node_breakdown, unmatched = get_cluster_cost_from_rows(
        infra_id, current_rows, billing_month
    )

    return ClusterCostResult(
        currency="USD",
        billing_month=billing_month,
        total_cost=total_cost,
        node_breakdown=node_breakdown,
        unmatched_line_items=unmatched,
    )


def get_available_reports(storage_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """List billing CSV files in the storage directory with metadata."""
    path = storage_path or settings.BILLING_CSV_STORAGE_PATH
    if not os.path.isdir(path):
        return []

    reports = []
    for fname in sorted(os.listdir(path)):
        if not fname.endswith(".csv"):
            continue
        fpath = os.path.join(path, fname)
        stat = os.stat(fpath)
        billing_month = extract_billing_month(fpath)
        cluster_count = len(_read_cluster_ids_from_header(fpath))
        reports.append({
            "billing_month": billing_month or "unknown",
            "file_name": fname,
            "file_path": fpath,
            "file_size": stat.st_size,
            "uploaded_at": datetime.fromtimestamp(stat.st_mtime),
            "cluster_count": cluster_count,
        })

    return reports


def _read_cluster_ids_from_header(csv_path: str) -> List[str]:
    """Read cluster infra IDs from CSV column headers without parsing the full file."""
    with open(csv_path, "r", encoding="utf-8") as f:
        for _ in range(HEADER_SKIP_LINES):
            f.readline()
        header_line = f.readline()
    if not header_line:
        return []
    reader = csv.reader(io.StringIO(header_line))
    headers = next(reader, [])
    return sorted(
        col.replace("kubernetes-io-cluster-", "")
        for col in headers
        if col and col.startswith("kubernetes-io-cluster-")
    )


def find_csv_for_month(billing_month: str, storage_path: Optional[str] = None) -> Optional[str]:
    """Find the billing CSV file for a given month (e.g. '2026-07')."""
    reports = get_available_reports(storage_path)
    for r in reports:
        if r["billing_month"] == billing_month:
            return r["file_path"]
    return None


def prior_billing_month(billing_month: str) -> Optional[str]:
    if not _BILLING_MONTH_RE.match(billing_month):
        return None
    year, month = (int(part) for part in billing_month.split("-"))
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def resolve_billing_id(
    infra_id: str,
    rows: List[Dict[str, Any]],
    tag_ids: List[str],
    cluster_name: Optional[str] = None,
) -> str:
    """Find the billing ID that matches Instance Name rows.
    Tries infra_id first, then falls back to tag column IDs that contain
    the cluster name (handles OpenShift infrastructureName != IBM billing ID)."""
    if any(infra_id in (r.get("Instance Name") or "") for r in rows):
        return infra_id
    if cluster_name:
        for tag_id in tag_ids:
            if cluster_name in tag_id:
                if any(tag_id in (r.get("Instance Name") or "") for r in rows):
                    return tag_id
    return infra_id


def detect_cluster_infra_ids(csv_path: str) -> List[str]:
    """Extract unique cluster infra IDs from the CSV tag column names."""
    rows = parse_billing_csv(csv_path)
    if not rows:
        return []

    infra_ids = set()
    for key in rows[0].keys():
        if key and key.startswith("kubernetes-io-cluster-"):
            infra_ids.add(key.replace("kubernetes-io-cluster-", ""))
    return sorted(infra_ids)
