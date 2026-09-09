import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function getElectronModuleRoot(baseDir = process.cwd())
{
  return path.resolve(baseDir, 'node_modules', 'electron');
}

export function resolveElectronRuntimePath(baseDir = process.cwd())
{
  const electronRoot = getElectronModuleRoot(baseDir);
  const pathFile = path.join(electronRoot, 'path.txt');
  let executablePath;
  if (existsSync(pathFile))
  {
    executablePath = readFileSync(pathFile, 'utf8').trim();
  }
  else
  {
    executablePath = '';
  }

  if (!executablePath)
  {
    return '';
  }
  return path.join(electronRoot, 'dist', executablePath);
}

export function shouldInstallElectronRuntime(baseDir = process.cwd())
{
  const electronRoot = getElectronModuleRoot(baseDir);
  const runtimePath = resolveElectronRuntimePath(baseDir);

  return !existsSync(path.join(electronRoot, 'package.json')) || !runtimePath || !existsSync(runtimePath);
}

export function ensureElectronRuntime(baseDir = process.cwd())
{
  if (!shouldInstallElectronRuntime(baseDir))
  {
    return false;
  }

  const electronRoot = getElectronModuleRoot(baseDir);
  const installScript = path.join(electronRoot, 'install.js');

  if (!existsSync(installScript))
  {
    throw new Error(`Cannot install Electron runtime: ${installScript} is missing`);
  }

  execFileSync(process.execPath, [installScript], { cwd: electronRoot, stdio: 'inherit' });
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`)
{
  const installed = ensureElectronRuntime();
  if (!installed)
  {
    console.log('Electron runtime already available');
  }
}
