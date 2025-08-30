import React, { createContext, useContext, useState } from 'react';

interface EavesdropContextType {
  isEavesdropOpen: boolean;
  setIsEavesdropOpen: (isOpen: boolean) => void;
}

const EavesdropContext = createContext<EavesdropContextType | undefined>(undefined);

export const EavesdropProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isEavesdropOpen, setIsEavesdropOpen] = useState(false);

  return (
    <EavesdropContext.Provider value={{ isEavesdropOpen, setIsEavesdropOpen }}>
      {children}
    </EavesdropContext.Provider>
  );
};

export const useEavesdrop = () => {
  const context = useContext(EavesdropContext);
  if (context === undefined) {
    throw new Error('useEavesdrop must be used within an EavesdropProvider');
  }
  return context;
}; 