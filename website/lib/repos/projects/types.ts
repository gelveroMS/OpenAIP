export type ProjectKind = "health" | "infrastructure";

export const PROJECT_STATUS_VALUES = [
  "proposed",
  "ongoing",
  "completed",
  "on_hold",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

export type BarangayProjectScope = {
  barangayId?: string | null;
  barangayScopeName?: string | null;
};

export type CityProjectScope = {
  cityId?: string | null;
  cityScopeName?: string | null;
};

export type ProjectReadOptions = BarangayProjectScope &
  CityProjectScope & {
    publishedOnly?: boolean;
  };

export type ProjectMaster = {
  projectRefCode: string;
  year: number;
  kind: ProjectKind;
  title: string;
  lguLabel?: string;
  status: ProjectStatus;
  imageUrl?: string;
};

export type HealthProjectDetails = {
  projectRefCode: string;
  month: string;
  startDate: string;
  targetCompletionDate: string;
  totalTargetParticipants: number;
  targetParticipants: string;
  implementingOffice: string;
  budgetAllocated: number;
};

export type InfrastructureProjectDetails = {
  projectRefCode: string;
  startDate: string;
  targetCompletionDate: string;
  implementingOffice: string;
  fundingSource: string;
  contractorName: string;
  contractCost: number;
};

export type ProjectUpdate = {
  id: string;
  projectRefCode: string;
  title: string;
  date: string;
  description: string;
  progressPercent?: number;
  attendanceCount?: number;
  photoUrls?: string[];
  isHidden?: boolean;
  isRedacted?: boolean;
  hiddenReason?: string | null;
  violationCategory?: string | null;
};

export type ProjectUpdateUi = {
  id: string;
  title: string;
  date: string;
  description: string;
  progressPercent: number;
  photoUrls?: string[];
  attendanceCount?: number;
  isHidden?: boolean;
  isRedacted?: boolean;
  hiddenReason?: string | null;
  violationCategory?: string | null;
};

export type HealthProject = Omit<ProjectMaster, "projectRefCode" | "kind"> & {
  id: string;
  kind: "health";
  month: HealthProjectDetails["month"];
  startDate: HealthProjectDetails["startDate"];
  targetCompletionDate: HealthProjectDetails["targetCompletionDate"];
  description: string;
  totalTargetParticipants: HealthProjectDetails["totalTargetParticipants"];
  targetParticipants: HealthProjectDetails["targetParticipants"];
  implementingOffice: HealthProjectDetails["implementingOffice"];
  budgetAllocated: HealthProjectDetails["budgetAllocated"];
  updates: ProjectUpdate[];
};

export type InfrastructureProject = Omit<ProjectMaster, "projectRefCode" | "kind"> & {
  id: string;
  kind: "infrastructure";
  description: string;
  startDate: InfrastructureProjectDetails["startDate"];
  targetCompletionDate: InfrastructureProjectDetails["targetCompletionDate"];
  implementingOffice: InfrastructureProjectDetails["implementingOffice"];
  fundingSource: InfrastructureProjectDetails["fundingSource"];
  contractorName: InfrastructureProjectDetails["contractorName"];
  contractCost: InfrastructureProjectDetails["contractCost"];
  updates: ProjectUpdate[];
};

export type ProjectBundle = HealthProject | InfrastructureProject;

export type OtherProject = {
  id: string;
  projectRefCode: string;
  year: number;
  kind: "other";
  title: string;
  lguLabel?: string;
  status: ProjectStatus;
  imageUrl?: string;
  updates: ProjectUpdate[];
};

export type UiProject = HealthProject | InfrastructureProject | OtherProject;
