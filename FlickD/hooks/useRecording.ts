import { useState, useEffect, useCallback } from 'react';
import RecordingService, { RecordingState } from '../services/recordingService';

export const useRecording = () => {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    recording: null,
    isRecording: false,
    duration: 0,
    startTime: 0
  });

  const recordingService = RecordingService.getInstance();

  useEffect(() => {
    const unsubscribe = recordingService.subscribe(setRecordingState);
    return unsubscribe;
  }, [recordingService]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    return await recordingService.startRecording();
  }, [recordingService]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    return await recordingService.stopRecording();
  }, [recordingService]);

  const cancelRecording = useCallback(async (): Promise<void> => {
    await recordingService.cancelRecording();
  }, [recordingService]);

  return {
    isRecording: recordingState.isRecording,
    duration: recordingState.duration,
    startRecording,
    stopRecording,
    cancelRecording,
    isCurrentlyRecording: recordingService.isCurrentlyRecording()
  };
}; 