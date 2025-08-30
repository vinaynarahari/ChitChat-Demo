import React, { createContext, useContext, useState } from 'react';

interface GestureContextType {
  disableTabGestures: boolean;
  setDisableTabGestures: (disable: boolean) => void;
}

const GestureContext = createContext<GestureContextType | undefined>(undefined);

export const GestureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [disableTabGestures, setDisableTabGestures] = useState(false);

  return (
    <GestureContext.Provider value={{ disableTabGestures, setDisableTabGestures }}>
      {children}
    </GestureContext.Provider>
  );
};

export const useGestureContext = () => {
  const context = useContext(GestureContext);
  if (context === undefined) {
    throw new Error('useGestureContext must be used within a GestureProvider');
  }
  return context;
}; 