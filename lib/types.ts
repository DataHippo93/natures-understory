// Data types for Nature's Understory dashboard

export interface HourlySales {
  hour: number;
  sales: number;
  transactions: number;
  avgTicket: number;
}

export interface DailySales {
  date: string;
  sales: number;
  transactions: number;
  avgTicket: number;
}

export interface QuietScore {
  hour: number;
  score: number; // 0-10, higher = quieter
  label: 'peak' | 'light' | 'quiet';
  transactions: number; // raw transaction count for the hour
  hourlySales: number;  // net sales dollars for the hour
}

export interface RosterEntry {
  employeeId: string;
  employeeName: string;
  department: string;
  shiftStart: string;   // ISO8601
  shiftEnd: string;     // ISO8601
  scheduledHours: number;
  actualHours: number | null; // null = not yet clocked out
  clockedIn: boolean;
  isActual: boolean;    // true = timecard exists, false = projection only
}

export interface RosterDay {
  date: string; // YYYY-MM-DD
  categories: {
    name: string;
    entries: RosterEntry[];
  }[];
  totalScheduledHours: number;
  totalActualHours: number;
  totalScheduledCost: number;
}

export interface DayOfWeekBreakdown {
  day: string;
  avgQuietScore: number;
  bestHours: number[];
  peakHours: number[];
}

export interface LaborActuals {
  date: string;
  timesheetHours: number;
  wages: number;
  fullyLoadedCost: number;
  netSales: number;
  laborRatio: number;
  hasLaborData: boolean;
}

export interface LaborProjection {
  date: string;
  scheduledHours: number;
  projectedWages: number;
  projectedLoadedCost: number;
  projectedSales: number;
  projectedLaborRatio: number;
}

export interface KPIData {
  todaySales: number;
  todaySalesChange: number;
  laborRatio: number;
  laborRatioTarget: number;
  currentQuietScore: number;
  quietScoreLabel: 'peak' | 'light' | 'quiet';
}

export interface ShiftAnalysisData {
  hourlyScores: QuietScore[];
  dayOfWeekBreakdown: DayOfWeekBreakdown[];
  lookbackDays: number;
}

export interface LaborRatioData {
  actuals: LaborActuals[];
  projections: LaborProjection[];
  laborRatioPercent: number;
  projectedRatioPercent: number;
  loadedCostFactor: number;
}
