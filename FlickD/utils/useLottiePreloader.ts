import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';

export function useLottiePreloader(module: any) {
  const [source, setSource] = useState<any>(module);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const asset = Asset.fromModule(module);
        if (!asset.localUri) {
          await asset.downloadAsync();
        }
        if (isMounted) {
          setSource({ uri: asset.localUri || asset.uri });
        }
      } catch (e) {
        // fallback to module
        if (isMounted) setSource(module);
      }
    })();
    return () => { isMounted = false; };
  }, [module]);

  return source;
} 