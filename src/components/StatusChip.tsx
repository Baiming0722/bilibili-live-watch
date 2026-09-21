import React from "react";
import type { RoomStatus } from "../types";

interface StatusChipProps {
  status: RoomStatus;
  label: string;
}

export function StatusChip({ status, label }: StatusChipProps) {
  return <span className={`status-chip status-${status}`}>{label}</span>;
}
