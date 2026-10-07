import { resolve, sep } from 'node:path';

export function packagedElectronPath({ packageRoot, outputDirectory, productName, appName, platform = process.platform, arch = process.arch }) {
  if (typeof productName !== 'string' || !productName || /[\\/\x00]/.test(productName) || productName === '.' || productName === '..') throw new Error('Invalid Electron product name.');
  if (typeof outputDirectory !== 'string' || !outputDirectory || outputDirectory.split(/[\\/]/).includes('..')) throw new Error('Invalid Electron output directory.');
  const root = resolve(packageRoot), output = resolve(root, outputDirectory);
  if (!output.startsWith(root + sep)) throw new Error('Electron output must be inside the product root.');
  if (!['x64', 'arm64', 'ia32', 'armv7l'].includes(arch)) throw new Error(`Unsupported Electron architecture: ${arch}`);
  if (platform === 'darwin') return resolve(output, arch === 'x64' ? 'mac' : `mac-${arch}`, `${productName}.app`, 'Contents/MacOS', productName);
  if (platform === 'win32') return resolve(output, arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`, `${productName}.exe`);
  if (platform === 'linux') {
    if (typeof appName !== 'string' || !/^[a-z0-9._-]+$/.test(appName) || ['.', '..'].includes(appName)) throw new Error('Linux package name is required.');
    return resolve(output, arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`, appName);
  }
  throw new Error(`Unsupported Electron platform: ${platform}`);
}
