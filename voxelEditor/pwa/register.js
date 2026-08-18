const canRegister = 'serviceWorker' in navigator
  && window.isSecureContext
  && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

if (canRegister) {
  window.addEventListener('load', async () => {
    try {
      const response = await fetch('./service-worker.js', { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) return;
      await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
    } catch (error) {
      console.warn('Voxel Editor PWA registration failed.', error);
    }
  }, { once: true });
}
