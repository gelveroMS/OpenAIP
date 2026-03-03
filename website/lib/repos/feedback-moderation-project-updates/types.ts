import type {
  ActivityLogRow,
  AipRow,
  ProjectUpdateMediaRow,
  ProjectUpdateRow,
  ProfileRow,
  ProjectRow,
} from "@/lib/contracts/databasev2";

export type ProjectUpdateRecord = ProjectUpdateRow;
export type ModerationActionRecord = ActivityLogRow;
export type ProjectUpdateMediaRecord = ProjectUpdateMediaRow;

export type AipRecord = AipRow;
export type ProjectRecord = ProjectRow;
export type ProfileRecord = ProfileRow;

export type CityRecord = {
  id: string;
  region_id: string;
  province_id: string | null;
  psgc_code: string;
  name: string;
  is_independent: boolean;
  is_active: boolean;
  created_at: string;
};

export type BarangayRecord = {
  id: string;
  city_id: string | null;
  municipality_id: string | null;
  psgc_code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type MunicipalityRecord = {
  id: string;
  province_id: string;
  psgc_code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type ProjectUpdateStatus = "Visible" | "Hidden";
export type ProjectUpdateType = "Update" | "Photo";

export type ProjectUpdateRowModel = {
  id: string;
  previewUrl: string | null;
  title: string;
  caption: string | null;
  lguName: string;
  uploadedBy: string;
  type: ProjectUpdateType;
  status: ProjectUpdateStatus;
  date: string;
};

export type ProjectUpdateDetailsModel = {
  id: string;
  projectTitle: string;
  lguName: string;
  updateTitle: string;
  updateCaption: string | null;
  updateContent: string;
  progressPercent: number | null;
  attendanceCount: number | null;
  attachments: string[];
  uploadedByName: string;
  uploadedByPosition: string | null;
  uploadedByEmail: string | null;
  uploadedAt: string;
  status: ProjectUpdateStatus;
  hiddenReason: string | null;
  violationCategory: string | null;
};
