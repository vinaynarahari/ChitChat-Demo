export interface AudioTimePoint {
  timestamp: number;
  frequencies: number[];
}

export interface AudioAnalysisData {
  duration: number;
  sampleRate: number;
  timePoints: AudioTimePoint[];
} 